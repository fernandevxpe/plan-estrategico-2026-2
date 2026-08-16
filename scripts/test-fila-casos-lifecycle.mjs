// Prova transacional da fila por casos e do lifecycle conservador (0090).
//
// Quando a migration está pendente, o teste separa definição e primeira
// execução para comparar o espelho SQL do DSL com o avaliador JavaScript nos
// 1.533 itens originais. Todo DDL, fixture e classificação termina em ROLLBACK.

import { readFile } from 'node:fs/promises';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { classify } from './lib/fin-rules.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';
import {
  executeReviewLifecycle,
  parseLifecycleArgs
} from './fin-review-lifecycle.mjs';

loadEnv();
registerFinanceTypeParsers();

const migrationUrl = new URL('../db/migrations/0090_fin_fila_casos_lifecycle.sql', import.meta.url);
const schedulerUrl = new URL('./scheduler.mjs', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);
const migrationSql = await readFile(migrationUrl, 'utf8');
const executionMarker = [
  '-- --------------------------------------------------------------------------',
  '-- 6. PRÉ-CONDIÇÕES DA FOTOGRAFIA E PRIMEIRA APLICAÇÃO'
].join('\n');
const markerPosition = migrationSql.indexOf(executionMarker);

const pool = financePool();
const client = await pool.connect();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function number(value) {
  return Number(value ?? 0);
}

async function one(sql, params = []) {
  const { rows: [row] } = await client.query(sql, params);
  return row;
}

async function moneySnapshot() {
  return one(`
    SELECT
      (SELECT count(*)::bigint FROM fin_transaction) AS transaction_rows,
      (SELECT COALESCE(sum(amount_cents), 0)::bigint FROM fin_transaction) AS transaction_cents,
      (SELECT COALESCE(sum(abs(amount_cents)), 0)::bigint FROM fin_transaction) AS transaction_abs_cents,
      (SELECT count(*)::bigint FROM fin_document) AS document_rows,
      (SELECT COALESCE(sum(amount_cents), 0)::bigint FROM fin_document) AS document_cents,
      (SELECT count(*)::bigint FROM fin_settlement) AS settlement_rows,
      (SELECT COALESCE(sum(amount_cents), 0)::bigint FROM fin_settlement) AS settlement_cents,
      (SELECT count(*)::bigint FROM fin_dre_lancamento_v) AS dre_rows,
      (SELECT COALESCE(sum(amount_cents), 0)::bigint FROM fin_dre_lancamento_v) AS dre_cents,
      (SELECT COALESCE(sum(abs(amount_cents)), 0)::bigint FROM fin_dre_lancamento_v) AS dre_abs_cents,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', id,
                'opening_balance_cents', opening_balance_cents,
                'current_balance_cents', current_balance_cents
              ) ORDER BY id), '[]'::jsonb)
         FROM fin_account) AS account_balances
  `);
}

function assertSameMoney(before, after, context) {
  for (const field of [
    'transaction_rows', 'transaction_cents', 'transaction_abs_cents',
    'document_rows', 'document_cents', 'settlement_rows', 'settlement_cents',
    'dre_rows', 'dre_cents', 'dre_abs_cents'
  ]) {
    assert(String(before[field]) === String(after[field]),
      `${context}: ${field} mudou de ${before[field]} para ${after[field]}`);
  }
  assert(JSON.stringify(before.account_balances) === JSON.stringify(after.account_balances),
    `${context}: saldos declarados das contas mudaram`);
}

async function dreGroups() {
  const { rows } = await client.query(`
    SELECT linha,
           COALESCE(categoria_code, 'NULL') AS category_code,
           count(*)::integer AS rows,
           COALESCE(sum(amount_cents), 0)::bigint AS cents,
           COALESCE(sum(abs(amount_cents)), 0)::bigint AS abs_cents
      FROM fin_dre_lancamento_v
     GROUP BY linha, COALESCE(categoria_code, 'NULL')
  `);
  return new Map(rows.map((row) => [`${row.linha}|${row.category_code}`, row]));
}

function changedDreGroups(before, after) {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].map((key) => {
    const b = before.get(key) ?? {};
    const a = after.get(key) ?? {};
    return {
      key,
      rows: number(a.rows) - number(b.rows),
      cents: number(a.cents) - number(b.cents),
      abs_cents: number(a.abs_cents) - number(b.abs_cents)
    };
  }).filter((row) => row.rows || row.cents || row.abs_cents)
    .sort((a, b) => a.key.localeCompare(b.key));
}

async function dreMonthlyTotals() {
  const { rows } = await client.query(`
    SELECT visao,
           COALESCE(sum(receita_bruta_cents), 0)::bigint AS revenue,
           COALESCE(sum(custos_diretos_cents), 0)::bigint AS direct_costs,
           COALESCE(sum(lucro_liquido_cents), 0)::bigint AS profit,
           COALESCE(sum(lacuna_ledger_cents), 0)::bigint AS ledger_gap
      FROM fin_dre_mensal_v
     GROUP BY visao
     ORDER BY visao
  `);
  return new Map(rows.map((row) => [row.visao, row]));
}

async function approvedDocumentCount() {
  return number((await one(`SELECT count(*)::integer AS n FROM fin_review_approved_document_v`)).n);
}

