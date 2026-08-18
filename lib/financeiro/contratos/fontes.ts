import "server-only";

import { isFinanceConfigured, query, queryOne } from "../db";
import { contrato, contratoIndisponivel, frescorDeData, frescorIndisponivel, type Contrato, type Frescor } from "./base";

/**
 * As fontes que alimentam o ledger, uma linha cada.
 *
 * ---------------------------------------------------------------------------
 * O PEDIDO QUE ORIGINOU ESTE ARQUIVO
 * ---------------------------------------------------------------------------
 * "e tbm tem dizendo que tem fontes sem atualizar... precisa mesmo ficar
 *  mostrando? é importante atualizar? pq n tem botão para atualizar as fontes?
 *  mostrar quais nao estão atualizadas?"
 *
 * As quatro perguntas viram quatro colunas desta tela, e a resposta a cada uma
 * é medida:
 *
 *   "precisa ficar mostrando?"   Não como estava. Cinco avisos idênticos para
 *                                três contas, contando dias corridos num
 *                                calendário que tem fim de semana.
 *   "é importante atualizar?"    Depende da fonte, e a tela diz de qual. Uma
 *                                fonte que é olhada todo dia e não tem
 *                                movimento não precisa de nada.
 *   "pq n tem botão?"            Agora tem — para as fontes que o pipeline
 *                                alcança, e as outras dizem por que não.
 *   "quais não estão?"           Esta lista.
 *
 * ---------------------------------------------------------------------------
 * TRÊS RELÓGIOS, E POR QUE NENHUM DELES SOZINHO RESPONDE
 * ---------------------------------------------------------------------------
 * `ultimoDadoEm` .......... até quando a fonte tem dado. Responde "o saldo é de
 *                           quando?", que é a pergunta do Fernando.
 * `ultimaIngestaoEm` ...... quando uma linha desta fonte entrou aqui.
 * `ultimaTentativaEm` ..... quando OLHAMOS. É o relógio que faltava, e é o que
 *                           distingue "a sync quebrou" de "o banco não teve
 *                           movimento" — duas situações que a tela antiga
 *                           mostrava com a mesma cara vermelha.
 *
 * SOMENTE LEITURA. O disparo mora em `lib/financeiro/fontes.ts`.
 */

export type NaturezaFonte = "automatica" | "manual" | "desconhecida";

export type EstadoFonte =
  | "em_dia"
  | "atrasada"
  | "sem_regua"
  | "nunca_entregou"
  | "sem_classificacao";

export type LinhaFonte = {
  fonte: string;
  conta: string;
  rotulo: string;
  /** Em português, o que esta fonte alimenta. É a resposta a "por que me importo?". */
  alimenta: string;
  natureza: NaturezaFonte;
  /** Automática NÃO implica agendada: polp e erp_obras são API e ninguém as agenda. */
  agendada: boolean;
  comando: string | null;
  motivoNaoAgendada: string | null;

  ultimoDadoEm: string | null;
  ultimaIngestaoEm: string | null;
  ultimaTentativaEm: string | null;

  atrasoCorrido: number | null;
  atrasoUtil: number | null;
  toleranciaUtil: number | null;
  /** A contagem passou por algum ano sem feriado conferido? */
  feriadoCoberto: boolean | null;

  lancamentos: number;
  tentativas: number;

  estado: EstadoFonte;
  /** Sempre preenchido quando o estado não é `em_dia`. O banco garante. */
  motivo: string | null;
  alarma: boolean;

  /** O botão desta linha funciona? E, se não, por quê. */
  atualizavel: boolean;
  motivoNaoAtualizavel: string | null;
};

export type EtapaExecucao = {
  /** 1-based, gravado com o plano. Ausente nas execuções anteriores ao plano. */
  ordem?: number;
  etapa: string;
  script: string;
  fonte: string | null;
  /** `pendente` = declarada no plano e ainda não rodou. É o que dá denominador. */
  estado: "pendente" | "rodando" | "ok" | "erro";
  iniciadaEm?: string;
  ms?: number;
  erro?: string | null;
  saida?: string | null;
};

