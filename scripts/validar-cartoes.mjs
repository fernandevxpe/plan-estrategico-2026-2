// Fechamento do cartão: as verificações que precisam passar para o cartão poder
// ser chamado de conciliado.
//
// SOMENTE LEITURA. Sai com código 1 se alguma verificação FALHA.
//
// A diferença entre FALHA e LACUNA é a coisa mais importante deste arquivo:
//
//   FALHA   é contradição interna. O acumulador não bate com a recontagem; o
//           lançamento amarrado tem valor diferente do pago; a fatura saiu de
//           uma conta que não é a de liquidação. Alguém escreveu errado, e dá
//           para consertar com código.
//
//   LACUNA  é ausência de dado na fonte. O Polp não itemiza 15,4% do faturado;
//           a API do Inter não tem cartão; ninguém disse de quem é cada
//           plástico. NÃO dá para consertar com código, e tentar consertar é
//           inventar. Lacuna é contada, mostrada com valor e motivo, e NÃO
//           reprova.
//
// Trocar a segunda pela primeira seria a maneira mais rápida de deixar o painel
// verde e a base errada.
//
// Uso:
//   node scripts/validar-cartoes.mjs
//   node scripts/validar-cartoes.mjs --strict   lacuna também reprova
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const STRICT = process.argv.includes('--strict');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

let falhas = 0;
let lacunas = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const falha = (m) => {
  falhas += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
};
const lacuna = (m) => {
  lacunas += 1;
  console.log(`  \x1b[33m○\x1b[0m ${m}`);
};

const pool = financePool();
const client = await pool.connect();

