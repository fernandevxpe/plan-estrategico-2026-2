// O trabalhador do botão "atualizar fontes".
//
// ===========================================================================
// POR QUE ELE EXISTE, E POR QUE NÃO REESCREVE NADA
// ===========================================================================
// O feedback foi "pq n tem botão para atualizar as fontes?", e a resposta certa
// não é uma sync nova: é o MESMO pipeline que o agendador roda toda manhã,
// disparável por uma pessoa. Uma segunda implementação da ingestão seria um
// segundo caminho para o dinheiro entrar no ledger — e o invariante desta
// frente é justamente que sincronizar não altere saldo por caminho que não seja
// a ingestão normal.
//
// Por isso as etapas abaixo são, na mesma ordem, o bloco financeiro de
// `scripts/scheduler.mjs`. Este arquivo não sabe falar com Asaas nem com Inter;
// ele sabe chamar os scripts que sabem, registrar o que aconteceu e nunca
// deixar a execução pendurada.
//
// ===========================================================================
// SOMENTE GET NAS APIS EXTERNAS — conferido, não presumido
// ===========================================================================
// Restrição absoluta nº 3. Medido nos scripts que este arquivo invoca:
//
//   sync-asaas.mjs .... usa createJsonFetcher de scripts/lib/http.mjs, que
//                       chama fetch(url, options) sem method — ou seja, GET
//   sync-inter.mjs .... usa createInterClient de scripts/lib/inter.mjs, que tem
//                       exatamente UM POST: /oauth/v2/token, o endpoint de
//                       autenticação. Todo dado passa por get()
//   import-*.mjs ...... não falam com API nenhuma; leem o acervo bruto local
//
// Nenhum deles emite cobrança, paga, transfere, estorna ou cria webhook.
//
// ===========================================================================
// UMA POR VEZ, GARANTIDO PELO BANCO
// ===========================================================================
// A rota HTTP insere a linha 'rodando' ANTES de spawnar este processo, e o
// índice único parcial `fin_fonte_sync_uma_por_vez` recusa a segunda. Uma flag
// em memória como a `running` do scheduler.mjs não serve: rota e trabalhador
// são processos diferentes, e no Railway pode haver mais de uma instância.
//
// Uso:
//   node scripts/sincronizar-fontes.mjs --execucao=12
//   node scripts/sincronizar-fontes.mjs --execucao=12 --fonte=asaas
//   node scripts/sincronizar-fontes.mjs --listar        # o que o botão alcança

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A raiz do repositório, calculada SOB DEMANDA e sem `new URL('..', ...)`.
 *
 * O bundler do Next (Turbopack) trata `new URL(relativo, import.meta.url)` como
 * referência a um ASSET e tenta resolvê-lo em tempo de build. Como este módulo
 * é importado pela rota (para a lista de etapas não divergir da tela), a forma
 * anterior derrubava a rota inteira com `Module not found: Can't resolve '..'`
 * — medido, 500 em `/api/financeiro/gerencial/fontes`.
 *
 * `dirname(fileURLToPath(import.meta.url))` faz a mesma coisa sem parecer um
 * import para o bundler. E ser função, em vez de constante de topo, garante que
 * nada disso seja avaliado quando quem importa só quer `ETAPAS`.
 */
const raiz = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ESTE ARQUIVO É IMPORTADO PELO SERVIDOR WEB, E POR ISSO NÃO PODE FAZER NADA AO
 * SER IMPORTADO.
 *
 * `lib/financeiro/fontes.ts` e `lib/financeiro/contratos/fontes.ts` importam
 * `ETAPAS` e `FONTES_ALCANCADAS` daqui — de propósito, para que a lista do botão
 * na tela não possa divergir da lista que o trabalhador executa.
 *
 * A consequência é dura e não é teórica: enquanto o corpo executável ficou no
 * topo do módulo, importá-lo de uma rota rodava `loadEnv()`, abria um pool e
 * chamava `process.exit(2)` por falta de `--execucao` — ou seja, **derrubava o
 * servidor web na primeira vez que alguém abrisse /financeiro/fontes**. O
 * `scheduler.mjs` já usa esta guarda pelo mesmo motivo; aqui ela é obrigatória.
 *
 * Regra: acima desta linha, só declarações. Efeito colateral só dentro de
 * `principal()`, que só roda em execução direta.
 */
const EXECUCAO_DIRETA = process.argv[1]?.endsWith('sincronizar-fontes.mjs') ?? false;

const arg = (nome) => {
  const bruto = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return bruto ? bruto.slice(nome.length + 3) : null;
};

/** Teto por etapa, o mesmo do scheduler: uma requisição pendurada não pode
 *  segurar a execução para sempre. */
