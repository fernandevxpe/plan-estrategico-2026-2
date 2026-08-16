// Prova transacional da saude e da memoria de regras (migration 0088).
//
// Se a migration ainda estiver pendente, o teste a instala dentro da propria
// transacao. Exercita fatos sinteticos, versoes e assercoes e SEMPRE termina em
// ROLLBACK. Nenhuma classificacao, regra ou valor financeiro fica gravado.

import { readFile } from 'node:fs/promises';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { normalizeName } from './lib/fin-normalize.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const migrationUrl = new URL('../db/migrations/0088_fin_regra_saude.sql', import.meta.url);
const pool = financePool();
const client = await pool.connect();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function one(sql, params = []) {
  const { rows: [row] } = await client.query(sql, params);
  return row;
}

async function classificationSnapshot() {
  return one(`
    SELECT
      (SELECT md5(COALESCE(string_agg(
                jsonb_build_array(
                  id, category_id, nucleo, classified_rule_id,
                  classified_by, classified_at, review_status
                )::text,
                E'\\n' ORDER BY id
              ), ''))
         FROM fin_transaction) AS transaction_hash,
      (SELECT md5(COALESCE(string_agg(
                jsonb_build_array(
                  id, category_id, nucleo, classified_rule_id,
                  classified_by, classified_at, review_status
                )::text,
                E'\\n' ORDER BY id
              ), ''))
         FROM fin_document) AS document_hash,
      (SELECT count(*)::bigint FROM fin_transaction) AS transaction_count,
      (SELECT COALESCE(sum(amount_cents), 0)::bigint FROM fin_transaction) AS transaction_cents,
      (SELECT count(*)::bigint FROM fin_document) AS document_count,
      (SELECT COALESCE(sum(amount_cents), 0)::bigint FROM fin_document) AS document_cents
  `);
}

function assertSameSnapshot(before, after, context) {
  for (const field of [
    'transaction_hash', 'document_hash',
    'transaction_count', 'transaction_cents',
    'document_count', 'document_cents'
  ]) {
    assert(
      String(before[field]) === String(after[field]),
      `${context}: ${field} mudou de ${before[field]} para ${after[field]}`
    );
  }
}

async function versionCount(ruleId) {
  const row = await one(
    `SELECT count(*)::integer AS n FROM fin_rule_version WHERE rule_id = $1`,
    [ruleId]
  );
  return Number(row.n);
}

async function hits(ruleId) {
  return one(
    `SELECT r.hits_count AS hits_total,
            h.hits_current_version,
            fin_rule_current_version_id(r.id) AS version_id
       FROM fin_rule r
       LEFT JOIN fin_rule_health_v h ON h.rule_id = r.id
      WHERE r.id = $1`,
    [ruleId]
  );
}

