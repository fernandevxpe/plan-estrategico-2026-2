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
  etapa: string;
  script: string;
  fonte: string | null;
  estado: "rodando" | "ok" | "erro";
  ms?: number;
  erro?: string | null;
  saida?: string | null;
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
};

export type PainelFontes = {
  disponivel: boolean;
  fontes: LinhaFonte[];
  /** Fontes que o botão alcança. Medido do próprio script, não escrito à mão. */
  fontesAtualizaveis: string[];
  execucaoCorrente: ExecucaoSync | null;
  ultimasExecucoes: ExecucaoSync[];
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

type ExecucaoBruta = {
  id: number;
  escopo: string;
  status: string;
  ator: string;
  iniciada_em: Date | string;
  terminada_em: Date | string | null;
  etapas: EtapaExecucao[] | null;
  erro: string | null;
};

const paraExecucao = (r: ExecucaoBruta): ExecucaoSync => ({
  id: Number(r.id),
  escopo: r.escopo,
  status: r.status as ExecucaoSync["status"],
  ator: r.ator,
  iniciadaEm: iso(r.iniciada_em) as string,
  terminadaEm: iso(r.terminada_em),
  etapas: Array.isArray(r.etapas) ? r.etapas : [],
  erro: r.erro
});

export async function getFontes(): Promise<Contrato<PainelFontes>> {
  const vazio: PainelFontes = {
    disponivel: false,
    fontes: [],
    fontesAtualizaveis: [],
    execucaoCorrente: null,
    ultimasExecucoes: [],
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

  const [linhas, correntes, recentes, anos, alcancadas] = await Promise.all([
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
    fontesAlcancadas()
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
      execucaoCorrente: correntes.length ? paraExecucao(correntes[0]) : null,
      ultimasExecucoes: recentes.map(paraExecucao),
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
