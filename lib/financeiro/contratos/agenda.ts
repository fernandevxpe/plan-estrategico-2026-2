import "server-only";

import { isFinanceConfigured, query } from "../db";
import { contrato, contratoIndisponivel, ENTIDADE, type Contrato } from "./base";

/**
 * A agenda diária de obrigações — contas a pagar e a receber, dia a dia.
 *
 * ---------------------------------------------------------------------------
 * A REGRA QUE ESTE CONTRATO EXISTE PARA A TELA NÃO QUEBRAR
 * ---------------------------------------------------------------------------
 * Cada obrigação aparece no máximo UMA VEZ no total de um dia, mesmo quando
 * três fontes falam dela. `fin_agenda_dia_v` decide qual linha soma pela chave
 * `chaveDedupe`, e a linha perdedora continua visível com `motivoNaoSoma`.
 *
 *   `entraNoTotal = true`   soma; uma linha por dinheiro
 *   `entraNoTotal = false`  existe, aparece, e NÃO soma — com o motivo escrito
 *
 * Somar as duas é o defeito que já produziu R$ 1,27 milhão falso nesta base
 * (migration 0060/0061). Esconder a segunda faz o número parecer vindo do nada.
 * A tela mostra as duas, separadas.
 *
 * ---------------------------------------------------------------------------
 * O PASSADO E O FUTURO NÃO SÃO A MESMA PERGUNTA
 * ---------------------------------------------------------------------------
 * De hoje para frente, a agenda é PREVISÃO: o que se espera receber e pagar. É
 * comparável, mês a mês, com `fin_previsao_evento_v` — e `fin_agenda_prova_v`
 * faz essa conta a cada leitura.
 *
 * Para trás, a agenda é HISTÓRIA: o que venceu, e o que de fato aconteceu. Aí
 * `realizadoCents`, `realizadoEm` e `atrasoDias` passam a existir, e o dia
 * mostra previsto × realizado lado a lado. É assim que a previsão aprende — e
 * é a única razão de a agenda ter passado.
 *
 * `saldoPrevistoCents` é NULL no passado, sempre. O saldo de um dia que já
 * passou é o extrato daquele dia, não a âncora de hoje projetada para trás.
 *
 * ---------------------------------------------------------------------------
 * O BURACO QUE A TELA TEM DE DIZER NA CARA
 * ---------------------------------------------------------------------------
 * A previsão de SAÍDA cobre ~72% do que sai de verdade (medido, migration
 * 0079; o restante é a dúvida 34). E o lado a pagar do PASSADO é quase vazio:
 * `fin_document direction='pagar'` tem 12 linhas contra 3.406 a receber, todas
 * futuras — a empresa não tem "contas a pagar", tem "contas pagas" (dúvida 28).
 * A agenda não inventa o que falta: declara, e as ressalvas medidas carregam o
 * número.
 */

const DOMINIO = "agenda";

export type Tempo = "passado" | "hoje" | "futuro";
export type Direcao = "receber" | "pagar";
export type Certeza = "firme" | "provavel" | "observado" | "atrasado" | "indeterminado";

