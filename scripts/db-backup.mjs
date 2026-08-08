// Backup lógico das tabelas financeiras.
//
// POR QUE NÃO pg_dump: a imagem Nixpacks do Railway é Node, e o binário do
// cliente PostgreSQL não é garantido lá. Um backup que só funciona na máquina do
// desenvolvedor não é backup. Isto usa só o driver `pg`, que já é dependência.
//
// POR QUE ISTO EXISTE: até agora o banco guardava artefatos derivados —
// perdê-los custava rodar o sync de novo. Dado financeiro é diferente: uma
// classificação manual, uma conciliação, um pagamento planejado não têm origem
// para reprocessar. Sem backup, o módulo inteiro é um risco.
//
// FORMATO: NDJSON gzipado por tabela, gravado em xpe_artifacts sob a chave
// `fin/backup/<data>/<tabela>.ndjson.gz`, reaproveitando a mesma máquina
// durável de scripts/storage-push.mjs.
//
// RESTAURAÇÃO: aplicar as migrations num banco vazio, inserir as tabelas na
// ordem abaixo (é ordem de dependência) e depois acertar as sequences com
// `SELECT setval(pg_get_serial_sequence('<tabela>','id'), MAX(id)) FROM <tabela>`.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { ensureArtifactSchema, financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

// Ordem de dependência: pai antes de filho, para a restauração não bater em FK.
//
// Tabela nova que não entrar aqui não é feita backup, e ninguém percebe até
// precisar restaurar. Por isso o script confere no fim se sobrou alguma fin_*
// fora desta lista e falha alto.
const TABLES = [
  'fin_entity',
  'fin_nucleo',
  'fin_cost_center',
  'fin_cash_flow_group',
  'fin_account',
  'fin_category',
  'fin_counterparty',
  'fin_payee_account',
  'fin_contract',
  'fin_reserve',
  'fin_import_batch',
  'fin_statement_coverage',
  'fin_document',
  'fin_fiscal_document',
  'fin_transaction',
  'fin_settlement',
  'fin_balance_snapshot'
];

const KEEP_DAILY = 14; // backups mantidos antes de começar a podar

const startedAt = new Date();
const stamp = startedAt.toISOString().slice(0, 10);

const pool = financePool();
const client = await pool.connect();

let totalRows = 0;
let totalBytes = 0;
let totalCompressed = 0;
const detail = {};

try {
  await ensureArtifactSchema(client);

  for (const table of TABLES) {
    // Tabela que ainda não existe (migration futura) não é erro: o backup roda
    // desde a Fatia 0 e o schema cresce ao longo das fases.
    const { rows: exists } = await client.query('SELECT to_regclass($1) AS reg', [table]);
    if (!exists[0].reg) {
      detail[table] = 'ausente';
      continue;
    }

    // row_to_json preserva tipos como o Postgres os serializa, incluindo bigint
    // como número JSON e date como 'YYYY-MM-DD'. Fazer o dump no servidor evita
    // trazer 12 mil linhas como objetos JS só para reserializá-las.
    const { rows } = await client.query(`SELECT row_to_json(t)::text AS line FROM ${table} t ORDER BY 1`);
    const ndjson = Buffer.from(rows.map((row) => row.line).join('\n') + (rows.length ? '\n' : ''), 'utf8');
    const compressed = gzipSync(ndjson, { level: 9 });
    const checksum = createHash('sha256').update(ndjson).digest('hex');
    const key = `fin/backup/${stamp}/${table}.ndjson.gz`;

    await client.query(
      `
      INSERT INTO xpe_artifacts (
        artifact_key, content, content_type, content_encoding, checksum_sha256,
        byte_size, compressed_size, source_updated_at, stored_at
      ) VALUES ($1, $2, 'application/x-ndjson', 'gzip', $3, $4, $5, $6, now())
      ON CONFLICT (artifact_key) DO UPDATE SET
        content = EXCLUDED.content,
        checksum_sha256 = EXCLUDED.checksum_sha256,
        byte_size = EXCLUDED.byte_size,
        compressed_size = EXCLUDED.compressed_size,
        source_updated_at = EXCLUDED.source_updated_at,
        stored_at = now()
    `,
      [key, compressed, checksum, ndjson.length, compressed.length, startedAt]
    );

    totalRows += rows.length;
    totalBytes += ndjson.length;
    totalCompressed += compressed.length;
    detail[table] = rows.length;
  }

  // Poda: mantém os KEEP_DAILY backups mais recentes. Sem isso a tabela de
  // artefatos cresce para sempre, e o banco do Railway é cobrado por volume.
  const { rows: stamps } = await client.query(`
    SELECT DISTINCT split_part(artifact_key, '/', 3) AS stamp
    FROM xpe_artifacts
    WHERE artifact_key LIKE 'fin/backup/%'
    ORDER BY 1 DESC
  `);
  const toPrune = stamps.slice(KEEP_DAILY).map((row) => row.stamp);
  if (toPrune.length) {
    await client.query(
      `DELETE FROM xpe_artifacts WHERE artifact_key LIKE 'fin/backup/%' AND split_part(artifact_key, '/', 3) = ANY($1)`,
      [toPrune]
    );
  }

  // Uma tabela fin_* que ninguém acrescentou a TABLES não seria salva, e o
  // silêncio só apareceria no dia da restauração. Falhar aqui é barato.
  const { rows: existing } = await client.query(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name LIKE 'fin\\_%'
  `);
  const esquecidas = existing.map((row) => row.table_name).filter((name) => !TABLES.includes(name));
  if (esquecidas.length) {
    throw new Error(`tabelas fora do backup: ${esquecidas.join(', ')} — acrescente-as a TABLES em scripts/db-backup.mjs`);
  }

  await client.query(
    `
    INSERT INTO xpe_artifact_sync_runs (started_at, status, artifact_count, byte_size, compressed_size, detail)
    VALUES ($1, 'ok', $2, $3, $4, $5::jsonb)
  `,
    [startedAt, TABLES.length, totalBytes, totalCompressed, JSON.stringify({ source: 'fin-backup', stamp, detail, pruned: toPrune })]
  );

  console.log(
    JSON.stringify(
      {
        backup: stamp,
        rows: totalRows,
        bytes: totalBytes,
        compressedBytes: totalCompressed,
        pruned: toPrune,
        detail
      },
      null,
      2
    )
  );
} finally {
  client.release();
  await pool.end();
}
