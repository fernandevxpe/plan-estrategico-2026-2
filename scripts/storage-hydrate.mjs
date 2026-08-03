import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { processedDir, ensureDataDirs } from './lib/paths.mjs';
import { artifactPool, ensureArtifactSchema } from './lib/artifact-db.mjs';

ensureDataDirs();
const pool = artifactPool();
const client = await pool.connect();
let hydrated = 0;
let bytes = 0;
try {
  await ensureArtifactSchema(client);
  const result = await client.query(`
    SELECT artifact_key, content, content_encoding, checksum_sha256, byte_size
    FROM xpe_artifacts
    ORDER BY artifact_key
  `);
  if (!result.rows.length) throw new Error('Banco de artefatos vazio; execute storage:push antes do primeiro hydrate');
  await mkdir(processedDir, { recursive: true });
  for (const row of result.rows) {
    const file = String(row.artifact_key);
    if (path.basename(file) !== file || !/\.(json|csv)$/i.test(file)) throw new Error(`Chave de artefato inválida: ${file}`);
    const encoded = Buffer.from(row.content);
    const content = row.content_encoding === 'gzip' ? gunzipSync(encoded) : encoded;
    const checksum = createHash('sha256').update(content).digest('hex');
    if (checksum !== row.checksum_sha256 || content.length !== Number(row.byte_size)) throw new Error(`Falha de integridade ao hidratar ${file}`);
    const target = path.join(processedDir, file);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, content);
    await rename(temporary, target);
    hydrated += 1;
    bytes += content.length;
  }
  console.log(JSON.stringify({ hydrated, bytes, target: processedDir }, null, 2));
} finally {
  client.release();
  await pool.end();
}