export type LinhaAgenda = {
  dia: string;
  competencia: string;
  tempo: Tempo;
  diasAFrente: number;
  direcao: Direcao;
  /** 'documento' (data real), 'item' (alguém agiu) ou 'projetado' (a previsão). */
  procedencia: string;
  precedencia: string;
  precedenciaNivel: number;
  /** Nulo quando a linha ainda é só projeção — não existe item para editar. */
  itemId: number | null;
  estado: string | null;
  camada: string | null;
  descricao: string;
  contraparteId: number | null;
  contraparte: string | null;
  categoriaId: number | null;
  categoriaCode: string | null;
  categoria: string | null;
  nucleo: string | null;
  valorCents: number | null;
  /** Entrada positiva, saída negativa. É o que o agregado do dia soma. */
  assinadoCents: number | null;
  realizadoCents: number | null;
  realizadoEm: string | null;
  /** Dias entre o esperado e o realizado. Negativo = entrou antes. */
  atrasoDias: number | null;
  /** Null no futuro: ausência de dado, não afirmação de que está em dia. */
  vencido: boolean | null;
  origemTabela: string;
  origemId: number | null;
  origemRef: string | null;
  /** A identidade do dinheiro. Duas linhas com a mesma chave são a MESMA coisa. */
  chaveDedupe: string;
  /** Por que aquele dia. "folha: dia 2", "vencimento do boleto". */
  diaRegra: string | null;
  certeza: Certeza;
  confianca: string | null;
  serieChave: string | null;
  source: string | null;
  externalUrl: string | null;
  entraNoTotal: boolean;
  motivoNaoSoma: string | null;
  alertaSobreposicao: string | null;
};

export type DiaAgenda = {
  dia: string;
  competencia: string;
  tempo: Tempo;
  diasAFrente: number;
  entradaCents: number;
  saidaCents: number;
  liquidoCents: number;
  /** NULL no passado, de propósito. Ver o cabeçalho deste arquivo. */
  saldoPrevistoCents: number | null;
  itens: number;
  itensForaDaSoma: number;
  foraDaSomaCents: number;
  itensVencidos: number;
  vencidoCents: number;
  estimadoCents: number;
  itensManuais: number;
  itensConfirmados: number;
  /** NULL significa "não houve lançamento", nunca zero. */
  realizadoEntradaCents: number | null;
  realizadoSaidaCents: number | null;
  realizadoLiquidoCents: number | null;
  realizadoLancamentos: number | null;
  erroDoDiaCents: number | null;
};

export type Serie = {
  serieRef: string;
  serieTabela: string;
  direcao: Direcao;
  descricao: string;
  contraparte: string | null;
  categoria: string | null;
  /** assinatura | parcelamento | padrao_observado — declarado pela FONTE. */
  tipo: string;
  /** False quando o fim ausente é ignorância, não natureza. A diferença importa. */
  fimDeclarado: boolean;
  inicio: string | null;
  fim: string | null;
  diaDoMes: number | null;
  valorTipicoCents: number | null;
  /** Quantas vezes o detector viu; medidas é o que o ledger registra. */
  ocorrencias: number | null;
  ocorrenciasMedidas: number | null;
  valorMedianoCents: number | null;
  valorMinCents: number | null;
  valorMaxCents: number | null;
  /** Dispersão do valor pago em torno da mediana. Responde "repete mesmo?". */
  desvioPct: number | null;
  primeiraOcorrencia: string | null;
  ultimaOcorrencia: string | null;
  mesesRestantes: number | null;
  leituraDoFim: string | null;
  totalEContado: boolean;
  status: string | null;
};

export type Prova = {
  competencia: string;
  direcao: Direcao;
  agendaCents: number;
  previsaoCents: number;
  agendaLinhas: number;
  previsaoLinhas: number;
  manualCents: number;
  ajusteHumanoCents: number;
  deltaCents: number;
  deltaExplicado: boolean;
  leitura: string | null;
};

export type AgendaPeriodo = {
  de: string;
  ate: string;
  hoje: string;
  dias: DiaAgenda[];
  linhas: LinhaAgenda[];
  total: number;
  pagina: number;
  porPagina: number;
  ordenarPor: string;
  ordem: "asc" | "desc";
  /** Somatórios do período, só do que soma. */
  entradaCents: number;
  saidaCents: number;
  liquidoCents: number;
  foraDaSomaCents: number;
  foraDaSomaLinhas: number;
  /** A conta que prova que nada foi contado duas vezes, mês a mês. */
  prova: Prova[];
  provaOk: boolean;
  ancoraSaldoCents: number | null;
  ancoraAte: string | null;
};

