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
  // Financeiro. Todas `required: false` de propósito: uma falha aqui não pode
  // derrubar o painel comercial que o time usa todo dia. Vira `true` quando o
  // módulo estiver em uso diário — e essa mudança merece um commit próprio.
  //
  // O sync incremental cobre 45 dias; o histórico completo é uma execução
  // avulsa (`node scripts/sync-asaas.mjs --full`), fora do agendador, porque
  // leva ~4 min contra o watchdog de 20 por etapa.
  { name: 'sync Asaas', script: 'scripts/sync-asaas.mjs', required: false },
  { name: 'importação financeira', script: 'scripts/import-asaas.mjs', required: false },
  // Inter: a conta por onde sai a folha. Vem depois do Asaas porque o dinheiro
  // anda nessa ordem — entra no gateway, é transferido, e sai daqui.
  //
  // Sem estas duas etapas, a integração construída em 10/08/2026 só rodava se
  // alguém digitasse o comando: a migration 0019 diz que a conta "se atualiza
  // sozinha", e isso só passou a ser verdade aqui.
  //
  // O sync incremental cobre 45 dias e respeita o limite de 10 req/min do
  // Inter; a carga histórica é avulsa (`--desde=2026-01-01`), fora do
  // agendador, pelo mesmo motivo do Asaas: estoura o watchdog de 20 min.
  { name: 'sync Inter', script: 'scripts/sync-inter.mjs', required: false },
  { name: 'importação do Inter', script: 'scripts/import-inter.mjs', required: false },
  // Nubank: espelho, promoção e caixinhas — incluídos em 01/09/2026.
  //
  // A razão está medida: naquele dia Asaas e Inter fecharam em 01/09 e o Nubank
  // ainda estava em 15/08, com 117 lançamentos e R$ 11.682,57 de fora. É a
  // conta por onde a folha sai, e ela era a única das três que dependia de
  // alguém lembrar de digitar dois comandos.
  //
  // A ordem entre as três é a mesma de `sincronizar-fontes.mjs`, e o motivo
  // está escrito lá em detalhe: staging → ledger → caixinhas, porque a Polp
  // espelha as pernas opostas das linhas da conta corrente e precisa que elas
  // já existam. Este bloco e o `ETAPAS` daquele arquivo são a MESMA lista de
  // propósito — o botão é este pipeline disparado por uma pessoa, e o dia em
  // que os dois divergirem é o dia em que "atualizar" passa a significar duas
  // coisas diferentes na mesma plataforma.
  { name: 'espelho do erp-obras', script: 'scripts/sync-erp-obras.mjs', required: false },
  {
    name: 'promoção do extrato do Nubank',
    script: 'scripts/promover-erp-extrato.mjs',
    args: ['--conta=nubank', '--fechar-saldo'],
    required: false
  },
  // Depois de promover, dar nome a quem recebeu. Só isso: a natureza do
  // pagamento (salário, pró-labore, comissão) continua sendo decisão humana.
  {
    name: 'identificação do extrato do Nubank',
    script: 'scripts/identificar-extrato-nubank.mjs',
    args: ['--aplicar'],
    required: false
  },
  // As caixinhas (fonte `polp`) NÃO entram: a fonte declara 108 posições e
  // entrega 91, e o ingestor aborta em vez de gravar saldo menor que o real.
  // O porquê e a medição estão em `sincronizar-fontes.mjs`, que é a lista irmã
  // desta — as duas continuam iguais, inclusive nesta ausência.
  // Uma única consolidação depois dos dois importadores. A rotina percorre a
  // fila completa e ancora ledger/DRE/saldos; chamá-la dentro de cada INSERT
  // multiplicaria esse custo pelo número de linhas do extrato.
  {
    name: 'lifecycle da fila financeira',
    script: 'scripts/fin-review-lifecycle.mjs',
    args: ['--aplicar', '--actor=scheduler:financeiro'],
    required: false
  },
  // A foto datada da previsão. Vem DEPOIS dos dois importadores e do lifecycle
  // porque a âncora dela é o saldo das contas: tirada antes, fotografaria o
  // saldo de ontem e carimbaria a data de hoje.
  //
  // POR QUE ISTO PRECISA SER DIÁRIO, e não sob demanda: `fin_cash_forecast` é a
  // única memória do que a plataforma ACHAVA. A view responde "o que eu acho
  // agora" e muda de ideia amanhã sem deixar rastro — uma previsão que ninguém
  // pode cobrar depois volta a ser palpite. Até 16/08/2026 existia UMA foto, a
  // que alguém tirou à mão, e por isso `fin_previsao_afericao_v` nunca produziu
  // uma linha: a previsão é o único módulo desta base sem backtest, justo o
  // teste que pegou os +37% da receita recorrente e os +75% da comissão.
  //
  // IDEMPOTÊNCIA: rodar duas vezes no mesmo dia não duplica foto. A chave
  // `fin_cash_forecast_foto_key (entity_id, gerado_em, cenario, dia)` e o
  // `ON CONFLICT ... DO UPDATE` de prever-caixa.mjs fazem a segunda execução
  // reescrever a linha do dia em vez de criar outra. Reescrever é o
  // comportamento certo: a foto vale o que o ledger sabia na última vez que
  // olhou naquele dia.
  //
  // `required: false` como o resto do financeiro: uma falha aqui não derruba o
  // painel comercial. E não escreve em caixa — só lê views e grava em
  // `fin_cash_forecast`, que é tabela de previsão e nenhuma consulta de saldo
  // soma.
  {
    name: 'foto da previsão de caixa',
    script: 'scripts/prever-caixa.mjs',
    args: ['--aplicar'],
    required: false
  },
  // As notificações vêm por ÚLTIMO entre as etapas financeiras, e a ordem é o
  // ponto: elas descrevem o estado do dia, e rodadas antes do sync avisariam
  // sobre o estado de ontem — inclusive "fonte desatualizada" para uma fonte
  // que a etapa seguinte ia atualizar. Um sino que acusa o que já foi
  // resolvido ensina a ser ignorado no primeiro dia.
  //
  // Idempotente: a chave de deduplicação faz a segunda execução do mesmo dia
  // incrementar o contador, não criar aviso novo. E ela também RESOLVE sozinha
  // o que sumiu do mundo — é aqui que a caixa devolve ao estado de agora.
  //
  // `required: false` como o resto do financeiro, e por um motivo extra: até a
  // 0105 ser aplicada o script sai limpo dizendo que não há o que fazer.
  {
    name: 'notificações',
    script: 'scripts/notificar.mjs',
    args: ['--aplicar'],
    required: false
  },
  // O backup vem DEPOIS das importações, para o artefato do dia já conter o que
  // entrou hoje. Antes, ele salvaria o estado de ontem e chamaria de hoje.
  { name: 'backup do financeiro', script: 'scripts/db-backup.mjs', required: false },
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
        await run('node', [step.script, ...(step.args ?? [])]);
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