async function validateDsl(expectedItems) {
  const { rows: rules } = await client.query(`
    SELECT id, slug, name, priority, match_scope, conditions, actions, confidence
      FROM fin_rule
     WHERE status = 'ativa'
     ORDER BY priority, id
  `);
  const { rows: subjects } = await client.query(`
    SELECT review_item_id, scope, subject
      FROM fin_review_rule_subject_v
     ORDER BY review_item_id
  `);
  const { rows: sqlResults } = await client.query(`
    SELECT review_item_id, winner, competitors
      FROM fin_review_rule_result_v
  `);
  const byId = new Map(sqlResults.map((row) => [number(row.review_item_id), row]));

  assert(subjects.length === expectedItems,
    `DSL recebeu ${subjects.length} itens, esperado ${expectedItems}`);
  assert(byId.size === expectedItems,
    `resultado SQL do DSL trouxe ${byId.size} itens, esperado ${expectedItems}`);

  let winners = 0;
  for (const row of subjects) {
    const js = classify(rules, { ...row.subject, scope: row.scope }, { collectCompetitors: true });
    const sql = byId.get(number(row.review_item_id));
    const jsWinner = js ? number(js.rule.id) : null;
    const sqlWinner = sql?.winner ? number(sql.winner.rule_id) : null;
    assert(jsWinner === sqlWinner,
      `winner divergente no review_item ${row.review_item_id}: JS=${jsWinner}, SQL=${sqlWinner}`);

    const jsCompetitors = js?.rationale?.tambem_casaram?.map((item) => number(item.rule_id)) ?? [];
    const sqlCompetitors = (sql?.competitors ?? []).map((item) => number(item.rule_id));
    assert(JSON.stringify(jsCompetitors) === JSON.stringify(sqlCompetitors),
      `competidores divergentes no review_item ${row.review_item_id}: ` +
      `JS=${JSON.stringify(jsCompetitors)}, SQL=${JSON.stringify(sqlCompetitors)}`);
    if (jsWinner !== null) winners += 1;
  }
  return winners;
}

async function insertCounterparty(entityId, token) {
  return number((await one(`
    INSERT INTO fin_counterparty (entity_id, kind, name, normalized_name)
    VALUES ($1, 'cliente', $2, $2)
    RETURNING id
  `, [entityId, token])).id);
}

let documentSequence = 0;
async function insertDocument({
  entityId,
  counterpartyId = null,
  categoryId = null,
  amount = 10000,
  description,
  reviewStatus = 'ok',
  classifiedBy = null,
  ruleId = null,
  humanLocks = []
}) {
  documentSequence += 1;
  return number((await one(`
    INSERT INTO fin_document (
      entity_id, direction, counterparty_id, category_id,
      description, description_norm, competence_date, due_date,
      amount_cents, status, source, source_id, review_status,
      classified_by, classified_rule_id, classified_at, human_locked_fields
    ) VALUES (
      $1, 'receber', $2, $3,
      $4, $4, DATE '2026-08-15', DATE '2026-08-15',
      $5, 'emitido', 'manual', $6, $7,
      $8, $9, CASE WHEN $8::text IS NULL THEN NULL ELSE now() END, $10::text[]
    )
    RETURNING id
  `, [
    entityId, counterpartyId, categoryId, description, amount,
    `${description}:source:${documentSequence}`, reviewStatus,
    classifiedBy, ruleId, humanLocks
  ])).id);
}

let transactionSequence = 0;
async function insertTransaction({
  entityId,
  accountId,
  amount,
  description,
  source = 'manual',
  sourceKind = 'FIXTURE',
  categoryId = null,
  counterpartyDocument = null
}) {
  transactionSequence += 1;
  const identity = `${description}:${process.pid}:${transactionSequence}`;
  return number((await one(`
    INSERT INTO fin_transaction (
      entity_id, account_id, posted_on, amount_cents,
      description_raw, description_norm, counterparty_document,
      category_id, source_kind, source, source_id, dedupe_hash
    ) VALUES (
      $1, $2, DATE '2026-08-15', $3,
      $4, $4, $5,
      $6, $7, $8, $9, $10
    )
    RETURNING id
  `, [
    entityId, accountId, amount, description, counterpartyDocument,
    categoryId, sourceKind, source, `${identity}:source`, `${identity}:dedupe`
  ])).id);
}

async function reviewId(targetTable, targetId) {
  return number((await one(`
    SELECT id FROM fin_review_item WHERE target_table = $1 AND target_id = $2
  `, [targetTable, targetId])).id);
}

async function insertDocumentReview(documentId, entityId, amount, reason, extra = {}) {
  return number((await one(`
    INSERT INTO fin_review_item (
      entity_id, target_table, target_id, reason, amount_cents,
      assigned_to, note, snoozed_until
    ) VALUES ($1, 'fin_document', $2, $3, $4, $5, $6, $7)
    RETURNING id
  `, [
    entityId, documentId, reason, amount,
    extra.assignedTo ?? null, extra.note ?? null, extra.snoozedUntil ?? null
  ])).id);
}