const VAZIO: AgendaPeriodo = {
  de: "",
  ate: "",
  hoje: "",
  dias: [],
  linhas: [],
  total: 0,
  pagina: 1,
  porPagina: 50,
  ordenarPor: "dia",
  ordem: "asc",
  entradaCents: 0,
  saidaCents: 0,
  liquidoCents: 0,
  foraDaSomaCents: 0,
  foraDaSomaLinhas: 0,
  prova: [],
  provaOk: true,
  ancoraSaldoCents: null,
  ancoraAte: null
};

/**
 * As colunas por que se pode ordenar, por LISTA BRANCA.
 *
 * `ORDER BY` não aceita parâmetro no Postgres — ele vira texto na consulta. Um
 * nome vindo do cliente concatenado aqui é injeção de SQL com outro nome. Esta
 * lista é a fronteira: o que não está nela não existe, e o pedido cai no padrão
 * em vez de chegar ao banco.
 */
const ORDENACOES: Record<string, string> = {
  dia: "v.dia",
  valor: "v.valor_cents",
  contraparte: "cp_nome",
  categoria: "v.categoria_code",
  certeza: "v.precedencia_nivel",
  atraso: "v.atraso_dias"
};

export const ORDENACOES_VALIDAS = Object.keys(ORDENACOES);

export type FiltroAgenda = {
  de: string;
  ate: string;
  direcao?: Direcao;
  texto?: string;
  categoria?: string;
  camada?: string;
  certeza?: Certeza;
  procedencia?: string;
  estado?: string;
  valorMinCents?: number;
  valorMaxCents?: number;
  /** Quando falso, traz também as linhas que não somam (para auditar a trava). */
  somenteSomaveis?: boolean;
  somenteVencidos?: boolean;
  pagina?: number;
  porPagina?: number;
  ordenarPor?: string;
  ordem?: "asc" | "desc";
};

type LinhaSQL = Record<string, unknown>;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const numOu0 = (v: unknown): number => Number(v ?? 0);
const iso = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

function mapaLinha(r: LinhaSQL): LinhaAgenda {
  return {
    dia: iso(r.dia) ?? "",
    competencia: iso(r.competencia) ?? "",
    tempo: String(r.tempo) as Tempo,
    diasAFrente: numOu0(r.dias_a_frente),
    direcao: String(r.direcao) as Direcao,
    procedencia: String(r.procedencia),
    precedencia: String(r.precedencia),
    precedenciaNivel: numOu0(r.precedencia_nivel),
    itemId: num(r.item_id),
    estado: r.estado === null ? null : String(r.estado),
    camada: r.camada === null ? null : String(r.camada),
    descricao: String(r.descricao ?? ""),
    contraparteId: num(r.counterparty_id),
    contraparte: r.contraparte === null ? null : String(r.contraparte),
    categoriaId: num(r.category_id),
    categoriaCode: r.categoria_code === null ? null : String(r.categoria_code),
    categoria: r.categoria === null ? null : String(r.categoria),
    nucleo: r.nucleo === null ? null : String(r.nucleo),
    valorCents: num(r.valor_cents),
    assinadoCents: num(r.assinado_cents),
    realizadoCents: num(r.realizado_cents),
    realizadoEm: iso(r.realizado_em),
    atrasoDias: num(r.atraso_dias),
    vencido: r.vencido === null || r.vencido === undefined ? null : Boolean(r.vencido),
    origemTabela: String(r.origem_tabela ?? ""),
    origemId: num(r.origem_id),
    origemRef: r.origem_ref === null ? null : String(r.origem_ref),
    chaveDedupe: String(r.chave_dedupe ?? ""),
    diaRegra: r.dia_regra === null ? null : String(r.dia_regra),
    certeza: String(r.certeza) as Certeza,
    confianca: r.confianca === null ? null : String(r.confianca),
    serieChave: r.serie_chave === null ? null : String(r.serie_chave),
    source: r.source === null ? null : String(r.source),
    externalUrl: r.external_url === null ? null : String(r.external_url),
    entraNoTotal: Boolean(r.entra_no_total),
    motivoNaoSoma: r.motivo_nao_soma === null ? null : String(r.motivo_nao_soma),
    alertaSobreposicao: r.alerta_sobreposicao === null ? null : String(r.alerta_sobreposicao)
  };
}

