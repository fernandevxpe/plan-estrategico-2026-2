// Prova transacional da separação entre transferência acionável, subledger e
// fonte ausente (migration 0089). O arquivo é aplicado dentro de BEGIN quando
// ainda está pendente e tudo termina em ROLLBACK.

import { readFile } from 'node:fs/promises';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const migrationUrl = new URL(
  '../db/migrations/0089_fin_transferencias_lacunas.sql',
  import.meta.url
);
const pool = financePool();
const client = await pool.connect();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function snapshot() {
  const { rows: [row] } = await client.query(`
    SELECT (SELECT count(*)::bigint FROM fin_transaction) AS ledger_rows,
           (SELECT COALESCE(sum(amount_cents), 0)::bigint FROM fin_transaction) AS ledger_cents,
           (SELECT COALESCE(sum(abs(amount_cents)), 0)::bigint FROM fin_transaction) AS ledger_abs_cents,
           (SELECT count(*)::bigint FROM fin_dre_lancamento_v) AS dre_rows,
           (SELECT COALESCE(sum(amount_cents), 0)::bigint FROM fin_dre_lancamento_v) AS dre_cents,
           (SELECT COALESCE(sum(lucro_liquido_cents), 0)::bigint FROM fin_dre_mensal_v) AS dre_result_cents,
           (SELECT jsonb_agg(jsonb_build_object(
                     'id', a.id,
                     'slug', a.slug,
                     'balance', a.current_balance_cents
                   ) ORDER BY a.id)
              FROM fin_account a) AS balances
  `);
  return row;
}

function sameSnapshot(before, after, context) {
  for (const key of [
    'ledger_rows', 'ledger_cents', 'ledger_abs_cents',
    'dre_rows', 'dre_cents', 'dre_result_cents'
  ]) {
    assert(String(before[key]) === String(after[key]),
      `${context}: ${key} mudou de ${before[key]} para ${after[key]}`);
  }
  assert(JSON.stringify(before.balances) === JSON.stringify(after.balances),
    `${context}: saldos declarados mudaram`);
}

try {
  const { rows: [installedBefore] } = await client.query(
    `SELECT to_regclass('fin_transfer_monitor_v') IS NOT NULL AS installed`
  );
  const before = await snapshot();

  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '20s'");
  await client.query("SET LOCAL statement_timeout = '180s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '240s'");

  if (!installedBefore.installed) {
    await client.query(await readFile(migrationUrl, 'utf8'));
  }

  const after = await snapshot();
  sameSnapshot(before, after, 'migration 0089');

  const { rows: [monitor] } = await client.query(
    `SELECT * FROM fin_transfer_monitor_v`
  );
  assert(Number(monitor.paired_legs) === 368,
    `pareadas ${monitor.paired_legs}, esperado 368`);
  assert(Number(monitor.reversed_legs) === 8,
    `anuladas ${monitor.reversed_legs}, esperado 8`);
  assert(Number(monitor.actionable_legs) === 0,
    `ainda há ${monitor.actionable_legs} perna(s) acionável(is)`);
  assert(Number(monitor.declared_gap_legs) === 243,
    `lacunas ${monitor.declared_gap_legs}, esperado 243`);
  assert(Number(monitor.actionable_resolution_pct) === 100,
    `resolução acionável ${monitor.actionable_resolution_pct}, esperado 100`);

  const { rows: gaps } = await client.query(`
    SELECT reason, legs, net_cents
      FROM fin_transfer_gap_v
     ORDER BY reason
  `);
  const gapMap = new Map(gaps.map((row) => [row.reason, row]));
  const expectedGaps = new Map([
    ['destino_fora_do_ledger:caixa-economica-12920000005783083433', [5, -2540000]],
    ['sem_cobertura_extrato', [167, -222476797]],
    ['sem_cobertura_extrato:conta-destino-nao-identificada', [4, -2412000]],
    ['sem_cobertura_extrato:nubank-caixinhas-antes-2026-07-10', [67, 66150]],
  ]);
  assert(gapMap.size === expectedGaps.size,
    `motivos de lacuna ${gapMap.size}, esperado ${expectedGaps.size}`);
  for (const [reason, [legs, cents]] of expectedGaps) {
    const actual = gapMap.get(reason);
    assert(actual, `motivo ausente: ${reason}`);
    assert(Number(actual.legs) === legs && Number(actual.net_cents) === cents,
      `${reason}: ${actual.legs}/${actual.net_cents}, esperado ${legs}/${cents}`);
  }

  const { rows: [supplier] } = await client.query(`
    SELECT t.transfer_status,
           t.transfer_unresolved_reason,
           t.category_id,
           count(ri.id) FILTER (WHERE ri.status = 'pendente')::integer AS pending_reviews
      FROM fin_transaction t
      LEFT JOIN fin_review_item ri
        ON ri.target_table = 'fin_transaction' AND ri.target_id = t.id
     WHERE t.id = 76646
     GROUP BY t.id
  `);
  assert(supplier.transfer_status === 'nao',
    'PIX fornecedor continuou como transferência própria');
  assert(supplier.transfer_unresolved_reason === null,
    'PIX fornecedor manteve motivo de perna ausente');
  assert(supplier.category_id === null,
    '0089 inventou categoria para o PIX fornecedor');
  assert(Number(supplier.pending_reviews) > 0,
    'PIX fornecedor ficou sem decisão e fora da fila');

  const { rows: [bills] } = await client.query(`
    SELECT count(*)::integer AS n,
           count(*) FILTER (WHERE t.transfer_status = 'nao')::integer AS normal,
           count(DISTINCT b.id)::integer AS linked_bills,
           COALESCE(sum(t.amount_cents), 0)::bigint AS cents
      FROM fin_transaction t
      JOIN fin_card_bill b ON b.paid_transaction_id = t.id
     WHERE t.source_kind = 'FATURA_CARTAO'
  `);
  assert(Number(bills.n) === 8 && Number(bills.normal) === 8,
    `pagamentos de fatura ${bills.normal}/${bills.n} em estado normal`);
  assert(Number(bills.linked_bills) === 8 && Number(bills.cents) === -6673834,
    'ligação/valor das oito faturas mudou');

  if (!installedBefore.installed) {
    const { rows: [audit] } = await client.query(`
      SELECT count(*)::integer AS n
        FROM fin_audit_log
       WHERE actor = 'migration-0089'
         AND target_table = 'fin_transaction'
    `);
    assert(Number(audit.n) === 80,
      `trilha 0089 tem ${audit.n} eventos, esperado 80`);
  }

  await client.query('ROLLBACK');

  const afterRollback = await snapshot();
  sameSnapshot(before, afterRollback, 'ROLLBACK 0089');
  const { rows: [installedAfter] } = await client.query(
    `SELECT to_regclass('fin_transfer_monitor_v') IS NOT NULL AS installed`
  );
  assert(installedAfter.installed === installedBefore.installed,
    'teste deixou DDL da 0089 persistido');

  console.log('✓ 8 faturas saem de em_transito sem sair do caixa ou da DRE');
  console.log('✓ PIX fornecedor volta à fila normal sem categoria inventada');
  console.log('✓ 243 pernas sem fonte têm motivo; pendência acionável é zero');
  console.log('✓ ledger, DRE e saldos idênticos; ROLLBACK integral');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