const TETO_ETAPA_MS = Number(process.env.SYNC_STEP_TIMEOUT_MS ?? 20 * 60_000);

/**
 * As etapas, com a FONTE que cada uma atualiza.
 *
 * `fonte: null` são as duas de consolidação, que rodam sempre: o lifecycle
 * porque a fila e as âncoras precisam ser percorridas depois de qualquer
 * importação (é o que o comentário do scheduler manda), e as notificações
 * porque um botão que atualiza a fonte e deixa o aviso velho na tela é a mesma
 * mentira que esta frente veio consertar — só que mais rápida.
 *
 * `prever-caixa.mjs` foi deliberadamente DEIXADO DE FORA. Ele grava a foto
 * datada da previsão, e uma foto extra no meio do dia reescreve a do dia sem
 * que ninguém tenha pedido previsão nova. O agendador continua tirando a dele.
 */
export const ETAPAS = [
  { fonte: 'asaas',     nome: 'sync Asaas',              script: 'scripts/sync-asaas.mjs' },
  { fonte: 'asaas',     nome: 'importação do Asaas',     script: 'scripts/import-asaas.mjs' },
  { fonte: 'inter_api', nome: 'sync Inter',              script: 'scripts/sync-inter.mjs' },
  { fonte: 'inter_api', nome: 'importação do Inter',     script: 'scripts/import-inter.mjs' },
  {
    fonte: null,
    nome: 'lifecycle da fila financeira',
    script: 'scripts/fin-review-lifecycle.mjs',
    args: ['--aplicar', '--actor=botao:fontes']
  },
  {
    fonte: null,
    nome: 'notificações',
    script: 'scripts/notificar.mjs',
    args: ['--aplicar']
  }
];

/** As fontes que o botão de fato alcança. Tudo o mais a tela declara e explica. */
export const FONTES_ALCANCADAS = [...new Set(ETAPAS.map((e) => e.fonte).filter(Boolean))];

/** As etapas de um escopo. Uma função só, para tela e trabalhador não divergirem. */
export function etapasDoEscopo(escopo) {
  return ETAPAS.filter((e) => escopo === 'todas' || e.fonte === null || e.fonte === escopo);
}

/** Ruído que o Node imprime em todo crash e que não explica nada. */
const RUIDO = [
  /^Node\.js v[\d.]+$/,          // o rodapé de versão — é a ÚLTIMA linha de todo crash
  /^\s*at /,                     // quadro de pilha
  /^\s*\^+\s*$/,                 // o acento circunflexo do apontador
  /^\s*throw /,                  // a linha do throw interno
  /^node:internal/,              // caminho interno do runtime
  /^\s*$/
];

/**
 * A frase que explica a falha, extraída da saída do script.
 *
 * "pegue a última linha do stderr" parece razoável e está errado: em todo crash
 * do Node a última linha é `Node.js v22.18.0`. Medido — um script inexistente
 * produzia exatamente esse texto como "motivo", e a tela mostraria a versão do
 * runtime onde deveria dizer que o arquivo não existe.
 *
 * A ordem de preferência abaixo vai do mais específico ao mais genérico:
 *
 *   1. `✗ mensagem` — a convenção desta casa. Todo script daqui reporta assim,
 *      e essa linha foi escrita por um humano para ser lida por outro.
 *   2. `Error: ...` / `TypeError: ...` — a exceção do runtime.
 *   3. a última linha que não seja ruído.
 */
function mensagemDeErro(stderr, stdout) {
  const linhas = `${stderr}\n${stdout}`
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !RUIDO.some((r) => r.test(l)));

  const daCasa = linhas.filter((l) => l.startsWith('✗'));
  if (daCasa.length) return daCasa[daCasa.length - 1].replace(/^✗\s*/, '');

  const excecao = linhas.find((l) => /^[A-Za-z]*Error[:\s]/.test(l));
  if (excecao) return excecao;

  return linhas.length ? linhas[linhas.length - 1] : null;
}

/**
 * Roda uma etapa e devolve o que aconteceu — nunca lança.
 *
 * A saída é capturada em vez de herdada porque a tela precisa dizer O QUE
 * falhou e POR QUÊ. Um `stdio: 'inherit'` como o do scheduler deixa a mensagem
 * no log do container, onde quem clicou no botão não alcança.
 *
 * Exportada para que `npm run test:fonte-frescor` prove o caminho feliz E o
 * caminho de erro contra processos de verdade, sem precisar de uma segunda
 * implementação do executor no teste.
 */
