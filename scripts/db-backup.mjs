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
// RESTAURAÇÃO: aplicar as migrations num banco vazio, ler `_manifest.json.gz`,
// inserir as tabelas na ordem registrada em `restoreOrder` e depois acertar as
// sequences com
// `SELECT setval(pg_get_serial_sequence('<tabela>','id'), MAX(id)) FROM <tabela>`.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { ensureArtifactSchema, financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Descobre TODA tabela financeira e calcula uma ordem de restauração em que o
 * pai de cada FK aparece antes do filho.
 *
 * A lista manual original nasceu com 37 tabelas e ficou congelada enquanto o
 * schema cresceu para 69. O backup ainda terminava com erro ao perceber as
 * esquecidas, mas só DEPOIS de escrever um conjunto parcial de artefatos — uma
 * foto que existia no storage e parecia utilizável. Descoberta pelo catálogo
 * torna tabela nova coberta no mesmo deploy em que ela passa a existir.
 */
async function discoverFinancialTables(client) {
  const { rows: tableRows } = await client.query(`
    SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relname LIKE 'fin\\_%' ESCAPE '\\'
     ORDER BY c.relname
  `);
  const tables = tableRows.map((row) => row.table_name);
  const known = new Set(tables);

  const { rows: fkRows } = await client.query(`
    SELECT child.relname AS child, parent.relname AS parent
      FROM pg_constraint con
      JOIN pg_class child       ON child.oid = con.conrelid
      JOIN pg_namespace child_n ON child_n.oid = child.relnamespace
      JOIN pg_class parent      ON parent.oid = con.confrelid
      JOIN pg_namespace parent_n ON parent_n.oid = parent.relnamespace
     WHERE con.contype = 'f'
       AND child_n.nspname = 'public'
       AND parent_n.nspname = 'public'
       AND child.relname LIKE 'fin\\_%' ESCAPE '\\'
       AND parent.relname LIKE 'fin\\_%' ESCAPE '\\'
  `);

  const dependencies = new Map(tables.map((table) => [table, new Set()]));
  for (const { child, parent } of fkRows) {
    if (known.has(child) && known.has(parent) && child !== parent) dependencies.get(child).add(parent);
  }

  const restoreOrder = [];
  const remaining = new Set(tables);
  while (remaining.size) {
    const ready = [...remaining]
      .filter((table) => [...dependencies.get(table)].every((parent) => !remaining.has(parent)))
      .sort();
    if (!ready.length) {
      const cycle = [...remaining]
        .map((table) => `${table} -> ${[...dependencies.get(table)].filter((parent) => remaining.has(parent)).join(',')}`)
        .join('; ');
      throw new Error(`ciclo de FK entre tabelas financeiras; restauração precisa de estratégia explícita: ${cycle}`);
    }
    for (const table of ready) {
      restoreOrder.push(table);
      remaining.delete(table);
    }
  }

  return { tables, restoreOrder, foreignKeys: fkRows };
}

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
  // Uma foto é indivisível: ou todas as tabelas + manifesto + registro entram,
  // ou nenhuma entra. A versão anterior deixava artefatos parciais se a
  // conferência final falhasse.
  await client.query('BEGIN');
  await ensureArtifactSchema(client);

  const catalog = await discoverFinancialTables(client);
  const TABLES = catalog.restoreOrder;

  for (const table of TABLES) {
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

  // O manifesto é parte do backup, não documentação lateral. Ele prova quais
  // tabelas existiam naquele dia, em que ordem restaurar e contra quais
  // migrations a foto foi tirada.
  const { rows: migrations } = await client.query(`
    SELECT id, checksum_sha256, applied_at
      FROM xpe_migrations
     ORDER BY id
  `);
  const manifest = Buffer.from(
    JSON.stringify(
      {
        formatVersion: 1,
        generatedAt: startedAt.toISOString(),
        restoreOrder: TABLES,
        foreignKeys: catalog.foreignKeys,
        migrations
      },
      null,
      2
    ) + '\n',
    'utf8'
  );
  const manifestCompressed = gzipSync(manifest, { level: 9 });
  const manifestChecksum = createHash('sha256').update(manifest).digest('hex');
  await client.query(
    `
    INSERT INTO xpe_artifacts (
      artifact_key, content, content_type, content_encoding, checksum_sha256,
      byte_size, compressed_size, source_updated_at, stored_at
    ) VALUES ($1, $2, 'application/json', 'gzip', $3, $4, $5, $6, now())
    ON CONFLICT (artifact_key) DO UPDATE SET
      content = EXCLUDED.content,
      checksum_sha256 = EXCLUDED.checksum_sha256,
      byte_size = EXCLUDED.byte_size,
      compressed_size = EXCLUDED.compressed_size,
      source_updated_at = EXCLUDED.source_updated_at,
      stored_at = now()
    `,
    [
      `fin/backup/${stamp}/_manifest.json.gz`,
      manifestCompressed,
      manifestChecksum,
      manifest.length,
      manifestCompressed.length,
      startedAt
    ]
  );
  totalBytes += manifest.length;
  totalCompressed += manifestCompressed.length;
  detail._manifest = { tables: TABLES.length, migrations: migrations.length };

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

  await client.query(
    `
    INSERT INTO xpe_artifact_sync_runs (started_at, status, artifact_count, byte_size, compressed_size, detail)
    VALUES ($1, 'ok', $2, $3, $4, $5::jsonb)
  `,
    [startedAt, TABLES.length + 1, totalBytes, totalCompressed, JSON.stringify({ source: 'fin-backup', stamp, detail, pruned: toPrune })]
  );

  if (DRY_RUN) await client.query('ROLLBACK');
  else await client.query('COMMIT');

  console.log(
    JSON.stringify(
      {
        backup: stamp,
        dryRun: DRY_RUN,
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
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