/**
 * O quanto andou — e a regra é que ele conta ETAPAS CONCLUÍDAS, nunca tempo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NÃO UMA BARRA POR RELÓGIO
 * ---------------------------------------------------------------------------
 * A tentação é dividir o decorrido pela duração da última execução e mostrar
 * uma barra suave. Isso é uma estimativa vestida de medida: quando a sync do
 * Asaas encalha, a barra continua andando e chega a 100% com a sync parada —
 * exatamente o defeito de alarme que esta frente inteira veio consertar, só que
 * na direção otimista.
 *
 * O percentual daqui só sobe quando um processo terminou. Ele anda aos saltos, e
 * andar aos saltos é honesto: a tela diz "etapa 3 de 6" ao lado, que é a frase
 * que a pessoa de fato lê. A duração da última execução bem-sucedida aparece
 * como REFERÊNCIA separada ("a de ontem levou 4m10s"), sem se misturar ao
 * percentual.
 *
 * Nenhuma etapa sabe reportar progresso interno hoje — `rodarEtapa` só observa
 * o código de saída do processo filho. Enquanto for assim, a menor unidade
 * honesta é a etapa.
 */
export type ProgressoSync = {
  /** Quantas etapas o plano tem. Vem do plano gravado; ver `planoPresumido`. */
  previstas: number;
  /** Terminaram, bem ou mal. É o numerador. */
  concluidas: number;
  ok: number;
  falhas: number;
  /** Declaradas e ainda não rodadas. */
  pendentes: number;
  /** `concluidas / previstas` em %, inteiro. Contagem de fatos, não de relógio. */
  pct: number;
  /** 1-based, ou null quando nenhuma etapa está rodando. */
  etapaAtual: number | null;
  nomeEtapaAtual: string | null;
  /** Há quanto tempo a etapa corrente está rodando. Distingue "indo" de "pendurada". */
  etapaAtualMs: number | null;
  /** Do relógio do SERVIDOR: `now − iniciada_em`, ou a duração fechada. */
  decorridoMs: number;
  /**
   * O trabalhador ainda não gravou o plano, então `previstas` foi deduzida do
   * escopo. A tela mostra "iniciando…" em vez de 0% de um denominador incerto.
   */
  planoPresumido: boolean;
};

/**
 * A última execução bem-sucedida do mesmo escopo — o "quanto isto costuma
 * demorar" que o percentual se recusa a fingir.
 *
 * Fica null enquanto não houver uma. Uma média de zero execuções seria um número
 * inventado, e a tela diz "primeira vez, não sei quanto demora".
 */
export type ReferenciaSync = {
  execucaoId: number;
  terminadaEm: string;
  duracaoMs: number;
  porEtapa: { etapa: string; ms: number }[];
};

export type ExecucaoSync = {
  id: number;
  escopo: string;
  status: "rodando" | "ok" | "parcial" | "erro" | "perdida";
  ator: string;
  iniciadaEm: string;
  terminadaEm: string | null;
  etapas: EtapaExecucao[];
  erro: string | null;
  progresso: ProgressoSync;
};

export type PainelFontes = {
  disponivel: boolean;
  fontes: LinhaFonte[];
  /** Fontes que o botão alcança. Medido do próprio script, não escrito à mão. */
  fontesAtualizaveis: string[];
  execucaoCorrente: ExecucaoSync | null;
  ultimasExecucoes: ExecucaoSync[];
  /** Quanto a última sincronização completa bem-sucedida levou. Null na primeira vez. */
  referencia: ReferenciaSync | null;
  /** Anos com feriado nacional conferido — a cobertura declarada do calendário. */
  anosDeCalendario: number[];
};

/**
 * As fontes que o botão de fato dispara.
 *
 * Importado do próprio trabalhador para que a tela não possa discordar dele.
 * Uma lista duplicada aqui viraria, no primeiro mês, um botão habilitado para
 * uma fonte que o script não roda — e o usuário clicando num botão que não faz
 * nada é a versão ativa do alarme que não oferece ação.
 */