export function rodarEtapa(etapa) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const filho = spawn('node', [etapa.script, ...(etapa.args ?? [])], {
      cwd: raiz(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let saida = '';
    let erroSaida = '';
    // Teto de memória: um script verboso não pode inflar a linha do banco.
    const acumular = (alvo) => (d) => {
      const texto = String(d);
      if (alvo === 'out') saida = (saida + texto).slice(-4000);
      else erroSaida = (erroSaida + texto).slice(-4000);
    };
    filho.stdout.on('data', acumular('out'));
    filho.stderr.on('data', acumular('err'));

    const cao = setTimeout(() => filho.kill('SIGKILL'), TETO_ETAPA_MS);

    filho.on('error', (e) => {
      clearTimeout(cao);
      resolve({ ok: false, ms: Date.now() - inicio, erro: `não consegui iniciar ${etapa.script}: ${e.message}`, saida: '' });
    });

    filho.on('exit', (codigo, sinal) => {
      clearTimeout(cao);
      const ms = Date.now() - inicio;
      if (sinal === 'SIGKILL') {
        resolve({
          ok: false, ms, saida: saida.slice(-1200),
          erro: `${etapa.script} passou de ${Math.round(TETO_ETAPA_MS / 60000)} min e foi encerrado`
        });
        return;
      }
      if (codigo !== 0) {
        resolve({
          ok: false, ms, saida: (erroSaida || saida).slice(-1200),
          erro: mensagemDeErro(erroSaida, saida) || `${etapa.script} saiu com código ${codigo}`
        });
        return;
      }
      resolve({ ok: true, ms, erro: null, saida: saida.slice(-1200) });
    });
  });
}

