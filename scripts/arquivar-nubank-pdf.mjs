// Arquiva o PDF original do lote Nubank #10 e liga sua evidencia aos sete
// casos M12 que dependem dele. Dry-run e o padrao; somente --aplicar grava.

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  artifactPool,
  ensureArtifactSchema,
  financePool
} from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

const BATCH_ID = 10;
const FILE_NAME = '681b6b77-f29f-4ed6-8351-0f5b530fc6d5-2026-01-01-2026-08-08.pdf';
const EXPECTED_SHA256 = '75eee8665ccfbf7d1c36fd921e60dbe93d6392b6a802d50b232f701aad2fbf7c';
const EXPECTED_BYTES = 444_456;
const ARTIFACT_KEY = `fin/import-batch/${BATCH_ID}/raw-${EXPECTED_SHA256}.pdf`;
const ACTOR = 'script:arquivar-nubank-pdf';

// Totais DIRECIONAIS lidos na auditoria do mesmo binario. Campo omitido nao
// significa zero (alguns dias tambem tiveram entradas); somente a direcao que
// prova as ocorrencias relevantes e comparada. O SHA amarra a prova ao PDF.
const DIRECTION_TOTALS = Object.freeze({
  '2026-02-20': { saidas_cents: 236_222 },
  '2026-02-25': { saidas_cents: 459_615 },
  '2026-03-03': { saidas_cents: 1_020_063 },
  '2026-03-24': { entradas_cents: 15_576, saidas_cents: 715_374 },
  '2026-05-11': { saidas_cents: 1_101_939 },
  '2026-05-31': { entradas_cents: 46_636, saidas_cents: 46_636 }
});

function usage() {
  return [
    'Uso: node scripts/arquivar-nubank-pdf.mjs [--arquivo CAMINHO] [--aplicar]',
    '',
    'Sem --aplicar: valida arquivo, lote, artefato e casos sem gravar nada.',
    'Com --aplicar: arquiva primeiro o binario e depois liga lote/casos em transacao.',
    'NUBANK_BATCH_10_PDF pode definir o caminho padrao do arquivo.'
  ].join('\n');
}

function parseArgs(argv) {
  const parsed = { apply: false, help: false, file: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--aplicar') parsed.apply = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--arquivo') {
      parsed.file = argv[i + 1];
      if (!parsed.file) throw new Error('--arquivo exige um caminho');
      i += 1;
    } else if (arg.startsWith('--arquivo=')) {
      parsed.file = arg.slice('--arquivo='.length);
      if (!parsed.file) throw new Error('--arquivo exige um caminho');
    } else {
      throw new Error(`Argumento desconhecido: ${arg}\n\n${usage()}`);
    }
  }
  return parsed;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function shouldRetryFinanceEvidence(error, attempt, maxAttempts = 3) {
  return attempt < maxAttempts && ['40001', '40P01'].includes(error?.code);
}

// Prova local da politica: somente serialization_failure/deadlock e nunca
// depois da ultima tentativa. O teste nao precisa provocar erro no banco real.
assert(shouldRetryFinanceEvidence({ code: '40001' }, 1), 'retry 40001 deveria estar ativo');
assert(shouldRetryFinanceEvidence({ code: '40P01' }, 2), 'retry 40P01 deveria estar ativo');
assert(!shouldRetryFinanceEvidence({ code: '40001' }, 3), 'retry excedeu o limite');
assert(!shouldRetryFinanceEvidence({ code: '23505' }, 1), 'retry aceitou erro nao transitorio');

function checksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

function sameLedger(before, after) {
  for (const field of ['transactions', 'sum_cents', 'absolute_cents']) {
    assert(String(before[field]) === String(after[field]),
      `guarda monetaria: ${field} mudou de ${before[field]} para ${after[field]}`);
  }
}

async function ledgerSnapshot(client) {
  const { rows: [row] } = await client.query(
    `SELECT count(*)::bigint AS transactions,
            COALESCE(sum(amount_cents), 0)::bigint AS sum_cents,
            COALESCE(sum(abs(amount_cents)), 0)::bigint AS absolute_cents
       FROM fin_transaction`
  );
  return row;
}

