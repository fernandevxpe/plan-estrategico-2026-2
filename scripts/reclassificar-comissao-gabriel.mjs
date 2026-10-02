// O PIX de R$ 2.431,58 ao Gabriel em 01/10/2026 é comissão, não pró-labore.
//
//   node scripts/reclassificar-comissao-gabriel.mjs            mostra o que faria
//   node scripts/reclassificar-comissao-gabriel.mjs --aplicar  grava
//
// O dono, em 02/10/2026: "ele não recebeu 1 de outubro o valor... ele recebeu
// do nubank a comissão de obras". O lançamento estava em 6.02 por
// `fato_estrutural` (a contraparte é sócio, então a regra chutou pró-labore), e
// por isso a tela de contas a pagar o casou com o pró-labore de outubro dele e
// pedia "Confirmar pagamento" — confirmar seria dar como pago um pró-labore que
// não saiu.
//
// Grava como a central de categorização grava (`lib/financeiro/categorizacao.ts`):
// evento em `fin_classification_event` com o valor anterior, fila resolvida
// ANTES da linha, `classified_rule_id = NULL` no mesmo SET (senão estoura a
// paridade de versão de regra) e `category_id` acrescentado à trava humana.
import { randomUUID } from 'node:crypto';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const TX = 198731;
const VALOR_CENTS = 243158;
const ATOR = 'decisao:fernando-2026-10-02';
const MOTIVO = 'Dono, 02/10/2026: o PIX do Nubank de 01/10 ao Gabriel é a comissão de obras, não o pró-labore.';

const pool = financePool();
const client = await pool.connect();
const lote = randomUUID();
console.log(`\nGabriel, PIX de 01/10 — 6.02 → 4.01 — ${APLICAR ? 'APLICANDO' : 'apenas mostrando'}\n`);

try {
  await client.query('BEGIN');
  const { rows } = await client.query(
    `SELECT t.id, t.entity_id, t.amount_cents, t.posted_on::text, c.code, t.category_id, t.classified_by,
            t.classified_rule_id, t.human_locked_fields
       FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
      WHERE t.id = $1 FOR UPDATE OF t`,
    [TX]
  );
  const tx = rows[0];
  if (!tx) throw new Error(`lançamento ${TX} não existe`);
  if (Number(tx.amount_cents) !== -VALOR_CENTS || tx.posted_on !== '2026-10-01') {
    throw new Error(`lançamento ${TX} não é o PIX de R$ 2.431,58 de 01/10`);
  }
  if (tx.code !== '6.02') throw new Error(`categoria já mudou: ${tx.code}`);

  const { rows: cat } = await client.query(
    `SELECT id FROM fin_category WHERE entity_id = $1 AND code = '4.01'`,
    [tx.entity_id]
  );
  if (!cat[0]) throw new Error('categoria 4.01 não existe');

  await client.query(
    `INSERT INTO fin_classification_event
       (target_table, target_id, stage, category_id, accepted, superseded_value, rationale, actor)
     VALUES ('fin_transaction', $1, 'humano', $2, true, $3::jsonb, $4::jsonb, $5)`,
    [
      TX,
      cat[0].id,
      JSON.stringify({
        category_id: tx.category_id,
        classified_by: tx.classified_by,
        classified_rule_id: tx.classified_rule_id,
        human_locked_fields: tx.human_locked_fields
      }),
      JSON.stringify({ motivo: MOTIVO, lote, origem: 'script' }),
      ATOR
    ]
  );
  await client.query(
    `UPDATE fin_review_item SET status = 'resolvido', resolved_at = now(), resolved_by = $2
      WHERE target_table = 'fin_transaction' AND target_id = $1 AND status = 'pendente'`,
    [TX, ATOR]
  );
  await client.query(
    `UPDATE fin_transaction x
        SET category_id = $2, classified_by = 'humano', classified_rule_id = NULL, classified_at = now(),
            human_locked_fields = (SELECT COALESCE(array_agg(DISTINCT f), '{}'::text[])
                                     FROM unnest(x.human_locked_fields || ARRAY['category_id']) AS f),
            classified_reason = jsonb_build_object('motivo', $3::text, 'lote', $4::text),
            review_status = 'ok', updated_at = now()
      WHERE x.id = $1`,
    [TX, cat[0].id, MOTIVO, lote]
  );
  await client.query(
    `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
     VALUES ($1, 'fin_transaction', $2, 'update', $3::jsonb, $4::jsonb, ARRAY['category_id','classified_by'], $5)`,
    [
      tx.entity_id,
      TX,
      JSON.stringify({ category: '6.02', classified_by: tx.classified_by }),
      JSON.stringify({ category: '4.01', classified_by: 'humano', lote }),
      ATOR
    ]
  );

  const { rows: depois } = await client.query(
    `SELECT c.code, 'category_id' = ANY (t.human_locked_fields) AS travada
       FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id WHERE t.id = $1`,
    [TX]
  );
  if (depois[0].code !== '4.01' || !depois[0].travada) throw new Error('a linha não ficou em 4.01 com trava');

  console.log(`  lançamento ${TX}: 6.02 Pró-labore → 4.01 Comissão · travado · lote ${lote}`);
  if (APLICAR) {
    await client.query('COMMIT');
    console.log('  gravado.\n');
  } else {
    await client.query('ROLLBACK');
    console.log('  nada gravado — rode com --aplicar.\n');
  }
} catch (erro) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`\n  ABORTADO, nada gravado: ${erro.message}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
