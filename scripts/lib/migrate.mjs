// Runner de migrations em SQL puro.
//
// Até aqui o banco só tinha duas tabelas append-only criadas por
// `ensureArtifactSchema()` com CREATE TABLE IF NOT EXISTS. Isso funciona para
// blobs, mas não sobrevive a um módulo com dezenas de tabelas que evoluem: não
// há como alterar coluna, renomear ou semear dado de forma reproduzível.
//
// A escolha aqui é o mínimo que resolve: arquivos numerados em db/migrations/,
// um por transação, registrados numa tabela de controle. Sem Prisma, sem
// Drizzle, sem Knex — `pg` já é dependência e o resto é ~150 linhas.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { financeDatabaseUrl, financePool } from './artifact-db.mjs';

const MIGRATIONS_DIR = path.resolve(fileURLToPath(new URL('../../db/migrations', import.meta.url)));

// Prefixo xpe_ e não fin_: controle de schema é infraestrutura da plataforma,
// igual a xpe_artifacts. O módulo financeiro é só o primeiro a usar.
const LEDGER_TABLE = 'xpe_migrations';

// Duas migrations concorrentes destroem o schema. Isso não é hipotético aqui: o
// Railway mantém o container antigo vivo durante a troca de deploy, então dois
// processos bootam ao mesmo tempo com toda naturalidade.
const LOCK_KEY = 0x58504d47; // 'XPMG'

/**
 * Espera máxima pelo lock antes de desistir.
 *
 * pg_advisory_lock bloqueia para SEMPRE, e lock_timeout não se aplica a advisory
 * locks. Um perdedor de corrida ficaria segurando uma conexão do pool enquanto o
 * Railway observa um container que nunca fica pronto.
 */
const LOCK_WAIT_MS = 60_000;

/**
 * Normaliza antes do checksum.
 *
 * A verificação de deriva tem como consequência derrubar o boot, e o gatilho
 * seria trivial demais: um editor que remove espaço em branco no fim, ou um
 * checkout com core.autocrlf no Windows, mudaria o hash de um arquivo idêntico
 * em conteúdo. (Ver também *.sql text eol=lf no .gitattributes.)
 */
