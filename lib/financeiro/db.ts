import "server-only";

import pg from "pg";

import { registerFinanceTypeParsers } from "@/scripts/lib/fin-types.mjs";

/**
 * Acesso ao PostgreSQL a partir das rotas e Server Components do módulo
 * financeiro.
 *
 * É a primeira vez que esta plataforma lê banco em tempo de request. Todo o
 * resto (`lib/data/processed-store.ts`) lê JSON do volume, o que serve para
 * analítica derivada e somente-leitura. O financeiro tem escrita do usuário,
 * conciliação e correção retroativa — não cabe naquele molde.
 *
 * A consequência a assumir: uma queda do banco que hoje só atrasa o sync do dia
 * seguinte passa a derrubar `/financeiro`. Por isso `isFinanceAvailable()` e o
 * estado explícito de indisponibilidade na tela, em vez de um 500 seco.
 */

const { Pool } = pg;

// Os parsers de tipo (bigint, numeric, date) vivem em scripts/lib/fin-types.mjs
// e são registrados aqui e nos scripts. Registrar em dois lugares com listas
// diferentes faria a MESMA consulta devolver 1184000 num lado e "1184000" no
// outro — e os scripts de teste, que afirmam números, comparariam número com
// string e falhariam parecendo erro de cálculo.
registerFinanceTypeParsers();

/**
 * Onde o financeiro mora — declarado, não herdado.
 *
 * `FINANCE_DATABASE_URL` vem primeiro de propósito. `DATABASE_URL` tem valores
 * DIFERENTES em cada ambiente: na máquina local o `.env.local` aponta para um
 * Postgres, e no Railway a plataforma injeta o dela. Um módulo financeiro que
 * herda essa variável grava o ledger num banco em desenvolvimento e lê de outro
 * em produção — sem erro nenhum, só números que não existem.
 *
 * Com a variável própria, a casa do ledger é uma decisão escrita. Os scripts
 * (scripts/lib/artifact-db.mjs) leem a mesma, então importação e tela nunca
 * divergem.
 *
 * Entre as demais, a rede privada vem antes da pública: a ordem inversa era
 * inofensiva num job em lote diário, mas aqui poria TODA renderização de
 * `/financeiro` no proxy TCP público — cobrado por egresso e, com
 * `rejectUnauthorized: false`, mandando folha de pagamento pela internet aberta
 * sem validar certificado.
 */
function connectionString(): string | null {
  return (
    process.env.FINANCE_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.DATABASE_PUBLIC_URL?.trim() ||
    null
  );
}

/**
 * O pool fica no `globalThis` porque o HMR do `next dev` reavalia este módulo a
 * cada alteração. Sem isso, cada edição vaza um pool e o Postgres derruba a
 * conexão por excesso de clientes depois de algumas dezenas de saves.
 */
const globalForPool = globalThis as unknown as { __finPool?: pg.Pool | null };