async function fontesAlcancadas(): Promise<string[]> {
  const mod = await import("@/scripts/sincronizar-fontes.mjs");
  return (mod as { FONTES_ALCANCADAS: string[] }).FONTES_ALCANCADAS;
}

const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

const dia = (v: unknown): string | null => {
  const t = iso(v);
  return t ? t.slice(0, 10) : null;
};

type LinhaBruta = {
  fonte: string;
  conta: string;
  rotulo: string;
  alimenta: string;
  natureza: string;
  agendada: boolean;
  comando: string | null;
  motivo_nao_agendada: string | null;
  ultimo_dado_em: Date | string | null;
  ultima_ingestao_em: Date | string | null;
  ultima_tentativa_em: Date | string | null;
  atraso_corrido: number | null;
  atraso_util: number | null;
  tolerancia_util: number | null;
  feriado_coberto: boolean | null;
  lancamentos: number;
  tentativas: number;
  estado: string;
  motivo: string | null;
  alarma: boolean;
};

/**
 * A linha crua de `fin_fonte_sync_execucao`.
 *
 * `id` é `bigint` no banco e o driver o entrega como STRING; declarar `number`
 * aqui compilava só porque ninguém tipava a consulta do outro lado. Aceitar os
 * dois e converter em `paraExecucao` é o que impede a próxima consulta de
 * comparar um id-string com um id-número e não achar nada.
 */
export type ExecucaoBruta = {
  id: string | number;
  escopo: string;
  status: string;
  ator: string;
  iniciada_em: Date | string;
  terminada_em: Date | string | null;
  etapas: EtapaExecucao[] | null;
  erro: string | null;
};

/**
 * Quantas etapas o escopo prevê, lido do próprio trabalhador.
 *
 * É a mesma `etapasDoEscopo` que o script executa — importada, nunca copiada,
 * pelo motivo de sempre: uma lista duplicada divergiria no primeiro mês e o
 * denominador do percentual passaria a mentir sem ninguém perceber.
 */
export async function contadorDeEtapasPrevistas(): Promise<(escopo: string) => number> {
  const mod = await import("@/scripts/sincronizar-fontes.mjs");
  const f = (mod as { etapasDoEscopo: (e: string) => unknown[] }).etapasDoEscopo;
  return (escopo: string) => f(escopo).length;
}

/**
 * O progresso, derivado do que está gravado. Não consulta nada.
 *
 * `agoraMs` é injetável para o teste poder fixar o relógio.
 */
export function progressoDe(
  args: {
    escopo: string;
    status: ExecucaoSync["status"];
    iniciadaEm: string;
    terminadaEm: string | null;
    etapas: EtapaExecucao[];
  },
  previstasDoEscopo: (escopo: string) => number,
  agoraMs: number = Date.now()
): ProgressoSync {
  const etapas = args.etapas;
  const ok = etapas.filter((e) => e.estado === "ok").length;
  const falhas = etapas.filter((e) => e.estado === "erro").length;
  const pendentes = etapas.filter((e) => e.estado === "pendente").length;
  const concluidas = ok + falhas;

  // O plano gravado é a verdade sobre ESTA execução. Cair no escopo só vale
  // enquanto ele não existe — usar a lista de hoje para uma execução de semanas
  // atrás faria o histórico mudar de denominador quando alguém acrescentar uma
  // etapa, e um número que muda sozinho no passado não é um registro.
  const planoPresumido = etapas.length === 0;
  let previstas = etapas.length;
  if (planoPresumido) {
    try {
      previstas = previstasDoEscopo(args.escopo);
    } catch {
      previstas = 0;
    }
  }

  const inicio = new Date(args.iniciadaEm).getTime();
  const fim = args.terminadaEm ? new Date(args.terminadaEm).getTime() : agoraMs;
  // Relógio para trás (NTP, container reiniciado) não pode virar decorrido
  // negativo na tela.
  const decorridoMs = Math.max(0, fim - inicio);

  const idxRodando = etapas.findIndex((e) => e.estado === "rodando");
  const rodando = idxRodando >= 0 ? etapas[idxRodando] : null;

  return {
    previstas,
    concluidas,
    ok,
    falhas,
    pendentes,
    pct: previstas > 0 ? Math.round((concluidas / previstas) * 100) : 0,
    etapaAtual: rodando ? (rodando.ordem ?? idxRodando + 1) : null,
    nomeEtapaAtual: rodando ? rodando.etapa : null,
    etapaAtualMs:
      rodando?.iniciadaEm ? Math.max(0, agoraMs - new Date(rodando.iniciadaEm).getTime()) : null,
    decorridoMs,
    planoPresumido
  };
}