function mapaDia(r: LinhaSQL): DiaAgenda {
  return {
    dia: iso(r.dia) ?? "",
    competencia: iso(r.competencia) ?? "",
    tempo: String(r.tempo) as Tempo,
    diasAFrente: numOu0(r.dias_a_frente),
    entradaCents: numOu0(r.entrada_cents),
    saidaCents: numOu0(r.saida_cents),
    liquidoCents: numOu0(r.liquido_cents),
    saldoPrevistoCents: num(r.saldo_previsto_cents),
    itens: numOu0(r.itens),
    itensForaDaSoma: numOu0(r.itens_fora_da_soma),
    foraDaSomaCents: numOu0(r.fora_da_soma_cents),
    itensVencidos: numOu0(r.itens_vencidos),
    vencidoCents: numOu0(r.vencido_cents),
    estimadoCents: numOu0(r.estimado_cents),
    itensManuais: numOu0(r.itens_manuais),
    itensConfirmados: numOu0(r.itens_confirmados),
    realizadoEntradaCents: num(r.realizado_entrada_cents),
    realizadoSaidaCents: num(r.realizado_saida_cents),
    realizadoLiquidoCents: num(r.realizado_liquido_cents),
    realizadoLancamentos: num(r.realizado_lancamentos),
    erroDoDiaCents: num(r.erro_do_dia_cents)
  };
}

/**
 * Monta o WHERE a partir dos filtros. Tudo por parâmetro — nada interpolado.
 *
 * O único texto que chega concatenado à consulta é o nome da coluna de
 * ordenação, e ele passa pela lista branca acima. Valor de filtro, faixa de
 * data e busca textual são sempre `$n`.
 */
function condicoes(f: FiltroAgenda): { sql: string; params: unknown[] } {
  const p: unknown[] = [f.de, f.ate];
  const c: string[] = ["v.dia BETWEEN $1::date AND $2::date"];
  const push = (expr: string, valor: unknown) => {
    p.push(valor);
    c.push(expr.replace("$?", `$${p.length}`));
  };

  if (f.direcao) push("v.direcao = $?", f.direcao);
  if (f.categoria) push("v.categoria_code = $?", f.categoria);
  if (f.camada) push("v.camada = $?", f.camada);
  if (f.certeza) push("v.certeza = $?", f.certeza);
  if (f.procedencia) push("v.procedencia = $?", f.procedencia);
  if (f.estado) push("COALESCE(v.estado, 'projetado') = $?", f.estado);
  if (f.valorMinCents !== undefined) push("v.valor_cents >= $?", f.valorMinCents);
  if (f.valorMaxCents !== undefined) push("v.valor_cents <= $?", f.valorMaxCents);
  if (f.somenteSomaveis) c.push("v.entra_no_total");
  if (f.somenteVencidos) c.push("v.vencido");
  // Busca por nome cobre descrição E contraparte: quem procura "Pichilau" não
  // sabe se o nome está na descrição do boleto ou no cadastro da contraparte.
  if (f.texto) {
    p.push(`%${f.texto}%`);
    c.push(`(v.descricao ILIKE $${p.length} OR v.contraparte ILIKE $${p.length})`);
  }
  return { sql: c.join(" AND "), params: p };
}

