// Teste de aceite de competência, DRE, fluxo de caixa e balanço gerencial.
//
//   node scripts/test-contabil.mjs
//
// ---------------------------------------------------------------------------
// POR QUE ESTE TESTE APLICA AS MIGRATIONS E DÁ ROLLBACK
// ---------------------------------------------------------------------------
// As migrations 0071–0073 podem ainda não ter sido aplicadas no banco. Um teste
// que só passa depois de `npm run db:migrate` não serve para VALIDAR a
// migration — serve para validar o que já foi decidido.
//
// Então o teste abre uma transação, aplica os três arquivos do disco, faz todas
// as afirmações contra o estado resultante e dá ROLLBACK. Nada é persistido, e
// o que está sendo testado é exatamente o SQL que será aplicado.
//
// Depois de aplicadas de verdade, o teste PARA de reaplicá-las, e isso não é
// economia de tempo — é convivência. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
// pega ACCESS EXCLUSIVE em fin_transaction ANTES de descobrir que a coluna já
// existe, e segura esse lock até o fim da transação. Com outros agentes lendo o
// ledger ao mesmo tempo, isso os trava por minutos. Medido: 5 consultas de
// outras sessões esperando 2min27s por causa de um ALTER que não fazia nada.
//
// Então: se o schema já tem as views, o teste só afirma. `--aplicar` força a
// aplicação, que é o modo de validar migration ainda pendente.
//
// ---------------------------------------------------------------------------
// O QUE ESTE TESTE PROVA, E O QUE ELE DELIBERADAMENTE NÃO PROVA
// ---------------------------------------------------------------------------
// PROVA:
//   · toda linha tem competência E a regra que a produziu;
//   · o backfill é idempotente;
//   · cada subtotal da DRE é a soma dos seus componentes;
//   · a DRE por dimensão soma exatamente a DRE mensal;
//   · nenhum lançamento do ledger some da DRE;
//   · o fluxo de caixa reconstrói o saldo de CADA conta, conferido contra
//     fin_account e contra o snapshot da API;
//   · o balanço equilibra e o não conciliado está DECLARADO, não escondido;
//   · os três invariantes: transferência própria neutra, fatura de cartão não é
//     despesa, e a DRE lê UMA camada de receita.
//
// NÃO PROVA:
//   · que a classificação está certa. Um lançamento no 5.99 fecha todas as
//     somas e continua sem dizer o que é. Isso é fila humana, não teste.
//   · que a competência da folha é a real. Ela é CONVENÇÃO declarada; o teste
//     verifica que a convenção foi aplicada, não que ela corresponde à folha.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = [
  'db/migrations/0071_fin_competencia.sql',
  'db/migrations/0072_fin_dre.sql',
  'db/migrations/0073_fin_balanco_fluxo.sql',
];

const forcarAplicacao = process.argv.includes('--aplicar');

const brl = (c) => (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

let falhas = 0;
let passes = 0;

function ok(nome, detalhe = '') {
  passes += 1;
  console.log(`  ✓ ${nome}${detalhe ? `: ${detalhe}` : ''}`);
}
function falhou(nome, detalhe) {
  falhas += 1;
  console.error(`  ✗ ${nome}\n      ${detalhe}`);
}
function igual(nome, atual, esperado, formatar = brl) {
  const a = Number(atual);
  const e = Number(esperado);
  if (a === e) ok(nome, formatar(a));
  else falhou(nome, `esperado ${formatar(e)} · obtido ${formatar(a)} · delta ${formatar(a - e)}`);
}
function zero(nome, valor, formatar = brl) {
  igual(nome, valor, 0, formatar);
}
const inteiro = (n) => String(n);
// pg devolve DATE como string quando fin-types registra o parser, e como Date
// quando não registra. Formatar sem saber qual é evita um teste que quebra por
// causa do driver em vez de por causa do número.
const mes = (d) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 7);
const dia = (d) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);