export const paraExecucao = (
  r: ExecucaoBruta,
  previstasDoEscopo: (escopo: string) => number
): ExecucaoSync => {
  const base = {
    id: Number(r.id),
    escopo: r.escopo,
    status: r.status as ExecucaoSync["status"],
    ator: r.ator,
    iniciadaEm: iso(r.iniciada_em) as string,
    terminadaEm: iso(r.terminada_em),
    etapas: Array.isArray(r.etapas) ? r.etapas : [],
    erro: r.erro
  };
  return { ...base, progresso: progressoDe(base, previstasDoEscopo) };
};

/**
 * A última execução bem-sucedida do escopo, para a tela poder dizer quanto isto
 * costuma levar sem inventar média de zero amostras.
 */
export async function referenciaDoEscopo(escopo: string): Promise<ReferenciaSync | null> {
  const r = await queryOne<{
    id: string;
    iniciada_em: Date | string;
    terminada_em: Date | string;
    etapas: EtapaExecucao[] | null;
  }>(
    `SELECT e.id, e.iniciada_em, e.terminada_em, e.etapas
       FROM fin_fonte_sync_execucao e
       JOIN fin_entity n ON n.id = e.entity_id AND n.slug = 'xpe'
      WHERE e.status = 'ok' AND e.escopo = $1 AND e.terminada_em IS NOT NULL
      ORDER BY e.terminada_em DESC
      LIMIT 1`,
    [escopo]
  );
  if (!r) return null;
  const duracaoMs = Math.max(
    0,
    new Date(r.terminada_em).getTime() - new Date(r.iniciada_em).getTime()
  );
  return {
    execucaoId: Number(r.id),
    terminadaEm: iso(r.terminada_em) as string,
    duracaoMs,
    porEtapa: (Array.isArray(r.etapas) ? r.etapas : [])
      .filter((e) => typeof e.ms === "number")
      .map((e) => ({ etapa: e.etapa, ms: e.ms as number }))
  };
}

