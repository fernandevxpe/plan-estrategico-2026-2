// Estratégia pedida pelo Fernando: achar Pix avulso que na verdade é a baixa
// manual de uma cobrança Asaas paga por fora do gateway.
//
// O PADRÃO: alguém recebe um Pix direto na conta do banco (não passou pelo
// link de pagamento do Asaas) e, pra fatura não ficar em aberto pra sempre,
// marca a cobrança correspondente como paga manualmente no Asaas
// (source_status = 'RECEIVED_IN_CASH'). O ledger bancário registra o Pix como
// um lançamento avulso, sem saber que ele já tem cobrança formal por trás —
// e a classificação automática (regra) não lê o documento pra descobrir qual
// contrato/serviço é. O caso real que motivou este script: um Pix de
// R$ 1.250,00 do Cond. Edif. Sobrado do Capibaribe, classificado por regra
// como "3.03 Estudo de Disponibilidade de Carga", quando o documento por
// trás (mesma contraparte, mesmo valor, mesma data de baixa) era a Parcela
// 2/3 de "Projeto de Subestação Aérea de 225 kVA" — categoria certa: 3.04.
//
// O QUE ISTO NÃO FAZ: não corrige nada sozinho. Confirmar que a categoria do
// documento bate com a do Pix é leitura humana — o script só encontra os
// PARES, não decide se estão certos. Dos 3 pares já encontrados em produção,
// 2 já estavam corretos (a regra acertou por coincidência); só 1 precisou de
// correção. Ver reclassificar-lote para aplicar a correção com trilha.
//
// Roda com: node scripts/verificar-baixa-manual-pix.mjs [--todos]
//   sem --todos: só os pares onde a classificação NÃO foi por humano
//                (candidatos reais a revisão — se já foi humano, alguém já olhou)
//   --todos: todos os pares, incluindo os já revisados por humano

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import pg from 'pg';

loadEnv();
const TODOS = process.argv.includes('--todos');

const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), ssl: { rejectUnauthorized: false } });

const r = await pool.query(`
  WITH docs_baixa_manual AS (
    SELECT d.id AS doc_id, d.paid_on, d.amount_cents, d.description, d.counterparty_id, cp.name AS cliente
    FROM fin_document d
    JOIN fin_counterparty cp ON cp.id = d.counterparty_id
    WHERE d.source_status = 'RECEIVED_IN_CASH' AND d.paid_on IS NOT NULL
  )
  SELECT db.doc_id, db.paid_on::text AS baixa_em, db.amount_cents, db.cliente, db.description AS servico_no_documento,
         t.id AS transacao_id, t.posted_on::text AS pix_em, t.description_raw AS descricao_do_pix,
         c.code AS categoria_atual, c.name AS categoria_atual_nome, t.classified_by
    FROM docs_baixa_manual db
    JOIN fin_transaction t
      ON t.counterparty_id = db.counterparty_id
     AND t.amount_cents = db.amount_cents
     AND t.posted_on BETWEEN db.paid_on - INTERVAL '2 days' AND db.paid_on + INTERVAL '2 days'
     AND t.source_kind = 'PIX'
    LEFT JOIN fin_category c ON c.id = t.category_id
   WHERE ($1::boolean OR t.classified_by IS DISTINCT FROM 'humano')
   ORDER BY db.paid_on DESC
`, [TODOS]);

if (!r.rows.length) {
  console.log(TODOS
    ? 'Nenhum par "baixa manual + Pix avulso" no banco.'
    : 'Nenhum par pendente de revisão humana. Rode com --todos para ver os já revisados também.');
} else {
  console.log(`${r.rows.length} par(es) encontrado(s)${TODOS ? '' : ' (não revisados por humano ainda)'}:\n`);
  for (const p of r.rows) {
    console.log(`Transação #${p.transacao_id} — ${p.pix_em} — R$ ${(p.amount_cents / 100).toFixed(2)} — ${p.cliente}`);
    console.log(`  Pix: "${p.descricao_do_pix}"`);
    console.log(`  Categoria atual: ${p.categoria_atual ?? '(sem categoria)'} ${p.categoria_atual_nome ?? ''} (classified_by=${p.classified_by})`);
    console.log(`  Documento #${p.doc_id} (baixa em ${p.baixa_em}): "${p.servico_no_documento}"`);
    console.log(`  → confira se a categoria atual condiz com o serviço do documento. Se não, use`);
    console.log(`    reclassificar-lote com evidência "fin_document.id=${p.doc_id}".\n`);
  }
}

await pool.end();
