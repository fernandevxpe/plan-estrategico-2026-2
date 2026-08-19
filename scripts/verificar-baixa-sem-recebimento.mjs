// Estratégia pedida pelo Fernando, parte 2 — o caso mais grave.
//
// O CASO CONFIRMADO REAL: Cond. Ed. Praia de Imbituba, documento #720,
// R$ 2.666,70, marcado RECEIVED_IN_CASH em 13/01/2026. Fernando confirmou:
// "apesar de dar baixa... realmente não recebemos". Ou seja, alguém marcou a
// cobrança como paga (às vezes por causa de reemissão de nota fiscal com o
// mesmo valor) sem o dinheiro ter entrado de fato.
//
// POR QUE ISSO IMPORTA MAIS QUE O PADRÃO DO CAPIBARIBE: uma baixa manual que
// CASA com uma transação bancária é só um lançamento sem categoria ainda —
// o dinheiro está lá, só falta organizar. Uma baixa manual que NÃO casa com
// transação nenhuma é dinheiro que o sistema afirma ter recebido e pode não
// ter recebido. E `/financeiro/receitas` conta RECEIVED_IN_CASH como receita
// recebida sem checar se existe lançamento bancário por trás — então esse
// erro infla um número que alguém lê.
//
// O QUE ISTO NÃO FAZ: não muda o status do documento. Confirmar se o
// dinheiro realmente não entrou (e decidir se cobra de novo, escreve como
// perda, ou corrige o Asaas) é decisão do Fernando, caso a caso — o script
// só encontra os candidatos.
//
// Roda com: node scripts/verificar-baixa-sem-recebimento.mjs

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import pg from 'pg';

loadEnv();
const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), ssl: { rejectUnauthorized: false } });
const brl = (c) => (Number(c) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

const r = await pool.query(`
  SELECT d.id, d.paid_on::text AS baixa_em, d.due_date::text, d.amount_cents, d.description, d.direction,
         cp.name AS cliente
  FROM fin_document d
  JOIN fin_counterparty cp ON cp.id = d.counterparty_id
  WHERE d.source_status = 'RECEIVED_IN_CASH' AND d.paid_on IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM fin_transaction t
       WHERE t.counterparty_id = d.counterparty_id AND t.amount_cents = d.amount_cents
         AND t.posted_on BETWEEN d.paid_on - INTERVAL '10 days' AND d.paid_on + INTERVAL '10 days'
    )
  ORDER BY d.paid_on DESC
`);

const total = r.rows.reduce((s, x) => s + Number(x.amount_cents), 0);

console.log(`${r.rows.length} documento(s) marcado(s) como pago(s) sem transação bancária correspondente.`);
console.log(`Soma: R$ ${brl(total)} — e todo esse valor conta hoje como receita recebida em /financeiro/receitas.\n`);

for (const d of r.rows) {
  console.log(`Documento #${d.id} — baixa em ${d.baixa_em} (venceu ${d.due_date}) — R$ ${brl(d.amount_cents)} — ${d.cliente}`);
  console.log(`  "${d.description}"`);
  console.log(`  → confira se o dinheiro realmente entrou (extrato do banco, ±10 dias da baixa). Se não entrou,`);
  console.log(`    o documento está marcado errado e infla /financeiro/receitas em R$ ${brl(d.amount_cents)}.\n`);
}

await pool.end();