async function loadBatch(client, { lock = false } = {}) {
  const { rows: [batch] } = await client.query(
    `SELECT id, entity_id, account_id, adapter, file_name, file_sha256,
            file_bytes, period_start, period_end, row_count, inserted_count,
            duplicate_count, status, raw_artifact_key
       FROM fin_import_batch
      WHERE id = $1
      ${lock ? 'FOR UPDATE' : ''}`,
    [BATCH_ID]
  );
  assert(batch, `fin_import_batch #${BATCH_ID} nao existe`);
  assert(batch.adapter === 'nubank_conta_pdf',
    `lote #${BATCH_ID} usa adapter inesperado: ${batch.adapter}`);
  assert(batch.file_name === FILE_NAME,
    `lote #${BATCH_ID} aponta para arquivo inesperado: ${batch.file_name}`);
  assert(String(batch.file_sha256).trim() === EXPECTED_SHA256,
    `SHA do lote #${BATCH_ID} diverge do PDF auditado`);
  assert(Number(batch.file_bytes) === EXPECTED_BYTES,
    `tamanho do lote #${BATCH_ID} diverge: ${batch.file_bytes}`);
  assert(batch.status === 'confirmado', `lote #${BATCH_ID} nao esta confirmado`);
  assert(batch.raw_artifact_key === null || batch.raw_artifact_key === ARTIFACT_KEY,
    `lote #${BATCH_ID} ja aponta para outro artefato: ${batch.raw_artifact_key}`);
  return batch;
}

async function duplicateSchemaInstalled(client) {
  const { rows: [row] } = await client.query(
    `SELECT to_regclass('fin_duplicate_case') IS NOT NULL
              AND to_regclass('fin_duplicate_case_member') IS NOT NULL
              AND to_regclass('fin_duplicate_ledger_guard_v') IS NOT NULL AS installed`
  );
  return row.installed;
}

async function validateDirectionTotals(client, accountId) {
  const dates = Object.keys(DIRECTION_TOTALS);
  const { rows: [integrity] } = await client.query(
    `SELECT count(*)::integer AS rows,
            count(*) FILTER (WHERE ir.status <> 'importado')::integer AS not_imported,
            count(*) FILTER (WHERE ir.transaction_id IS NULL)::integer AS missing_transaction,
            count(ir.transaction_id)::integer AS transaction_refs,
            count(DISTINCT ir.transaction_id)::integer AS distinct_transaction_refs,
            count(*) FILTER (
              WHERE t.id IS NULL
                 OR t.account_id <> $3
                 OR t.posted_on IS DISTINCT FROM ir.posted_on
                 OR t.amount_cents IS DISTINCT FROM ir.amount_cents
            )::integer AS mismatches
       FROM fin_import_row ir
       LEFT JOIN fin_transaction t ON t.id = ir.transaction_id
      WHERE ir.batch_id = $1
        AND ir.posted_on = ANY($2::date[])`,
    [BATCH_ID, dates, accountId]
  );
  assert(Number(integrity.rows) > 0, 'nenhuma fin_import_row encontrada nas datas auditadas');
  assert(Number(integrity.not_imported) === 0,
    `${integrity.not_imported} linha(s) das datas auditadas nao estao importadas`);
  assert(Number(integrity.missing_transaction) === 0,
    `${integrity.missing_transaction} linha(s) das datas auditadas nao apontam transacao`);
  assert(Number(integrity.transaction_refs) === Number(integrity.distinct_transaction_refs),
    'mais de uma fin_import_row aponta para a mesma transacao nas datas auditadas');
  assert(Number(integrity.mismatches) === 0,
    `${integrity.mismatches} linha(s) divergem entre import_row e ledger`);

  const { rows } = await client.query(
    `SELECT ir.posted_on::text,
            COALESCE(sum(t.amount_cents) FILTER (WHERE t.amount_cents > 0), 0)::bigint
              AS entradas_cents,
            COALESCE(sum(-t.amount_cents) FILTER (WHERE t.amount_cents < 0), 0)::bigint
              AS saidas_cents,
            count(*)::integer AS rows
       FROM fin_import_row ir
       JOIN fin_transaction t ON t.id = ir.transaction_id
      WHERE ir.batch_id = $1
        AND ir.posted_on = ANY($2::date[])
      GROUP BY ir.posted_on
      ORDER BY ir.posted_on`,
    [BATCH_ID, dates]
  );
  const computed = Object.fromEntries(rows.map((row) => [row.posted_on, {
    entradas_cents: Number(row.entradas_cents),
    saidas_cents: Number(row.saidas_cents),
    rows: Number(row.rows)
  }]));
  for (const [date, expected] of Object.entries(DIRECTION_TOTALS)) {
    assert(computed[date], `data ${date} nao apareceu nas linhas importadas do lote #${BATCH_ID}`);
    for (const [direction, cents] of Object.entries(expected)) {
      assert(computed[date][direction] === cents,
        `${date} ${direction}: ledger/import rows somam ${computed[date][direction]}, PDF declara ${cents}`);
    }
  }
  return computed;
}