async function fixtureProof() {
  const ctx = await one(`
    SELECT e.id AS entity_id,
           (SELECT a.id FROM fin_account a
             WHERE a.entity_id = e.id AND a.slug = 'inter') AS inter_account_id,
           (SELECT c.id FROM fin_category c
             WHERE c.entity_id = e.id AND c.code = '3.02') AS category_302,
           (SELECT c.id FROM fin_category c
             WHERE c.entity_id = e.id AND c.code = '3.03') AS category_303,
           (SELECT c.id FROM fin_category c
             WHERE c.entity_id = e.id AND c.code = '3.99') AS category_399
      FROM fin_entity e
     WHERE e.slug = 'xpe'
  `);
  assert(ctx?.inter_account_id && ctx?.category_302 && ctx?.category_303 && ctx?.category_399,
    'fixture não encontrou entidade/conta/categorias');

  const token = `fixture-lifecycle-${process.pid}-${Date.now()}`;
  const lifecycleCp = await insertCounterparty(ctx.entity_id, `${token}-lifecycle`);
  for (let i = 0; i < 3; i += 1) {
    await insertDocument({
      entityId: ctx.entity_id,
      counterpartyId: lifecycleCp,
      categoryId: ctx.category_302,
      amount: 5000 + i,
      description: `${token}-human-history-${i}`,
      classifiedBy: 'humano'
    });
  }
  const lifecycleDoc = await insertDocument({
    entityId: ctx.entity_id,
    counterpartyId: lifecycleCp,
    categoryId: ctx.category_302,
    amount: 8800,
    description: `${token}-lifecycle-target`,
    reviewStatus: 'pendente',
    classifiedBy: 'historico'
  });
  const lifecycleReview = await insertDocumentReview(
    lifecycleDoc, ctx.entity_id, 8800, 'baixa_confianca'
  );

  const assignedDoc = await insertDocument({
    entityId: ctx.entity_id,
    counterpartyId: lifecycleCp,
    categoryId: ctx.category_302,
    amount: 8801,
    description: `${token}-assigned`,
    reviewStatus: 'pendente',
    classifiedBy: 'historico'
  });
  const assignedReview = await insertDocumentReview(
    assignedDoc, ctx.entity_id, 8801, 'baixa_confianca', { assignedTo: 'humano:test' }
  );

  const lockedDoc = await insertDocument({
    entityId: ctx.entity_id,
    counterpartyId: lifecycleCp,
    categoryId: ctx.category_302,
    amount: 8802,
    description: `${token}-locked`,
    reviewStatus: 'pendente',
    classifiedBy: 'historico',
    humanLocks: ['category_id']
  });
  const lockedReview = await insertDocumentReview(
    lockedDoc, ctx.entity_id, 8802, 'baixa_confianca'
  );

  // A versão aplicada tinha confiança 20. Elevar a regra corrente a 100 não
  // pode transformar retroativamente estes documentos em histórico aprovado.
  const lowRule = await one(`
    INSERT INTO fin_rule (
      entity_id, slug, name, priority, match_scope,
      conditions, actions, confidence, source, status, created_by
    ) VALUES (
      $1, $2, $2, 999999, 'document',
      jsonb_build_object('all', jsonb_build_array(jsonb_build_object(
        'field', 'description_norm', 'op', 'contains_any', 'value', jsonb_build_array($2::text)
      ))),
      jsonb_build_object('category_code', '3.02'),
      20, 'humano', 'ativa', 'test:fila-lifecycle'
    ) RETURNING id
  `, [ctx.entity_id, `${token}-low-version-rule`]);
  const lowVersionId = number((await one(
    `SELECT fin_rule_current_version_id($1) AS id`, [lowRule.id]
  )).id);
  const lowCp = await insertCounterparty(ctx.entity_id, `${token}-low-version-cp`);
  const lowHistoryIds = [];
  for (let i = 0; i < 3; i += 1) {
    lowHistoryIds.push(await insertDocument({
      entityId: ctx.entity_id,
      counterpartyId: lowCp,
      categoryId: ctx.category_302,
      amount: 9100 + i,
      description: `${token}-low-version-rule-history-${i}`,
      classifiedBy: 'regra',
      ruleId: lowRule.id
    }));
  }
  await client.query(`UPDATE fin_rule SET confidence = 100 WHERE id = $1`, [lowRule.id]);
  const highVersionId = number((await one(
    `SELECT fin_rule_current_version_id($1) AS id`, [lowRule.id]
  )).id);
  assert(highVersionId !== lowVersionId, 'editar confiança não publicou nova versão da regra');
  const oldPointers = await one(`
    SELECT count(*)::integer AS n,
           count(*) FILTER (WHERE classified_rule_version_id = $2)::integer AS old_version
      FROM fin_document
     WHERE id = ANY($1::bigint[])
  `, [lowHistoryIds, lowVersionId]);
  assert(number(oldPointers.n) === 3 && number(oldPointers.old_version) === 3,
    'documentos antigos perderam a versão de confiança baixa');
  const approvedLow = await one(`
    SELECT count(*)::integer AS n
      FROM fin_review_approved_document_v
     WHERE id = ANY($1::bigint[])
  `, [lowHistoryIds]);
  assert(number(approvedLow.n) === 0,
    'versão antiga de confiança 20 virou evidência porque a regra corrente subiu');

  const lowTarget = await insertDocument({
    entityId: ctx.entity_id,
    counterpartyId: lowCp,
    categoryId: ctx.category_302,
    amount: 9999,
    description: `${token}-low-version-rule-target`,
    reviewStatus: 'pendente',
    classifiedBy: 'historico'
  });
  const lowTargetReview = await insertDocumentReview(
    lowTarget, ctx.entity_id, 9999, 'baixa_confianca'
  );

  const recurrenceCp = await insertCounterparty(ctx.entity_id, `${token}-recurrence`);
  for (let i = 0; i < 2; i += 1) {
    await insertDocument({
      entityId: ctx.entity_id,
      counterpartyId: recurrenceCp,
      categoryId: ctx.category_303,
      amount: 12345,
      description: `${token}-recurrence-history-${i}`,
      classifiedBy: 'humano'
    });
  }
  const recurrenceDoc = await insertDocument({
    entityId: ctx.entity_id,
    counterpartyId: recurrenceCp,
    amount: 12345,
    description: `${token}-recurrence-target`,
    reviewStatus: 'pendente'
  });
  const recurrenceReview = await insertDocumentReview(
    recurrenceDoc, ctx.entity_id, 12345, 'texto_generico'
  );
  const unknownDoc = await insertDocument({
    entityId: ctx.entity_id,
    amount: 7655,
    description: `${token}-unknown-settlement`,
    reviewStatus: 'pendente'
  });
  const unknownReview = await insertDocumentReview(
    unknownDoc, ctx.entity_id, 7655, 'texto_generico'
  );

  const inheritedTx = await insertTransaction({
    entityId: ctx.entity_id,
    accountId: ctx.inter_account_id,
    amount: 12345,
    description: `${token}-full-settlement`,
    categoryId: ctx.category_399
  });
  const partialTx = await insertTransaction({
    entityId: ctx.entity_id,
    accountId: ctx.inter_account_id,
    amount: 20000,
    description: `${token}-partial-n-to-n`,
    categoryId: ctx.category_399
  });
  await client.query(`
    INSERT INTO fin_settlement (
      transaction_id, document_id, amount_cents, method, confidence, matched_by, created_by
    ) VALUES
      ($1, $2, 12345, 'manual', 100, 'test:fila-lifecycle', 'test:fila-lifecycle'),
      ($3, $2, 12345, 'manual', 100, 'test:fila-lifecycle', 'test:fila-lifecycle'),
      ($3, $4, 7655, 'manual', 100, 'test:fila-lifecycle', 'test:fila-lifecycle')
  `, [inheritedTx, recurrenceDoc, partialTx, unknownDoc]);
  const inheritedReview = await reviewId('fin_transaction', inheritedTx);
  const partialReview = await reviewId('fin_transaction', partialTx);

  // Todos os documentos oferecem uma categoria real, mas só R$ 80 dos R$ 100
  // da transação estão alocados. Não há herança e a exposição econômica do
  // caso é 100 + 100 - 80 = 120, não max(100, 100).
  const partialMoneyDoc = await insertDocument({
    entityId: ctx.entity_id,
    categoryId: ctx.category_302,
    amount: 10000,
    description: `${token}-partial-money-document`,
    classifiedBy: 'humano'
  });
  const partialMoneyDocReview = await insertDocumentReview(
    partialMoneyDoc, ctx.entity_id, 10000, 'divergencia_valor'
  );
  const partialMoneyTx = await insertTransaction({
    entityId: ctx.entity_id,
    accountId: ctx.inter_account_id,
    amount: 10000,
    description: `${token}-partial-money-transaction`,
    categoryId: ctx.category_399
  });
  await client.query(`
    INSERT INTO fin_settlement (
      transaction_id, document_id, amount_cents, method, confidence, matched_by, created_by
    ) VALUES ($1, $2, 8000, 'manual', 100, 'test:fila-lifecycle', 'test:fila-lifecycle')
  `, [partialMoneyTx, partialMoneyDoc]);
  const partialMoneyTxReview = await reviewId('fin_transaction', partialMoneyTx);

  const pjbankTx = await insertTransaction({
    entityId: ctx.entity_id,
    accountId: ctx.inter_account_id,
    amount: -7777,
    description: 'pagamento efetuado pjbank pagamentos s a 1',
    source: 'inter_api',
    sourceKind: 'PAGAMENTO'
  });
  const pjbankReview = await reviewId('fin_transaction', pjbankTx);
  const pjbankWrongReasonTx = await insertTransaction({
    entityId: ctx.entity_id,
    accountId: ctx.inter_account_id,
    amount: -7788,
    description: 'pagamento efetuado pjbank pagamentos s a 1',
    source: 'inter_api',
    sourceKind: 'PAGAMENTO'
  });
  const pjbankWrongReasonReview = await reviewId('fin_transaction', pjbankWrongReasonTx);
  await client.query(`
    UPDATE fin_review_item
       SET reason = 'divergencia_valor',
           suggested = jsonb_build_array(jsonb_build_object(
             'schema', 'clickup/category-suggestion/v1',
             'score', 87
           ))
     WHERE id = $1
  `, [pjbankWrongReasonReview]);

  const knownPayee = await one(`
    SELECT COALESCE(t.counterparty_document, cp.document_number) AS document_number,
           t.description_norm
      FROM fin_classification_event ce
      JOIN fin_transaction t
        ON ce.target_table = 'fin_transaction' AND t.id = ce.target_id
      LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
     WHERE ce.actor = 'migration-0090'
       AND ce.rationale ->> 'evidence_code' = 'known_payee_independent_history'
     LIMIT 1
  `);
  assert(knownPayee?.document_number && knownPayee?.description_norm,
    'não encontrou chave exata do favorecido conhecido sem expor PII no teste');
  const knownTx = await insertTransaction({
    entityId: ctx.entity_id,
    accountId: ctx.inter_account_id,
    amount: -4321,
    description: knownPayee.description_norm,
    source: 'inter_api',
    sourceKind: 'PIX',
    counterpartyDocument: knownPayee.document_number
  });
  const knownReview = await reviewId('fin_transaction', knownTx);
  const knownBaseBefore = number((await one(`
    SELECT base_count FROM fin_review_known_payee_candidate_v WHERE transaction_id = $1
  `, [knownTx])).base_count);

  // Sem trigger global: dezenas de INSERTs acima não resolveram nada nem
  // produziram uma chamada implícita do lifecycle.
  const untouched = await one(`
    SELECT count(*) FILTER (WHERE status = 'pendente')::integer AS pending,
           count(*) FILTER (WHERE status = 'resolvido')::integer AS resolved
      FROM fin_review_item
     WHERE id = ANY($1::bigint[])
  `, [[
    lifecycleReview, assignedReview, lockedReview, lowTargetReview,
    recurrenceReview, unknownReview, inheritedReview, partialReview,
    partialMoneyDocReview, partialMoneyTxReview,
    pjbankReview, pjbankWrongReasonReview, knownReview
  ]]);
  assert(number(untouched.pending) === 13 && number(untouched.resolved) === 0,
    'algum trigger executou lifecycle durante o lote de fixture');

  const candidates = await one(`
    SELECT
      (SELECT count(*) FROM fin_review_lifecycle_candidate_v
        WHERE review_item_id = $1) AS lifecycle,
      (SELECT count(*) FROM fin_review_recurrence_candidate_v
        WHERE review_item_id = $2) AS recurrence,
      (SELECT count(*) FROM fin_review_settlement_inheritance_candidate_v
        WHERE review_item_id = $3) AS inherited,
      (SELECT count(*) FROM fin_review_settlement_inheritance_candidate_v
        WHERE review_item_id = $4) AS partial_n_to_n,
      (SELECT count(*) FROM fin_review_pjbank_candidate_v
        WHERE review_item_id = $5) AS pjbank,
      (SELECT count(*) FROM fin_review_known_payee_candidate_v
        WHERE review_item_id = $6) AS known_payee,
      (SELECT count(*) FROM fin_review_lifecycle_candidate_v
        WHERE review_item_id IN ($7, $8, $9)) AS protected,
      (SELECT count(*) FROM fin_review_settlement_inheritance_candidate_v
        WHERE review_item_id = $10) AS partial_money,
      (SELECT count(*) FROM fin_review_pjbank_candidate_v
        WHERE review_item_id = $11) AS pjbank_wrong_reason
  `, [
    lifecycleReview, recurrenceReview, inheritedReview, partialReview,
    pjbankReview, knownReview, assignedReview, lockedReview, lowTargetReview,
    partialMoneyTxReview, pjbankWrongReasonReview
  ]);
  assert(number(candidates.lifecycle) === 1 && number(candidates.recurrence) === 1 &&
         number(candidates.inherited) === 1 && number(candidates.partial_n_to_n) === 0 &&
         number(candidates.pjbank) === 1 && number(candidates.known_payee) === 1 &&
         number(candidates.protected) === 0 && number(candidates.partial_money) === 0 &&
         number(candidates.pjbank_wrong_reason) === 0,
  `candidatos de fixture inesperados: ${JSON.stringify(candidates)}`);

  const connectedCase = await one(`
    SELECT raw_item_count, raw_exposure_cents, case_exposure_cents, duplicated_exposure_cents
      FROM fin_review_case_v
     WHERE review_item_ids @> $1::bigint[]
  `, [[recurrenceReview, unknownReview, inheritedReview, partialReview]]);
  assert(number(connectedCase?.raw_item_count) === 4 &&
         number(connectedCase.raw_exposure_cents) === 52345 &&
         number(connectedCase.case_exposure_cents) === 32345 &&
         number(connectedCase.duplicated_exposure_cents) === 20000,
    `caso N:N não agrupou 4 itens/exposição corretamente: ${JSON.stringify(connectedCase)}`);

  const partialMoneyCase = await one(`
    SELECT raw_item_count, raw_exposure_cents, document_exposure_cents,
           transaction_exposure_cents, settlement_overlap_cents,
           case_exposure_cents, duplicated_exposure_cents
      FROM fin_review_case_v
     WHERE review_item_ids @> $1::bigint[]
  `, [[partialMoneyDocReview, partialMoneyTxReview]]);
  assert(number(partialMoneyCase?.raw_item_count) === 2 &&
         number(partialMoneyCase.raw_exposure_cents) === 20000 &&
         number(partialMoneyCase.document_exposure_cents) === 10000 &&
         number(partialMoneyCase.transaction_exposure_cents) === 10000 &&
         number(partialMoneyCase.settlement_overlap_cents) === 8000 &&
         number(partialMoneyCase.duplicated_exposure_cents) === 8000 &&
         number(partialMoneyCase.case_exposure_cents) === 12000,
    `caso monetariamente parcial não preservou exposição 120: ${JSON.stringify(partialMoneyCase)}`);

  const approvedBefore = await approvedDocumentCount();
  const eventsBefore = number((await one(`
    SELECT count(*)::integer AS n FROM fin_classification_event
     WHERE actor = 'test:fila-lifecycle'
  `)).n);
  const run = await one(`SELECT * FROM fin_review_lifecycle_apply('test:fila-lifecycle')`);
  assert(number(run.lifecycle_documents) === 1 &&
         number(run.recurrence_documents) === 1 &&
         number(run.inherited_transactions) === 1 &&
         number(run.pjbank_transactions) === 1 &&
         number(run.known_payee_transactions) === 1 &&
         number(run.resolved_items) === 5 &&
         number(run.category_changes) === 4,
    `resultado incremental inesperado: ${JSON.stringify(run)}`);

  const protectedAfter = await one(`
    SELECT count(*) FILTER (WHERE status = 'pendente')::integer AS pending
      FROM fin_review_item
     WHERE id = ANY($1::bigint[])
  `, [[
    assignedReview, lockedReview, lowTargetReview, unknownReview, partialReview,
    partialMoneyDocReview, partialMoneyTxReview, pjbankWrongReasonReview
  ]]);
  assert(number(protectedAfter.pending) === 8,
    'lifecycle fechou atribuição humana, trava, versão baixa ou N:N incompleto');

  const partialAfter = await one(`
    SELECT c.code, ri.status
      FROM fin_transaction t
      JOIN fin_category c ON c.id = t.category_id
      JOIN fin_review_item ri
        ON ri.target_table = 'fin_transaction' AND ri.target_id = t.id
     WHERE t.id = $1
  `, [partialTx]);
  assert(partialAfter.code === '3.99' && partialAfter.status === 'pendente',
    'N:N com documento sem evidência herdou categoria indevidamente');

  const preservedSuggestion = await one(`
    SELECT EXISTS (
             SELECT 1 FROM jsonb_array_elements(suggested) item
              WHERE item ->> 'schema' = 'clickup/category-suggestion/v1'
           ) AS external_preserved,
           EXISTS (
             SELECT 1 FROM jsonb_array_elements(suggested) item
              WHERE item ->> 'schema' = 'fin_review_suggestion/v1'
           ) AS lifecycle_added
      FROM fin_review_item
     WHERE id = $1
  `, [pjbankWrongReasonReview]);
  assert(preservedSuggestion.external_preserved && preservedSuggestion.lifecycle_added,
    'refresh do lifecycle apagou sugestão estruturada de outro produtor');

  const approvedAfter = await approvedDocumentCount();
  assert(approvedAfter === approvedBefore,
    `lifecycle realimentou histórico documental: ${approvedBefore} -> ${approvedAfter}`);
  const lifecycleInApproved = await one(`
    SELECT count(*)::integer AS n
      FROM fin_review_approved_document_v
     WHERE classified_reason ? 'lifecycle_0090'
  `);
  assert(number(lifecycleInApproved.n) === 0,
    'documento marcado pelo lifecycle entrou no histórico independente');

  const knownBaseAfter = number((await one(`
    WITH independent AS (
      SELECT count(*)::integer AS base
        FROM fin_transaction t
        LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
        JOIN fin_category c ON c.id = t.category_id
       WHERE t.entity_id = $1
         AND COALESCE(t.counterparty_document, cp.document_number) = $2
         AND t.description_norm = $3
         AND t.amount_cents < 0
         AND t.source = 'inter_api'
         AND t.source_kind = 'PIX'
         AND t.review_status = 'ok'
         AND t.classified_by = 'favorecido'
         AND c.code NOT IN ('3.99', '5.99')
         AND NOT (COALESCE(t.classified_reason, '{}'::jsonb) ? 'lifecycle_0090')
         AND NOT EXISTS (
           SELECT 1 FROM fin_review_item ri
            WHERE ri.target_table = 'fin_transaction'
              AND ri.target_id = t.id AND ri.status = 'pendente'
         )
    ) SELECT base FROM independent
  `, [ctx.entity_id, knownPayee.document_number, knownPayee.description_norm])).base);
  assert(knownBaseAfter === knownBaseBefore,
    `favorecido do lifecycle realimentou a base: ${knownBaseBefore} -> ${knownBaseAfter}`);

  const eventsAfter = number((await one(`
    SELECT count(*)::integer AS n FROM fin_classification_event
     WHERE actor = 'test:fila-lifecycle'
  `)).n);
  const auditsAfter = number((await one(`
    SELECT count(*)::integer AS n FROM fin_audit_log
     WHERE actor = 'test:fila-lifecycle'
  `)).n);
  assert(eventsAfter - eventsBefore === 5 && auditsAfter === 11,
    `trilha incremental inesperada: eventos=${eventsAfter - eventsBefore}, auditorias=${auditsAfter}`);

  const auditBeforePointFix = auditsAfter;
  const eventBeforePointFix = eventsAfter;
  const pointFix = await one(`SELECT * FROM fin_review_lifecycle_apply('test:fila-lifecycle')`);
  assert(Object.values(pointFix).every((value) => number(value) === 0),
    `segunda execução não chegou ao ponto fixo: ${JSON.stringify(pointFix)}`);
  const trailAtPointFix = await one(`
    SELECT (SELECT count(*) FROM fin_audit_log
             WHERE actor = 'test:fila-lifecycle') AS audits,
           (SELECT count(*) FROM fin_classification_event
             WHERE actor = 'test:fila-lifecycle') AS events
  `);
  assert(number(trailAtPointFix.audits) === auditBeforePointFix &&
         number(trailAtPointFix.events) === eventBeforePointFix,
    'point-fix criou auditoria/evento vazio');

  // O trigger de sinal recusa uma categoria de receita numa saída sem lançar
  // erro. O lifecycle precisa detectar o estado efetivo, abortar o statement e
  // deixar fato/fila/trilha exatamente como estavam.
  await client.query('SAVEPOINT sign_guard_fixture');
  const signDoc = await insertDocument({
    entityId: ctx.entity_id,
    categoryId: ctx.category_302,
    amount: 10000,
    description: `${token}-sign-guard-document`,
    classifiedBy: 'humano'
  });
  const signTx = await insertTransaction({
    entityId: ctx.entity_id,
    accountId: ctx.inter_account_id,
    amount: -10000,
    description: `${token}-sign-guard-transaction`
  });
  await client.query(`
    INSERT INTO fin_settlement (
      transaction_id, document_id, amount_cents, method, confidence, matched_by, created_by
    ) VALUES ($1, $2, 10000, 'manual', 100, 'test:fila-lifecycle', 'test:fila-lifecycle')
  `, [signTx, signDoc]);
  const signReview = await reviewId('fin_transaction', signTx);
  const signCandidate = await one(`
    SELECT count(*)::integer AS n
      FROM fin_review_settlement_inheritance_candidate_v
     WHERE review_item_id = $1
  `, [signReview]);
  assert(number(signCandidate.n) === 1,
    'fixture de sinal incompatível não chegou ao candidato de herança');

  const signTrailBefore = await one(`
    SELECT (SELECT count(*) FROM fin_audit_log
             WHERE actor = 'test:fila-lifecycle-sign-guard') AS audits,
           (SELECT count(*) FROM fin_classification_event
             WHERE actor = 'test:fila-lifecycle-sign-guard') AS events
  `);
  await client.query('SAVEPOINT sign_guard_apply');
  let signError = null;
  try {
    await one(`SELECT * FROM fin_review_lifecycle_apply('test:fila-lifecycle-sign-guard')`);
  } catch (error) {
    signError = error;
    await client.query('ROLLBACK TO SAVEPOINT sign_guard_apply');
  }
  assert(signError?.message?.includes('gatilho recusou estado proposto'),
    `lifecycle não rejeitou categoria incompatível: ${signError?.message ?? 'sem erro'}`);
  await client.query('RELEASE SAVEPOINT sign_guard_apply');

  const signState = await one(`
    SELECT t.category_id, t.review_status,
           ri.status AS queue_status, ri.resolved_at, ri.resolved_by,
           (SELECT count(*) FROM fin_audit_log
             WHERE actor = 'test:fila-lifecycle-sign-guard') AS audits,
           (SELECT count(*) FROM fin_classification_event
             WHERE actor = 'test:fila-lifecycle-sign-guard') AS events
      FROM fin_transaction t
      JOIN fin_review_item ri
        ON ri.target_table = 'fin_transaction' AND ri.target_id = t.id
     WHERE t.id = $1
  `, [signTx]);
  assert(signState.category_id === null && signState.review_status === 'pendente' &&
         signState.queue_status === 'pendente' && signState.resolved_at === null &&
         signState.resolved_by === null &&
         number(signState.audits) === number(signTrailBefore.audits) &&
         number(signState.events) === number(signTrailBefore.events),
    `rejeição pós-trigger deixou efeito parcial: ${JSON.stringify(signState)}`);
  await client.query('ROLLBACK TO SAVEPOINT sign_guard_fixture');
  await client.query('RELEASE SAVEPOINT sign_guard_fixture');
}