export async function getAgenda(filtro: FiltroAgenda): Promise<Contrato<AgendaPeriodo>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO, VAZIO, "FINANCE_DATABASE_URL não configurada");
  }

  const pagina = Math.max(1, filtro.pagina ?? 1);
  const porPagina = Math.min(500, Math.max(10, filtro.porPagina ?? 100));
  const ordenarPor = ORDENACOES[filtro.ordenarPor ?? "dia"] ? (filtro.ordenarPor ?? "dia") : "dia";
  const ordem = filtro.ordem === "desc" ? "desc" : "asc";
  const coluna = ORDENACOES[ordenarPor];

  const { sql: where, params } = condicoes(filtro);

  // `cp_nome` existe só para a ordenação por contraparte poder referir uma
  // coluna estável — ordenar por uma expressão repetida no SELECT e no ORDER BY
  // é o tipo de duplicação que diverge no primeiro ajuste.
  const base = `
    FROM (SELECT a.*, a.contraparte AS cp_nome FROM fin_agenda_dia_v a) v
    WHERE ${where}`;

  const [linhas, contagem, dias, prova, ancora] = await Promise.all([
    query<LinhaSQL>(
      `SELECT v.* ${base}
        ORDER BY ${coluna} ${ordem} NULLS LAST, v.dia ASC, v.valor_cents DESC NULLS LAST, v.chave_dedupe
        LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}`,
      params
    ),
    query<LinhaSQL>(
      `SELECT count(*)::int AS total,
              sum(v.valor_cents) FILTER (WHERE v.entra_no_total AND v.direcao = 'receber')::bigint AS entrada,
              sum(v.valor_cents) FILTER (WHERE v.entra_no_total AND v.direcao = 'pagar')::bigint    AS saida,
              sum(v.valor_cents) FILTER (WHERE NOT v.entra_no_total)::bigint                        AS fora,
              count(*) FILTER (WHERE NOT v.entra_no_total)::int                                     AS fora_linhas
         ${base}`,
      params
    ),
    query<LinhaSQL>(
      `SELECT * FROM fin_agenda_resumo_dia_v WHERE dia BETWEEN $1::date AND $2::date ORDER BY dia`,
      [filtro.de, filtro.ate]
    ),
    query<LinhaSQL>(
      `SELECT * FROM fin_agenda_prova_v
        WHERE competencia BETWEEN date_trunc('month', $1::date) AND date_trunc('month', $2::date)
        ORDER BY competencia, direcao`,
      [filtro.de, filtro.ate]
    ),
    query<LinhaSQL>(
      `SELECT ancora_saldo_cents, ancora_ate, (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje
         FROM fin_agenda_resumo_dia_v WHERE dias_a_frente = 0 LIMIT 1`
    )
  ]);

  const c = contagem[0] ?? {};
  const provas: Prova[] = prova.map((r) => ({
    competencia: iso(r.competencia) ?? "",
    direcao: String(r.direcao) as Direcao,
    agendaCents: numOu0(r.agenda_cents),
    previsaoCents: numOu0(r.previsao_cents),
    agendaLinhas: numOu0(r.agenda_linhas),
    previsaoLinhas: numOu0(r.previsao_linhas),
    manualCents: numOu0(r.manual_cents),
    ajusteHumanoCents: numOu0(r.ajuste_humano_cents),
    deltaCents: numOu0(r.delta_cents),
    deltaExplicado: Boolean(r.delta_explicado),
    leitura: r.leitura === null ? null : String(r.leitura)
  }));

  const dado: AgendaPeriodo = {
    de: filtro.de,
    ate: filtro.ate,
    hoje: iso(ancora[0]?.hoje) ?? "",
    dias: dias.map(mapaDia),
    linhas: linhas.map(mapaLinha),
    total: numOu0(c.total),
    pagina,
    porPagina,
    ordenarPor,
    ordem,
    entradaCents: numOu0(c.entrada),
    saidaCents: numOu0(c.saida),
    liquidoCents: numOu0(c.entrada) - numOu0(c.saida),
    foraDaSomaCents: numOu0(c.fora),
    foraDaSomaLinhas: numOu0(c.fora_linhas),
    prova: provas,
    provaOk: provas.every((x) => x.deltaExplicado),
    ancoraSaldoCents: num(ancora[0]?.ancora_saldo_cents),
    ancoraAte: iso(ancora[0]?.ancora_ate)
  };

  return contrato({
    dominio: DOMINIO,
    dado,
    ressalvas: [
      "Some SOMENTE as linhas com entraNoTotal = true. Duas linhas com a mesma chaveDedupe são o MESMO dinheiro " +
        "visto por procedências diferentes — somar as duas é o defeito que já produziu R$ 1,27 milhão falso aqui.",
      "saldoPrevistoCents é NULL no passado por construção: o saldo de um dia que já passou é o extrato daquele dia, " +
        "não a âncora de hoje projetada para trás.",
      "A camada de SAÍDA da previsão cobre ~72% do que sai de verdade (migration 0079, dúvida 34). " +
        "O líquido futuro é OTIMISTA por construção."
    ]
  });
}