const pool = financePool();
const client = await pool.connect();
const q = async (sql, params = []) => (await client.query(sql, params)).rows;

try {
  await client.query('BEGIN');
  // Falhar rápido é melhor que fazer fila: se alguém está com o ledger travado,
  // este teste desiste em 5s em vez de segurar lock atrás de lock.
  await client.query("SET LOCAL lock_timeout = '5s'");

  const [{ pronto }] = await q(
    `SELECT (to_regclass('fin_competence_rule') IS NOT NULL
         AND to_regclass('fin_dre_linha') IS NOT NULL
         AND to_regclass('fin_balanco_mensal_v') IS NOT NULL) AS pronto`);

  if (pronto && !forcarAplicacao) {
    console.log('\n=== 0. Schema já tem 0071–0073; afirmando contra o banco como está ===');
    console.log('     (use --aplicar para reaplicar as migrations dentro da transação)');
  } else {
    console.log('\n=== 0. Aplicando 0071–0073 na transação (rollback no fim) ===');
    for (const arquivo of MIGRATIONS) {
      await client.query(readFileSync(join(raiz, arquivo), 'utf8'));
      console.log(`  · ${arquivo}`);
    }
  }

  // -------------------------------------------------------------------------
  console.log('\n=== 1. Competência: toda linha tem data E regra ===');

  const [comp] = await q(`
    SELECT count(*) FILTER (WHERE competence_date IS NULL)                            AS sem_data,
           count(*) FILTER (WHERE competence_date IS NOT NULL AND competence_rule IS NULL) AS sem_regra,
           count(*)                                                                   AS total
      FROM fin_transaction`);
  igual('lançamentos sem competência', comp.sem_data, 0, inteiro);
  igual('competência sem regra declarada', comp.sem_regra, 0, inteiro);

  const [compCartao] = await q(`
    SELECT count(*) FILTER (WHERE competence_date IS NULL) AS sem_data,
           count(*) FILTER (WHERE competence_date IS NOT NULL AND competence_rule IS NULL) AS sem_regra
      FROM fin_card_transaction`);
  igual('itens de cartão sem competência', compCartao.sem_data, 0, inteiro);
  igual('itens de cartão com data sem regra', compCartao.sem_regra, 0, inteiro);

  // O backfill roda de novo dentro da mesma transação. Se ele não for
  // idempotente, mexe em linha — e aí rodar o backfill duas vezes daria
  // resultados diferentes, que é o pior tipo de bug num ledger.
  const rerun = await q(`SELECT * FROM fin_competencia_backfill(true)`);
  igual('backfill idempotente (nada muda ao rodar de novo)', rerun.length, 0, inteiro);

  console.log('\n  Cobertura por regra:');
  for (const r of await q(`
      SELECT aplica_em, regra, confianca, linhas, pct_linhas, valor_cents,
             linhas_que_mudam_de_mes, valor_que_muda_de_mes_cents
        FROM fin_competencia_cobertura_v ORDER BY aplica_em, precedencia`)) {
    console.log(
      `    ${String(r.linhas).padStart(5)} ${String(r.pct_linhas ?? 0).padStart(6)}%  ` +
      `${r.confianca.padEnd(10)} ${r.regra.padEnd(28)} ${brl(r.valor_cents).padStart(18)}  ` +
      `muda de mês: ${String(r.linhas_que_mudam_de_mes).padStart(4)} (${brl(r.valor_que_muda_de_mes_cents)})`
    );
  }

  const [presumida] = await q(`
    SELECT COALESCE(sum(linhas) FILTER (WHERE confianca = 'presumida'), 0) AS presumidas,
           sum(linhas) AS total
      FROM fin_competencia_cobertura_v WHERE aplica_em = 'fin_transaction'`);
  console.log(`\n  Presumidas: ${presumida.presumidas} de ${presumida.total} ` +
    `(${(100 * Number(presumida.presumidas) / Number(presumida.total)).toFixed(2)}%) — a lacuna declarada.`);

  // -------------------------------------------------------------------------
  console.log('\n=== 2. DRE fecha com seus componentes ===');
  //
  // Cada subtotal é recalculado a partir dos itens e comparado com o que a view
  // devolve. Um erro de sinal em qualquer linha aparece aqui.
  const somas = await q(`
    SELECT visao, mes,
      receita_liquida_cents        - (receita_bruta_cents + deducoes_cents)                   AS d_receita_liquida,
      deducoes_cents               - (deducoes_devolucoes_cents + deducoes_impostos_cents)    AS d_deducoes,
      margem_contribuicao_cents    - (receita_liquida_cents + custos_diretos_cents)           AS d_margem,
      resultado_operacional_cents  - (margem_contribuicao_cents + despesas_pessoal_cents
                                      + despesas_comerciais_cents + despesas_administrativas_cents) AS d_operacional,
      lair_cents                   - (resultado_operacional_cents + resultado_financeiro_cents) AS d_lair,
      lucro_liquido_cents          - (lair_cents + irpj_csll_cents)                           AS d_lucro,
      lucro_liquido_com_lacunas_cents - (lucro_liquido_cents + lacuna_ledger_cents + lacuna_cartao_cents) AS d_lacunas
      FROM fin_dre_mensal_v`);
  const quebras = somas.filter((r) => Object.entries(r)
    .filter(([k]) => k.startsWith('d_')).some(([, v]) => Number(v) !== 0));
  igual('meses com subtotal que não fecha', quebras.length, 0, inteiro);
  if (quebras.length) console.error('     ', JSON.stringify(quebras.slice(0, 3)));

  // Nenhum lançamento pode sumir entre o ledger e a DRE. Esta é a diferença
  // entre "a DRE fecha" e "a DRE fecha com TUDO dentro".
  const [cobertura] = await q(`
    SELECT (SELECT count(*) FROM fin_transaction WHERE NOT is_split_parent) AS ledger,
           (SELECT count(*) FROM fin_dre_lancamento_v WHERE origem = 'ledger') AS dre,
           (SELECT COALESCE(sum(amount_cents), 0) FROM fin_transaction WHERE NOT is_split_parent) AS ledger_cents,
           (SELECT COALESCE(sum(amount_cents), 0) FROM fin_dre_lancamento_v WHERE origem = 'ledger') AS dre_cents`);
  igual('lançamentos do ledger na DRE', cobertura.dre, cobertura.ledger, inteiro);
  igual('valor do ledger na DRE', cobertura.dre_cents, cobertura.ledger_cents);

  // A soma sobre todas as dimensões tem de reproduzir a DRE mensal. É o teste
  // que pega dimensão NULA sendo descartada por um GROUP BY descuidado.
  const [dim] = await q(`
    SELECT count(*) AS divergentes FROM (
      SELECT d.visao, d.mes FROM (
        SELECT visao, mes, sum(lucro_liquido_cents) ll, sum(lancamentos) n
          FROM fin_dre_dimensao_v GROUP BY 1, 2) d
      JOIN fin_dre_mensal_v m ON m.visao = d.visao AND m.mes = d.mes
      WHERE d.ll <> m.lucro_liquido_cents OR d.n <> m.lancamentos) x`);
  igual('meses em que a dimensão não soma o mensal', dim.divergentes, 0, inteiro);

  const [longo] = await q(`SELECT count(*) AS nulos FROM fin_dre_v WHERE valor_cents IS NULL`);
  igual('linhas da DRE longa sem valor', longo.nulos, 0, inteiro);

  // -------------------------------------------------------------------------
  console.log('\n=== 3. Os três invariantes ===');

  // 3.1 Transferência entre contas próprias é NEUTRA na DRE.
  //
  // O teste é sobre dre_line='nao_operacional' (9.01 a 9.05), não sobre o grupo
  // 'movimentacao' inteiro. O grupo também abriga 9.10 rendimentos, 9.11 juros e
  // 9.12 marcação, que têm dre_line='resultado_financeiro' e DEVEM entrar no
  // resultado — rendimento de aplicação é resultado financeiro, não transferência.
  // Testar pelo grupo reprovaria o comportamento correto.
  const [neutra] = await q(`
    SELECT count(*) AS vazadas FROM fin_dre_lancamento_v l
      JOIN fin_transaction t ON t.id = l.lancamento_id AND l.origem = 'ledger'
      JOIN fin_category c ON c.id = t.category_id
      JOIN fin_dre_linha d ON d.slug = l.linha
     WHERE c.dre_line = 'nao_operacional' AND d.secao = 'resultado'`);
  igual('transferência própria que vazou para o resultado', neutra.vazadas, 0, inteiro);

  // E o outro lado: o dinheiro de movimentação não pode simplesmente sumir.
  const [neutraTotal] = await q(`
    SELECT (SELECT COALESCE(sum(t.amount_cents), 0) FROM fin_transaction t
              JOIN fin_category c ON c.id = t.category_id
             WHERE NOT t.is_split_parent AND c.dre_line = 'nao_operacional'
               AND NOT EXISTS (SELECT 1 FROM fin_card_bill b WHERE b.paid_transaction_id = t.id)) AS ledger,
           (SELECT COALESCE(sum(movimentacao_cents), 0) FROM fin_dre_mensal_v WHERE visao = 'caixa') AS dre`);
  igual('movimentação preservada na seção fora', neutraTotal.dre, neutraTotal.ledger);

  // 3.2 Fatura de cartão não é despesa — nas duas direções.
  const [fatura] = await q(`
    SELECT (SELECT count(*) FROM fin_dre_lancamento_v l
              JOIN fin_dre_linha d ON d.slug = l.linha
             WHERE l.origem = 'ledger' AND d.secao = 'resultado'
               AND EXISTS (SELECT 1 FROM fin_card_bill b WHERE b.paid_transaction_id = l.lancamento_id)) AS fatura_como_despesa,
           (SELECT count(*) FROM fin_dre_lancamento_v
             WHERE origem = 'cartao' AND mes_caixa IS NOT NULL)                                          AS item_na_visao_caixa,
           (SELECT count(*) FROM fin_dre_lancamento_v l
              JOIN fin_card_transaction ct ON ct.id = l.lancamento_id AND l.origem = 'cartao'
             WHERE ct.kind = 'pagamento_fatura')                                                          AS pagamento_dentro_do_custo`);
  igual('fatura de cartão tratada como despesa', fatura.fatura_como_despesa, 0, inteiro);
  igual('item de cartão na visão caixa', fatura.item_na_visao_caixa, 0, inteiro);
  igual('pagamento de fatura somado ao custo do cartão', fatura.pagamento_dentro_do_custo, 0, inteiro);

  // Itens parcelados competem no mês da COMPRA, não no da fatura.
  const [parcela] = await q(`
    SELECT count(*) AS erradas FROM fin_card_transaction
     WHERE purchase_date IS NOT NULL AND competence_date <> purchase_date`);
  igual('parcela competindo fora do mês da compra', parcela.erradas, 0, inteiro);

  // 3.3 A DRE lê UMA camada de receita: o caixa recebido. Se a receita bruta da
  // visão caixa não for exatamente a soma dos lançamentos de receita do ledger,
  // alguma outra camada entrou junto — e a receita foi multiplicada.
  const [camada] = await q(`
    SELECT (SELECT COALESCE(sum(receita_bruta_cents), 0) FROM fin_dre_mensal_v WHERE visao = 'caixa') AS dre,
           (SELECT COALESCE(sum(t.amount_cents), 0) FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
             WHERE NOT t.is_split_parent AND c.dre_line = 'receita_bruta')                             AS ledger`);
  igual('receita bruta = uma única camada (caixa)', camada.dre, camada.ledger);

  // -------------------------------------------------------------------------
  console.log('\n=== 4. Fluxo de caixa reconcilia com a variação de saldo ===');

  const [residuo] = await q(`
    SELECT count(*) AS linhas FROM fin_fluxo_caixa_v WHERE residuo_cents <> 0`);
  igual('meses com resíduo no fluxo', residuo.linhas, 0, inteiro);

  // Confronto com o ledger, conta a conta. Esta é a verificação que impede um
  // fluxo bonito sobre saldo errado.
  const contas = await q(`
    SELECT a.slug,
           f.saldo_final_cents                                              AS fluxo,
           a.opening_balance_cents + COALESCE(s.soma, 0)                    AS ledger,
           a.current_balance_cents                                          AS coluna
      FROM fin_account a
      LEFT JOIN (SELECT account_id, sum(amount_cents) soma FROM fin_transaction
                  WHERE NOT is_split_parent GROUP BY 1) s ON s.account_id = a.id
      LEFT JOIN LATERAL (SELECT saldo_final_cents FROM fin_fluxo_caixa_conta_v fc
                          WHERE fc.account_id = a.id ORDER BY fc.mes DESC LIMIT 1) f ON true
     ORDER BY a.id`);
  for (const c of contas) {
    if (c.fluxo === null) {
      // Conta sem lançamento e sem abertura não aparece no fluxo. Isso é
      // correto e precisa estar VISÍVEL — conta ausente lida como zero
      // confiável é exatamente o erro que o AGENTE_FINANCEIRO proíbe.
      console.log(`  · ${c.slug}: sem histórico no ledger (não é zero confiável)`);
      continue;
    }
    igual(`fluxo reconstrói o saldo de ${c.slug}`, c.fluxo, c.ledger);
    if (Number(c.coluna) !== Number(c.ledger)) {
      falhou(`coluna current_balance de ${c.slug}`,
        `ledger ${brl(c.ledger)} · coluna ${brl(c.coluna)}`);
    }
  }

  // Confronto EXTERNO: o snapshot vindo da API do banco.
  const snaps = await q(`
    SELECT a.slug, s.date, s.balance_cents AS api,
           a.opening_balance_cents + COALESCE((SELECT sum(t.amount_cents) FROM fin_transaction t
              WHERE t.account_id = a.id AND NOT t.is_split_parent AND t.posted_on <= s.date), 0) AS ledger
      FROM fin_account a
      JOIN LATERAL (SELECT date, balance_cents FROM fin_balance_snapshot b
                     WHERE b.account_id = a.id AND b.source = 'api'
                     ORDER BY b.date DESC LIMIT 1) s ON true`);
  for (const s of snaps) igual(`saldo da API bate em ${s.slug} (${dia(s.date)})`, s.ledger, s.api);

  console.log('\n  Fluxo dos últimos 6 meses:');
  for (const f of await q(`
      SELECT mes, saldo_inicial_cents, operacional_cents, investimento_cents, financiamento_cents,
             transferencia_interna_cents, saida_sem_historico_cents, nao_classificado_cents, saldo_final_cents
        FROM fin_fluxo_caixa_v ORDER BY mes DESC LIMIT 6`)) {
    console.log(`    ${mes(f.mes)}  in ${brl(f.saldo_inicial_cents).padStart(14)}` +
      `  oper ${brl(f.operacional_cents).padStart(14)}  inv ${brl(f.investimento_cents).padStart(12)}` +
      `  fin ${brl(f.financiamento_cents).padStart(10)}  transf ${brl(f.transferencia_interna_cents).padStart(13)}` +
      `  s/hist ${brl(f.saida_sem_historico_cents).padStart(12)}  n/class ${brl(f.nao_classificado_cents).padStart(12)}` +
      `  fim ${brl(f.saldo_final_cents).padStart(14)}`);
  }

  // -------------------------------------------------------------------------
  console.log('\n=== 5. Balanço: equilibra, e a diferença está DECLARADA ===');

  const [identidade] = await q(`
    SELECT count(*) AS quebras FROM fin_balanco_mensal_v
     WHERE pl_apurado_cents <> ativo_total_cents - passivo_total_cents`);
  igual('meses em que ativo − passivo ≠ PL apurado', identidade.quebras, 0, inteiro);

  // A diferença nunca pode ser absorvida em "ajuste". A definição obriga:
  // PL apurado = PL explicado + não conciliado, em toda linha.
  const [declarada] = await q(`
    SELECT count(*) AS escondidas FROM fin_balanco_mensal_v
     WHERE pl_apurado_cents <> pl_explicado_cents + nao_conciliado_cents`);
  igual('meses com diferença escondida fora do não conciliado', declarada.escondidas, 0, inteiro);

  const naoConc = await q(`
    SELECT mes, nao_conciliado_cents FROM fin_balanco_mensal_v
     WHERE nao_conciliado_cents <> 0 ORDER BY mes`);
  if (naoConc.length === 0) {
    ok('todo mês do balanço concilia até o último centavo', '0 meses com diferença');
  } else {
    // Não é falha automaticamente: o desenho admite diferença, desde que ela
    // esteja na linha certa. Mas ela precisa aparecer no relatório.
    falhou('meses com não conciliado ≠ 0',
      naoConc.map((r) => `${mes(r.mes)} ${brl(r.nao_conciliado_cents)}`).join(' · '));
  }

  console.log('\n  Balanço na data mais recente:');
  for (const b of await q(`
      SELECT secao, linha, valor_cents FROM fin_balanco_v
       WHERE mes = (SELECT max(mes) FROM fin_balanco_v) ORDER BY ordem`)) {
    console.log(`    ${b.secao.padEnd(12)} ${b.linha.padEnd(36)} ${brl(b.valor_cents).padStart(18)}`);
  }

  console.log('\n  Lacunas conhecidas do balanço (direção do erro):');
  for (const l of await q(`SELECT lacuna, lado, vies, valor_conhecido_cents FROM fin_balanco_lacuna_v`)) {
    console.log(`    ${l.lado.padEnd(8)} ${l.vies.padEnd(12)} ${l.lacuna.padEnd(24)} ${brl(l.valor_conhecido_cents).padStart(18)}`);
  }

  // -------------------------------------------------------------------------
  console.log('\n=== 6. Diagnósticos que NÃO reprovam, mas precisam ser vistos ===');
  //
  // Sinal incompatível com a natureza da linha não quebra nenhuma soma — e é
  // por isso que precisa ser impresso. Reprovar aqui travaria o teste por um
  // problema de CLASSIFICAÇÃO, que se resolve em outra frente e com evidência.
  const sinal = await q(`
    SELECT linha, sum(lancamentos) AS n, sum(valor_cents) AS v
      FROM fin_dre_coerencia_v WHERE visao = 'competencia' GROUP BY linha ORDER BY linha`);
  if (sinal.length === 0) console.log('  · nenhum lançamento com sinal incompatível');
  for (const s of sinal) console.log(`  ! ${s.linha}: ${s.n} lançamentos, ${brl(s.v)} com sinal invertido`);

  const incompletos = await q(`
    SELECT mes, folha_media_3m_cents FROM fin_dre_cobertura_v
     WHERE visao = 'competencia' AND NOT folha_do_mes_ja_paga
       -- folha_media_3m nula = os meses ao redor também não tinham folha, então
       -- o mês não está "incompleto", só é anterior à folha existir no ledger.
       AND folha_media_3m_cents IS NOT NULL ORDER BY mes`);
  for (const i of incompletos) {
    console.log(`  ! ${mes(i.mes)} ainda não viu a folha dele — ` +
      `resultado superestimado em torno de ${brl(i.folha_media_3m_cents ?? 0)}`);
  }
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}

console.log(`\n${falhas === 0 ? 'OK' : 'FALHOU'} — ${passes} verificações passaram, ${falhas} falharam`);
process.exit(falhas === 0 ? 0 : 1);