export async function getFontes(): Promise<Contrato<PainelFontes>> {
  const vazio: PainelFontes = {
    disponivel: false,
    fontes: [],
    fontesAtualizaveis: [],
    execucaoCorrente: null,
    ultimasExecucoes: [],
    referencia: null,
    anosDeCalendario: []
  };

  if (!isFinanceConfigured()) {
    return contratoIndisponivel<PainelFontes>(
      "fontes",
      vazio,
      "o banco financeiro não está configurado. Nenhuma fonte é declarada em dia — o que NÃO é " +
        "o mesmo que declarar todas atrasadas."
    );
  }

  const instalada = await queryOne<{ ok: boolean }>(
    `SELECT to_regclass('fin_fonte_frescor_v') IS NOT NULL AS ok`
  );
  if (!instalada?.ok) {
    return contratoIndisponivel<PainelFontes>(
      "fontes",
      vazio,
      "a migration 0109 ainda não foi aplicada neste banco: o frescor por fonte não existe aqui. " +
        "A tela degrada dizendo o que falta em vez de inventar um estado."
    );
  }

  const [linhas, correntes, recentes, anos, alcancadas, previstasDoEscopo, referencia] = await Promise.all([
    query<LinhaBruta>(`
      SELECT fonte, conta, rotulo, alimenta, natureza, agendada, comando, motivo_nao_agendada,
             ultimo_dado_em, ultima_ingestao_em, ultima_tentativa_em,
             atraso_corrido, atraso_util, tolerancia_util, feriado_coberto,
             lancamentos, tentativas, estado, motivo, alarma
        FROM fin_fonte_frescor_v
       WHERE conta_ativa
       ORDER BY alarma DESC,
                CASE natureza WHEN 'automatica' THEN 0 WHEN 'manual' THEN 1 ELSE 2 END,
                agendada DESC, fonte, conta`),
    query<ExecucaoBruta>(`
      SELECT e.id, e.escopo, e.status, e.ator, e.iniciada_em, e.terminada_em, e.etapas, e.erro
        FROM fin_fonte_sync_execucao e
        JOIN fin_entity n ON n.id = e.entity_id AND n.slug = 'xpe'
       WHERE e.status = 'rodando'
       ORDER BY e.iniciada_em DESC LIMIT 1`),
    query<ExecucaoBruta>(`
      SELECT e.id, e.escopo, e.status, e.ator, e.iniciada_em, e.terminada_em, e.etapas, e.erro
        FROM fin_fonte_sync_execucao e
        JOIN fin_entity n ON n.id = e.entity_id AND n.slug = 'xpe'
       ORDER BY e.iniciada_em DESC LIMIT 8`),
    query<{ ano: number }>(`SELECT ano FROM fin_calendario_ano ORDER BY ano`),
    fontesAlcancadas(),
    contadorDeEtapasPrevistas(),
    referenciaDoEscopo("todas")
  ]);

  const fontes: LinhaFonte[] = linhas.map((r) => {
    const atualizavel = alcancadas.includes(r.fonte);
    return {
      fonte: r.fonte,
      conta: r.conta,
      rotulo: r.rotulo,
      alimenta: r.alimenta,
      natureza: r.natureza as NaturezaFonte,
      agendada: r.agendada,
      comando: r.comando,
      motivoNaoAgendada: r.motivo_nao_agendada,
      ultimoDadoEm: dia(r.ultimo_dado_em),
      ultimaIngestaoEm: iso(r.ultima_ingestao_em),
      ultimaTentativaEm: iso(r.ultima_tentativa_em),
      atrasoCorrido: r.atraso_corrido === null ? null : Number(r.atraso_corrido),
      atrasoUtil: r.atraso_util === null ? null : Number(r.atraso_util),
      toleranciaUtil: r.tolerancia_util === null ? null : Number(r.tolerancia_util),
      feriadoCoberto: r.feriado_coberto,
      lancamentos: Number(r.lancamentos),
      tentativas: Number(r.tentativas),
      estado: r.estado as EstadoFonte,
      motivo: r.motivo,
      alarma: r.alarma,
      atualizavel,
      // Botão desabilitado SEMPRE com a razão ao lado. Um botão cinza sem
      // explicação é a mesma cobrança sem ação que esta frente veio consertar.
      motivoNaoAtualizavel: atualizavel
        ? null
        : r.natureza === "manual"
          ? "esta fonte é um arquivo que uma pessoa exporta do banco e sobe pela tela de importação — não há o que um botão dispare"
          : (r.motivo_nao_agendada ??
             "esta fonte não tem etapa no pipeline que o botão executa") +
            (r.comando ? ` Por enquanto ela se atualiza pelo comando \`${r.comando}\`.` : "")
    };
  });

  const foraDaTolerancia = fontes.filter((f) => f.alarma);
  const manuais = fontes.filter((f) => f.natureza === "manual" && f.lancamentos > 0);
  const naoAgendadas = fontes.filter((f) => f.natureza === "automatica" && !f.agendada);
  const semCalendario = fontes.some((f) => f.feriadoCoberto === false);

  // O frescor DESTA tela é a pior fonte automática que ela mesma reporta —
  // qualquer outra escolha faria a tela de confiança se declarar confiável por
  // conta própria, que é o mesmo erro de `getCobertura`.
  const cobertura: Frescor[] = fontes
    .filter((f) => f.natureza === "automatica")
    .map((f) =>
      f.ultimoDadoEm === null
        ? frescorIndisponivel(`${f.rotulo} · ${f.conta}`, "fin_fonte_frescor_v", f.motivo ?? "sem dado")
        : frescorDeData({
            fonte: `${f.rotulo} · ${f.conta}`,
            origem: "fin_fonte_frescor_v",
            cobreAte: f.ultimoDadoEm,
            toleranciaDias: f.toleranciaUtil ?? 1
          })
    );

  return contrato<PainelFontes>({
    dominio: "fontes",
    dado: {
      disponivel: true,
      fontes,
      fontesAtualizaveis: alcancadas,
      execucaoCorrente: correntes.length ? paraExecucao(correntes[0], previstasDoEscopo) : null,
      ultimasExecucoes: recentes.map((r) => paraExecucao(r, previstasDoEscopo)),
      referencia,
      anosDeCalendario: anos.map((a) => Number(a.ano))
    },
    cobertura,
    pendencias: [
      ...(foraDaTolerancia.length
        ? [
            {
              chave: "fonte_fora_da_tolerancia",
              titulo: "Fontes automáticas com atraso acima da tolerância delas",
              quantidade: foraDaTolerancia.length,
              valorCents: null,
              severidade: "alerta" as const,
              telaDeDecisao: "/financeiro/fontes"
            }
          ]
        : []),
      ...(naoAgendadas.length
        ? [
            {
              chave: "fonte_automatica_sem_agendamento",
              titulo: "Fontes de API que só andam quando alguém roda o comando",
              quantidade: naoAgendadas.length,
              valorCents: null,
              severidade: "alerta" as const,
              telaDeDecisao: "/financeiro/fontes"
            }
          ]
        : [])
    ],
    ressalvas: [
      foraDaTolerancia.length
        ? `${foraDaTolerancia.length} fonte(s) automática(s) fora da tolerância: ${foraDaTolerancia
            .map((f) => `${f.rotulo} · ${f.conta} (${f.atrasoUtil}d úteis, tolerância ${f.toleranciaUtil})`)
            .join(", ")}.`
        : "Nenhuma fonte automática está fora da tolerância. O atraso é contado em dias ÚTEIS: " +
          "sábado, domingo e feriado nacional não contam contra a fonte, porque o banco não lança neles.",
      naoAgendadas.length
        ? `${naoAgendadas.length} fonte(s) são API mas NÃO estão no agendador (${naoAgendadas
            .map((f) => f.rotulo)
            .join(", ")}): elas só avançam quando alguém roda o comando, e alimentam contas reais. ` +
          `Estar em dia hoje é resultado de alguém ter rodado, não de automação. Dúvida 65.`
        : null,
      manuais.length
        ? `${manuais.length} fonte(s) são importação MANUAL e não geram alarme, de propósito: não há cadência ` +
          `declarada para elas. O acervo tem um único dia de importação manual (08/08/2026), e inferir uma ` +
          `cadência de um evento seria inventar régua. Dúvida 64.`
        : null,
      semCalendario
        ? "Parte dos intervalos medidos cai fora dos anos com feriado nacional conferido; nesses trechos a " +
          "contagem só desconta fim de semana, e pode estar alta."
        : null,
      "Feriado municipal e estadual NÃO entram no calendário. A empresa é de Recife/PE e dias como 24/06 " +
        "fecham banco lá sem aparecer aqui — o efeito é uma fonte parecer um dia mais atrasada do que está. Dúvida 66.",
      "'último dado' e 'última tentativa' respondem perguntas diferentes: a primeira é da fonte, a segunda é " +
        "nossa. Uma fonte olhada hoje sem movimento novo está em dia; foi confundir as duas que produziu cinco " +
        "avisos idênticos numa segunda-feira."
    ].filter((r): r is string => r !== null)
  });
}
