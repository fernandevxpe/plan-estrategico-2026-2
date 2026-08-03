import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { processedDir, ensureDataDirs } from './lib/paths.mjs';
import { artifactPool, ensureArtifactSchema } from './lib/artifact-db.mjs';

ensureDataDirs();
const startedAt = new Date();
const files = (await readdir(processedDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(json|csv)$/i.test(entry.name))
  .map((entry) => entry.name)
  .sort();
if (!files.length) throw new Error(`Nenhum artefato encontrado em ${processedDir}`);

const pool = artifactPool();
const client = await pool.connect();
let totalBytes = 0;
let totalCompressed = 0;
try {
  await ensureArtifactSchema(client);
  await client.query('BEGIN');
  for (const file of files) {
    const target = path.join(processedDir, file);
    const [content, info] = await Promise.all([readFile(target), stat(target)]);
    const compressed = gzipSync(content, { level: 9 });
    const checksum = createHash('sha256').update(content).digest('hex');
    const contentType = file.endsWith('.json') ? 'application/json' : 'text/csv';
    await client.query(`
      INSERT INTO xpe_artifacts (
        artifact_key, content, content_type, content_encoding, checksum_sha256,
        byte_size, compressed_size, source_updated_at, stored_at
      ) VALUES ($1, $2, $3, 'gzip', $4, $5, $6, $7, now())
      ON CONFLICT (artifact_key) DO UPDATE SET
        content = EXCLUDED.content,
        content_type = EXCLUDED.content_type,
        content_encoding = EXCLUDED.content_encoding,
        checksum_sha256 = EXCLUDED.checksum_sha256,
        byte_size = EXCLUDED.byte_size,
        compressed_size = EXCLUDED.compressed_size,
        source_updated_at = EXCLUDED.source_updated_at,
        stored_at = now()
    `, [file, compressed, contentType, checksum, content.length, compressed.length, info.mtime]);
    totalBytes += content.length;
    totalCompressed += compressed.length;
  }
  await client.query(`
    INSERT INTO xpe_artifact_sync_runs (started_at, status, artifact_count, byte_size, compressed_size, detail)
    VALUES ($1, 'ok', $2, $3, $4, $5::jsonb)
  `, [startedAt, files.length, totalBytes, totalCompressed, JSON.stringify({ source: 'processed-directory' })]);
  await client.query('COMMIT');
  console.log(JSON.stringify({ stored: files.length, bytes: totalBytes, compressedBytes: totalCompressed, compressionPct: Math.round((1 - totalCompressed / totalBytes) * 100) }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
