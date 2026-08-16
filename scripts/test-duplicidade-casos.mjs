// Prova transacional da fila de duplicidade (migration 0087).
//
// A migration e instalada dentro da propria transacao quando ainda esta
// pendente. O teste fotografa contagem e somas do ledger, confere o seed
// auditado, acrescenta um membro sintetico a um caso revisado e prova que a
// fingerprint reabre a decisao. Tudo termina em ROLLBACK.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const migrationUrl = new URL('../db/migrations/0087_fin_duplicidade_casos.sql', import.meta.url);
const pool = financePool();
const client = await pool.connect();
let savepointSequence = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameMoney(before, after, context) {
  for (const field of ['transactions', 'sum_cents', 'absolute_cents']) {
    assert(
      String(before[field]) === String(after[field]),
      `${context}: ${field} mudou de ${before[field]} para ${after[field]}`
    );
  }
}

async function assertAppendOnly(sql, params, label) {
  const savepoint = `duplicate_event_guard_${++savepointSequence}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  let rejected = null;
  try {
    await client.query(sql, params);
  } catch (error) {
    rejected = error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  assert(rejected && /append-only/.test(rejected.message),
    `${label} nao foi recusado pela guarda append-only`);
}

async function ledgerSnapshot() {
  const { rows: [row] } = await client.query(
    `SELECT count(*)::bigint AS transactions,
            COALESCE(sum(amount_cents), 0)::bigint AS sum_cents,
            COALESCE(sum(abs(amount_cents)), 0)::bigint AS absolute_cents
       FROM fin_transaction`
  );
  return row;
}

async function rawM12() {
  const { rows: [row] } = await client.query(
    `WITH g AS (
       SELECT account_id, posted_on, amount_cents, description_norm, count(*)::integer AS n
         FROM fin_transaction
        WHERE NOT is_split_parent AND parent_id IS NULL
        GROUP BY 1, 2, 3, 4
       HAVING count(*) > 1
     )
     SELECT count(*)::integer AS groups,
            COALESCE(sum(n), 0)::bigint AS members,
            COALESCE(sum(n - 1), 0)::bigint AS repeated,
            COALESCE(sum(abs(amount_cents) * (n - 1)), 0)::bigint AS cents
       FROM g`
  );
  return row;
}

function fixtureIdentity(token, suffix) {
  return {
    sourceId: createHash('sha256').update(`${token}:source:${suffix}`).digest('hex'),
    dedupeHash: createHash('sha256').update(`${token}:dedupe:${suffix}`).digest('hex')
  };
}

async function insertMatching(connection, baseCase, token, suffix, actor) {
  const identity = fixtureIdentity(token, suffix);
  return connection.query(
    `INSERT INTO fin_transaction (
       entity_id, account_id, posted_on, amount_cents,
       description_raw, description_norm, source, source_id,
       dedupe_hash, created_by
     ) VALUES ($1, $2, $3, $4, $5, $5, 'manual', $6, $7, $8)
     RETURNING id`,
    [
      baseCase.entity_id,
      baseCase.account_id,
      baseCase.posted_on,
      baseCase.amount_cents,
      baseCase.description_norm,
      identity.sourceId,
      identity.dedupeHash,
      actor
    ]
  );
}

async function concurrencyBase() {
  const { rows: [row] } = await client.query(
    `SELECT c.id AS case_id, c.entity_id, c.account_id, c.posted_on,
            c.amount_cents, c.description_norm, c.member_count,
            c.member_fingerprint, c.workflow_status, c.last_actor,
            m.transaction_id, m.last_seen_at,
            (SELECT count(*)::integer FROM fin_duplicate_case_event e WHERE e.case_id = c.id) AS events
       FROM fin_duplicate_case c
       JOIN fin_duplicate_case_member m ON m.case_id = c.id AND m.is_current
      WHERE c.workflow_status = 'revisado'
        AND c.verdict = 'transacoes_distintas'
      ORDER BY c.id, m.id
      LIMIT 1`
  );
  assert(row, 'nenhum caso revisado para provas de concorrencia');
  return row;
}

async function proveCategoryUpdateSkipsLifecycle() {
  const baseCase = await concurrencyBase();
  const probe = await pool.connect();
  let open = false;
  try {
    await probe.query('BEGIN');
    open = true;
    await probe.query(`UPDATE fin_transaction SET category_id = category_id WHERE id = $1`,
      [baseCase.transaction_id]);

    // O observer consegue tomar o lock exato: o UPDATE sem mudanca de assinatura
    // retornou antes de chamar refresh_signatures.
    const { rows: [lockProbe] } = await client.query(
      `SELECT pg_try_advisory_lock(
         hashtextextended('fin_duplicate_cases:lifecycle:v1', 8707)
       ) AS acquired`
    );
    if (lockProbe.acquired) {
      await client.query(
        `SELECT pg_advisory_unlock(
           hashtextextended('fin_duplicate_cases:lifecycle:v1', 8707)
         )`
      );
    }
    assert(lockProbe.acquired === true, 'UPDATE apenas de categoria adquiriu o lock do lifecycle');

    const { rows: [after] } = await probe.query(
      `SELECT c.last_actor,
              c.member_fingerprint,
              m.last_seen_at,
              (SELECT count(*)::integer FROM fin_duplicate_case_event e WHERE e.case_id = c.id) AS events
         FROM fin_duplicate_case c
         JOIN fin_duplicate_case_member m ON m.case_id = c.id AND m.transaction_id = $2
        WHERE c.id = $1`,
      [baseCase.case_id, baseCase.transaction_id]
    );
    assert(after.last_actor === baseCase.last_actor &&
           after.member_fingerprint === baseCase.member_fingerprint &&
           String(after.last_seen_at) === String(baseCase.last_seen_at) &&
           Number(after.events) === Number(baseCase.events),
      'UPDATE apenas de categoria tocou caso, membro ou evento de duplicidade');
    await probe.query('ROLLBACK');
    open = false;
  } finally {
    if (open) await probe.query('ROLLBACK').catch(() => {});
    probe.release();
  }
}

async function proveConcurrentAdvisoryLifecycle() {
  const baseCase = await concurrencyBase();
  const c1 = await pool.connect();
  const c2 = await pool.connect();
  let c1Open = false;
  let c2Open = false;
  let insert2Promise = null;
  const token = `duplicate-concurrency-${process.pid}-${Date.now()}`;
  try {
    await c1.query('BEGIN');
    c1Open = true;
    await c2.query('BEGIN');
    c2Open = true;
    await c1.query(`SELECT set_config('app.actor', 'test:duplicate-concurrency:c1', true)`);
    await c2.query(`SELECT set_config('app.actor', 'test:duplicate-concurrency:c2', true)`);
    const { rows: [pid2] } = await c2.query(`SELECT pg_backend_pid() AS pid`);

    await insertMatching(c1, baseCase, token, 'c1', 'test:duplicate-concurrency:c1');
    insert2Promise = insertMatching(
      c2, baseCase, token, 'c2', 'test:duplicate-concurrency:c2'
    ).then((result) => ({ result }), (error) => ({ error }));

    let waitingOnAdvisory = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const { rows: [activity] } = await client.query(
        `SELECT wait_event_type, wait_event
           FROM pg_stat_activity
          WHERE pid = $1`,
        [pid2.pid]
      );
      if (activity?.wait_event_type === 'Lock' && activity?.wait_event === 'advisory') {
        waitingOnAdvisory = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(waitingOnAdvisory, 'segunda conexao nao esperou no lock advisory global');

    await c1.query('ROLLBACK');
    c1Open = false;
    const outcome = await insert2Promise;
    assert(!outcome.error, `segunda conexao falhou depois do lock: ${outcome.error?.message}`);
    const { rows: [insideC2] } = await c2.query(
      `SELECT c.workflow_status, c.member_count,
              count(*) FILTER (
                WHERE e.event_kind = 'reaberto'
                  AND e.actor = 'test:duplicate-concurrency:c2'
              )::integer AS reopen_events
         FROM fin_duplicate_case c
         LEFT JOIN fin_duplicate_case_event e ON e.case_id = c.id
        WHERE c.id = $1
        GROUP BY c.id`,
      [baseCase.case_id]
    );
    assert(insideC2.workflow_status === 'reaberto' &&
           Number(insideC2.member_count) === Number(baseCase.member_count) + 1 &&
           Number(insideC2.reopen_events) === 1,
      'segunda conexao nao concluiu o lifecycle depois de adquirir o lock');
    await c2.query('ROLLBACK');
    c2Open = false;

    const { rows: [restored] } = await client.query(
      `SELECT workflow_status, member_count, member_fingerprint
         FROM fin_duplicate_case WHERE id = $1`,
      [baseCase.case_id]
    );
    assert(restored.workflow_status === baseCase.workflow_status &&
           Number(restored.member_count) === Number(baseCase.member_count) &&
           restored.member_fingerprint === baseCase.member_fingerprint,
      'ROLLBACK das duas conexoes nao restaurou o caso concorrente');
  } finally {
    if (c1Open) await c1.query('ROLLBACK').catch(() => {});
    if (c2Open) await c2.query('ROLLBACK').catch(() => {});
    if (insert2Promise) await insert2Promise.catch(() => {});
    c1.release();
    c2.release();
  }
}

try {
  const { rows: [installedBefore] } = await client.query(
    `SELECT to_regclass('fin_duplicate_case') IS NOT NULL AS installed`
  );
  let concurrentProofRan = false;
  if (installedBefore.installed) {
    await proveCategoryUpdateSkipsLifecycle();
    await proveConcurrentAdvisoryLifecycle();
    concurrentProofRan = true;
  }
  const before = await ledgerSnapshot();
  const rawBefore = await rawM12();

  assert(Number(rawBefore.groups) === 54, `baseline M12: ${rawBefore.groups} grupos, esperado 54`);
  assert(Number(rawBefore.members) === 168, `baseline M12: ${rawBefore.members} membros, esperado 168`);
  assert(Number(rawBefore.repeated) === 114, `baseline M12: ${rawBefore.repeated} repeticoes, esperado 114`);
  assert(Number(rawBefore.cents) === 8_049_981, `baseline M12: ${rawBefore.cents} cents, esperado 8049981`);

  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '20s'");
  await client.query("SET LOCAL statement_timeout = '180s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '240s'");
  await client.query("SELECT set_config('app.actor', '', true)");

  if (!installedBefore.installed) {
    await client.query(await readFile(migrationUrl, 'utf8'));
  }

  const afterMigration = await ledgerSnapshot();
  sameMoney(before, afterMigration, 'migration 0087');

  const { rows: [monitor] } = await client.query(`SELECT * FROM fin_duplicate_monitor_v`);
  assert(Number(monitor.raw_groups) === 54, 'monitor bruto nao preservou 54 grupos');
  assert(Number(monitor.raw_members) === 168, 'monitor bruto nao preservou 168 membros');
  assert(Number(monitor.raw_repeated) === 114, 'monitor bruto nao preservou 114 repeticoes');
  assert(Number(monitor.raw_cents) === 8_049_981, 'monitor bruto nao preservou R$ 80.499,81');
  assert(Number(monitor.untracked_raw_cases) === 0,
    'seed deixou assinatura bruta sem caso rastreavel');
  assert(Number(monitor.stale_tracked_cases) === 0,
    'seed deixou caso revisado sobre fingerprint stale');
  assert(Number(monitor.unreviewed_cases) === 0, 'seed deixou caso novo/reaberto');
  assert(Number(monitor.technical_verdict_cases) === 0, '0087 nao pode inventar duplicata tecnica');
  const seedState = Number(monitor.awaiting_evidence_cases) === 7 &&
    Number(monitor.awaiting_evidence_repeated) === 10 &&
    Number(monitor.awaiting_evidence_cents) === 227_262 &&
    Number(monitor.reviewed_distinct_cases) === 47;
  const artifactFinalizedState = Number(monitor.awaiting_evidence_cases) === 0 &&
    Number(monitor.awaiting_evidence_repeated) === 0 &&
    Number(monitor.awaiting_evidence_cents) === 0 &&
    Number(monitor.reviewed_distinct_cases) === 54;
  assert(seedState || artifactFinalizedState,
    'fila deveria estar no seed 47+7 ou no estado final 54+0 depois do PDF');
  if (!installedBefore.installed) {
    assert(seedState, 'migration nova nao produziu o seed auditado de 47 revisados + 7 aguardando');
  }

  const { rows: [inventory] } = await client.query(
    `SELECT count(*)::integer AS cases,
            count(*) FILTER (WHERE workflow_status = 'revisado')::integer AS reviewed,
            count(*) FILTER (WHERE workflow_status = 'aguardando_evidencia')::integer AS awaiting,
            count(*) FILTER (WHERE verdict IN ('duplicata_tecnica', 'misto'))::integer AS technical,
            (SELECT count(*)::integer FROM fin_duplicate_case_member WHERE is_current) AS current_members,
            (SELECT count(*)::integer FROM fin_duplicate_case_event) AS events
       FROM fin_duplicate_case`
  );
  assert(Number(inventory.cases) === 54, 'inventario deveria ter 54 casos');
  assert(
    (Number(inventory.reviewed) === 47 && Number(inventory.awaiting) === 7) ||
    (Number(inventory.reviewed) === 54 && Number(inventory.awaiting) === 0),
    `estados inesperados: ${inventory.reviewed} revisados / ${inventory.awaiting} aguardando`
  );
  assert(Number(inventory.technical) === 0, 'inventario contem veredito tecnico sem prova');
  assert(Number(inventory.current_members) === 168, 'inventario deveria ter 168 membros atuais');

  const { rows: [eventFixture] } = await client.query(
    `SELECT id FROM fin_duplicate_case_event ORDER BY id LIMIT 1`
  );
  assert(eventFixture, 'seed nao produziu evento para testar a trilha');
  await assertAppendOnly(
    `UPDATE fin_duplicate_case_event SET actor = actor WHERE id = $1`,
    [eventFixture.id],
    'UPDATE de evento'
  );
  await assertAppendOnly(
    `DELETE FROM fin_duplicate_case_event WHERE id = $1`,
    [eventFixture.id],
    'DELETE de evento'
  );
  await assertAppendOnly(
    `TRUNCATE fin_duplicate_case_event`,
    [],
    'TRUNCATE de eventos'
  );

  const categoryOnlyCase = await concurrencyBase();
  await client.query(
    `UPDATE fin_transaction SET category_id = category_id WHERE id = $1`,
    [categoryOnlyCase.transaction_id]
  );
  const { rows: [afterCategoryOnly] } = await client.query(
    `SELECT c.last_actor, c.member_fingerprint, m.last_seen_at,
            (SELECT count(*)::integer FROM fin_duplicate_case_event e WHERE e.case_id = c.id) AS events
       FROM fin_duplicate_case c
       JOIN fin_duplicate_case_member m ON m.case_id = c.id AND m.transaction_id = $2
      WHERE c.id = $1`,
    [categoryOnlyCase.case_id, categoryOnlyCase.transaction_id]
  );
  assert(afterCategoryOnly.last_actor === categoryOnlyCase.last_actor &&
         afterCategoryOnly.member_fingerprint === categoryOnlyCase.member_fingerprint &&
         String(afterCategoryOnly.last_seen_at) === String(categoryOnlyCase.last_seen_at) &&
         Number(afterCategoryOnly.events) === Number(categoryOnlyCase.events),
    'UPDATE apenas de categoria tocou o lifecycle de duplicidade');

  const { rows: [triggerShape] } = await client.query(
    `SELECT count(*)::integer AS triggers,
            count(*) FILTER (WHERE (tgtype & 1) = 0)::integer AS statement_level,
            count(*) FILTER (WHERE tgenabled <> 'D')::integer AS enabled
       FROM pg_trigger
      WHERE tgrelid = 'fin_transaction'::regclass
        AND tgname IN (
          'fin_duplicate_tx_insert_stmt',
          'fin_duplicate_tx_update_stmt',
          'fin_duplicate_tx_delete_stmt'
        )`
  );
  assert(Number(triggerShape.triggers) === 3, 'faltam gatilhos automaticos INSERT/UPDATE/DELETE');
  assert(Number(triggerShape.statement_level) === 3,
    'lifecycle de duplicidade deve executar uma vez por statement, nao uma vez por linha');
  assert(Number(triggerShape.enabled) === 3, 'algum gatilho automatico nasceu desabilitado');

  const { rows: [waitingProof] } = await client.query(
    `SELECT count(*)::integer AS cases,
            count(*) FILTER (
              WHERE evidence ->> 'expected_sha256' =
                    '75eee8665ccfbf7d1c36fd921e60dbe93d6392b6a802d50b232f701aad2fbf7c'
                AND evidence ->> 'batch_id' = '10'
            )::integer AS traced
       FROM fin_duplicate_case
      WHERE workflow_status = 'aguardando_evidencia'`
  );
  assert(Number(waitingProof.cases) === Number(monitor.awaiting_evidence_cases) &&
         Number(waitingProof.traced) === Number(waitingProof.cases),
    'casos aguardando PDF nao carregam lote/checksum completos');

  const { rows: [guard] } = await client.query(`SELECT * FROM fin_duplicate_ledger_guard_v`);
  assert(guard.neutralization_enabled === false, 'guarda de neutralizacao nasceu habilitada');
  assert(Number(guard.active_resolutions) === 0, '0087 declarou resolucao monetaria ativa');

  // Refresh sem mudanca e ponto fixo: nao cria caso, nao reabre e nao produz
  // evento de negocio novo.
  const eventsBeforeIdempotent = Number(inventory.events);
  const { rows: [fixedPoint] } = await client.query(
    `SELECT * FROM fin_duplicate_cases_refresh('test:duplicate-fixed-point')`
  );
  assert(Number(fixedPoint.novos) === 0 && Number(fixedPoint.reabertos) === 0,
    'refresh identico nao foi idempotente');
  const { rows: [eventsAfterIdempotent] } = await client.query(
    `SELECT count(*)::integer AS n FROM fin_duplicate_case_event`
  );
  assert(Number(eventsAfterIdempotent.n) === eventsBeforeIdempotent,
    'refresh identico criou evento sem mudanca de decisao');

  // Dois casos revisados da mesma conta permitem provar INSERT e, em seguida,
  // UPDATE da assinatura antiga para a nova. Um terceiro caso recebe um
  // timestamp sentinela: qualquer refresh global acidental o destruiria.
  const { rows: [pair] } = await client.query(
    `WITH ranked AS (
       SELECT c.*,
              row_number() OVER (PARTITION BY c.account_id ORDER BY abs(c.amount_cents), c.id) AS rn
         FROM fin_duplicate_case c
        WHERE c.workflow_status = 'revisado'
          AND c.verdict = 'transacoes_distintas'
     )
     SELECT b.id AS base_case_id,
            b.member_count AS base_member_count,
            b.member_fingerprint AS base_member_fingerprint,
            b.entity_id,
            b.account_id,
            b.posted_on AS base_posted_on,
            b.amount_cents AS base_amount_cents,
            b.description_norm AS base_description_norm,
            t.id AS target_case_id,
            t.member_count AS target_member_count,
            t.member_fingerprint AS target_member_fingerprint,
            t.posted_on AS target_posted_on,
            t.amount_cents AS target_amount_cents,
            t.description_norm AS target_description_norm
       FROM ranked b
       JOIN ranked t ON t.account_id = b.account_id AND t.rn = 2
      WHERE b.rn = 1
      ORDER BY b.account_id
      LIMIT 1`
  );
  assert(pair, 'faltam dois casos revisados na mesma conta para ensaio de mudanca de assinatura');

  const { rows: [untouched] } = await client.query(
    `SELECT c.id AS case_id, m.id AS member_id,
            c.entity_id, c.account_id, c.posted_on, c.amount_cents,
            c.description_norm, c.member_count, c.member_fingerprint,
            (SELECT count(*)::integer FROM fin_duplicate_case_event e WHERE e.case_id = c.id) AS events
       FROM fin_duplicate_case c
       JOIN fin_duplicate_case_member m ON m.case_id = c.id AND m.is_current
      WHERE c.id <> ALL($1::bigint[])
      ORDER BY c.id, m.id
      LIMIT 1`,
    [[pair.base_case_id, pair.target_case_id]]
  );
  assert(untouched, 'nenhum terceiro caso disponivel para provar refresh direcionado');
  await client.query(
    `UPDATE fin_duplicate_case_member
        SET last_seen_at = timestamptz '2000-01-01 00:00:00+00'
      WHERE id = $1`,
    [untouched.member_id]
  );

  const token = `duplicate-case-${process.pid}-${Date.now()}`;
  const sourceId = createHash('sha256').update(`${token}:source`).digest('hex');
  const dedupeHash = createHash('sha256').update(`${token}:dedupe`).digest('hex');
  const { rows: [synthetic] } = await client.query(
    `INSERT INTO fin_transaction (
       entity_id, account_id, posted_on, amount_cents,
       description_raw, description_norm, source, source_id,
       dedupe_hash, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7, $8, 'test:duplicate-case')
     RETURNING id`,
    [
      pair.entity_id,
      pair.account_id,
      pair.base_posted_on,
      pair.base_amount_cents,
      pair.base_description_norm,
      pair.base_description_norm,
      sourceId,
      dedupeHash
    ]
  );
  assert(synthetic, 'fixture sintetica nao foi criada');

  const { rows: [reopened] } = await client.query(
    `SELECT c.workflow_status,
            c.verdict,
            c.evidence_strength,
            c.reviewed_at,
            c.reviewed_by,
            c.member_count,
            c.member_fingerprint,
            count(*) FILTER (WHERE m.is_current)::integer AS current_members,
            count(*) FILTER (WHERE m.is_current AND m.review_status = 'pendente')::integer AS pending_members
       FROM fin_duplicate_case c
       LEFT JOIN fin_duplicate_case_member m ON m.case_id = c.id
      WHERE c.id = $1
      GROUP BY c.id`,
    [pair.base_case_id]
  );
  assert(reopened.workflow_status === 'reaberto', `caso ficou ${reopened.workflow_status}, esperado reaberto`);
  assert(reopened.verdict === null && reopened.evidence_strength === null,
    'reabertura preservou veredito/evidencia obsoletos');
  assert(reopened.reviewed_at === null && reopened.reviewed_by === null,
    'reabertura preservou assinatura humana obsoleta');
  assert(Number(reopened.member_count) === Number(pair.base_member_count) + 1,
    'reabertura nao incorporou o novo membro');
  assert(reopened.member_fingerprint !== pair.base_member_fingerprint,
    'fingerprint nao mudou depois do novo membro');
  assert(Number(reopened.current_members) === Number(reopened.member_count),
    'caso e tabela de membros discordam');
  assert(Number(reopened.pending_members) === Number(reopened.member_count),
    'reabertura nao devolveu o conjunto inteiro para revisao');

  const { rows: [reopenEvent] } = await client.query(
    `SELECT count(*)::integer AS n
       FROM fin_duplicate_case_event
      WHERE case_id = $1
        AND event_kind = 'reaberto'
        AND actor = 'trigger:fin_transaction:insert'`,
    [pair.base_case_id]
  );
  assert(Number(reopenEvent.n) === 1,
    'INSERT sozinho nao registrou uma unica reabertura automatica');

  const { rows: [untouchedAfterInsert] } = await client.query(
    `SELECT m.last_seen_at = timestamptz '2000-01-01 00:00:00+00' AS member_untouched,
            (SELECT count(*)::integer FROM fin_duplicate_case_event e WHERE e.case_id = $2) AS events
       FROM fin_duplicate_case_member m
      WHERE m.id = $1`,
    [untouched.member_id, untouched.case_id]
  );
  assert(untouchedAfterInsert.member_untouched === true,
    'INSERT regravou membro de caso nao afetado (refresh deixou de ser direcionado)');
  assert(Number(untouchedAfterInsert.events) === Number(untouched.events),
    'INSERT criou evento em caso nao afetado');

  const { rows: [secondRefresh] } = await client.query(
    `SELECT * FROM fin_duplicate_cases_refresh('test:duplicate-new-member-second-pass')`
  );
  assert(Number(secondRefresh.novos) === 0 && Number(secondRefresh.reabertos) === 0,
    'segunda passada da reabertura nao foi ponto fixo');
  // A varredura global explicita acima pode atualizar last_seen_at por desenho.
  // Reinstala a sentinela para isolar os dois gatilhos direcionados seguintes.
  await client.query(
    `UPDATE fin_duplicate_case_member
        SET last_seen_at = timestamptz '2000-01-01 00:00:00+00'
      WHERE id = $1`,
    [untouched.member_id]
  );

  // Move a mesma transacao para uma segunda assinatura revisada. O gatilho de
  // UPDATE precisa fechar o membro no caso antigo, abrir no novo e reabrir a
  // decisao do novo conjunto no proprio statement.
  await client.query(
    `UPDATE fin_transaction
        SET posted_on = $2,
            amount_cents = $3,
            description_raw = $4,
            description_norm = $4
      WHERE id = $1`,
    [
      synthetic.id,
      pair.target_posted_on,
      pair.target_amount_cents,
      pair.target_description_norm
    ]
  );

  const { rows: [moved] } = await client.query(
    `SELECT b.workflow_status AS base_status,
            b.member_count AS base_members,
            b.member_fingerprint AS base_fingerprint,
            t.workflow_status AS target_status,
            t.verdict AS target_verdict,
            t.reviewed_at AS target_reviewed_at,
            t.member_count AS target_members,
            t.member_fingerprint AS target_fingerprint,
            count(*) FILTER (
              WHERE m.case_id = b.id AND NOT m.is_current AND m.transaction_ref_id = $3
            )::integer AS base_history,
            count(*) FILTER (
              WHERE m.case_id = t.id AND m.is_current AND m.transaction_id = $3
            )::integer AS target_current
       FROM fin_duplicate_case b
       JOIN fin_duplicate_case t ON t.id = $2
       LEFT JOIN fin_duplicate_case_member m ON m.case_id IN (b.id, t.id)
      WHERE b.id = $1
      GROUP BY b.id, t.id`,
    [pair.base_case_id, pair.target_case_id, synthetic.id]
  );
  assert(moved.base_status === 'reaberto', 'caso antigo deveria permanecer aberto para nova revisao');
  assert(Number(moved.base_members) === Number(pair.base_member_count),
    'caso antigo nao voltou a contagem original apos UPDATE');
  assert(moved.base_fingerprint === pair.base_member_fingerprint,
    'caso antigo nao voltou a fingerprint original apos UPDATE');
  assert(moved.target_status === 'reaberto', 'UPDATE nao reabriu automaticamente o caso novo');
  assert(moved.target_verdict === null && moved.target_reviewed_at === null,
    'UPDATE preservou decisao antiga do caso novo');
  assert(Number(moved.target_members) === Number(pair.target_member_count) + 1,
    'caso novo nao incorporou o membro movido');
  assert(moved.target_fingerprint !== pair.target_member_fingerprint,
    'fingerprint do caso novo nao mudou');
  assert(Number(moved.base_history) === 1 && Number(moved.target_current) === 1,
    'mudanca de assinatura nao preservou historia antiga e membro atual novo');

  const { rows: [updateEvent] } = await client.query(
    `SELECT count(*)::integer AS n
       FROM fin_duplicate_case_event
      WHERE case_id = $1
        AND event_kind = 'reaberto'
        AND actor = 'trigger:fin_transaction:update'`,
    [pair.target_case_id]
  );
  assert(Number(updateEvent.n) === 1, 'UPDATE nao deixou trilha automatica no caso novo');

  // DELETE deve ser possivel mesmo com historia: a FK zera transaction_id,
  // transaction_ref_id permanece, e o caso volta a refletir somente o ledger.
  await client.query(`DELETE FROM fin_transaction WHERE id = $1`, [synthetic.id]);

  const { rows: [afterDelete] } = await client.query(
    `SELECT c.workflow_status,
            c.member_count,
            c.member_fingerprint,
            count(*) FILTER (
              WHERE m.transaction_ref_id = $2
                AND NOT m.is_current
                AND m.transaction_id IS NULL
                AND m.removed_at IS NOT NULL
            )::integer AS preserved_history
       FROM fin_duplicate_case c
       LEFT JOIN fin_duplicate_case_member m ON m.case_id = c.id
      WHERE c.id = $1
      GROUP BY c.id`,
    [pair.target_case_id, synthetic.id]
  );
  assert(afterDelete.workflow_status === 'reaberto', 'DELETE fechou caso sem nova revisao');
  assert(Number(afterDelete.member_count) === Number(pair.target_member_count),
    'DELETE nao restaurou a contagem original do caso');
  assert(afterDelete.member_fingerprint === pair.target_member_fingerprint,
    'DELETE nao restaurou a fingerprint original do caso');
  assert(Number(afterDelete.preserved_history) === 1,
    'DELETE perdeu a identidade historica do membro removido');

  const { rows: [deleteEvent] } = await client.query(
    `SELECT count(*)::integer AS n
       FROM fin_duplicate_case_event
      WHERE case_id = $1
        AND actor = 'trigger:fin_transaction:delete'`,
    [pair.target_case_id]
  );
  assert(Number(deleteEvent.n) === 1, 'DELETE nao deixou trilha automatica');

  const { rows: [untouchedAtEnd] } = await client.query(
    `SELECT m.last_seen_at = timestamptz '2000-01-01 00:00:00+00' AS member_untouched,
            (SELECT count(*)::integer FROM fin_duplicate_case_event e WHERE e.case_id = $2) AS events
       FROM fin_duplicate_case_member m
      WHERE m.id = $1`,
    [untouched.member_id, untouched.case_id]
  );
  assert(untouchedAtEnd.member_untouched === true &&
         Number(untouchedAtEnd.events) === Number(untouched.events),
    'lifecycle INSERT/UPDATE/DELETE tocou caso fora das assinaturas afetadas');

  // Simula a janela rara de dois INSERTs concorrentes que enxergam uma linha
  // cada: desliga somente o gatilho deste ensaio, cria o grupo bruto sem caso e
  // prova que o monitor operacional fica vermelho ate o refresh corretivo.
  const untrackedToken = `${token}-untracked`;
  const untrackedSourceA = createHash('sha256').update(`${untrackedToken}:source:a`).digest('hex');
  const untrackedSourceB = createHash('sha256').update(`${untrackedToken}:source:b`).digest('hex');
  const untrackedDedupeA = createHash('sha256').update(`${untrackedToken}:dedupe:a`).digest('hex');
  const untrackedDedupeB = createHash('sha256').update(`${untrackedToken}:dedupe:b`).digest('hex');
  const untrackedAmount = 123_457;
  const { rows: [beforeGapMonitor] } = await client.query(`SELECT * FROM fin_duplicate_monitor_v`);
  assert(Number(beforeGapMonitor.untracked_raw_cases) === 0,
    'ensaio de corrida comecou com caso bruto nao rastreado');
  await client.query(
    `ALTER TABLE fin_transaction DISABLE TRIGGER fin_duplicate_tx_insert_stmt`
  );
  let untrackedTransactions;
  try {
    const result = await client.query(
      `INSERT INTO fin_transaction (
         entity_id, account_id, posted_on, amount_cents,
         description_raw, description_norm, source, source_id,
         dedupe_hash, created_by
       ) VALUES
         ($1, $2, $3, $4, $5, $5, 'manual', $6, $7, 'test:duplicate-untracked'),
         ($1, $2, $3, $4, $5, $5, 'manual', $8, $9, 'test:duplicate-untracked')
       RETURNING id`,
      [
        pair.entity_id,
        pair.account_id,
        pair.base_posted_on,
        untrackedAmount,
        untrackedToken,
        untrackedSourceA,
        untrackedDedupeA,
        untrackedSourceB,
        untrackedDedupeB
      ]
    );
    untrackedTransactions = result.rows;
  } finally {
    await client.query(
      `ALTER TABLE fin_transaction ENABLE TRIGGER fin_duplicate_tx_insert_stmt`
    );
  }
  assert(untrackedTransactions.length === 2, 'fixture de corrida nao criou duas linhas brutas');

  const { rows: [gapMonitor] } = await client.query(`SELECT * FROM fin_duplicate_monitor_v`);
  assert(Number(gapMonitor.untracked_raw_cases) === 1 &&
         Number(gapMonitor.untracked_raw_repeated) === 1 &&
         Number(gapMonitor.untracked_raw_cents) === untrackedAmount,
    'monitor nao expos o grupo bruto sem caso');
  assert(Number(gapMonitor.unreviewed_cases) === Number(beforeGapMonitor.unreviewed_cases) + 1 &&
         Number(gapMonitor.unreviewed_repeated) === Number(beforeGapMonitor.unreviewed_repeated) + 1 &&
         Number(gapMonitor.unreviewed_cents) === Number(beforeGapMonitor.unreviewed_cents) + untrackedAmount,
    'M12 operacional silenciou a janela concorrente');

  const { rows: [gapRefresh] } = await client.query(
    `SELECT * FROM fin_duplicate_cases_refresh('test:duplicate-untracked-repair')`
  );
  assert(Number(gapRefresh.novos) === 1, 'refresh nao materializou o caso bruto ausente');
  const { rows: [repairedMonitor] } = await client.query(`SELECT * FROM fin_duplicate_monitor_v`);
  assert(Number(repairedMonitor.untracked_raw_cases) === 0 &&
         Number(repairedMonitor.tracked_unreviewed_cases) === Number(beforeGapMonitor.tracked_unreviewed_cases) + 1 &&
         Number(repairedMonitor.unreviewed_cases) === Number(gapMonitor.unreviewed_cases),
    'refresh corretivo nao moveu o alarme bruto para um caso rastreado');

  await client.query(
    `DELETE FROM fin_transaction WHERE id = ANY($1::bigint[])`,
    [untrackedTransactions.map((row) => row.id)]
  );
  const { rows: [cleanMonitor] } = await client.query(`SELECT * FROM fin_duplicate_monitor_v`);
  assert(Number(cleanMonitor.untracked_raw_cases) === 0 &&
         Number(cleanMonitor.unreviewed_cases) === Number(beforeGapMonitor.unreviewed_cases),
    'limpeza da fixture deixou alarme operacional residual');

  // Caso existente e revisado tambem nao pode ficar silenciosamente stale.
  // SAVEPOINT devolve inclusive o workflow/evento ao estado anterior ao ensaio.
  await client.query(`SAVEPOINT duplicate_stale_visibility`);
  const staleToken = `${token}-stale`;
  await client.query(
    `ALTER TABLE fin_transaction DISABLE TRIGGER fin_duplicate_tx_insert_stmt`
  );
  try {
    await client.query(
      `INSERT INTO fin_transaction (
         entity_id, account_id, posted_on, amount_cents,
         description_raw, description_norm, source, source_id,
         dedupe_hash, created_by
       ) VALUES ($1, $2, $3, $4, $5, $5, 'manual', $6, $7, 'test:duplicate-stale')`,
      [
        untouched.entity_id,
        untouched.account_id,
        untouched.posted_on,
        untouched.amount_cents,
        untouched.description_norm,
        createHash('sha256').update(`${staleToken}:source`).digest('hex'),
        createHash('sha256').update(`${staleToken}:dedupe`).digest('hex')
      ]
    );
  } finally {
    await client.query(
      `ALTER TABLE fin_transaction ENABLE TRIGGER fin_duplicate_tx_insert_stmt`
    );
  }
  const { rows: [staleMonitor] } = await client.query(`SELECT * FROM fin_duplicate_monitor_v`);
  assert(Number(staleMonitor.untracked_raw_cases) === 0,
    'caso existente stale foi contado incorretamente como raw sem caso');
  assert(Number(staleMonitor.stale_tracked_cases) === 1,
    'monitor nao expos caso revisado com fingerprint stale');
  const staleExpectedRepeated = Number(untouched.member_count);
  const staleExpectedCents = Math.abs(Number(untouched.amount_cents)) * staleExpectedRepeated;
  assert(Number(staleMonitor.stale_tracked_repeated) === staleExpectedRepeated &&
         Number(staleMonitor.stale_tracked_cents) === staleExpectedCents,
    'exposicao do caso stale nao reflete seus membros atuais');

  const { rows: [staleRefresh] } = await client.query(
    `SELECT * FROM fin_duplicate_cases_refresh('test:duplicate-stale-repair')`
  );
  assert(Number(staleRefresh.reabertos) === 1,
    'refresh nao reabriu caso revisado com fingerprint stale');
  const { rows: [afterStaleRefresh] } = await client.query(`SELECT * FROM fin_duplicate_monitor_v`);
  assert(Number(afterStaleRefresh.stale_tracked_cases) === 0 &&
         Number(afterStaleRefresh.unreviewed_cases) === Number(staleMonitor.unreviewed_cases),
    'refresh stale nao preservou o alarme como caso rastreado/reaberto');
  await client.query(`ROLLBACK TO SAVEPOINT duplicate_stale_visibility`);
  await client.query(`RELEASE SAVEPOINT duplicate_stale_visibility`);

  const beforeRollback = await ledgerSnapshot();
  sameMoney(before, beforeRollback, 'fixtures sinteticas removidas antes do ROLLBACK');
  const rawBeforeRollback = await rawM12();
  assert(JSON.stringify(rawBeforeRollback) === JSON.stringify(rawBefore),
    'fixtures sinteticas nao restauraram o M12 bruto antes do ROLLBACK');

  await client.query('ROLLBACK');

  const afterRollback = await ledgerSnapshot();
  sameMoney(before, afterRollback, 'ROLLBACK do teste 0087');
  const rawAfter = await rawM12();
  assert(JSON.stringify(rawAfter) === JSON.stringify(rawBefore),
    'ROLLBACK nao restaurou o baseline bruto do M12');
  const { rows: [installedAfter] } = await client.query(
    `SELECT to_regclass('fin_duplicate_case') IS NOT NULL AS installed`
  );
  assert(installedAfter.installed === installedBefore.installed,
    'teste deixou DDL da migration persistido');

  console.log('✓ 0087 transacional: 54 casos / 168 membros / 114 repeticoes / R$ 80.499,81');
  console.log(seedState
    ? '✓ seed: 47 revisados por evidencia persistida, 7 aguardando PDF, zero neutralizacao'
    : '✓ estado duravel: 54 revisados, PDF ligado, zero neutralizacao');
  console.log('✓ gatilhos por statement: INSERT reabre; UPDATE move assinatura; DELETE preserva historia');
  console.log('✓ refresh direcionado nao regrava membro nem evento de caso nao afetado');
  console.log('✓ corrida sem caso permanece visivel no M12 e refresh a materializa; eventos sao append-only');
  console.log(concurrentProofRan
    ? '✓ duas conexoes provaram espera advisory; UPDATE so de categoria nao toca o lifecycle'
    : '↷ prova real em duas conexoes fica ativa automaticamente apos a 0087 estar instalada');
  console.log('✓ contagem e somas do ledger intactas; ROLLBACK integral');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