try {
  // Sem a 0074 as views não existem e o erro seria um stack trace do pg.
  const { rows: temSchema } = await client.query(
    `SELECT to_regclass('fin_card_hierarquia_v') IS NOT NULL AS tem FROM (SELECT 1) x`
  );
  if (!temSchema[0].tem) {
    throw new Error('a migration 0074_fin_cartao_emissor.sql não está aplicada — rode `npm run db:migrate` antes');
  }

  // ─────────────────────────────────────────────────────── hierarquia
  console.log('\nHierarquia emissor → linha → subcartão');
  const { rows: hier } = await client.query(
    `SELECT emissor, emissor_slug, linha_slug, natureza, nivel_detalhe, titularidade, linha_ativa,
            count(card_id) AS cartoes, count(titular) AS com_titular
       FROM fin_card_hierarquia_v
      GROUP BY 1,2,3,4,5,6,7 ORDER BY 1,3`
  );
  for (const h of hier) {
    ok(
      `${h.emissor} · ${h.linha_slug} · ${h.natureza} · ${h.nivel_detalhe} · ` +
        `${h.cartoes} subcartão(ões)${h.linha_ativa ? '' : ' [inativa]'}`
    );
  }
  const { rows: semEmissor } = await client.query(
    `SELECT slug FROM fin_card_account WHERE issuer_id IS NULL`
  );
  if (semEmissor.length) falha(`${semEmissor.length} linha(s) sem emissor: ${semEmissor.map((r) => r.slug).join(', ')}`);
  else ok('toda linha de crédito tem emissor');

  // ─────────────────────────────────── fatura × itens × não explicado
  console.log('\nFatura declarada × itens × diferença não explicada');
  const { rows: rec } = await client.query(
    `SELECT count(*) AS n,
            count(*) FILTER (WHERE itens_cents <> itens_recontados_cents) AS acumulador_errado,
            COALESCE(sum(fatura_cents), 0)        AS faturado,
            COALESCE(sum(itens_cents), 0)         AS itemizado,
            COALESCE(sum(nao_explicado_cents), 0) AS nao_explicado
       FROM fin_card_fatura_conciliacao_v`
  );
  const r = rec[0];
  // A verificação que só código pega: o acumulador que o sync gravou tem de ser
  // igual à soma real dos itens. Se divergir, `pct_explicado` está mentindo.
  if (Number(r.acumulador_errado) > 0) {
    falha(`${r.acumulador_errado} fatura(s) com itemized_amount_cents diferente da soma real dos itens — o sync gravou errado`);
  } else {
    ok(`${r.n} fatura(s): acumulador de itens confere com a recontagem em todas`);
  }
  const pct = Number(r.faturado) ? (100 * Number(r.nao_explicado)) / Number(r.faturado) : 0;
  if (Number(r.nao_explicado) !== 0) {
    lacuna(
      `${brl(r.nao_explicado)} de ${brl(r.faturado)} (${pct.toFixed(1)}%) não é explicado por item nenhum — ` +
        'a fonte não itemiza. NÃO é fechado por diferença.'
    );
  } else {
    ok('todo o faturado é explicado por itens');
  }

  // ───────────────────────────── pagamento conciliado com a conta corrente
  console.log('\nPagamento da fatura × saída da conta corrente');
  const { rows: vered } = await client.query(
    `SELECT veredito, count(*) n, COALESCE(sum(paid_amount_cents), 0) valor
       FROM fin_card_fatura_conciliacao_v GROUP BY 1 ORDER BY 1`
  );
  for (const v of vered) {
    const msg = `${v.n} fatura(s) ${brl(v.valor)} — ${v.veredito}`;
    if (v.veredito === 'conciliada') ok(msg);
    else if (v.veredito === 'nao_paga') ok(`${msg} (esperado: fatura em aberto)`);
    else if (v.veredito === 'fora_da_cobertura') lacuna(`${msg} (o extrato da conta não alcança essas datas)`);
    else falha(msg);
  }

  // Nenhum lançamento pode pagar duas faturas. Se pagar, um dos dois vínculos é
  // falso e o caixa está sendo explicado duas vezes pelo mesmo dinheiro.
  const { rows: dup } = await client.query(
    `SELECT paid_transaction_id, count(*) n FROM fin_card_bill
      WHERE paid_transaction_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1`
  );
  if (dup.length) falha(`${dup.length} lançamento(s) amarrado(s) a mais de uma fatura`);
  else ok('nenhum lançamento paga duas faturas');

  // ───────────────────────────────────────────── emissor não modelado
  console.log('\nEmissor não modelado');
  // `situacao` vem calculada na view de propósito: o detector e este validador
  // precisam concordar sobre o mesmo lançamento, e duas cópias da mesma regra em
  // linguagens diferentes divergem no primeiro ajuste.
  const { rows: orf } = await client.query(
    `SELECT conta, situacao, linha_slug, count(*) n, COALESCE(sum(amount_cents), 0) valor
       FROM fin_card_pagamento_orfao_v GROUP BY 1,2,3 ORDER BY 1,2`
  );
  if (!orf.length) ok('nenhum pagamento de fatura sem fatura amarrada');
  for (const o of orf) {
    const msg = `conta ${o.conta}: ${o.n} pagamento(s) ${brl(Math.abs(Number(o.valor)))} sem fatura amarrada`;
    switch (o.situacao) {
      case 'emissor_nao_modelado':
        falha(`${msg} — NENHUMA linha de crédito liquida nesta conta: emissor fora da base`);
        break;
      case 'linha_sem_sync':
        lacuna(`${msg} — a linha '${o.linha_slug}' existe e o sync dela ainda não rodou`);
        break;
      case 'recarga_pre_pago':
        // Recarga de cartão pré-pago nunca terá fatura: é dinheiro nosso saindo
        // da conta para o plástico, e a fatura não existe nesse produto.
        ok(`${msg} — recarga de pré-pago em '${o.linha_slug}', não gera fatura`);
        break;
      default:
        falha(`${msg} — linha '${o.linha_slug}' existe e a fatura não foi conciliada`);
    }
  }

  // ────────────────────────────────────────────────── parcelas futuras
  console.log('\nParcelas futuras');
  const { rows: fut } = await client.query(
    `SELECT mes, parcelas, compras_do_ciclo, total_cents, sem_categoria
       FROM fin_card_parcela_futura_v ORDER BY mes`
  );
  if (!fut.length) lacuna('nenhuma parcela futura conhecida em nenhuma linha');
  let acumulado = 0;
  for (const f of fut) {
    acumulado += Number(f.total_cents);
    ok(
      `${String(f.mes).slice(0, 7)} ${brl(f.total_cents).padStart(13)} · ` +
        `${f.parcelas} parcela(s) + ${f.compras_do_ciclo} compra(s) do ciclo`
    );
  }
  if (fut.length) ok(`total comprometido nos próximos meses: ${brl(acumulado)}`);

  // Parcela sem data de compra não dá para agendar — a 0047 já tem CHECK, mas a
  // verificação é barata e o dia em que ela falhar é o dia em que a previsão
  // começou a chutar.
  const { rows: semData } = await client.query(
    `SELECT count(*) n FROM fin_card_transaction
      WHERE installment_number IS NOT NULL AND competence_month IS NULL`
  );
  if (Number(semData[0].n) > 0) falha(`${semData[0].n} parcela(s) sem mês de competência — não dá para agendar`);
  else ok('toda parcela tem mês de competência');

  // ──────────────────────────────── reemissão não parte o parcelamento
  console.log('\nReemissão × integridade do parcelamento');
  const { rows: reem } = await client.query(
    `SELECT count(*) FILTER (WHERE finais_distintos > 1) AS multi,
            count(*) AS planos,
            count(*) FILTER (WHERE parcelas_observadas > installments_total) AS estourados
       FROM fin_card_reemissao_v`
  );
  const rm = reem[0];
  ok(`${rm.multi} de ${rm.planos} plano(s) atravessam mais de um final — e continuam sendo UM plano cada`);
  if (Number(rm.estourados) > 0) {
    // Mais parcelas observadas que o total contratado significa que duas compras
    // diferentes colidiram na mesma purchase_key.
    falha(`${rm.estourados} plano(s) com mais parcelas observadas que o total contratado — chave de compra colidiu`);
  } else {
    ok('nenhum plano com mais parcelas que o contratado');
  }

  // ──────────────────────────────────────────────────────── lacunas
  console.log('\nLacunas declaradas');
  const { rows: lac } = await client.query(
    `SELECT lacuna, count(*) linhas, COALESCE(sum(itens), 0) itens, COALESCE(sum(valor_cents), 0) valor
       FROM fin_card_lacuna_v GROUP BY 1 ORDER BY 4 DESC`
  );
  if (!lac.length) ok('nenhuma lacuna declarada');
  for (const l of lac) {
    lacuna(`${l.lacuna.padEnd(28)} ${String(l.linhas).padStart(3)} ocorrência(s) · ${l.itens} item(ns) · ${brl(l.valor)}`);
  }

  // ─────────────────────────────────────────────── a trava da 0047 §1
  console.log('\nCartão continua fora do caixa');
  const { rows: kind } = await client.query(`SELECT count(*) n FROM fin_account WHERE kind = 'cartao'`);
  if (Number(kind[0].n) > 0) {
    falha(`${kind[0].n} conta(s) com kind='cartao' em fin_account — isso infla o caixa (ver 0047 §1)`);
  } else {
    ok("nenhuma fin_account com kind='cartao'");
  }
  const { rows: trava } = await client.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'fin_account_kind_check'`
  );
  if (trava.length && /cartao/.test(trava[0].def)) {
    falha("o CHECK de fin_account.kind ainda aceita 'cartao' — a trava da 0047 §12 não pegou");
  } else if (trava.length) {
    ok("o CHECK de fin_account.kind não aceita 'cartao'");
  }

  console.log('');
  console.log(`${falhas} falha(s) · ${lacunas} lacuna(s) declarada(s)`);
  if (falhas === 0 && lacunas > 0 && !STRICT) {
    console.log('Lacuna não reprova: é ausência na fonte, e está declarada com valor e motivo.');
  }
  console.log('');
  process.exit(falhas > 0 || (STRICT && lacunas > 0) ? 1 : 0);
} finally {
  client.release();
  await pool.end();
}
