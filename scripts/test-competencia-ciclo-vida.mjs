// Prova transacional do ciclo de vida da competencia (migration 0086).
//
// Se a migration ainda estiver pendente, ela e instalada dentro desta mesma
// transacao. O ensaio cria uma transacao, acrescenta documento/settlement/nota,
// provoca um conflito N:N, testa a trava humana e executa o reparo global duas
// vezes. Tudo termina em ROLLBACK, inclusive o DDL quando ainda pendente.

import { readFile } from 'node:fs/promises';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const pool = financePool();
const client = await pool.connect();
const migrationUrl = new URL(
  '../db/migrations/0086_fin_competencia_ciclo_vida.sql',
  import.meta.url
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDecision(row, rule, date, context) {
  assert(row, `${context}: transacao ausente`);
  assert(row.competence_rule === rule,
    `${context}: regra ${row.competence_rule}, esperada ${rule}`);
  assert(row.competence_date === date,
    `${context}: data ${row.competence_date}, esperada ${date}`);
}

async function transaction(transactionId) {
  const { rows: [row] } = await client.query(
    `SELECT competence_rule, competence_date, human_locked_fields, updated_at
       FROM fin_transaction
      WHERE id = $1`,
    [transactionId]
  );
  return row;
}

async function documentFixture(base, token, suffix, dueDate, amountCents) {
  const { rows: [row] } = await client.query(
    `INSERT INTO fin_document (
       entity_id, direction, description, description_norm,
       competence_date, issue_date, due_date, amount_cents,
       source, source_id, created_by
     ) VALUES (
       $1, 'receber', $2, $3,
       $4::date, $4::date, $4::date, $5,
       'manual', $6, 'test-competencia-ciclo-vida'
     ) RETURNING id`,
    [
      base.entity_id,
      `Documento competencia ${suffix}`,
      `documento competencia ${suffix}`,
      dueDate,
      amountCents,
      `${token}:documento:${suffix}`
    ]
  );
  return row.id;
}

try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '20s'");
  await client.query("SET LOCAL statement_timeout = '180s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '240s'");

  const { rows: [installed] } = await client.query(
    `SELECT to_regprocedure('fin_competencia_reavaliar(bigint[])') IS NOT NULL AS ok`
  );
  const { rows: [coverageBefore] } = await client.query(
    `SELECT count(*)::bigint AS ledger_total,
            count(*) FILTER (WHERE competence_date IS NULL)::bigint AS ledger_sem,
            (SELECT count(*)::bigint FROM fin_card_transaction) AS cartao_total,
            (SELECT count(*)::bigint FROM fin_card_transaction
              WHERE competence_date IS NULL) AS cartao_sem
       FROM fin_transaction`
  );
  if (!installed.ok) {
    await client.query(await readFile(migrationUrl, 'utf8'));
  }
  const { rows: [coverageAfter] } = await client.query(
    `SELECT count(*)::bigint AS ledger_total,
            count(*) FILTER (WHERE competence_date IS NULL)::bigint AS ledger_sem,
            (SELECT count(*)::bigint FROM fin_card_transaction) AS cartao_total,
            (SELECT count(*)::bigint FROM fin_card_transaction
              WHERE competence_date IS NULL) AS cartao_sem,
            (SELECT count(*)::bigint FROM fin_competencia_conflito_v) AS conflitos
       FROM fin_transaction`
  );

  const { rows: [base] } = await client.query(
    `SELECT e.id AS entity_id, a.id AS account_id
       FROM fin_entity e
       JOIN fin_account a ON a.entity_id = e.id
      WHERE e.slug = 'xpe' AND a.is_active
      ORDER BY a.id
      LIMIT 1`
  );
  if (!base) throw new Error('entidade/conta ativa de teste ausente');
  const { rows: [cardBase] } = await client.query(
    `SELECT ca.id AS card_account_id
       FROM fin_card_account ca
      WHERE ca.entity_id = $1
      ORDER BY ca.id
      LIMIT 1`,
    [base.entity_id]
  );
  if (!cardBase) throw new Error('conta de cartao de teste ausente');

  const token = `competencia-ciclo-${process.pid}-${Date.now()}`;
  const { rows: [inserted] } = await client.query(
    `INSERT INTO fin_transaction (
       entity_id, account_id, posted_on, amount_cents,
       description_raw, description_norm, source, source_id,
       dedupe_hash, created_by
     ) VALUES (
       $1, $2, DATE '2026-08-16', 12345,
       'Teste ciclo de vida da competencia',
       'teste ciclo de vida da competencia',
       'manual', $3, $3, 'test-competencia-ciclo-vida'
     )
     RETURNING id, competence_rule, competence_date`,
    [base.entity_id, base.account_id, `${token}:transaction`]
  );
  const transactionId = inserted.id;

  // O BEFORE INSERT e importante: o proprio RETURNING ja precisa sair completo.
  assertDecision(
    inserted,
    'competencia_presumida_caixa',
    '2026-08-16',
    'INSERT imediato'
  );

  const { rows: [cardInserted] } = await client.query(
    `INSERT INTO fin_card_transaction (
       card_account_id, external_id, external_source, posted_on,
       amount_cents, description, description_norm, status, kind,
       purchase_date
     ) VALUES (
       $1, $2, 'test-competencia-ciclo-vida', DATE '2026-08-10',
       4321, 'Teste competencia cartao', 'teste competencia cartao',
       'POSTED', 'compra', DATE '2026-07-09'
     ) RETURNING id, competence_rule, competence_date`,
    [cardBase.card_account_id, `${token}:card`]
  );
  assertDecision(
    cardInserted,
    'cartao_data_compra',
    '2026-07-09',
    'INSERT imediato do cartao'
  );

  await client.query(
    `UPDATE fin_card_transaction
        SET purchase_date = DATE '2026-07-08'
      WHERE id = $1`,
    [cardInserted.id]
  );
  const { rows: [cardUpdated] } = await client.query(
    `SELECT competence_rule, competence_date
       FROM fin_card_transaction WHERE id = $1`,
    [cardInserted.id]
  );
  assertDecision(
    cardUpdated,
    'cartao_data_compra',
    '2026-07-08',
    'correcao posterior da compra no cartao'
  );

  await client.query(
    `UPDATE fin_card_transaction
        SET human_locked_fields = array_append(human_locked_fields, 'competence_date')
      WHERE id = $1`,
    [cardInserted.id]
  );
  await client.query(
    `UPDATE fin_card_transaction
        SET purchase_date = DATE '2026-04-01'
      WHERE id = $1`,
    [cardInserted.id]
  );
  const { rows: [cardLocked] } = await client.query(
    `SELECT competence_rule, competence_date
       FROM fin_card_transaction WHERE id = $1`,
    [cardInserted.id]
  );
  assertDecision(
    cardLocked,
    'cartao_data_compra',
    '2026-07-08',
    'trava humana do cartao'
  );

  // A trava nao e uma permissao para gravar um par incompleto: NOT NULL falha
  // alto se alguem tentar criar uma linha travada mas sem decisao humana.
  await client.query('SAVEPOINT card_lock_nulo');
  let rejectedLockedNull = false;
  try {
    await client.query(
      `INSERT INTO fin_card_transaction (
         card_account_id, external_id, external_source, posted_on,
         amount_cents, description, description_norm, status, kind,
         human_locked_fields
       ) VALUES (
         $1, $2, 'test-competencia-ciclo-vida', DATE '2026-08-10',
         100, 'Teste trava nula', 'teste trava nula', 'POSTED', 'compra',
         ARRAY['competence_date']::text[]
       )`,
      [cardBase.card_account_id, `${token}:card:locked-null`]
    );
  } catch (error) {
    rejectedLockedNull = error.code === '23502';
    await client.query('ROLLBACK TO SAVEPOINT card_lock_nulo');
  }
  assert(rejectedLockedNull,
    'cartao aceitou competence_date NULL por estar humanamente travada');
  await client.query('RELEASE SAVEPOINT card_lock_nulo');

  const firstDocumentId = await documentFixture(
    base, token, 'primeiro', '2026-07-31', 7000
  );
  await client.query(
    `INSERT INTO fin_settlement (
       transaction_id, document_id, amount_cents, method,
       confidence, matched_by, created_by
     ) VALUES ($1, $2, 7000, 'manual', 100,
               'test-competencia-ciclo-vida', 'test-competencia-ciclo-vida')`,
    [transactionId, firstDocumentId]
  );
  assertDecision(
    await transaction(transactionId),
    'cobranca_vencimento',
    '2026-07-31',
    'upgrade por settlement/documento'
  );

  // O documento muda depois da liquidacao: so a transacao ligada acompanha.
  await client.query(
    `UPDATE fin_document SET due_date = DATE '2026-07-30' WHERE id = $1`,
    [firstDocumentId]
  );
  assertDecision(
    await transaction(transactionId),
    'cobranca_vencimento',
    '2026-07-30',
    'reavaliacao por alteracao do documento'
  );

  // N:N legitimo com datas divergentes: escolha estavel e conflito publicado.
  const secondDocumentId = await documentFixture(
    base, token, 'segundo', '2026-06-15', 5345
  );
  await client.query(
    `INSERT INTO fin_settlement (
       transaction_id, document_id, amount_cents, method,
       confidence, matched_by, created_by
     ) VALUES ($1, $2, 5345, 'manual', 100,
               'test-competencia-ciclo-vida', 'test-competencia-ciclo-vida')`,
    [transactionId, secondDocumentId]
  );
  assertDecision(
    await transaction(transactionId),
    'cobranca_vencimento',
    '2026-07-30',
    'desempate N:N por menor document_id'
  );
  const { rows: [conflict] } = await client.query(
    `SELECT datas_distintas, competencias, documento_escolhido_por_convencao
       FROM fin_competencia_conflito_v
      WHERE transaction_id = $1`,
    [transactionId]
  );
  assert(conflict, 'conflito N:N de competencia nao foi publicado');
  assert(Number(conflict.datas_distintas) === 2,
    `conflito N:N publicou ${conflict.datas_distintas} datas, esperadas 2`);
  assert(Number(conflict.documento_escolhido_por_convencao) === Number(firstDocumentId),
    'view de conflito nao declarou o documento escolhido pela convencao');

  await client.query(
    `DELETE FROM fin_settlement
      WHERE transaction_id = $1 AND document_id = $2`,
    [transactionId, secondDocumentId]
  );

  const { rows: [fiscal] } = await client.query(
    `INSERT INTO fin_fiscal_document (
       entity_id, document_id, issue_date, competence_date,
       service_amount_cents, status, source, source_id
     ) VALUES (
       $1, $2, DATE '2026-07-12', DATE '2026-07-12',
       7000, 'AUTHORIZED', 'test', $3
     ) RETURNING id`,
    [base.entity_id, firstDocumentId, `${token}:fiscal`]
  );
  assertDecision(
    await transaction(transactionId),
    'nota_fiscal_emissao',
    '2026-07-12',
    'upgrade por nota autorizada'
  );

  // Perder a autorizacao rebaixa para a proxima evidencia; recuperar promove.
  await client.query(
    `UPDATE fin_fiscal_document SET status = 'CANCELLED' WHERE id = $1`,
    [fiscal.id]
  );
  assertDecision(
    await transaction(transactionId),
    'cobranca_vencimento',
    '2026-07-30',
    'remocao da evidencia fiscal'
  );
  await client.query(
    `UPDATE fin_fiscal_document
        SET status = 'AUTHORIZED', issue_date = DATE '2026-07-11'
      WHERE id = $1`,
    [fiscal.id]
  );
  assertDecision(
    await transaction(transactionId),
    'nota_fiscal_emissao',
    '2026-07-11',
    'retorno da evidencia fiscal'
  );

  // Uma decisao humana trava o par inteiro como foi conferido: data e regra
  // ficam como estavam, mesmo que a nota e o vencimento mudem depois.
  await client.query(
    `UPDATE fin_transaction
        SET human_locked_fields = array_append(human_locked_fields, 'competence_date')
      WHERE id = $1`,
    [transactionId]
  );
  const lockedBefore = await transaction(transactionId);
  assertDecision(
    lockedBefore,
    'nota_fiscal_emissao',
    '2026-07-11',
    'data humana travada'
  );

  await client.query(
    `UPDATE fin_fiscal_document SET issue_date = DATE '2026-04-01' WHERE id = $1`,
    [fiscal.id]
  );
  await client.query(
    `UPDATE fin_document SET due_date = DATE '2026-03-01' WHERE id = $1`,
    [firstDocumentId]
  );
  const lockedAfter = await transaction(transactionId);
  assertDecision(
    lockedAfter,
    lockedBefore.competence_rule,
    lockedBefore.competence_date,
    'evidencia nao sobrescreve trava humana'
  );

  const { rows: [targeted] } = await client.query(
    `SELECT fin_competencia_reavaliar(ARRAY[$1::bigint]) AS linhas`,
    [transactionId]
  );
  assert(Number(targeted.linhas) === 0,
    `reavaliacao dirigida tocou ${targeted.linhas} linha travada`);

  // O reparo global continua um ponto fixo. A segunda chamada obrigatoriamente
  // precisa devolver zero, inclusive para itens de cartao.
  await client.query(`SELECT * FROM fin_competencia_backfill(true)`);
  const { rows: secondBackfill } = await client.query(
    `SELECT * FROM fin_competencia_backfill(true)`
  );
  const changedTwice = secondBackfill.reduce(
    (sum, row) => sum + Number(row.linhas),
    0
  );
  assert(changedTwice === 0,
    `segundo backfill alterou ${changedTwice} linhas; nao chegou ao ponto fixo`);

  const { rows: nullableColumns } = await client.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('fin_transaction', 'fin_card_transaction')
        AND column_name IN ('competence_date', 'competence_rule')
        AND is_nullable <> 'NO'`
  );
  assert(nullableColumns.length === 0,
    `colunas de competencia ainda anulaveis: ${nullableColumns.map((r) => `${r.table_name}.${r.column_name}`)}`);

  console.log('✓ INSERT ... RETURNING ja entrega competencia no banco e no cartao');
  console.log('✓ settlement, documento e nota promovem/rebaixam somente a transacao ligada');
  console.log('✓ N:N tem desempate deterministico e conflito explicitamente publicado');
  console.log('✓ trava humana impede sobrescrita e nao permite par NULL');
  console.log('✓ backfill global chega a ponto fixo; ambos os pares sao NOT NULL');
  console.log('  cobertura antes:', coverageBefore);
  console.log('  cobertura depois:', coverageAfter);
  console.log('✓ nenhuma escrita persistida (ROLLBACK)');
} finally {
  await client.query('ROLLBACK').catch(() => {});
  client.release();
  await pool.end();
}
