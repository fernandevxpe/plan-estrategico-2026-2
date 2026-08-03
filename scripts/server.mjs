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
 * Primeira subida com volume vazio: copia o snapshot versionado para o volume
 * para a plataforma não abrir sem dado nenhum enquanto o primeiro sync roda.
 */
async function seedVolume() {
  if (DATA_DIR === SEED_DIR) return;
  await mkdir(DATA_DIR, { recursive: true });
  for (const folder of ['processed', 'areas', 'gestao-xpe']) {
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

await seedVolume();

const { startScheduler } = await import('./scheduler.mjs');
startScheduler();

const port = process.env.PORT ?? '3000';
console.log(`[server] subindo Next na porta ${port} (DATA_DIR=${DATA_DIR})`);

const next = spawn('npx', ['next', 'start', '--port', port, '--hostname', '0.0.0.0'], {
  stdio: 'inherit',
  env: process.env
});

const shutdown = (signal) => {
  console.log(`[server] recebido ${signal}, encerrando`);
  next.kill(signal);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

next.on('exit', (code) => {
  console.log(`[server] Next encerrou com código ${code}`);
  process.exit(code ?? 0);
});