try {
  assert(markerPosition > 0, 'não encontrou fronteira da execução inicial na migration 0090');
  assert(!/(?<!\d)\d{11}(?!\d)/.test(migrationSql),
    'migration contém possível CPF literal do favorecido conhecido');

  const installedBefore = (await one(`
    SELECT to_regclass('public.fin_review_case_v') IS NOT NULL AS value
  `)).value;
  const moneyBefore = await moneySnapshot();
  const dreBefore = await dreGroups();
  const monthlyBefore = await dreMonthlyTotals();

  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

  let validatedItems;
  if (!installedBefore) {
    await client.query(migrationSql.slice(0, markerPosition));

    await client.query("SET LOCAL lock_timeout = '20s'");
    await client.query("SET LOCAL statement_timeout = '240s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '300s'");

    const preCases = await one(`
      SELECT count(*)::integer AS cases,
             sum(raw_item_count)::integer AS raw_items,
             sum(raw_exposure_cents)::bigint AS raw_cents,
             sum(case_exposure_cents)::bigint AS case_cents
        FROM fin_review_case_v
    `);
    assert(number(preCases.cases) === 1183 && number(preCases.raw_items) === 1533 &&
           number(preCases.raw_cents) === 135376892 && number(preCases.case_cents) === 112252686,
      `casos pré-migration divergentes: ${JSON.stringify(preCases)}`);

    const winners = await validateDsl(1533);
    assert(winners === 494, `DSL encontrou ${winners} vencedoras, esperado 494`);
    validatedItems = 1533;

    const independentBefore = await approvedDocumentCount();
    assert(independentBefore === 2595,
      `histórico independente inicial ${independentBefore}, esperado 2595`);

    await client.query(migrationSql.slice(markerPosition));
    const independentAfter = await approvedDocumentCount();
    assert(independentAfter === independentBefore,
      `primeira execução realimentou histórico: ${independentBefore} -> ${independentAfter}`);
  } else {
    await client.query("SET LOCAL lock_timeout = '20s'");
    await client.query("SET LOCAL statement_timeout = '240s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '300s'");

    const pending = number((await one(
      `SELECT count(*)::integer AS n FROM fin_review_item WHERE status = 'pendente'`
    )).n);
    const winners = await validateDsl(pending);
    assert(winners === 474, `DSL instalado encontrou ${winners} vencedoras, esperado 474`);
    validatedItems = pending;
  }

  const moneyAfterInitial = await moneySnapshot();
  assertSameMoney(moneyBefore, moneyAfterInitial, 'migration 0090');

  if (!installedBefore) {
    const dreAfter = await dreGroups();
    const actualDelta = changedDreGroups(dreBefore, dreAfter);
    const expectedDelta = [
      { key: 'custos_diretos|4.03', rows: 1, cents: -6000, abs_cents: 6000 },
      { key: 'custos_diretos|4.05', rows: 3, cents: -238672, abs_cents: 238672 },
      { key: 'lacuna_ledger_sem_categoria|NULL', rows: -7, cents: -446661, abs_cents: -936005 },
      { key: 'receita_bruta|3.02', rows: 6, cents: 600000, abs_cents: 600000 },
      { key: 'receita_bruta|3.03', rows: 4, cents: 1441333, abs_cents: 1441333 },
      { key: 'receita_bruta|3.04', rows: 3, cents: 775000, abs_cents: 775000 },
      { key: 'receita_bruta|3.05', rows: 1, cents: 1625000, abs_cents: 1625000 },
      { key: 'receita_bruta|3.99', rows: -11, cents: -3750000, abs_cents: -3750000 }
    ].sort((a, b) => a.key.localeCompare(b.key));
    assert(JSON.stringify(actualDelta) === JSON.stringify(expectedDelta),
      `delta categórico da DRE divergente:\n${JSON.stringify(actualDelta, null, 2)}`);

    const monthlyAfter = await dreMonthlyTotals();
    for (const view of ['caixa', 'competencia']) {
      const before = monthlyBefore.get(view);
      const after = monthlyAfter.get(view);
      assert(number(after.revenue) - number(before.revenue) === 691333 &&
             number(after.direct_costs) - number(before.direct_costs) === -244672 &&
             number(after.profit) - number(before.profit) === 446661 &&
             number(after.ledger_gap) - number(before.ledger_gap) === -446661,
        `delta mensal ${view} divergente`);
    }
  }

  const queue = await one(`
    SELECT count(*)::integer AS pending,
           sum(abs(amount_cents))::bigint AS raw_cents,
           count(*) FILTER (
             WHERE jsonb_array_length(suggested) = 1
               AND suggested #>> '{0,schema}' = 'fin_review_suggestion/v1'
           )::integer AS structured
      FROM fin_review_item
     WHERE status = 'pendente'
  `);
  assert(number(queue.pending) === 1101 && number(queue.raw_cents) === 90297088 &&
         number(queue.structured) === 1101,
    `fila pós-migration divergente: ${JSON.stringify(queue)}`);

  const cases = await one(`
    SELECT count(*)::integer AS cases,
           sum(raw_item_count)::integer AS raw_items,
           sum(raw_exposure_cents)::bigint AS raw_cents,
           sum(case_exposure_cents)::bigint AS case_cents,
           count(*) FILTER (WHERE resolution_kind = 'fonte_externa')::integer AS external_cases,
           count(*) FILTER (WHERE resolution_kind = 'humano')::integer AS human_cases,
           count(*) FILTER (WHERE resolution_kind IN ('deterministico', 'lifecycle'))::integer AS stale_cases
      FROM fin_review_case_v
  `);
  assert(number(cases.cases) === 765 && number(cases.raw_items) === 1101 &&
         number(cases.raw_cents) === 90297088 && number(cases.case_cents) === 71614215 &&
         number(cases.external_cases) === 374 && number(cases.human_cases) === 391 &&
         number(cases.stale_cases) === 0,
    `casos pós-migration divergentes: ${JSON.stringify(cases)}`);

  const lifecycleTriggers = await one(`
    SELECT count(*)::integer AS n
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal
       AND (t.tgname LIKE '%review%lifecycle%' OR p.proname = 'fin_review_lifecycle_trigger')
  `);
  assert(number(lifecycleTriggers.n) === 0,
    `0090 instalou ${lifecycleTriggers.n} trigger(s) de varredura global`);

  await fixtureProof();

  const scheduler = await readFile(schedulerUrl, 'utf8');
  const stepMatches = scheduler.match(/script:\s*'scripts\/fin-review-lifecycle\.mjs'/g) ?? [];
  assert(stepMatches.length === 1,
    `scheduler contém ${stepMatches.length} etapas do lifecycle, esperado exatamente 1`);
  assert(scheduler.includes("args: ['--aplicar', '--actor=scheduler:financeiro']") &&
         scheduler.includes("[step.script, ...(step.args ?? [])]"),
    'scheduler não passa --aplicar e identidade explícita ao lifecycle');

  const defaultCli = parseLifecycleArgs([]);
  const applyCli = parseLifecycleArgs(['--aplicar', '--actor=scheduler:financeiro']);
  assert(defaultCli.dryRun === true && applyCli.dryRun === false &&
         applyCli.actor === 'scheduler:financeiro',
    'parser do CLI não mantém dry-run padrão/--aplicar explícito');
  const fakeCalls = [];
  const fakeClient = {
    async query(sql) {
      fakeCalls.push(String(sql).trim().split(/\s+/).join(' '));
      if (String(sql).includes("to_regprocedure('fin_review_lifecycle_apply(text)')")) {
        return { rows: [{ value: true }] };
      }
      if (String(sql).includes('fin_review_lifecycle_apply($1)')) {
        return { rows: [{ resolved_items: 0, category_changes: 0 }] };
      }
      if (String(sql).includes('pending_items')) {
        return { rows: [{ pending_items: 1, pending_exposure_cents: 1,
          pending_cases: 1, case_exposure_cents: 1 }] };
      }
      return { rows: [] };
    }
  };
  const fakeReport = await executeReviewLifecycle(fakeClient);
  assert(fakeReport.dry_run === true && fakeCalls.includes('ROLLBACK') &&
         !fakeCalls.includes('COMMIT'),
    `CLI padrão não provou writes=0: ${JSON.stringify(fakeCalls)}`);

  const packageJson = JSON.parse(await readFile(packageUrl, 'utf8'));
  assert(packageJson.scripts?.['fin:review:lifecycle'] === 'node scripts/fin-review-lifecycle.mjs',
    'package.json não expõe fin:review:lifecycle');
  assert(packageJson.scripts?.['test:fila-lifecycle'] === 'node scripts/test-fila-casos-lifecycle.mjs',
    'package.json não expõe test:fila-lifecycle');

  await client.query('ROLLBACK');

  const moneyAfterRollback = await moneySnapshot();
  assertSameMoney(moneyBefore, moneyAfterRollback, 'ROLLBACK 0090');
  const installedAfter = (await one(`
    SELECT to_regclass('public.fin_review_case_v') IS NOT NULL AS value
  `)).value;
  assert(installedAfter === installedBefore, 'teste deixou DDL da 0090 persistido');

  console.log(`✓ DSL SQL = JavaScript em ${validatedItems} itens (winner + competidores)`);
  console.log('✓ 432 itens viram 765 casos; exposição sem dupla contagem reconciliada');
  console.log('✓ 398 lifecycle + 34 categorias com trilha, versão aplicada e ponto fixo');
  console.log('✓ N:N incompleto, ação humana e regra histórica de baixa confiança ficam pendentes');
  console.log('✓ nenhum trigger global; scheduler chama uma vez com actor correto');
  console.log('✓ ledger, documentos, settlements e saldos invariantes; DRE delta exato; ROLLBACK');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
