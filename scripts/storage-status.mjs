import { artifactPool, ensureArtifactSchema } from './lib/artifact-db.mjs';

const pool = artifactPool();
const client = await pool.connect();
try {
  await ensureArtifactSchema(client);
  const [artifacts, run] = await Promise.all([
    client.query(`SELECT count(*)::int AS count, coalesce(sum(byte_size), 0)::bigint AS bytes, coalesce(sum(compressed_size), 0)::bigint AS compressed_bytes, max(stored_at) AS last_stored_at FROM xpe_artifacts`),
    client.query(`SELECT finished_at, status, artifact_count, byte_size, compressed_size FROM xpe_artifact_sync_runs ORDER BY finished_at DESC LIMIT 1`)
  ]);
  console.log(JSON.stringify({ artifacts: artifacts.rows[0], latestRun: run.rows[0] ?? null }, null, 2));
} finally {
  client.release();
  await pool.end();
}