async function duplicateCaseState(client) {
  const { rows } = await client.query(
    `SELECT c.id,
            c.posted_on::text,
            c.member_count,
            c.member_fingerprint,
            c.reviewed_member_fingerprint,
            c.workflow_status,
            c.verdict,
            c.evidence_strength,
            c.evidence,
            count(*) FILTER (WHERE m.is_current)::integer AS current_members,
            count(*) FILTER (
              WHERE m.is_current AND EXISTS (
                SELECT 1
                  FROM fin_import_row ir
                 WHERE ir.transaction_id = m.transaction_id
                   AND ir.batch_id = $1
              )
            )::integer AS batch_members,
            count(*) FILTER (
              WHERE m.is_current AND m.review_status = 'confirmado_distinto'
            )::integer AS confirmed_members
       FROM fin_duplicate_case c
       LEFT JOIN fin_duplicate_case_member m ON m.case_id = c.id
      WHERE c.evidence ->> 'batch_id' = $1::text
         OR c.evidence ->> 'raw_artifact_key' = $2
      GROUP BY c.id
      ORDER BY c.posted_on, c.id`,
    [BATCH_ID, ARTIFACT_KEY]
  );
  return rows;
}

function classifyCaseState(rows) {
  const awaiting = rows.filter((row) =>
    row.workflow_status === 'aguardando_evidencia' &&
    row.evidence?.expected_sha256 === EXPECTED_SHA256 &&
    Number(row.current_members) === Number(row.member_count) &&
    Number(row.batch_members) === Number(row.member_count)
  );
  const reviewed = rows.filter((row) =>
    row.workflow_status === 'revisado' &&
    row.verdict === 'transacoes_distintas' &&
    row.evidence_strength === 'forte' &&
    row.reviewed_member_fingerprint === row.member_fingerprint &&
    row.evidence?.raw_artifact_key === ARTIFACT_KEY &&
    row.evidence?.artifact_sha256 === EXPECTED_SHA256 &&
    Number(row.current_members) === Number(row.member_count) &&
    Number(row.confirmed_members) === Number(row.member_count)
  );
  return { awaiting, reviewed };
}

function assertCaseTransitionIsSafe(rows) {
  const { awaiting, reviewed } = classifyCaseState(rows);
  const firstRun = awaiting.length === 7 && reviewed.length === 0 && rows.length === 7;
  const alreadyDone = awaiting.length === 0 && reviewed.length === 7 && rows.length === 7;
  assert(firstRun || alreadyDone,
    `estado dos casos nao e seguro: ${awaiting.length} aguardando, ` +
    `${reviewed.length} revisados, ${rows.length} relacionados (esperado 7/0 ou 0/7)`);
  for (const row of awaiting) {
    assert(DIRECTION_TOTALS[row.posted_on],
      `caso ${row.id} cai em ${row.posted_on}, data sem total direcional auditado`);
  }
  return { awaiting, reviewed, alreadyDone };
}

