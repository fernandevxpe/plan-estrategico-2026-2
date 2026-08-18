// Consolida a fila financeira uma vez por lote.
//
// A migration 0090 deliberadamente NÃO instala triggers em fin_transaction,
// fin_document, fin_settlement, fin_review_item ou fin_rule: cada chamada faz
// snapshots monetários e avalia a fila inteira, portanto executá-la por linha
// transformaria um import incremental em centenas de varreduras globais.
//
// Uso:
//   node scripts/fin-review-lifecycle.mjs                         # ROLLBACK
//   node scripts/fin-review-lifecycle.mjs --aplicar               # COMMIT
//   node scripts/fin-review-lifecycle.mjs --aplicar --actor=operacao:fernando

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

function snapshotSql() {
  return `
    SELECT count(*)::integer AS pending_items,
           COALESCE(sum(abs(amount_cents)), 0)::bigint AS pending_exposure_cents,
           (SELECT count(*)::integer FROM fin_review_case_v) AS pending_cases,
           (SELECT COALESCE(sum(case_exposure_cents), 0)::bigint
              FROM fin_review_case_v) AS case_exposure_cents
      FROM fin_review_item
     WHERE status = 'pendente'
  `;
}

export async function executeReviewLifecycle(
  client,
  { actor = 'cli:fin-review-lifecycle', dryRun = true } = {}
) {
  if (!actor || !actor.trim()) throw new Error('actor não pode ser vazio');

  const normalizedActor = actor.trim();
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      await client.query("SET LOCAL lock_timeout = '20s'");
      await client.query("SET LOCAL statement_timeout = '180s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '240s'");

      const { rows: [installed] } = await client.query(`
        SELECT to_regprocedure('fin_review_lifecycle_apply(text)') IS NOT NULL AS value
      `);
      if (!installed.value) {
        // A 0090 foi reprovada de propósito (vide docs/CONTINUACAO.md e o
        // commit 190b99e): o gatilho de herança de núcleo recusa a própria
        // proposta dela em 16 de 16 candidatos, e suas pré-condições fixam
        // números absolutos que mudam a cada sync. Corrigi-la é trabalho à
        // parte — não é algo que este script deva forçar nem esconder.
        //
        // Antes, isto lançava e o processo pai (o botão de atualizar e o
        // agendador noturno) contava a etapa como ERRO — todo run do
        // consolidador falhava, sempre, por uma condição conhecida e
        // deliberada. Um "erro" que dispara 100% das vezes não é sinal de
        // nada: é ruído que ensina a ignorar o alarme de verdade.
        //
        // `skipped: true` é o relato honesto: nada rodou, por decisão
        // pendente, não por falha. `ROLLBACK` porque nada foi tentado.
        await client.query('ROLLBACK');
        return {
          actor: normalizedActor,
          dry_run: dryRun,
          attempts: attempt,
          skipped: true,
          motivo: 'migration 0090 reprovada e não aplicada — consolidação pendente de decisão, não é falha da sincronização'
        };
      }

      const { rows: [before] } = await client.query(snapshotSql());
      const { rows: [result] } = await client.query(
        `SELECT * FROM fin_review_lifecycle_apply($1)`,
        [normalizedActor]
      );
      const { rows: [after] } = await client.query(snapshotSql());

      if (dryRun) await client.query('ROLLBACK');
      else await client.query('COMMIT');

      return {
        actor: normalizedActor,
        dry_run: dryRun,
        attempts: attempt,
        before,
        result,
        after
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      const retryable = error?.code === '40001' || error?.code === '40P01';
      if (!retryable || attempt === maxAttempts) throw error;
    }
  }

  throw new Error('lifecycle esgotou tentativas sem resultado');
}

export function parseLifecycleArgs(argv) {
  const options = { actor: 'cli:fin-review-lifecycle', dryRun: true };
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--aplicar') options.dryRun = false;
    else if (arg.startsWith('--actor=')) options.actor = arg.slice('--actor='.length);
    else if (arg === '--help') options.help = true;
    else throw new Error(`argumento desconhecido: ${arg}`);
  }
  return options;
}

if (process.argv[1]?.endsWith('fin-review-lifecycle.mjs')) {
  const options = parseLifecycleArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      'Uso: node scripts/fin-review-lifecycle.mjs [--aplicar] [--actor=IDENTIDADE]\n' +
      'Sem --aplicar, executa tudo e termina em ROLLBACK.'
    );
  } else {
    const pool = financePool();
    const client = await pool.connect();
    try {
      const report = await executeReviewLifecycle(client, options);
      console.log(JSON.stringify(report, null, 2));
    } finally {
      client.release();
      await pool.end();
    }
  }
}