const normalizeSql = (sql) => sql.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      id              text PRIMARY KEY,
      checksum_sha256 char(64) NOT NULL,
      applied_at      timestamptz NOT NULL DEFAULT now(),
      duration_ms     integer NOT NULL,
      applied_by      text
    )
  `);
}

async function readMigrationFiles() {
  let entries;
  try {
    entries = await readdir(MIGRATIONS_DIR);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  // Ordem lexicográfica é a ordem correta porque os números são zero-padded.
  const files = entries.filter((name) => name.endsWith('.sql')).sort();
  return Promise.all(
    files.map(async (id) => {
      const raw = await readFile(path.join(MIGRATIONS_DIR, id), 'utf8');
      const sql = normalizeSql(raw);
      // O marcador vale só na PRIMEIRA linha. Buscá-lo em qualquer lugar faria
      // um comentário que apenas menciona a diretiva desligar a transação.
      const inTransaction = !/^--\s*migrate:no-transaction/.test(sql.split('\n', 1)[0]);
      return { id, sql, checksum: sha256(sql), inTransaction };
    })
  );
}

/**
 * Compara o que existe em disco com o que já foi aplicado.
 * Retorna { pending, applied, drifted } sem tocar em nada.
 */
export async function migrationStatus() {
  const pool = financePool();
  try {
    const client = await pool.connect();
    try {
      await ensureLedger(client);
      const { rows } = await client.query(`SELECT id, checksum_sha256 FROM ${LEDGER_TABLE}`);
      const appliedBy = new Map(rows.map((row) => [row.id, row.checksum_sha256]));
      const files = await readMigrationFiles();

      const pending = [];
      const applied = [];
      const drifted = [];
      for (const file of files) {
        const known = appliedBy.get(file.id);
        if (!known) pending.push(file);
        else if (known !== file.checksum) drifted.push(file);
        else applied.push(file);
      }
      // Registrado no banco mas ausente do disco: alguém apagou histórico.
      const orphans = rows.filter((row) => !files.some((file) => file.id === row.id)).map((row) => row.id);
      return { pending, applied, drifted, orphans };
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

/**
 * Aplica as migrations pendentes. Idempotente: rodar duas vezes seguidas não
 * muda nada na segunda.
 *
 * @param {{ dryRun?: boolean }} [options]
 */
export async function runMigrations({ dryRun = false } = {}) {
  const pool = financePool();
  let client;
  let locked = false;
  try {
    client = await pool.connect();

    // pg_try_advisory_lock em laço, não pg_advisory_lock: este último bloqueia
    // indefinidamente e transformaria uma corrida de deploy num boot pendurado.
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      const { rows: lock } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
      if (lock[0].ok) {
        locked = true;
        break;
      }
      if (Date.now() > deadline) {
        throw new Error(`outro processo aplica migrations há mais de ${LOCK_WAIT_MS / 1000}s; abortando este boot`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    // Só DEPOIS de ter o lock — um statement_timeout cancelaria a própria espera.
    //
    // O lock_timeout importa a partir da 0002: um ALTER TABLE em fin_transaction
    // enfileirado atrás de uma consulta longa de /financeiro pega ACCESS
    // EXCLUSIVE e bloqueia TODAS as consultas seguintes naquela tabela. Falhar
    // rápido é melhor que um deploy que trava o app.
    await client.query("SET lock_timeout = '10s'");
    await client.query("SET statement_timeout = '10min'");

    await ensureLedger(client);
    const { rows } = await client.query(`SELECT id, checksum_sha256 FROM ${LEDGER_TABLE}`);
    const appliedBy = new Map(rows.map((row) => [row.id, row.checksum_sha256]));
    const files = await readMigrationFiles();

    // Registrada no banco e ausente do disco: alguém renomeou ou apagou um
    // arquivo já aplicado. Sem esta checagem, renomear 0001_fin_core.sql faria o
    // runner tratá-la como pendente e reaplicar tudo.
    const orphans = rows.filter((row) => !files.some((file) => file.id === row.id)).map((row) => row.id);
    if (orphans.length) {
      throw new Error(
        `migrations registradas no banco mas ausentes do disco: ${orphans.join(', ')}. ` +
          'Restaure os arquivos ou remova os registros manualmente.'
      );
    }

    // Um arquivo já aplicado que mudou de conteúdo significa que o histórico do
    // banco e o do repositório divergiram. Reaplicar seria errado e ignorar
    // seria pior: o schema real deixaria de ser o que o código pressupõe.
    for (const file of files) {
      const known = appliedBy.get(file.id);
      if (known && known !== file.checksum) {
        throw new Error(
          `migration ${file.id} foi alterada depois de aplicada ` +
            `(esperado ${known.slice(0, 12)}…, encontrado ${file.checksum.slice(0, 12)}…). ` +
            'Crie uma migration nova em vez de editar uma já aplicada.'
        );
      }
    }

    const pending = files.filter((file) => !appliedBy.has(file.id));
    if (!pending.length) {
      console.log(`[migrate] nada a aplicar (${files.length} migrations já no banco)`);
      return { applied: [], total: files.length };
    }

    if (dryRun) {
      console.log(`[migrate] ${pending.length} pendente(s):`);
      pending.forEach((file) => console.log(`  · ${file.id}`));
      return { applied: [], total: files.length, dryRun: true };
    }

    const appliedNow = [];
    for (const file of pending) {
      const startedAt = Date.now();
      try {
        if (file.inTransaction) await client.query('BEGIN');
        await client.query(file.sql);
        await client.query(
          `INSERT INTO ${LEDGER_TABLE} (id, checksum_sha256, duration_ms, applied_by) VALUES ($1, $2, $3, $4)`,
          [file.id, file.checksum, Date.now() - startedAt, process.env.RAILWAY_SERVICE_NAME ?? 'local']
        );
        if (file.inTransaction) await client.query('COMMIT');
      } catch (error) {
        if (file.inTransaction) await client.query('ROLLBACK').catch(() => {});
        // `position` é a diferença entre "syntax error at or near" e saber a
        // linha exata num arquivo de 350 linhas de SQL.
        const parts = [`migration ${file.id} falhou: ${error.message}`];
        if (error.position) parts.push(`  posição: caractere ${error.position}`);
        if (error.detail) parts.push(`  detalhe: ${error.detail}`);
        if (error.hint) parts.push(`  dica: ${error.hint}`);
        if (error.where) parts.push(`  contexto: ${error.where}`);
        throw new Error(parts.join('\n'), { cause: error });
      }
      appliedNow.push(file.id);
      console.log(`[migrate] ✓ ${file.id} (${Date.now() - startedAt}ms)`);
    }
    return { applied: appliedNow, total: files.length };
  } finally {
    // `client` pode ser undefined se o próprio connect estourou o tempo.
    if (client) {
      if (locked) await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
      client.release();
    }
    await pool.end();
  }
}

/**
 * Versão para o boot do servidor.
 *
 * NÃO derruba o processo. A primeira versão saía com código 1, o que parecia
 * prudente — servir o financeiro contra um schema pela metade é pior do que não
 * servir. Mas o efeito real, com restartPolicy ON_FAILURE e 3 tentativas no
 * railway.json, é três reinícios e a PLATAFORMA INTEIRA fora do ar: o painel
 * comercial que o time de vendas usa todo dia cairia por causa de uma migration
 * financeira quebrada.
 *
 * Em vez disso: reporta e deixa o Next subir. Quem degrada é só `/financeiro`,
 * via FIN_SCHEMA_OK, que é exatamente o estado de indisponibilidade que
 * lib/financeiro/db.ts já sabe renderizar.
 *
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function runMigrationsOrDegrade() {
  if (!financeDatabaseUrl()) {
    console.warn('[migrate] DATABASE_URL não configurada; o módulo financeiro ficará indisponível');
    return { ok: false, reason: 'sem-banco' };
  }
  try {
    await runMigrations();
    return { ok: true };
  } catch (error) {
    console.error('[migrate] FALHA ao aplicar migrations — /financeiro ficará indisponível:');
    console.error(error.message);
    return { ok: false, reason: 'schema-invalido' };
  }
}