export async function getAgendaDia(dia: string): Promise<Contrato<{ dia: DiaAgenda | null; linhas: LinhaAgenda[] }>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO, { dia: null, linhas: [] }, "FINANCE_DATABASE_URL não configurada");
  }
  const [resumo, linhas] = await Promise.all([
    query<LinhaSQL>(`SELECT * FROM fin_agenda_resumo_dia_v WHERE dia = $1::date`, [dia]),
    query<LinhaSQL>(
      `SELECT * FROM fin_agenda_dia_v WHERE dia = $1::date
        ORDER BY entra_no_total DESC, direcao, valor_cents DESC NULLS LAST`,
      [dia]
    )
  ]);
  return contrato({
    dominio: `${DOMINIO}.dia`,
    dado: { dia: resumo[0] ? mapaDia(resumo[0]) : null, linhas: linhas.map(mapaLinha) }
  });
}

/**
 * As séries que se repetem.
 *
 * `tipo` vem da FONTE, nunca do detector: assinatura declarada no contrato,
 * parcelamento com fim declarado, e padrão apenas observado no histórico. Ler
 * isso do detector estatístico já superestimou a receita recorrente em 37%
 * nesta base — recorrente e parcelado têm densidade, dispersão e concentração
 * idênticas, e mesmo assim um acaba e o outro não.
 *
 * `fimDeclarado = false` com `fim = null` significa "não sei quando acaba", e
 * não "não acaba". A tela precisa dizer coisas diferentes nos dois casos.
 */
