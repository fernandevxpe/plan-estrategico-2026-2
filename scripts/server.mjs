// Entrypoint de produção: sobe o Next e o agendador no mesmo processo.
//
// Os dois juntos porque o volume do Railway só pode ser montado em um serviço.
// Se um dia o sync passar a pesar sobre o servidor, o caminho é separar em dois
// serviços com um bucket S3 no meio — mas enquanto o pipeline leva ~2 min por
// dia, não vale a complexidade.
import { spawn } from 'node:child_process';
import { mkdir, cp, access } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), 'data');
const SEED_DIR = path.join(process.cwd(), 'data');

/**
 * Os artefatos processados vivem no PostgreSQL e são hidratados no volume antes
 * do Next iniciar. O volume funciona como cache local rápido; o banco é a cópia
 * persistente e auditável.
 */
async function hydrateProcessedData() {
  if (!process.env.DATABASE_URL && !process.env.DATABASE_PUBLIC_URL) {
    console.warn('[server] banco de artefatos não configurado; mantendo cache atual do volume');
    return false;
  }
  return new Promise((resolve) => {
    const child = spawn('node', ['scripts/storage-hydrate.mjs'], {
      stdio: 'inherit',
      env: { ...process.env, DATA_DIR }
    });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 90_000);
    child.on('error', (error) => {
      clearTimeout(timeout);
      console.warn('[server] não consegui iniciar a hidratação:', error.message);
      resolve(false);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) console.warn(`[server] hidratação terminou com código ${code}; mantendo cache do volume`);
      resolve(code === 0);
    });
  });
}

async function seedDatabaseFromVolume() {
  if (!process.env.DATABASE_URL && !process.env.DATABASE_PUBLIC_URL) return false;
  return new Promise((resolve) => {
    console.log('[server] banco vazio; semeando com o cache persistente do volume');
    const child = spawn('node', ['scripts/storage-push.mjs'], {
      stdio: 'inherit',
      env: { ...process.env, DATA_DIR }
    });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 90_000);
    child.on('error', (error) => {
      clearTimeout(timeout);
      console.warn('[server] não consegui iniciar a carga inicial:', error.message);
      resolve(false);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) console.warn(`[server] carga inicial terminou com código ${code}; mantendo somente o volume`);
      resolve(code === 0);
    });
  });
}

async function seedVolume() {
  if (DATA_DIR === SEED_DIR) return;
  await mkdir(DATA_DIR, { recursive: true });
  for (const folder of ['areas', 'gestao-xpe']) {
    const target = path.join(DATA_DIR, folder);
    try {
      await access(target);
      console.log(`[server] ${folder}/ já existe no volume, mantendo`);
    } catch {
      try {
        await cp(path.join(SEED_DIR, folder), target, { recursive: true });
        console.log(`[server] ${folder}/ copiado do repositório para o volume`);
      } catch (error) {
        console.warn(`[server] não consegui semear ${folder}/:`, error.message);
      }
    }
  }
  // Arquivos soltos na raiz de data/
  try {
    await cp(path.join(SEED_DIR, 'obra-subgroup-overrides.json'), path.join(DATA_DIR, 'obra-subgroup-overrides.json'));
  } catch {
    /* opcional */
  }
}

const hydrated = await hydrateProcessedData();
if (!hydrated) await seedDatabaseFromVolume();
await seedVolume();

// Migrations antes de qualquer coisa ler o banco.
//
// Falha aqui NÃO derruba o processo: com restartPolicy ON_FAILURE, sair com
// código 1 tiraria a plataforma inteira do ar — inclusive o painel comercial que
// o time usa todo dia — por causa de uma migration financeira quebrada. O
// resultado vai para o Next como FIN_SCHEMA_OK e só `/financeiro` degrada.
const { runMigrationsOrDegrade } = await import('./lib/migrate.mjs');
const schema = await runMigrationsOrDegrade();

const { startScheduler } = await import('./scheduler.mjs');
startScheduler();

const port = process.env.PORT ?? '3000';
console.log(`[server] subindo Next na porta ${port} (DATA_DIR=${DATA_DIR})`);

// FIN_SCHEMA_OK precisa entrar no spawn: variável definida depois não alcança o
// processo filho.
const next = spawn('npx', ['next', 'start', '--port', port, '--hostname', '0.0.0.0'], {
  stdio: 'inherit',
  env: { ...process.env, FIN_SCHEMA_OK: schema.ok ? '1' : '0' }
});

// Toda troca de deploy manda SIGTERM. Sair com código diferente de zero aqui faz
// a plataforma registrar uma substituição rotineira como queda — e disparar
// alerta de crash por e-mail. Encerramento pedido de fora não é falha.
let shuttingDown = false;

const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] recebido ${signal}, encerrando`);
  next.kill(signal);
  // Se o Next travar no encerramento, não segura o container até o kill forçado.
  setTimeout(() => {
    console.log('[server] Next não encerrou a tempo, saindo mesmo assim');
    process.exit(0);
  }, 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

next.on('exit', (code, signal) => {
  if (shuttingDown) {
    console.log(`[server] encerrado a pedido (${signal ?? `código ${code}`})`);
    process.exit(0);
  }
  console.log(`[server] Next encerrou sozinho com código ${code}${signal ? ` (${signal})` : ''}`);
  process.exit(code ?? 1);
});
