import pg from 'pg';

const { Pool } = pg;

export function databaseUrl() {
  return process.env.DATABASE_PUBLIC_URL?.trim() || process.env.DATABASE_URL?.trim() || null;
}

/**
 * Banco do módulo financeiro — declarado, não herdado.
 *
 * `DATABASE_URL` tem valor DIFERENTE em cada ambiente: local vem do .env.local,
 * no Railway a plataforma injeta o dela. Um ledger que herda essa variável grava
 * em desenvolvimento num banco e lê em produção de outro, sem erro nenhum — só
 * números que não existem.
 *
 * Precisa bater exatamente com lib/financeiro/db.ts, senão a importação e a tela
 * olham para lugares distintos.
 */
export function financeDatabaseUrl() {
  return process.env.FINANCE_DATABASE_URL?.trim() || databaseUrl();
}

/**
 * Conexão fixada — o gancho que torna "importador idempotente" testável.
 *
 * Um importador abre o próprio pool, dá BEGIN, grava e dá COMMIT. Nada fora dele
 * consegue envolver isso numa transação, e por isso a única forma de provar que
 * rodar duas vezes não muda nada era rodar duas vezes CONTRA PRODUÇÃO e conferir
 * depois — que é exatamente o que o critério nº 23 mandava um humano fazer.
 *
 * Com a conexão fixada, `financePool()` devolve um pool de mentira amarrado a UMA
 * conexão que o teste controla, e traduz o vocabulário de transação do
 * importador para savepoints aninhados:
 *
 *   BEGIN     → SAVEPOINT
 *   COMMIT    → RELEASE SAVEPOINT     (o importador "confirma", nada persiste)
 *   ROLLBACK  → ROLLBACK TO SAVEPOINT
 *
 * A transação de verdade fica com o teste, que sempre termina em ROLLBACK. O
 * importador roda inteiro, com o mesmo SQL, o mesmo planejador e as mesmas
 * constraints — só não consegue mais persistir.
 *
 * Fora do teste isto é código morto: `pinFinanceClient` só é chamada por
 * scripts/test-idempotencia.mjs. Sem pin, `financePool()` é o de sempre.
 */
let pinnedClient = null;
const savepointStack = [];
let savepointSeq = 0;

export function pinFinanceClient(client) {
  pinnedClient = client;
  savepointStack.length = 0;
}

export function unpinFinanceClient() {
  pinnedClient = null;
  savepointStack.length = 0;
}

export function isFinanceClientPinned() {
  return pinnedClient !== null;
}

/** O texto do comando, seja `query(sql, params)` ou `query({ text })`. */
function sqlDe(text) {
  const bruto = typeof text === 'string' ? text : text?.text;
  return String(bruto ?? '').trim().replace(/;+\s*$/, '').toUpperCase();
}

function clientFixado() {
  const encaminhar = (text, values) =>
    typeof text === 'string' ? pinnedClient.query(text, values) : pinnedClient.query(text);

  const vazio = { rows: [], rowCount: 0, command: '', fields: [] };

  return {
    async query(text, values) {
      const sql = sqlDe(text);

      if (sql === 'BEGIN' || sql.startsWith('BEGIN ') || sql.startsWith('START TRANSACTION')) {
        const sp = `idem_sp_${++savepointSeq}`;
        savepointStack.push(sp);
        return pinnedClient.query(`SAVEPOINT ${sp}`);
      }
      if (sql === 'COMMIT' || sql.startsWith('COMMIT ')) {
        const sp = savepointStack.pop();
        return sp ? pinnedClient.query(`RELEASE SAVEPOINT ${sp}`) : vazio;
      }
      if (sql === 'ROLLBACK' || sql.startsWith('ROLLBACK ')) {
        const sp = savepointStack.pop();
        if (!sp) return vazio;
        await pinnedClient.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        return pinnedClient.query(`RELEASE SAVEPOINT ${sp}`);
      }
      return encaminhar(text, values);
    },
    // O importador devolve a conexão quando termina; ela é do teste, não dele.
    release() {},
    async end() {},
    on() { return this; },
    once() { return this; },
    removeListener() { return this; }
  };
}

export function financePool() {
  if (pinnedClient) {
    const fixado = clientFixado();
    return {
      connect: async () => fixado,
      query: (text, values) => fixado.query(text, values),
      // `pool.end()` do importador não pode derrubar a conexão do teste.
      end: async () => {},
      on() { return this; },
      once() { return this; },
      removeListener() { return this; },
      totalCount: 1,
      idleCount: 0,
      waitingCount: 0
    };
  }

  const connectionString = financeDatabaseUrl();
  if (!connectionString) throw new Error('FINANCE_DATABASE_URL/DATABASE_URL não configurada');
  return new Pool({
    connectionString,
    max: 3,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: false }
  });
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