// ---------------------------------------------------------------------------
// Daqui para baixo, só executa em invocação direta. Ver a guarda no topo.
// ---------------------------------------------------------------------------
async function principal() {
  const { loadEnv } = await import('./lib/env.mjs');
  loadEnv();
  const { financePool } = await import('./lib/artifact-db.mjs');

  const EXECUCAO = arg('execucao') ? Number(arg('execucao')) : null;
  const FONTE = arg('fonte');

  if (process.argv.includes('--listar')) {
    console.log('Fontes que o botão alcança:', FONTES_ALCANCADAS.join(', '));
    console.log('\nEtapas, na ordem:');
    for (const e of ETAPAS) {
      console.log(
        `  ${(e.fonte ?? '(consolidação)').padEnd(14)} ${e.nome.padEnd(30)} ${e.script} ${(e.args ?? []).join(' ')}`
      );
    }
    return 0;
  }

  if (!Number.isSafeInteger(EXECUCAO) || EXECUCAO <= 0) {
    console.error('✗ --execucao=<id> é obrigatório. A linha em fin_fonte_sync_execucao é criada por quem dispara.');
    return 2;
  }

  const pool = financePool();
  const client = await pool.connect();

  /** Grava o progresso a cada etapa: a tela acompanha em vez de esperar no escuro. */
  const anotar = (lista) =>
    client.query(`UPDATE fin_fonte_sync_execucao SET etapas = $2::jsonb WHERE id = $1`, [
      EXECUCAO,
      JSON.stringify(lista)
    ]);

  let etapas = [];
  let codigo = 0;

  try {
    const { rows } = await client.query(
      `SELECT id, escopo, status FROM fin_fonte_sync_execucao WHERE id = $1`,
      [EXECUCAO]
    );
    if (!rows.length) throw new Error(`execução ${EXECUCAO} não existe`);
    if (rows[0].status !== 'rodando') {
      // Não é erro: é outra pessoa (ou o recolhedor de perdidas) já tendo
      // encerrado esta linha. Sair calado é o certo — sobrescrever o status de
      // alguém apagaria o diagnóstico dele.
      console.log(`execução ${EXECUCAO} já está '${rows[0].status}'; nada a fazer`);
      return 0;
    }

    const escopo = FONTE || rows[0].escopo || 'todas';

    // Escopo que não casa com nenhuma etapa de fonte não roda "só a
    // consolidação" por engano: isso pareceria sucesso e não teria atualizado
    // fonte nenhuma.
    if (escopo !== 'todas' && !ETAPAS.some((e) => e.fonte === escopo)) {
      throw new Error(
        `a fonte '${escopo}' não é alcançada por este botão. Alcançadas: ${FONTES_ALCANCADAS.join(', ')}`
      );
    }

    const selecionadas = etapasDoEscopo(escopo);
    await client.query(`UPDATE fin_fonte_sync_execucao SET pid = $2 WHERE id = $1`, [EXECUCAO, process.pid]);
    console.log(`[fontes] execução ${EXECUCAO} · escopo ${escopo} · ${selecionadas.length} etapa(s)`);

    /**
     * O PLANO INTEIRO É GRAVADO ANTES DA PRIMEIRA ETAPA RODAR.
     *
     * A versão anterior só acrescentava a etapa no momento em que ela começava.
     * Isso bastava para dizer "o que já rodou", e não bastava para dizer
     * "quanto falta": com 2 etapas gravadas ninguém sabe se são 2 de 2 ou 2 de
     * 6, e o denominador é metade de um percentual.
     *
     * Gravar o plano com todas em `pendente` resolve isso sem coluna nova e sem
     * estimar tempo: o percentual é `concluídas / previstas`, uma contagem de
     * fatos. Uma barra que anda por relógio finge saber quanto falta; esta anda
     * quando um processo de fato terminou.
     *
     * A consequência boa e não óbvia: se a execução morrer no meio, as etapas
     * que nunca rodaram continuam `pendente` no banco — a tela diz quais
     * ficaram para trás em vez de fazer parecer que o plano era só o que rodou.
     */
    etapas = selecionadas.map((e, i) => ({
      ordem: i + 1,
      etapa: e.nome,
      script: e.script,
      fonte: e.fonte,
      estado: 'pendente'
    }));
    await anotar(etapas);

    for (let i = 0; i < selecionadas.length; i += 1) {
      const etapa = selecionadas[i];
      console.log(`[fontes] → (${i + 1}/${selecionadas.length}) ${etapa.nome}`);
      // `iniciadaEm` por etapa: sem ele a tela sabe que a etapa 3 está rodando
      // e não sabe há quanto tempo — que é a diferença entre "está indo" e
      // "está pendurada".
      etapas = etapas.map((x, j) =>
        j === i ? { ...x, estado: 'rodando', iniciadaEm: new Date().toISOString() } : x
      );
      await anotar(etapas);

      const r = await rodarEtapa(etapa);
      etapas = etapas.map((x, j) =>
        j === i
          ? { ...x, estado: r.ok ? 'ok' : 'erro', ms: r.ms, erro: r.erro, saida: r.saida || null }
          : x
      );
      await anotar(etapas);
      console.log(`[fontes]   ${r.ok ? 'ok' : 'ERRO'} em ${Math.round(r.ms / 1000)}s${r.erro ? ` — ${r.erro}` : ''}`);
    }

    const falhas = etapas.filter((e) => e.estado === 'erro');
    const sucessos = etapas.filter((e) => e.estado === 'ok');
    // 'ok' exige que TODAS tenham rodado bem — com o plano gravado desde o
    // início, uma etapa que sobrou em `pendente` não pode ser confundida com
    // etapa inexistente, e um plano incompleto não vira sucesso.
    const naoRodaram = etapas.filter((e) => e.estado === 'pendente');
    const status =
      falhas.length === 0 && naoRodaram.length === 0
        ? 'ok'
        : sucessos.length === 0
          ? 'erro'
          : 'parcial';
    // O CHECK `fin_fonte_sync_erro_com_motivo` recusa 'erro' sem motivo, e ele
    // está certo: status vermelho sem frase é o "erro ao sincronizar" que esta
    // frente veio eliminar. Etapa que nunca rodou também é motivo.
    const motivo =
      [
        ...falhas.map((f) => `${f.etapa}: ${f.erro}`),
        ...(naoRodaram.length
          ? [`não chegaram a rodar: ${naoRodaram.map((f) => f.etapa).join(', ')}`]
          : [])
      ].join(' · ') || null;

    await client.query(
      `UPDATE fin_fonte_sync_execucao
          SET status = $2, terminada_em = now(), etapas = $3::jsonb, erro = $4
        WHERE id = $1`,
      [EXECUCAO, status, JSON.stringify(etapas), motivo]
    );

    console.log(`[fontes] execução ${EXECUCAO} terminou como '${status}' (${falhas.length} falha(s))`);
    codigo = status === 'erro' ? 1 : 0;
  } catch (erro) {
    // Falhar sem fechar a linha deixaria o botão travado até o recolhedor
    // passar. Fechar aqui é o que garante que o próximo clique funcione.
    await client
      .query(
        `UPDATE fin_fonte_sync_execucao
            SET status = 'erro', terminada_em = now(), etapas = $2::jsonb, erro = $3
          WHERE id = $1 AND status = 'rodando'`,
        [EXECUCAO, JSON.stringify(etapas), erro.message]
      )
      .catch((e) => console.error('não consegui registrar a falha:', e.message));
    console.error('✗', erro.message);
    codigo = 1;
  } finally {
    client.release();
    await pool.end();
  }

  return codigo;
}

if (EXECUCAO_DIRETA) {
  process.exitCode = await principal();
}