async function artifactTableExists(client) {
  const { rows: [row] } = await client.query(
    `SELECT to_regclass('xpe_artifacts') IS NOT NULL AS installed`
  );
  return row.installed;
}

async function loadArtifact(client) {
  if (!(await artifactTableExists(client))) return null;
  const { rows: [row] } = await client.query(
    `SELECT artifact_key, content, content_type, content_encoding,
            checksum_sha256, byte_size, compressed_size, source_updated_at, stored_at
       FROM xpe_artifacts
      WHERE artifact_key = $1`,
    [ARTIFACT_KEY]
  );
  return row ?? null;
}

function verifyArtifact(row) {
  if (!row) return false;
  assert(row.artifact_key === ARTIFACT_KEY, 'chave retornada pelo banco de artefatos diverge');
  assert(row.content_type === 'application/pdf',
    `content_type inesperado no artefato: ${row.content_type}`);
  assert(['gzip', 'identity'].includes(row.content_encoding),
    `content_encoding inesperado no artefato: ${row.content_encoding}`);
  const encoded = Buffer.from(row.content);
  const original = row.content_encoding === 'gzip' ? gunzipSync(encoded) : encoded;
  assert(checksum(original) === EXPECTED_SHA256,
    'conteudo duravel nao corresponde ao SHA esperado');
  assert(String(row.checksum_sha256) === EXPECTED_SHA256,
    'metadado checksum_sha256 do artefato diverge');
  assert(Number(row.byte_size) === EXPECTED_BYTES && original.length === EXPECTED_BYTES,
    'tamanho descompactado do artefato diverge');
  assert(Number(row.compressed_size) === encoded.length,
    'compressed_size do artefato diverge do bytea armazenado');
  return true;
}

