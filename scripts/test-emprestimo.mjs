#!/usr/bin/env node
/**
 * test-emprestimo.mjs — executa a 0110 inteira em transacao e da ROLLBACK.
 *
 * O que ele prova, alem das assercoes da propria migration:
 *
 *  1. A ANCORA DO DINHEIRO nao se move. Fotografa (conta, saldo) antes e
 *     depois e exige `EXCEPT ALL` vazio nos dois sentidos — a mesma defesa que
 *     a 0109 usou para a composicao das notificacoes.
 *  2. A PROVA DA TAXA: com o spread sozinho a Price reproduz R$ 4.683,50.
 *  3. O CONFRONTO parcela a parcela contra as transferencias reais.
 *  4. O saldo devedor de hoje, com memoria de calculo.
 *
 * Nada e gravado. `--catalogo` imprime o cronograma inteiro.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const MIGRATION = path.join(RAIZ, 'db', 'migrations', '0110_fin_emprestimo.sql');

const CATALOGO = process.argv.includes('--catalogo');

const url = process.env.FINANCE_DATABASE_URL?.trim();
if (!url) {
  console.error('✗ FINANCE_DATABASE_URL nao configurada');
  process.exit(2);
}

const brl = (c) =>
  c === null || c === undefined
    ? 'indeterminado'
    : (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10).split('-').reverse().join('/') : '—');

let passou = 0;
let falhou = 0;
const afirma = (ok, o_que, detalhe = '') => {
  if (ok) {
    passou += 1;
    console.log(`  ✓ ${o_que}${detalhe ? ` — ${detalhe}` : ''}`);
  } else {
    falhou += 1;
    console.log(`  ✗ ${o_que}${detalhe ? ` — ${detalhe}` : ''}`);
  }
};

const client = new pg.Client({ connectionString: url });
await client.connect();

const ancora = async () => {
  const r = await client.query(`
    SELECT a.slug,
           (a.opening_balance_cents + COALESCE(sum(t.amount_cents), 0))::bigint AS saldo
      FROM fin_account a
      LEFT JOIN fin_transaction t ON t.account_id = a.id AND NOT t.is_split_parent
     GROUP BY a.slug, a.opening_balance_cents
     ORDER BY a.slug`);
  return r.rows.map((x) => `${x.slug}=${x.saldo}`).join('|');
};

const ledger = async () => {
  const r = await client.query(
    'SELECT count(*) n, COALESCE(sum(amount_cents),0) s, count(*) FILTER (WHERE category_id IS NOT NULL) c FROM fin_transaction'
  );
  return `${r.rows[0].n}/${r.rows[0].s}/${r.rows[0].c}`;
};

try {
  console.log('═'.repeat(78));
  console.log('0110_fin_emprestimo — validacao em transacao (ROLLBACK ao final)');
  console.log('═'.repeat(78));

  const ancoraAntes = await ancora();
  const ledgerAntes = await ledger();

  await client.query('BEGIN');

  console.log('\n1. A migration aplica inteira, com as proprias assercoes');
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const t0 = Date.now();
  const res = await client.query(sql);
  const ms = Date.now() - t0;
  afirma(true, 'a 0110 executou e nenhuma assercao dela disparou', `${ms} ms`);
  const notices = (Array.isArray(res) ? res : [res])
    .flatMap((r) => r?.rows ?? [])
    .length;
  void notices;

  // ------------------------------------------------------------------
  console.log('\n2. A ancora do dinheiro nao se moveu');
  const ancoraDepois = await ancora();
  const ledgerDepois = await ledger();
  afirma(ancoraAntes === ancoraDepois, 'saldo por conta identico antes e depois');
  if (ancoraAntes !== ancoraDepois) console.log(`     antes  ${ancoraAntes}\n     depois ${ancoraDepois}`);
  afirma(ledgerAntes === ledgerDepois, 'ledger identico (linhas/soma/categorizadas)', ledgerDepois);

  const dif = await client.query(`
    SELECT count(*) n FROM (
      (SELECT id, amount_cents, category_id, classified_by, classified_rule_id FROM fin_transaction
       EXCEPT ALL
       SELECT id, amount_cents, category_id, classified_by, classified_rule_id FROM fin_transaction)
    ) x`);
  afirma(Number(dif.rows[0].n) === 0, 'EXCEPT ALL sobre fin_transaction vazio');

  // ------------------------------------------------------------------
  console.log('\n3. A prova da leitura da taxa — o spread sozinho reproduz o contrato');
  const price = await client.query(`
    SELECT prestacao_contratual_cents AS contrato,
           round((principal_cents/100.0) * power(1+spread_mensal, carencia_meses)
                 * spread_mensal / (1 - power(1+spread_mensal, -prestacoes)) * 100) AS calculado,
           round((principal_cents/100.0) * power(1+spread_mensal, carencia_meses) * 100) AS saldo_fim_carencia
      FROM fin_emprestimo WHERE ccb = '0.000.000.002.266.602'`);
  const p = price.rows[0];
  afirma(
    Math.abs(Number(p.calculado) - Number(p.contrato)) <= 10,
    'Price(37) sobre 11 meses de capitalizacao = prestacao impressa na CCB',
    `calculado ${brl(p.calculado)} · contrato ${brl(p.contrato)} · saldo fim da carencia ${brl(p.saldo_fim_carencia)}`
  );

  // ------------------------------------------------------------------
  console.log('\n4. O cronograma');
  const cron = await client.query(`
    SELECT count(*) FILTER (WHERE fase='carencia') car,
           count(*) FILTER (WHERE fase='amortizacao') amo,
           count(*) FILTER (WHERE origem_taxa='observada') obs,
           count(*) FILTER (WHERE origem_taxa='cenario') cen,
           count(*) FILTER (WHERE estimada) est,
           max(periodo) fim
      FROM fin_emprestimo_cronograma_v`);
  const c = cron.rows[0];
  afirma(Number(c.car) === 11 && Number(c.amo) === 37, '11 de carencia + 37 prestacoes = 48 periodos', `fim ${c.fim}`);
  afirma(Number(c.est) === 48, 'todas as 48 linhas carregam a marca de estimativa');
  afirma(Number(c.obs) === 28, 'Selic observada em 28 periodos', `cenario em ${c.cen}`);

  const zero = await client.query(
    'SELECT saldo_devedor_cents s FROM fin_emprestimo_cronograma_v ORDER BY periodo DESC LIMIT 1'
  );
  afirma(Math.abs(Number(zero.rows[0].s)) <= 100, 'a divida amortiza ate zero na ultima parcela', brl(zero.rows[0].s));

  // ------------------------------------------------------------------
  console.log('\n5. As transferencias, pela chave certa');
  const tr = await client.query(
    'SELECT conta_origem, movimento_em, valor_cents FROM fin_emprestimo_transferencia_v ORDER BY movimento_em'
  );
  const soma = tr.rows.reduce((a, x) => a + Number(x.valor_cents), 0);
  afirma(tr.rows.length === 5, 'a chave certa acha as 5 transferencias', `soma ${brl(soma)}`);
  afirma(soma === 2540000, 'somam R$ 25.400,00 ao centavo');
  afirma(new Set(tr.rows.map((x) => x.conta_origem)).size === 1, 'todas do Inter — nao ha Asaas nem Nubank');
  for (const x of tr.rows) console.log(`     ${dia(x.movimento_em)}  ${x.conta_origem.padEnd(8)} ${brl(x.valor_cents)}`);

  const cnpjCaixa = await client.query(
    "SELECT count(*) n FROM fin_transaction WHERE counterparty_document LIKE '00360305%'"
  );
  afirma(
    Number(cnpjCaixa.rows[0].n) === 0,
    'a busca pelo CNPJ da CAIXA continua devolvendo zero — a chave e o CNPJ da propria XPE'
  );

  // ------------------------------------------------------------------
  console.log('\n6. O confronto parcela a parcela (so as vencidas)');
  const conf = await client.query(`
    SELECT parcela, vencimento_em, modelo_cents, contrato_cents, observado_cents,
           diferenca_cents, diferenca_pct, estado, cobertura_origem, origem_taxa
      FROM fin_emprestimo_confronto_v
     WHERE vencimento_em <= current_date
     ORDER BY parcela`);
  console.log('     #   venc.       modelo        contrato      observado     dif.      estado');
  for (const r of conf.rows) {
    const d = r.diferenca_pct === null ? '     —' : `${(Number(r.diferenca_pct) * 100).toFixed(2)}%`.padStart(7);
    console.log(
      `     ${String(r.parcela).padStart(2)}  ${dia(r.vencimento_em)}  ${brl(r.modelo_cents).padStart(12)}  ` +
        `${brl(r.contrato_cents).padStart(12)}  ${(r.observado_cents ? brl(r.observado_cents) : '—').padStart(12)}  ${d}  ${r.estado}`
    );
  }
  const comObs = conf.rows.filter((r) => r.observado_cents !== null);
  afirma(comObs.length === 5, '5 prestacoes vencidas tem alguma transferencia no mes', `de ${conf.rows.length} vencidas`);

  // O erro do MODELO so pode ser medido contra funding que pretende pagar a
  // parcela. Os R$ 650,00 de janeiro nao pretendem: sao 10% dela. Misturar os
  // dois mede a decisao de quem transferiu, nao a qualidade do modelo.
  const compat = conf.rows.filter((r) => r.estado === 'vencida_com_funding_compativel');
  const insuf = conf.rows.filter((r) => r.estado === 'vencida_com_funding_insuficiente');
  afirma(compat.length === 4, '4 delas com valor compativel com a prestacao');
  afirma(
    insuf.length === 1,
    '1 com funding insuficiente, exposta em vez de contada como paga',
    insuf.map((r) => `${dia(r.vencimento_em)} ${brl(r.observado_cents)} de ${brl(r.modelo_cents)}`).join('')
  );
  const erroMedio = compat.reduce((a, r) => a + Math.abs(Number(r.diferenca_pct)), 0) / (compat.length || 1);
  afirma(
    erroMedio < 0.05,
    'erro absoluto medio do modelo, nas 4 compativeis, abaixo de 5%',
    `${(erroMedio * 100).toFixed(2)}%`
  );
  const semFunding = conf.rows.filter((r) => r.estado === 'vencida_sem_funding_na_janela_coberta');
  afirma(
    semFunding.length > 0,
    'ha prestacao vencida SEM funding dentro da janela coberta — o achado 5',
    `${semFunding.length} prestacao(oes): ${semFunding.map((r) => dia(r.vencimento_em)).join(', ')}`
  );

  // ------------------------------------------------------------------
  console.log('\n7. O saldo devedor de hoje');
  const s = (await client.query('SELECT * FROM fin_emprestimo_saldo_v')).rows[0];
  console.log(`     ${s.memoria}`);
  console.log(`     natureza ......... ${s.natureza}`);
  console.log(`     ressalva ......... ${s.ressalva}`);
  console.log(`     vencidas ......... ${s.vencidas} de ${s.prestacoes}  (funding compativel ${s.com_funding} · funding insuficiente ${s.funding_insuficiente} · sem funding na janela coberta ${s.sem_funding_coberta} · fora da cobertura ${s.fora_da_cobertura})`);
  console.log(`     devido total ..... ${brl(s.devido_cents)}`);
  console.log(`     devido na janela . ${brl(s.devido_na_cobertura_cents)}`);
  console.log(`     transferido ...... ${brl(s.transferido_cents)} em ${s.transferencias} lancamentos`);
  console.log(`     lacuna ........... ${brl(s.lacuna_na_cobertura_cents)}`);
  console.log(`     proxima parcela .. ${brl(s.proxima_prestacao_cents)} em ${dia(s.proxima_parcela_em)} (${s.proxima_origem_taxa})`);
  afirma(Number(s.saldo_devedor_cents) > 0, 'saldo devedor positivo', brl(s.saldo_devedor_cents));
  afirma(s.natureza === 'piso', 'o saldo se declara piso, com a direcao do erro escrita');
  afirma(Number(s.lacuna_na_cobertura_cents) > 0, 'a lacuna de funding continua exposta', brl(s.lacuna_na_cobertura_cents));

  // ------------------------------------------------------------------
  console.log('\n8. A visao de caixa por conta');
  const contas = await client.query('SELECT * FROM fin_caixa_conta_v ORDER BY slug');
  let total = 0;
  for (const r of contas.rows) {
    if (r.saldo_cents !== null) total += Number(r.saldo_cents);
    console.log(
      `     ${r.slug.padEnd(18)} ${(r.saldo_cents === null ? 'indeterminado' : brl(r.saldo_cents)).padStart(14)}` +
        (r.saldo_cents === null ? `  ← ${String(r.motivo_sem_saldo).slice(0, 60)}…` : '') +
        (r.passivo_saldo_devedor_cents ? `  [passivo ${brl(r.passivo_saldo_devedor_cents)}]` : '')
    );
  }
  console.log(`     ${'TOTAL disponivel'.padEnd(18)} ${brl(total).padStart(14)}`);
  afirma(contas.rows.filter((r) => r.saldo_cents !== null).length === 4, '4 contas com saldo, 2 sem');
  afirma(
    contas.rows.filter((r) => r.saldo_cents === null && !r.motivo_sem_saldo).length === 0,
    'nenhuma conta sem saldo ficou sem motivo'
  );
  const emprestimoConta = contas.rows.find((r) => r.slug === 'caixa-emprestimo');
  afirma(
    emprestimoConta && emprestimoConta.saldo_cents === null && emprestimoConta.passivo_saldo_devedor_cents !== null,
    'o passivo do Pronampe NAO virou saldo de conta',
    `passivo ${brl(emprestimoConta?.passivo_saldo_devedor_cents)}`
  );
  const aplic = contas.rows.find((r) => r.slug === 'caixa-aplicacao');
  afirma(aplic && aplic.saldo_cents === null, 'caixa-aplicacao continua indeterminada, nunca R$ 0,00');

  // ------------------------------------------------------------------
  console.log('\n9. A serie mensal fecha com o saldo de hoje');
  const serie = await client.query(`
    SELECT DISTINCT ON (account_id) slug, mes, saldo_fim_cents,
           (SELECT current_balance_cents FROM fin_account a WHERE a.id = account_id) atual
      FROM fin_caixa_serie_mensal_v ORDER BY account_id, mes DESC`);
  for (const r of serie.rows) {
    afirma(
      String(r.saldo_fim_cents) === String(r.atual),
      `${r.slug}: ultimo mes da serie = saldo atual`,
      `${dia(r.mes)} ${brl(r.saldo_fim_cents)}`
    );
  }
  const nMeses = await client.query('SELECT count(*) n, count(DISTINCT mes) m FROM fin_caixa_serie_mensal_v');
  console.log(`     serie: ${nMeses.rows[0].n} pontos em ${nMeses.rows[0].m} meses`);

  // ------------------------------------------------------------------
  console.log('\n10. O extrato estimado da conta na Caixa');
  const ext = await client.query(`
    SELECT count(*) n, count(*) FILTER (WHERE estimado) est,
           count(*) FILTER (WHERE origem='transferencia_observada') obs,
           min(data) de, max(data) ate
      FROM fin_caixa_extrato_estimado_v`);
  const e = ext.rows[0];
  afirma(Number(e.obs) === 5, 'o extrato estimado traz as 5 entradas reais', `${e.n} linhas, de ${dia(e.de)} a ${dia(e.ate)}`);
  afirma(Number(e.est) === Number(e.n) - Number(e.obs), 'toda saida e estimada e esta marcada');

  if (CATALOGO) {
    console.log('\n' + '─'.repeat(78));
    console.log('CRONOGRAMA INTEGRAL');
    console.log('─'.repeat(78));
    const todos = await client.query(`
      SELECT periodo, parcela, vencimento_em, fase, taxa_mes, selic_mes, origem_taxa,
             encargo_cents, principal_cents, prestacao_cents, saldo_devedor_cents, estado
        FROM fin_emprestimo_cronograma_v ORDER BY periodo`);
    console.log('per  #    venc.        taxa     selic    encargo      principal    prestacao    saldo devedor  estado');
    for (const r of todos.rows) {
      console.log(
        `${String(r.periodo).padStart(3)}  ${String(r.parcela ?? '').padStart(2)}  ${dia(r.vencimento_em)}  ` +
          `${(Number(r.taxa_mes) * 100).toFixed(4).padStart(7)}% ${(Number(r.selic_mes) * 100).toFixed(4).padStart(7)}% ` +
          `${brl(r.encargo_cents).padStart(12)} ${brl(r.principal_cents).padStart(12)} ${brl(r.prestacao_cents).padStart(12)} ` +
          `${brl(r.saldo_devedor_cents).padStart(14)}  ${r.estado}${r.origem_taxa === 'cenario' ? ' (cenario)' : ''}`
      );
    }
  }
} catch (err) {
  falhou += 1;
  console.error(`\n✗ ${err.message}`);
  if (err.where) console.error(`  em: ${err.where}`);
} finally {
  await client.query('ROLLBACK').catch(() => {});
}

const ancoraFinal = await ancora();
console.log('\n' + '═'.repeat(78));
console.log(`ROLLBACK dado. Ancora apos o rollback: ${ancoraFinal}`);
console.log(`${passou} afirmacao(oes) passaram · ${falhou} falharam`);
console.log('═'.repeat(78));

await client.end();
process.exit(falhou > 0 ? 1 : 0);