export async function getAgendaSeries(args?: {
  direcao?: Direcao;
  tipo?: string;
}): Promise<Contrato<{ series: Serie[]; porTipo: { tipo: string; direcao: string; n: number; mensalCents: number }[] }>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO, { series: [], porTipo: [] }, "FINANCE_DATABASE_URL não configurada");
  }
  const p: unknown[] = [];
  const c: string[] = [];
  if (args?.direcao) {
    p.push(args.direcao);
    c.push(`direcao = $${p.length}`);
  }
  if (args?.tipo) {
    p.push(args.tipo);
    c.push(`tipo = $${p.length}`);
  }
  const where = c.length ? `WHERE ${c.join(" AND ")}` : "";

  const [series, porTipo] = await Promise.all([
    query<LinhaSQL>(
      `SELECT * FROM fin_agenda_serie_v ${where}
        ORDER BY valor_tipico_cents DESC NULLS LAST LIMIT 500`,
      p
    ),
    query<LinhaSQL>(
      `SELECT tipo, direcao, count(*)::int AS n, sum(valor_tipico_cents)::bigint AS mensal
         FROM fin_agenda_serie_v ${where} GROUP BY 1,2 ORDER BY 1,2`,
      p
    )
  ]);

  return contrato({
    dominio: `${DOMINIO}.series`,
    dado: {
      series: series.map((r) => ({
        serieRef: String(r.serie_ref),
        serieTabela: String(r.serie_tabela),
        direcao: String(r.direcao) as Direcao,
        descricao: String(r.descricao ?? ""),
        contraparte: r.contraparte === null ? null : String(r.contraparte),
        categoria: r.categoria === null ? null : String(r.categoria),
        tipo: String(r.tipo),
        fimDeclarado: Boolean(r.fim_declarado),
        inicio: iso(r.start_month),
        fim: iso(r.end_month),
        diaDoMes: num(r.day_of_month),
        valorTipicoCents: num(r.valor_tipico_cents),
        ocorrencias: num(r.ocorrencias),
        ocorrenciasMedidas: num(r.ocorrencias_medidas),
        valorMedianoCents: num(r.valor_mediano_cents),
        valorMinCents: num(r.valor_min_cents),
        valorMaxCents: num(r.valor_max_cents),
        desvioPct: num(r.desvio_pct),
        primeiraOcorrencia: iso(r.primeira_ocorrencia),
        ultimaOcorrencia: iso(r.ultima_ocorrencia),
        mesesRestantes: num(r.meses_restantes),
        leituraDoFim: r.leitura_do_fim === null ? null : String(r.leitura_do_fim),
        totalEContado: Boolean(r.total_e_contado),
        status: r.status === null ? null : String(r.status)
      })),
      porTipo: porTipo.map((r) => ({
        tipo: String(r.tipo),
        direcao: String(r.direcao),
        n: numOu0(r.n),
        mensalCents: numOu0(r.mensal)
      }))
    },
    ressalvas: [
      "tipo vem da FONTE, não de detector estatístico. fimDeclarado = false com fim nulo significa " +
        '"não sei quando acaba", não "não acaba" — e a diferença entre assinatura e parcelamento já ' +
        "custou 37% de superestimativa nesta base.",
      "totalEContado = true significa que o número de parcelas foi CONTADO por nós: " +
        "fin_document.installment_total está vazio na base inteira, e chamar a contagem de declaração seria inventar uma."
    ]
  });
}

/** Só a prova, para quem quiser auditar sem baixar a agenda inteira. */
export async function getAgendaProva(): Promise<Contrato<{ prova: Prova[]; ok: boolean; duplicadas: number }>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO, { prova: [], ok: false, duplicadas: 0 }, "FINANCE_DATABASE_URL não configurada");
  }
  const [prova, dup] = await Promise.all([
    query<LinhaSQL>(`SELECT * FROM fin_agenda_prova_v ORDER BY competencia, direcao`),
    query<LinhaSQL>(
      `SELECT count(*)::int AS n FROM (
         SELECT entity_id, chave_dedupe FROM fin_agenda_dia_v
          WHERE entra_no_total GROUP BY 1,2 HAVING count(*) > 1) x`
    )
  ]);
  const linhas: Prova[] = prova.map((r) => ({
    competencia: iso(r.competencia) ?? "",
    direcao: String(r.direcao) as Direcao,
    agendaCents: numOu0(r.agenda_cents),
    previsaoCents: numOu0(r.previsao_cents),
    agendaLinhas: numOu0(r.agenda_linhas),
    previsaoLinhas: numOu0(r.previsao_linhas),
    manualCents: numOu0(r.manual_cents),
    ajusteHumanoCents: numOu0(r.ajuste_humano_cents),
    deltaCents: numOu0(r.delta_cents),
    deltaExplicado: Boolean(r.delta_explicado),
    leitura: r.leitura === null ? null : String(r.leitura)
  }));
  const duplicadas = numOu0(dup[0]?.n);
  return contrato({
    dominio: `${DOMINIO}.prova`,
    dado: { prova: linhas, ok: linhas.every((x) => x.deltaExplicado) && duplicadas === 0, duplicadas }
  });
}

export { ENTIDADE };