export function financePool(): pg.Pool {
  if (process.env.FIN_SCHEMA_OK === "0") {
    throw new FinanceUnavailableError("schema financeiro indisponível (migrations falharam no boot)");
  }
  const url = connectionString();
  if (!url) throw new FinanceUnavailableError("DATABASE_URL não configurada");

  if (!globalForPool.__finPool) {
    globalForPool.__finPool = new Pool({
      connectionString: url,
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      // Teto por consulta. Sem ele, uma consulta lenta segura a conexão até o
      // fim e, com um pool de 5, bastam cinco delas para TODAS as rotas
      // começarem a devolver "timeout exceeded when trying to connect".
      //
      // Foi o que aconteceu em 17/08/2026: a agenda leva ~12 s, e o efeito
      // colateral não ficou nela — o /financeiro inteiro passou a responder
      // 500. Um alarme que aparece longe da causa é o mais caro de diagnosticar.
      //
      // 20 s é acima do pior caso conhecido (a agenda) e bem abaixo do ponto em
      // que o usuário desiste. Consulta que passar disso é defeito, e falhar
      // rápido nomeando a consulta é melhor que degradar a aplicação toda.
      statement_timeout: 20_000,
      /*
       * JIT DESLIGADO — e esta é a linha mais cara do arquivo.
       *
       * MEDIDO EM 23/08/2026, na mesma base, mesma consulta, só trocando isto:
       *
       *   fin_custo_previsto_consolidado_v    12.573ms →   541ms
       *   fin_agenda_dia_v (janela 120d)      23.445ms →   440ms
       *   fin_agenda_resumo_dia_v (janela)    41.912ms →   544ms
       *   fin_agenda_prova_v                  28.363ms →   409ms
       *
       * Quarenta segundos viravam meio. E o efeito não ficava na agenda: com
       * `max: 5`, quatro consultas dessas seguravam o pool inteiro, e o
       * `/api/notificacoes` — que TODA página chama — passou a responder em
       * 19,9s. A `/financeiro/agenda` batia no `statement_timeout` acima e
       * devolvia 500 em produção.
       *
       * POR QUE O JIT SAI TÃO CARO AQUI
       * O JIT dispara por ESTIMATIVA de custo (`jit_above_cost`, 100.000). As
       * views do financeiro são profundamente aninhadas — `fin_agenda_dia_v`
       * expande num plano de 2.170 linhas — e o planejador estima um custo
       * enorme para uma consulta que toca alguns milhares de linhas. O LLVM
       * então gasta 15 a 40 segundos compilando expressões para um trabalho
       * real de 400ms.
       *
       * Foi o que escondeu o diagnóstico por horas: no EXPLAIN, o tempo de
       * compilação aparece grudado no PRIMEIRO nó do plano. Aqui ele caía
       * numa CTE `hoje` que só calcula `now()::date` — e o plano dizia, com
       * cara de verdade, que pegar a data de hoje levava 22 segundos.
       *
       * O JIT existe para varredura analítica de milhões de linhas. Esta base
       * tem milhares. Ele nunca se paga aqui, e é `options` (pacote de
       * inicialização) em vez de `SET` por consulta justamente para valer
       * também na conexão que o `transaction()` toma emprestada.
       */
      options: "-c jit=off",
      // O Railway serve Postgres com certificado próprio; o cliente confia na
      // rede privada. Mesmo tratamento de scripts/lib/artifact-db.mjs.
      ssl: { rejectUnauthorized: false },
    });
    globalForPool.__finPool.on("error", (error) => {
      // Um cliente ocioso que morre não deve derrubar o processo inteiro.
      console.error("[financeiro] erro no pool do Postgres:", error.message);
    });
  }
  return globalForPool.__finPool;
}

/** Erro reconhecível pelas telas, para renderizar "banco indisponível" em vez de estourar. */
export class FinanceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceUnavailableError";
  }
}

/**
 * O módulo tem banco E schema utilizável?
 *
 * `FIN_SCHEMA_OK=0` é posto por scripts/server.mjs quando as migrations falham.
 * A plataforma inteira continua no ar; só `/financeiro` renderiza o estado de
 * indisponibilidade, em vez de estourar consulta contra tabela que não existe.
 */
export function isFinanceConfigured(): boolean {
  if (process.env.FIN_SCHEMA_OK === "0") return false;
  return connectionString() !== null;
}

/** Consulta com parâmetros. Sempre parametrizada — nunca interpolar SQL. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const pool = financePool();
  try {
    const result = await pool.query<T>(text, params);
    return result.rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Erro de conexão vira FinanceUnavailableError; erro de SQL sobe como está,
    // porque é bug nosso e tem de aparecer em desenvolvimento.
    if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Connection terminated|too many clients/i.test(message)) {
      throw new FinanceUnavailableError(message);
    }
    throw error;
  }
}

/** Primeira linha ou `null`. */
export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Executa `fn` dentro de uma transação, com rollback automático em erro.
 *
 * Toda escrita que toca mais de uma tabela passa por aqui: importar um lote,
 * liquidar um documento, aplicar classificação em massa. Meio caminho gravado é
 * pior que nada gravado quando o assunto é dinheiro.
 */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await financePool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Ping barato para as telas decidirem entre renderizar dado ou o estado de indisponibilidade. */
export async function isFinanceAvailable(): Promise<boolean> {
  if (!isFinanceConfigured()) return false;
  try {
    await query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
