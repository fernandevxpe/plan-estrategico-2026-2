import pg from 'pg';

const { Pool } = pg;

export function databaseUrl() {
  return process.env.DATABASE_PUBLIC_URL?.trim() || process.env.DATABASE_URL?.trim() || null;
}

/**
 * Banco do módulo financeiro — declarado, não herdado.
 *
 * `DATABASE_URL` tem valor DIFERENTE em cada ambiente: local vem do .env.local,
 * no Railway a plataforma injeta o dela. Um ledger que herda essa variável grava
 * em desenvolvimento num banco e lê em produção de outro, sem erro nenhum — só
 * números que não existem.
 *
 * Precisa bater exatamente com lib/financeiro/db.ts, senão a importação e a tela
 * olham para lugares distintos.
 */
export function financeDatabaseUrl() {
  return process.env.FINANCE_DATABASE_URL?.trim() || databaseUrl();
}

export function financePool() {
  const connectionString = financeDatabaseUrl();
  if (!connectionString) throw new Error('FINANCE_DATABASE_URL/DATABASE_URL não configurada');
  return new Pool({
    connectionString,
    max: 3,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: false }
  });
}

export function artifactPool() {
  const connectionString = databaseUrl();
  if (!connectionString) throw new Error('DATABASE_URL/DATABASE_PUBLIC_URL não configurada');
  return new Pool({
    connectionString,
    max: 3,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: false }
  });
}

export async function ensureArtifactSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS xpe_artifacts (
      artifact_key text PRIMARY KEY,
      content bytea NOT NULL,
      content_type text NOT NULL,
      content_encoding text NOT NULL DEFAULT 'gzip',
      checksum_sha256 text NOT NULL,
      byte_size bigint NOT NULL,
      compressed_size bigint NOT NULL,
      source_updated_at timestamptz NOT NULL,
      stored_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS xpe_artifact_sync_runs (
      id bigserial PRIMARY KEY,
      started_at timestamptz NOT NULL,
      finished_at timestamptz NOT NULL DEFAULT now(),
      status text NOT NULL,
      artifact_count integer NOT NULL DEFAULT 0,
      byte_size bigint NOT NULL DEFAULT 0,
      compressed_size bigint NOT NULL DEFAULT 0,
      detail jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS xpe_artifact_sync_runs_finished_idx ON xpe_artifact_sync_runs (finished_at DESC)');
}
