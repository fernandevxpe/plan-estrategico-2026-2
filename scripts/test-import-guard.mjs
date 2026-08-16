// Prova executável da guarda C3: lote confirmado precisa ter linha crua.
//
// A migration 0084 é carregada dentro da transação quando ainda estiver
// pendente. Depois de aplicada, o teste usa o trigger instalado. Nos dois casos
// toda a experiência termina em ROLLBACK.
import { readFile } from 'node:fs/promises';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const pool = financePool();
const client = await pool.connect();
let bloqueouSemTrilha = false;

try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SET LOCAL statement_timeout = '120s'");

  const { rows: trigger } = await client.query(`
    SELECT 1
      FROM pg_trigger
     WHERE tgname = 'fin_import_batch_confirmado_exige_trilha'
       AND NOT tgisinternal
  `);
  if (!trigger.length) {
    const migration = await readFile(
      new URL('../db/migrations/0084_fin_import_row_guard.sql', import.meta.url),
      'utf8'
    );
    await client.query(migration);
  }

  const { rows: bases } = await client.query(`
    SELECT e.id AS entity_id, a.id AS account_id
      FROM fin_entity e
      JOIN fin_account a ON a.entity_id = e.id
     WHERE e.slug = 'xpe'
     ORDER BY a.id
     LIMIT 1
  `);
  if (!bases.length) throw new Error('entidade/conta de teste ausente');
  const base = bases[0];

  await client.query('SAVEPOINT lote_invalido');
  try {
    await client.query(
      `INSERT INTO fin_import_batch
         (entity_id, account_id, adapter, row_count, status, created_by)
       VALUES ($1, $2, 'guard-test', 1, 'confirmado', 'test-import-guard')`,
      [base.entity_id, base.account_id]
    );
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  } catch (error) {
    bloqueouSemTrilha = error.code === '23514' && /não pode ficar confirmado/.test(error.message);
    await client.query('ROLLBACK TO SAVEPOINT lote_invalido');
  }
  if (!bloqueouSemTrilha) throw new Error('a guarda aceitou lote confirmado sem fin_import_row');

  await client.query('SAVEPOINT lote_valido');
  const { rows: lotes } = await client.query(
    `INSERT INTO fin_import_batch
       (entity_id, account_id, adapter, row_count, status, created_by)
     VALUES ($1, $2, 'guard-test', 1, 'preview', 'test-import-guard')
     RETURNING id`,
    [base.entity_id, base.account_id]
  );
  const batchId = lotes[0].id;
  await client.query(
    `INSERT INTO fin_import_row (batch_id, row_number, raw, status)
     VALUES ($1, 1, '{}'::jsonb, 'novo')`,
    [batchId]
  );
  await client.query(`UPDATE fin_import_batch SET status = 'confirmado' WHERE id = $1`, [batchId]);
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  await client.query('ROLLBACK TO SAVEPOINT lote_valido');

  console.log('✓ lote confirmado sem trilha foi bloqueado');
  console.log('✓ lote confirmado com fin_import_row foi aceito');
  console.log('✓ nenhuma escrita persistida (ROLLBACK)');
} finally {
  await client.query('ROLLBACK').catch(() => {});
  client.release();
  await pool.end();
}
