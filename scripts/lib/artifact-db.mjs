import pg from 'pg';

const { Pool } = pg;

export function databaseUrl() {
  return process.env.DATABASE_PUBLIC_URL?.trim() || process.env.DATABASE_URL?.trim() || null;
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