async function storeArtifact(client, content, fileInfo) {
  const compressed = gzipSync(content, { level: 9 });
  const startedAt = new Date();
  await client.query('BEGIN');
  try {
    await ensureArtifactSchema(client);
    const inserted = await client.query(
      `INSERT INTO xpe_artifacts (
         artifact_key, content, content_type, content_encoding, checksum_sha256,
         byte_size, compressed_size, source_updated_at, stored_at
       ) VALUES ($1, $2, 'application/pdf', 'gzip', $3, $4, $5, $6, now())
       ON CONFLICT (artifact_key) DO NOTHING
       RETURNING artifact_key`,
      [
        ARTIFACT_KEY,
        compressed,
        EXPECTED_SHA256,
        content.length,
        compressed.length,
        fileInfo.mtime
      ]
    );

    const artifact = await loadArtifact(client);
    verifyArtifact(artifact);
    if (inserted.rowCount === 1) {
      await client.query(
        `INSERT INTO xpe_artifact_sync_runs (
           started_at, status, artifact_count, byte_size, compressed_size, detail
         ) VALUES ($1, 'ok', 1, $2, $3, $4::jsonb)`,
        [
          startedAt,
          content.length,
          compressed.length,
          JSON.stringify({ source: ACTOR, batch_id: BATCH_ID, artifact_key: ARTIFACT_KEY })
        ]
      );
    }
    await client.query('COMMIT');
    return { inserted: inserted.rowCount === 1, compressedBytes: compressed.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function linkFinanceEvidence(client) {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query("SET LOCAL lock_timeout = '20s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query(`SELECT set_config('app.actor', $1, true)`, [ACTOR]);
    const beforeLedger = await ledgerSnapshot(client);
    const batch = await loadBatch(client, { lock: true });
    const computedImportDayTotals = await validateDirectionTotals(client, batch.account_id);

    assert(await duplicateSchemaInstalled(client),
      'migration 0087 ainda nao foi aplicada; o artefato duravel nao sera ligado pela metade');
    await client.query(
      `SELECT id
         FROM fin_duplicate_case
        WHERE evidence ->> 'batch_id' = $1::text
           OR evidence ->> 'raw_artifact_key' = $2
        ORDER BY id
        FOR UPDATE`,
      [BATCH_ID, ARTIFACT_KEY]
    );

    const beforeRows = await duplicateCaseState(client);
    const beforeState = assertCaseTransitionIsSafe(beforeRows);
    let batchLinked = false;
    let casesReviewed = 0;

    if (batch.raw_artifact_key === null) {
      await client.query(
        `INSERT INTO fin_audit_log (
           entity_id, target_table, target_id, action, before, after, fields, actor
         ) VALUES (
           $1, 'fin_import_batch', $2, 'update',
           jsonb_build_object('raw_artifact_key', NULL),
           jsonb_build_object('raw_artifact_key', $3::text),
           ARRAY['raw_artifact_key']::text[], $4
         )`,
        [batch.entity_id, BATCH_ID, ARTIFACT_KEY, ACTOR]
      );
      await client.query(
        `UPDATE fin_import_batch SET raw_artifact_key = $2 WHERE id = $1`,
        [BATCH_ID, ARTIFACT_KEY]
      );
      batchLinked = true;
    }

    if (!beforeState.alreadyDone) {
      const ids = beforeState.awaiting.map((row) => row.id);
      const reviewed = await client.query(
        `UPDATE fin_duplicate_case c
            SET workflow_status = 'revisado',
                verdict = 'transacoes_distintas',
                evidence_strength = 'forte',
                evidence = c.evidence || jsonb_build_object(
                  'proof_kind', 'nubank_pdf_totais_direcionais_e_linhas_distintas',
                  'raw_artifact_key', $2::text,
                  'artifact_sha256', $3::text,
                  'statement_direction_totals', $4::jsonb -> c.posted_on::text,
                  'computed_import_day_totals', $6::jsonb -> c.posted_on::text,
                  'direction_totals_validated', true,
                  'basis', 'o PDF original inclui as ocorrencias no somatorio direcional auditado; repeticao visual nao e duplicata tecnica'
                ),
                reviewed_member_fingerprint = c.member_fingerprint,
                reviewed_at = clock_timestamp(),
                reviewed_by = $5,
                last_actor = $5,
                updated_at = clock_timestamp()
          WHERE c.id = ANY($1::bigint[])
            AND c.workflow_status = 'aguardando_evidencia'
          RETURNING c.id`,
        [
          ids,
          ARTIFACT_KEY,
          EXPECTED_SHA256,
          JSON.stringify(DIRECTION_TOTALS),
          ACTOR,
          JSON.stringify(computedImportDayTotals)
        ]
      );
      assert(reviewed.rowCount === 7,
        `esperava revisar 7 casos depois do PDF duravel; revisou ${reviewed.rowCount}`);
      const reviewedIds = reviewed.rows.map((row) => row.id);
      await client.query(
        `UPDATE fin_duplicate_case_member
            SET review_status = 'confirmado_distinto',
                evidence = evidence || jsonb_build_object(
                  'inherited_from_case', case_id,
                  'raw_artifact_key', $2::text,
                  'artifact_sha256', $3::text
                ),
                last_seen_at = clock_timestamp()
          WHERE case_id = ANY($1::bigint[])
            AND is_current`,
        [reviewedIds, ARTIFACT_KEY, EXPECTED_SHA256]
      );
      casesReviewed = reviewed.rowCount;
    }

    const afterBatch = await loadBatch(client);
    assert(afterBatch.raw_artifact_key === ARTIFACT_KEY,
      'lote nao ficou ligado ao artefato esperado');
    const afterRows = await duplicateCaseState(client);
    const afterState = assertCaseTransitionIsSafe(afterRows);
    assert(afterState.alreadyDone, 'casos nao chegaram ao estado revisado idempotente');

    const { rows: [guard] } = await client.query(`SELECT * FROM fin_duplicate_ledger_guard_v`);
    assert(guard.neutralization_enabled === false && Number(guard.active_resolutions) === 0,
      'script encontrou mecanismo monetario ativo; abortando');
    const afterLedger = await ledgerSnapshot(client);
    sameLedger(beforeLedger, afterLedger);

    await client.query('COMMIT');
    return { batchLinked, casesReviewed, computedImportDayTotals, ledger: afterLedger };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function linkFinanceEvidenceWithRetry(pool, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const retryClient = await pool.connect();
    try {
      return await linkFinanceEvidence(retryClient);
    } catch (error) {
      if (!shouldRetryFinanceEvidence(error, attempt, maxAttempts)) throw error;
      const backoffMs = 100 * attempt;
      console.warn(
        `link financeiro sofreu ${error.code}; tentativa ${attempt}/${maxAttempts}, ` +
        `nova conexao em ${backoffMs}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    } finally {
      retryClient.release();
    }
  }
  throw new Error('retry financeiro terminou sem resultado');
}

loadEnv();
registerFinanceTypeParsers();
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}

const filePath = path.resolve(
  args.file || process.env.NUBANK_BATCH_10_PDF?.trim() || path.join(homedir(), 'Downloads', FILE_NAME)
);
const [content, fileInfo] = await Promise.all([readFile(filePath), stat(filePath)]);
assert(content.length === EXPECTED_BYTES,
  `arquivo tem ${content.length} bytes; esperado ${EXPECTED_BYTES}`);
assert(checksum(content) === EXPECTED_SHA256,
  `arquivo nao e o PDF auditado (SHA esperado ${EXPECTED_SHA256})`);

const finPool = financePool();
const artPool = artifactPool();
const finClient = await finPool.connect();
const artClient = await artPool.connect();
try {
  const batch = await loadBatch(finClient);
  const computedImportDayTotals = await validateDirectionTotals(finClient, batch.account_id);
  const schemaInstalled = await duplicateSchemaInstalled(finClient);
  const caseRows = schemaInstalled ? await duplicateCaseState(finClient) : [];
  const caseState = schemaInstalled ? assertCaseTransitionIsSafe(caseRows) : null;
  const existingArtifact = await loadArtifact(artClient);
  const artifactDurable = verifyArtifact(existingArtifact);

  if (!args.apply) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      writes: 0,
      file: { path: filePath, bytes: content.length, sha256: EXPECTED_SHA256 },
      batch: {
        id: BATCH_ID,
        status: batch.status,
        rawArtifactKey: batch.raw_artifact_key,
        wouldLink: batch.raw_artifact_key === null
      },
      artifact: {
        key: ARTIFACT_KEY,
        durable: artifactDurable,
        wouldInsert: !artifactDurable
      },
      duplicateCases: schemaInstalled ? {
        migrationInstalled: true,
        awaitingEvidence: caseState.awaiting.length,
        reviewedDistinct: caseState.reviewed.length,
        wouldReview: caseState.awaiting.length
      } : {
        migrationInstalled: false,
        prerequisite: 'aplicar db/migrations/0087_fin_duplicidade_casos.sql antes de --aplicar'
      },
      computedImportDayTotals,
      next: 'nenhuma gravacao feita; use --aplicar explicitamente depois da migration 0087'
    }, null, 2));
  } else {
    assert(schemaInstalled,
      'migration 0087 ainda nao foi aplicada; --aplicar recusado antes de escrever o artefato');
    const artifactWrite = await storeArtifact(artClient, content, fileInfo);
    const financeWrite = await linkFinanceEvidenceWithRetry(finPool);
    console.log(JSON.stringify({
      mode: 'aplicar',
      artifact: {
        key: ARTIFACT_KEY,
        inserted: artifactWrite.inserted,
        bytes: content.length,
        compressedBytes: artifactWrite.compressedBytes
      },
      finance: financeWrite,
      result: financeWrite.batchLinked || financeWrite.casesReviewed
        ? 'PDF arquivado e evidencia financeira ligada sem alterar o ledger'
        : 'ja estava concluido; nenhuma nova alteracao financeira'
    }, null, 2));
  }
} finally {
  finClient.release();
  artClient.release();
  await Promise.all([finPool.end(), artPool.end()]);
}