async function expectRejected(savepoint, work, pattern, message) {
  await client.query(`SAVEPOINT ${savepoint}`);
  let failure = null;
  try {
    await work();
  } catch (error) {
    failure = error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  assert(failure, `${message}: operacao foi aceita`);
  assert(pattern.test(failure.message), `${message}: erro inesperado: ${failure.message}`);
}

try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await client.query("SET LOCAL lock_timeout = '20s'");
  await client.query("SET LOCAL statement_timeout = '180s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '240s'");

  const before = await classificationSnapshot();
  const installed = await one(
    `SELECT to_regclass('public.fin_rule_health_assertion') IS NOT NULL AS value`
  );
  if (!installed.value) {
    await client.query(await readFile(migrationUrl, 'utf8'));
  }

  // Forca agora a rede diferida criada pela migration. Isso tambem prova que
  // a recontagem de hits nao publicou versoes comportamentais acidentais.
  await client.query('SET CONSTRAINTS fin_rule_version_corrente_coerente IMMEDIATE');
  await client.query('SET CONSTRAINTS fin_rule_version_corrente_coerente DEFERRED');

  const afterMigration = await classificationSnapshot();
  assertSameSnapshot(before, afterMigration, 'migration 0088');

  const health = await one(`
    SELECT count(*)::integer AS active,
           count(DISTINCT rule_id)::integer AS unique_rules,
           count(*) FILTER (WHERE health_state = 'produtiva')::integer AS productive,
           count(*) FILTER (WHERE health_state = 'aguardando_fonte')::integer AS external_gaps,
           count(*) FILTER (WHERE health_state = 'sombreada_nao_justificada')::integer AS shadows,
           count(*) FILTER (WHERE health_state NOT IN (
             'produtiva', 'aguardando_fonte', 'sombreada_nao_justificada'
           ))::integer AS unexpected,
           count(*) FILTER (
             WHERE health_state = 'produtiva' AND hits_current_version <= 0
           )::integer AS false_productive
      FROM fin_rule_health_v
  `);
  assert(Number(health.active) === 58, `monitor trouxe ${health.active} ativas, esperado 58`);
  assert(Number(health.unique_rules) === 58, 'monitor nao trouxe exatamente uma linha por regra ativa');
  assert(Number(health.productive) === 53, `monitor trouxe ${health.productive} produtivas, esperado 53`);
  assert(Number(health.external_gaps) === 3, `monitor trouxe ${health.external_gaps} lacunas, esperado 3`);
  assert(Number(health.shadows) === 2, `monitor trouxe ${health.shadows} sombras, esperado 2`);
  assert(Number(health.unexpected) === 0, `monitor deixou ${health.unexpected} regra(s) sem estado honesto`);
  assert(Number(health.false_productive) === 0, 'monitor chamou versao sem hit de produtiva');

  const assertions = await one(`
    SELECT count(*)::integer AS n,
           count(*) FILTER (WHERE a.health_state = 'aguardando_fonte')::integer AS external_gaps,
           count(*) FILTER (WHERE a.health_state = 'sombreada_nao_justificada')::integer AS shadows,
           count(*) FILTER (WHERE v.rule_id IS DISTINCT FROM a.rule_id)::integer AS mismatches,
           count(*) FILTER (WHERE a.valid_until <= a.asserted_at)::integer AS invalid_periods
      FROM fin_rule_health_assertion a
      JOIN fin_rule_version v ON v.id = a.rule_version_id
     WHERE a.asserted_by = 'migration-0088'
  `);
  assert(Number(assertions.n) === 5, `migration deveria criar 5 assercoes, criou ${assertions.n}`);
  assert(Number(assertions.external_gaps) === 3 && Number(assertions.shadows) === 2,
    'assercoes nao preservaram 3 lacunas externas e 2 sombras nao justificadas');
  assert(Number(assertions.mismatches) === 0, 'assercoes apontam para versao de outra regra');
  assert(Number(assertions.invalid_periods) === 0, 'assercoes nasceram sem validade positiva');

  const archived = await one(`
    WITH expected(slug) AS (VALUES
      ('qualificacao-conselho-regional-de-engenharia-e-agronomia'),
      ('qualificacao-lyra-m2m-ltda')
    )
    SELECT count(*)::integer AS n,
           count(*) FILTER (WHERE r.status = 'arquivada')::integer AS archived,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM fin_audit_log l
              WHERE l.target_table = 'fin_rule'
                AND l.target_id = r.id
                AND l.actor = 'migration-0088'
                AND l.fields @> ARRAY['status']::text[]
           ))::integer AS audited,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM fin_transaction t WHERE t.classified_rule_id = r.id
           ) OR EXISTS (
             SELECT 1 FROM fin_document d WHERE d.classified_rule_id = r.id
           ))::integer AS referenced
      FROM expected x
      JOIN fin_rule r ON r.slug = x.slug
  `);
  assert(Number(archived.n) === 2 && Number(archived.archived) === 2,
    'as duas regras inexequiveis nao foram arquivadas');
  assert(Number(archived.audited) === 2, 'arquivamento nao deixou duas trilhas migration-0088');
  assert(Number(archived.referenced) === 0, 'regra arquivada ainda classifica fato atual');

  const fkShape = await one(`
    SELECT count(*)::integer AS n
      FROM pg_constraint c
     WHERE c.conname IN (
       'fin_transaction_rule_version_fkey',
       'fin_document_rule_version_fkey',
       'fin_classification_event_rule_version_fkey'
     )
       AND c.contype = 'f'
       AND cardinality(c.conkey) = 2
       AND cardinality(c.confkey) = 2
  `);
  assert(Number(fkShape.n) === 3, 'ponteiros de versao nao usam as tres FKs compostas esperadas');

  const coherence = await one(`
    SELECT
      (SELECT count(*) FROM fin_transaction t
        LEFT JOIN fin_rule_version v
          ON (v.id, v.rule_id) = (t.classified_rule_version_id, t.classified_rule_id)
       WHERE t.classified_rule_id IS NOT NULL AND v.id IS NULL) AS bad_transactions,
      (SELECT count(*) FROM fin_document d
        LEFT JOIN fin_rule_version v
          ON (v.id, v.rule_id) = (d.classified_rule_version_id, d.classified_rule_id)
       WHERE d.classified_rule_id IS NOT NULL AND v.id IS NULL) AS bad_documents,
      (SELECT count(*) FROM fin_classification_event e
        LEFT JOIN fin_rule_version v
          ON (v.id, v.rule_id) = (e.rule_version_id, e.rule_id)
       WHERE e.rule_id IS NOT NULL AND v.id IS NULL) AS bad_events
  `);
  assert(Number(coherence.bad_transactions) === 0, 'transacao com versao de outra regra');
  assert(Number(coherence.bad_documents) === 0, 'documento com versao de outra regra');
  assert(Number(coherence.bad_events) === 0, 'evento com versao de outra regra');

  const recount = await one(`
    WITH pointers AS (
      SELECT classified_rule_id AS rule_id FROM fin_transaction
       WHERE classified_rule_id IS NOT NULL
      UNION ALL
      SELECT classified_rule_id FROM fin_document
       WHERE classified_rule_id IS NOT NULL
    ), actual AS (
      SELECT rule_id, count(*)::integer AS hits FROM pointers GROUP BY rule_id
    )
    SELECT count(*)::integer AS differences
      FROM fin_rule r
      LEFT JOIN actual x ON x.rule_id = r.id
     WHERE r.hits_count IS DISTINCT FROM COALESCE(x.hits, 0)
  `);
  assert(Number(recount.differences) === 0, `recontagem combinada divergiu em ${recount.differences} regras`);

  // Os dois nomes que originaram regras mortas precisam compartilhar a mesma
  // forma canonica usada pelo motor e pelo qualificar-cli.
  assert(
    normalizeName('Conselho Regional de Engenharia e Agronomia') ===
      'conselho regional engenharia agronomia',
    'normalizeName do CREA divergiu da forma usada pelo motor'
  );
  assert(normalizeName('LYRA M2M LTDA') === 'lyra m2m', 'normalizeName da Lyra preservou forma societaria');
  assert(normalizeName('LTDA ME EIRELI') === '', 'forma societaria pura deveria normalizar para vazio');

  const fixture = await one(`
    WITH transaction_rules AS (
      SELECT r.id, r.slug, r.hits_count, r.actions ->> 'category_code' AS category_code,
             c.id AS category_id,
             row_number() OVER (ORDER BY r.hits_count DESC, r.id) AS pos
        FROM fin_rule r
        JOIN fin_entity e ON e.id = r.entity_id AND e.slug = 'xpe'
        JOIN fin_category c ON c.entity_id = r.entity_id
                           AND c.code = r.actions ->> 'category_code'
       WHERE r.status = 'ativa'
         AND r.match_scope IN ('transaction', 'both')
         AND r.actions ->> 'category_code' LIKE '5.%'
    ), document_rules AS (
      SELECT r.id, r.slug, r.hits_count, r.actions ->> 'category_code' AS category_code,
             c.id AS category_id,
             row_number() OVER (ORDER BY r.hits_count DESC, r.id) AS pos
        FROM fin_rule r
        JOIN fin_entity e ON e.id = r.entity_id AND e.slug = 'xpe'
        JOIN fin_category c ON c.entity_id = r.entity_id
                           AND c.code = r.actions ->> 'category_code'
       WHERE r.status = 'ativa'
         AND r.match_scope IN ('document', 'both')
         AND r.actions ->> 'category_code' LIKE '3.%'
    )
    SELECT e.id AS entity_id,
           a.id AS account_id,
           tr1.id AS tx_rule_a, tr1.category_id AS tx_category_a,
           tr2.id AS tx_rule_b, tr2.category_id AS tx_category_b,
           dr1.id AS doc_rule_a, dr1.category_id AS doc_category_a,
           dr2.id AS doc_rule_b, dr2.category_id AS doc_category_b
      FROM fin_entity e
      JOIN LATERAL (
        SELECT id FROM fin_account WHERE entity_id = e.id ORDER BY id LIMIT 1
      ) a ON true
      JOIN transaction_rules tr1 ON tr1.pos = 1
      JOIN transaction_rules tr2 ON tr2.pos = 2
      JOIN document_rules dr1 ON dr1.pos = 1
      JOIN document_rules dr2 ON dr2.pos = 2
     WHERE e.slug = 'xpe'
  `);
  assert(fixture, 'nao ha duas regras transacionais e documentais para testar troca de ponteiro');

  const txId = String(-880_000_000_000 - process.pid);
  const docId = String(-881_000_000_000 - process.pid);
  const testRuleId = String(-882_000_000_000 - process.pid);
  const token = `test-regra-saude-${process.pid}-${Date.now()}`;

  const occupied = await one(`
    SELECT EXISTS (SELECT 1 FROM fin_transaction WHERE id = $1) OR
           EXISTS (SELECT 1 FROM fin_document WHERE id = $2) OR
           EXISTS (SELECT 1 FROM fin_rule WHERE id = $3) AS value
  `, [txId, docId, testRuleId]);
  assert(!occupied.value, 'ids sinteticos do teste ja existem');

  const txBeforeA = await hits(fixture.tx_rule_a);
  const txBeforeB = await hits(fixture.tx_rule_b);
  const versionsBeforeHits = await one(`SELECT count(*)::integer AS n FROM fin_rule_version`);

  const insertedTx = await one(`
    INSERT INTO fin_transaction (
      id, entity_id, account_id, posted_on, competence_date, competence_rule,
      amount_cents, description_raw, description_norm, category_id,
      source, source_id, dedupe_hash, classified_by, classified_rule_id,
      classified_at, created_by
    ) VALUES (
      $1, $2, $3, current_date, current_date, 'competencia_presumida_caixa',
      -12345, 'Teste de hit transacional 0088', 'teste hit transacional 0088', $4,
      'manual', $5, $6, 'regra', $7, now(), 'test:regra-saude'
    )
    RETURNING classified_rule_id, classified_rule_version_id
  `, [txId, fixture.entity_id, fixture.account_id, fixture.tx_category_a,
    `${token}:tx-source`, `${token}:tx-dedupe`, fixture.tx_rule_a]);
  assert(String(insertedTx.classified_rule_id) === String(fixture.tx_rule_a), 'INSERT trocou rule_id transacional');
  assert(String(insertedTx.classified_rule_version_id) === String(txBeforeA.version_id),
    'INSERT transacional nao carimbou a versao corrente');

  const txAfterInsert = await hits(fixture.tx_rule_a);
  assert(Number(txAfterInsert.hits_total) === Number(txBeforeA.hits_total) + 1,
    'INSERT transacional nao incrementou hits_total');
  assert(Number(txAfterInsert.hits_current_version) === Number(txBeforeA.hits_current_version) + 1,
    'INSERT transacional nao incrementou hit da versao corrente');

  const switchedTx = await one(`
    UPDATE fin_transaction
       SET classified_rule_id = $2,
           category_id = $3,
           classified_at = now()
     WHERE id = $1
    RETURNING classified_rule_id, classified_rule_version_id
  `, [txId, fixture.tx_rule_b, fixture.tx_category_b]);
  assert(String(switchedTx.classified_rule_id) === String(fixture.tx_rule_b), 'UPDATE nao trocou regra transacional');
  assert(String(switchedTx.classified_rule_version_id) === String(txBeforeB.version_id),
    'UPDATE transacional nao trocou a versao junto com a regra');
  const txAfterSwitchA = await hits(fixture.tx_rule_a);
  const txAfterSwitchB = await hits(fixture.tx_rule_b);
  assert(Number(txAfterSwitchA.hits_total) === Number(txBeforeA.hits_total),
    'troca transacional nao retirou hit da regra anterior');
  assert(Number(txAfterSwitchB.hits_total) === Number(txBeforeB.hits_total) + 1,
    'troca transacional nao adicionou hit na regra nova');

  await client.query(`DELETE FROM fin_transaction WHERE id = $1`, [txId]);
  const txAfterDeleteB = await hits(fixture.tx_rule_b);
  assert(Number(txAfterDeleteB.hits_total) === Number(txBeforeB.hits_total),
    'DELETE transacional nao restaurou hits da regra nova');

  const docBeforeA = await hits(fixture.doc_rule_a);
  const docBeforeB = await hits(fixture.doc_rule_b);
  const insertedDoc = await one(`
    INSERT INTO fin_document (
      id, entity_id, direction, category_id, description, description_norm,
      competence_date, due_date, amount_cents, status, source, source_id,
      classified_by, classified_rule_id, classified_at, created_by
    ) VALUES (
      $1, $2, 'receber', $3, 'Teste de hit documental 0088',
      'teste hit documental 0088', current_date, current_date, 23456,
      'previsto', 'manual', $4, 'regra', $5, now(), 'test:regra-saude'
    )
    RETURNING classified_rule_id, classified_rule_version_id
  `, [docId, fixture.entity_id, fixture.doc_category_a, `${token}:doc-source`, fixture.doc_rule_a]);
  assert(String(insertedDoc.classified_rule_version_id) === String(docBeforeA.version_id),
    'INSERT documental nao carimbou a versao corrente');
  const docAfterInsert = await hits(fixture.doc_rule_a);
  assert(Number(docAfterInsert.hits_total) === Number(docBeforeA.hits_total) + 1,
    'INSERT documental nao incrementou hits_total');
  assert(Number(docAfterInsert.hits_current_version) === Number(docBeforeA.hits_current_version) + 1,
    'INSERT documental nao incrementou hit da versao corrente');

  const switchedDoc = await one(`
    UPDATE fin_document
       SET classified_rule_id = $2,
           category_id = $3,
           classified_at = now()
     WHERE id = $1
    RETURNING classified_rule_id, classified_rule_version_id
  `, [docId, fixture.doc_rule_b, fixture.doc_category_b]);
  assert(String(switchedDoc.classified_rule_version_id) === String(docBeforeB.version_id),
    'UPDATE documental nao trocou a versao junto com a regra');
  const docAfterSwitchA = await hits(fixture.doc_rule_a);
  const docAfterSwitchB = await hits(fixture.doc_rule_b);
  assert(Number(docAfterSwitchA.hits_total) === Number(docBeforeA.hits_total),
    'troca documental nao retirou hit da regra anterior');
  assert(Number(docAfterSwitchB.hits_total) === Number(docBeforeB.hits_total) + 1,
    'troca documental nao adicionou hit na regra nova');

  await client.query(`DELETE FROM fin_document WHERE id = $1`, [docId]);
  const docAfterDeleteB = await hits(fixture.doc_rule_b);
  assert(Number(docAfterDeleteB.hits_total) === Number(docBeforeB.hits_total),
    'DELETE documental nao restaurou hits da regra nova');

  const versionsAfterHits = await one(`SELECT count(*)::integer AS n FROM fin_rule_version`);
  assert(Number(versionsAfterHits.n) === Number(versionsBeforeHits.n),
    'telemetria de INSERT/UPDATE/DELETE publicou versao de definicao');

  // Alteracoes editoriais e de telemetria sao reais, mas nao comportamentais.
  await client.query('SAVEPOINT telemetry_only');
  const telemetryVersions = await versionCount(fixture.tx_rule_a);
  await client.query(`
    UPDATE fin_rule
       SET notes = concat_ws(E'\\n', notes, 'teste transacional 0088'),
           hits_count = hits_count + 0,
           last_hit_at = last_hit_at,
           updated_at = now()
     WHERE id = $1
  `, [fixture.tx_rule_a]);
  assert(await versionCount(fixture.tx_rule_a) === telemetryVersions,
    'notes/hits/updated_at publicaram versao comportamental');
  await client.query('SET CONSTRAINTS fin_rule_version_corrente_coerente IMMEDIATE');
  await client.query('ROLLBACK TO SAVEPOINT telemetry_only');
  await client.query('RELEASE SAVEPOINT telemetry_only');
  await client.query('SET CONSTRAINTS fin_rule_version_corrente_coerente DEFERRED');

  // Uma definicao nova nao herda produtividade dos ponteiros da versao antiga.
  // Duas mudancas antes da validacao cobrem o caso em que o primeiro NEW
  // diferido ja ficou historico e a funcao precisa reler a linha final.
  await client.query('SAVEPOINT productive_definition');
  const productiveBaseVersion = await one(`
    SELECT fin_rule_current_version_id($1) AS id,
           (SELECT max(version_no) FROM fin_rule_version WHERE rule_id = $1) AS version_no
  `, [fixture.tx_rule_a]);
  await client.query(`UPDATE fin_rule SET priority = priority + 10000 WHERE id = $1`, [fixture.tx_rule_a]);
  await client.query(`UPDATE fin_rule SET priority = priority + 1 WHERE id = $1`, [fixture.tx_rule_a]);
  const productiveNew = await one(`
    SELECT h.health_state, h.hits_total, h.hits_current_version,
           h.rule_version_id,
           (SELECT max(version_no) FROM fin_rule_version WHERE rule_id = $1) AS version_no
      FROM fin_rule_health_v h WHERE h.rule_id = $1
  `, [fixture.tx_rule_a]);
  assert(String(productiveNew.rule_version_id) !== String(productiveBaseVersion.id),
    'mudanca de definicao nao publicou versao nova');
  assert(Number(productiveNew.version_no) === Number(productiveBaseVersion.version_no) + 2,
    'duas definicoes distintas nao publicaram duas versoes');
  assert(Number(productiveNew.hits_total) > 0 && Number(productiveNew.hits_current_version) === 0,
    'monitor misturou hits historicos com hits da definicao corrente');
  assert(productiveNew.health_state === 'zero_inesperado',
    `definicao nova sem hit ficou ${productiveNew.health_state}, esperado zero_inesperado`);
  await client.query('SET CONSTRAINTS fin_rule_version_corrente_coerente IMMEDIATE');
  await client.query('ROLLBACK TO SAVEPOINT productive_definition');
  await client.query('RELEASE SAVEPOINT productive_definition');
  await client.query('SET CONSTRAINTS fin_rule_version_corrente_coerente DEFERRED');

  // Assercao vigente e presa a uma versao: expira pelo tempo e invalida por
  // mudanca comportamental, sem baixar limiar nem arquivar regra futura util.
  const fgts = await one(`SELECT * FROM fin_rule_health_v WHERE slug = 'fgts'`);
  assert(fgts.health_state === 'aguardando_fonte', 'FGTS nao nasceu como lacuna externa explicita');
  const expiredFgts = await one(`
    SELECT health_state FROM fin_rule_health(now() + interval '31 days') WHERE slug = 'fgts'
  `);
  assert(expiredFgts.health_state === 'assercao_expirada', 'asserção de FGTS nao expira apos a validade');

  await client.query('SAVEPOINT assertion_invalidation');
  await client.query(`UPDATE fin_rule SET priority = priority + 1 WHERE id = $1`, [fgts.rule_id]);
  const invalidatedFgts = await one(`SELECT * FROM fin_rule_health_v WHERE rule_id = $1`, [fgts.rule_id]);
  assert(invalidatedFgts.health_state === 'assercao_invalidada',
    `asserção antiga ficou ${invalidatedFgts.health_state} apos versao nova`);
  assert(Number(invalidatedFgts.hits_current_version) === 0, 'versao nova de FGTS herdou hit historico');
  await client.query('SET CONSTRAINTS fin_rule_version_corrente_coerente IMMEDIATE');
  await client.query('ROLLBACK TO SAVEPOINT assertion_invalidation');
  await client.query('RELEASE SAVEPOINT assertion_invalidation');
  await client.query('SET CONSTRAINTS fin_rule_version_corrente_coerente DEFERRED');

  // INSERT real de fin_rule precisa chegar a uma versao 1 no mesmo comando,
  // sem current_version_id NOT NULL nem FK circular.
  const newRule = await one(`
    INSERT INTO fin_rule (
      id, entity_id, slug, name, priority, match_scope, conditions, actions,
      confidence, source, status, created_by, notes
    ) VALUES (
      $1, $2, $3, 'Regra sintetica 0088', 9999, 'transaction',
      '{"all":[{"field":"description_norm","op":"equals","value":"teste regra saude 0088"}]}'::jsonb,
      jsonb_build_object('category_code', '5.03'),
      100, 'humano', 'proposta', 'test:regra-saude', 'sempre revertida'
    )
    RETURNING id
  `, [testRuleId, fixture.entity_id, `${token}-rule`]);
  await client.query('SET CONSTRAINTS fin_rule_version_corrente_coerente IMMEDIATE');
  const newRuleVersion = await one(`
    SELECT v.id, v.version_no, v.change_kind,
           v.definition = fin_rule_definition_payload(r) AS coherent
      FROM fin_rule r
      JOIN fin_rule_version v ON v.id = fin_rule_current_version_id(r.id)
     WHERE r.id = $1
  `, [newRule.id]);
  assert(Number(newRuleVersion.version_no) === 1 && newRuleVersion.change_kind === 'criacao',
    'INSERT real de regra nao criou versao 1 de criacao');
  assert(newRuleVersion.coherent, 'versao 1 da regra nova nao reproduz sua definicao');
  await client.query('SET CONSTRAINTS fin_rule_version_corrente_coerente DEFERRED');

  const newRuleVersionsBeforeTelemetry = await versionCount(newRule.id);
  await client.query(`UPDATE fin_rule SET updated_at = now(), hits_count = hits_count WHERE id = $1`, [newRule.id]);
  assert(await versionCount(newRule.id) === newRuleVersionsBeforeTelemetry,
    'telemetria da regra nova publicou versao 2');

  const testRuleTx = await one(`
    INSERT INTO fin_transaction (
      id, entity_id, account_id, posted_on, competence_date, competence_rule,
      amount_cents, description_raw, description_norm, category_id,
      source, source_id, dedupe_hash, classified_by, classified_rule_id,
      classified_at, created_by
    ) VALUES (
      $1, $2, $3, current_date, current_date, 'competencia_presumida_caixa',
      -34567, 'Teste regra saude 0088', 'teste regra saude 0088', $4,
      'manual', $5, $6, 'regra', $7, now(), 'test:regra-saude'
    )
    RETURNING classified_rule_version_id
  `, [txId, fixture.entity_id, fixture.account_id, fixture.tx_category_a,
    `${token}:history-source`, `${token}:history-dedupe`, newRule.id]);
  assert(String(testRuleTx.classified_rule_version_id) === String(newRuleVersion.id),
    'fato nao guardou versao 1 da regra sintetica');

  await client.query(`UPDATE fin_rule SET priority = priority + 1 WHERE id = $1`, [newRule.id]);
  const newestVersion = await one(`
    SELECT fin_rule_current_version_id($1) AS id,
           (SELECT max(version_no) FROM fin_rule_version WHERE rule_id = $1) AS version_no
  `, [newRule.id]);
  assert(Number(newestVersion.version_no) === 2, 'mudanca da regra sintetica nao criou versao 2');

  await client.query(`UPDATE fin_transaction SET classified_at = now() + interval '1 second' WHERE id = $1`, [txId]);
  const historicalStamp = await one(`
    SELECT classified_rule_version_id FROM fin_transaction WHERE id = $1
  `, [txId]);
  assert(String(historicalStamp.classified_rule_version_id) === String(newRuleVersion.id),
    'mudanca incidental de classified_at reescreveu a versao historica');

  await client.query(`UPDATE fin_transaction SET classified_rule_version_id = NULL WHERE id = $1`, [txId]);
  const reevaluatedStamp = await one(`
    SELECT classified_rule_version_id FROM fin_transaction WHERE id = $1
  `, [txId]);
  assert(String(reevaluatedStamp.classified_rule_version_id) === String(newestVersion.id),
    'reavaliacao explicita da mesma regra nao carimbou versao corrente');

  await expectRejected('mismatched_version', async () => {
    await client.query(`
      UPDATE fin_transaction
         SET classified_rule_version_id = fin_rule_current_version_id($2)
       WHERE id = $1
    `, [txId, fixture.tx_rule_b]);
  }, /nao pertence|não pertence|foreign key/i, 'versao de outra regra');

  await expectRejected('immutable_version', async () => {
    await client.query(`UPDATE fin_rule_version SET created_by = 'adulterado' WHERE id = $1`, [newRuleVersion.id]);
  }, /append-only/i, 'versao historica mutavel');

  await client.query(`DELETE FROM fin_transaction WHERE id = $1`, [txId]);

  const finalRecount = await one(`
    WITH pointers AS (
      SELECT classified_rule_id AS rule_id FROM fin_transaction
       WHERE classified_rule_id IS NOT NULL
      UNION ALL
      SELECT classified_rule_id FROM fin_document
       WHERE classified_rule_id IS NOT NULL
    ), actual AS (
      SELECT rule_id, count(*)::integer AS hits FROM pointers GROUP BY rule_id
    )
    SELECT count(*)::integer AS differences
      FROM fin_rule r
      LEFT JOIN actual x ON x.rule_id = r.id
     WHERE r.hits_count IS DISTINCT FROM COALESCE(x.hits, 0)
  `);
  assert(Number(finalRecount.differences) === 0,
    `triggers +1/troca/-1 deixaram ${finalRecount.differences} divergencia(s)`);

  // Ate aqui todos os fixtures ja foram removidos. As unicas diferencas ainda
  // abertas sao definicoes sinteticas, que o ROLLBACK externo apaga.
  const beforeRollback = await classificationSnapshot();
  assertSameSnapshot(afterMigration, beforeRollback, 'fixtures removidos');

  console.log('✓ 0088 em ROLLBACK: 58 ativas = 53 produtivas + 3 lacunas + 2 sombras');
  console.log('✓ hits transacao/documento: +1, troca e -1; recontagem combinada sem divergencia');
  console.log('✓ versao imutavel: INSERT real, FK composta, telemetria neutra e memoria historica preservada');
  console.log('✓ saude por versao: definicao nova zera produtividade; assercao expira e invalida');
  console.log('✓ duas regras inexequiveis arquivadas com auditoria, sem reclassificacao');
} catch (error) {
  console.error(`✗ teste de saude das regras: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.query('ROLLBACK').catch(() => {});
  client.release();
  await pool.end();
}
