// Agendador do sync diário para o serviço web do Railway.
//
// O cron job do Railway sobe o serviço, roda e derruba — o que serve para
// tarefas isoladas, mas não para um servidor web. Como a plataforma precisa
// estar de pé o tempo todo E sincronizar uma vez por dia, o agendamento vive
// dentro do próprio processo: ele calcula o próximo horário, dorme até lá e
// dispara o pipeline como um processo filho.
//
// Escrever o resultado no volume é o que faz o dado novo valer sem redeploy —
// `lib/data/processed-store.ts` relê os arquivos a cada request.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'sync-state.json');
/** Hora local (America/Recife, UTC−3) em que o sync roda. */
const SYNC_HOUR_UTC = Number(process.env.SYNC_HOUR_UTC ?? 11); // 08:00 BRT
const RUN_ON_BOOT = process.env.SYNC_ON_BOOT !== 'false';

const log = (...args) => console.log(`[scheduler ${new Date().toISOString()}]`, ...args);

async function readState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return { lastRunAt: null, lastStatus: null, lastError: null, runs: 0 };
  }
}

async function writeState(patch) {
  const state = { ...(await readState()), ...patch };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  return state;
}

/** Teto por etapa. Um sync pendurado numa requisição sem resposta bloquearia
 *  todas as rodadas seguintes, porque `running` nunca voltaria a false. */
const STEP_TIMEOUT_MS = Number(process.env.SYNC_STEP_TIMEOUT_MS ?? 20 * 60_000);

function run(command, args, timeoutMs = STEP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, DATA_DIR }
    });

    const watchdog = setTimeout(() => {
      log(`etapa passou de ${Math.round(timeoutMs / 60000)} min, encerrando processo`);
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(watchdog);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(watchdog);
      if (signal === 'SIGKILL') {
        reject(new Error(`${args[0]} excedeu ${Math.round(timeoutMs / 60000)} min e foi encerrado`));
        return;
      }
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(' ')} saiu com código ${code}`));
    });
  });
}

/**
 * Etapas em ordem. `required: false` deixa a etapa falhar sem derrubar o resto:
 * se as credenciais da Meta ainda não estiverem configuradas, o Pipedrive
 * continua atualizando normalmente.
 */
const STEPS = [
  { name: 'sync Pipedrive + ClickUp', script: 'scripts/sync-data.mjs', required: true },
  { name: 'sync Meta Ads + Instagram', script: 'scripts/sync-meta.mjs', required: false },
  { name: 'sync Chatwoot', script: 'scripts/sync-chatwoot.mjs', required: false },
  { name: 'análise do bot de pré-vendas', script: 'scripts/analyze-presales-bot.mjs', required: false },
  { name: 'análise principal', script: 'scripts/analyze.mjs', required: true },
  { name: 'análise de marketing', script: 'scripts/analyze-meta.mjs', required: false },
  { name: 'análise de pré-vendas', script: 'scripts/analyze-presales.mjs', required: false },
  { name: 'funil de receita', script: 'scripts/analyze-revenue-funnel.mjs', required: false },
  { name: 'inteligência comercial', script: 'scripts/analyze-commercial-intel.mjs', required: true },
  { name: 'snapshot do CRM', script: 'scripts/build-crm-snapshot.mjs', required: true },
  { name: 'índice de auditorias', script: 'scripts/build-audit-index.mjs', required: true },
  { name: 'persistência PostgreSQL', script: 'scripts/storage-push.mjs', required: true }
];

let running = false;

export async function runPipeline(trigger = 'agendado') {
  if (running) {
    log('sync já em andamento, ignorando disparo', trigger);
    return { skipped: true };
  }
  running = true;
  const startedAt = new Date();
  log(`iniciando pipeline (${trigger})`);
  const failures = [];

  try {
    for (const step of STEPS) {
      try {
        log(`→ ${step.name}`);
        await run('node', [step.script]);
      } catch (error) {
        failures.push({ step: step.name, message: error.message });
        if (step.required) throw new Error(`etapa obrigatória falhou: ${step.name} — ${error.message}`);
        log(`  etapa opcional falhou, seguindo: ${step.name} — ${error.message}`);
      }
    }

    const durationMs = Date.now() - startedAt.getTime();
    await writeState({
      lastRunAt: startedAt.toISOString(),
      lastFinishedAt: new Date().toISOString(),
      lastStatus: failures.length ? 'parcial' : 'ok',
      lastError: null,
      lastFailures: failures,
      lastDurationMs: durationMs,
      runs: (await readState()).runs + 1
    });
    log(`pipeline concluído em ${Math.round(durationMs / 1000)}s com ${failures.length} etapa(s) opcional(is) falhando`);
    return { ok: true, failures };
  } catch (error) {
    // Volume cheio ou sem permissão faria o writeState estourar aqui dentro do
    // catch, transformando uma falha de sync numa queda do servidor.
    await writeState({
      lastRunAt: startedAt.toISOString(),
      lastFinishedAt: new Date().toISOString(),
      lastStatus: 'erro',
      lastError: error.message,
      lastFailures: failures
    }).catch((writeError) => log('não consegui registrar o estado do sync:', writeError.message));
    log('pipeline falhou:', error.message);
    return { ok: false, error: error.message, failures };
  } finally {
    running = false;
  }
}

function millisUntilNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(SYNC_HOUR_UTC, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function startScheduler() {
  const schedule = () => {
    const delay = millisUntilNextRun();
    log(`próximo sync em ${Math.round(delay / 60000)} min (${SYNC_HOUR_UTC}:00 UTC)`);
    setTimeout(() => {
      // Agendador e servidor web dividem o mesmo processo. Uma rejeição não
      // tratada aqui derrubaria a plataforma inteira por causa do sync — e,
      // pior, `schedule()` nunca mais seria chamado, matando o agendador em
      // silêncio. O catch garante que o próximo horário sempre seja marcado.
      runPipeline('agendado')
        .catch((error) => log('pipeline lançou exceção não tratada:', error?.message ?? error))
        .finally(schedule);
    }, delay).unref?.();
  };
  schedule();

  if (RUN_ON_BOOT) {
    // Um deploy pode acontecer depois do horário do dia; sem isso o volume
    // ficaria com o dado do build até a virada seguinte.
    readState()
      .then((state) => {
        const last = state.lastRunAt ? new Date(state.lastRunAt).getTime() : 0;
        const hoursSince = (Date.now() - last) / 3_600_000;
        if (hoursSince >= 20) {
          log(`último sync há ${Math.round(hoursSince)}h, rodando na subida`);
          return runPipeline('boot');
        }
        log(`último sync há ${Math.round(hoursSince)}h, não precisa rodar agora`);
        return null;
      })
      .catch((error) => log('sync na subida falhou:', error?.message ?? error));
  }
}

// Execução direta: `node scripts/scheduler.mjs --once`
if (process.argv[1]?.endsWith('scheduler.mjs')) {
  if (process.argv.includes('--once')) {
    const result = await runPipeline('manual');
    process.exit(result.ok ? 0 : 1);
  } else {
    startScheduler();
  }
}
