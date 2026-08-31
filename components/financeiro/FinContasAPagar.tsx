"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CalendarCheck,
  CalendarClock,
  ChevronRight,
  CircleDashed,
  Cpu,
  CreditCard,
  Hammer,
  House,
  Landmark,
  ListFilter,
  ShieldAlert,
  Users
} from "lucide-react";

import type { ContaAPagar, ContasAPagar } from "@/lib/financeiro/contas-a-pagar";
/*
 * O vocabulário vem de `contas-a-pagar-eixos` e NÃO de `contas-a-pagar`, mesmo
 * este último reexportando `GRUPOS`. O reexport não atravessa a fronteira: o
 * corpo de `contas-a-pagar.ts` abre com `import "server-only"` (um módulo cujo
 * conteúdo é um `throw`) e puxa `./db` com o `pg` junto — importar VALOR de lá
 * num "use client" quebra o build. Só `import type` passa, porque some na
 * compilação, e é por isso que `ContaAPagar` acima pode vir do contrato.
 */
import {
  GRUPOS,
  MOTIVO_IMPEDIMENTO,
  NATUREZA_DA_VIEW,
  ordemDaNatureza,
  type GrupoContas
} from "@/lib/financeiro/contas-a-pagar-eixos";
import {
  PARTES,
  rotuloSubparte,
  subpartesVisiveis,
  type ParteCusto
} from "@/lib/financeiro/custo-empresa-partes";
import { brlCents, brlPrecise, dateLabel, monthKeyLabel, shortDateLabel } from "@/lib/financeiro/format";
import { urlDaOrigem } from "@/lib/url-origem";

import { SeloCamada } from "./Certeza";
import { KpiAnalise } from "./FinKpiAnalise";

/**
 * CONTAS A PAGAR — o mês inteiro que sai, nos blocos do Custo da empresa.
 *
 * ---------------------------------------------------------------------------
 * AS DUAS REGRAS QUE ESTA TELA EXISTE PARA OBEDECER
 * ---------------------------------------------------------------------------
 * 1. DOIS TOTAIS, NUNCA UM. Custo da empresa e caixa não são a mesma pergunta.
 *    Folha, DAS e fatura de cartão já são contadas em Pessoas, MEI e Cartões;
 *    elas aparecem aqui porque SAEM DO CAIXA, não para somar com o custo. Um
 *    KPI único juntando as duas coisas produziria um número que não bate com
 *    nenhuma outra tela da casa — é a razão escrita em `contas-a-pagar.ts`.
 *
 * 2. SÓ SOMA `entraNoTotal`. Quem decide o que soma é `fin_agenda_dia_v`
 *    (0104), que dá uma linha por (dia, item) e marca a perdedora do dedupe com
 *    o motivo escrito. A linha perdedora CONTINUA NA TELA, apagada e com o
 *    motivo no `title` — escondê-la faria o mês parecer menor do que é, e
 *    somá-la contaria a mesma obrigação duas vezes (foi assim que R$ 1,27
 *    milhão falso apareceu uma vez).
 *
 * ---------------------------------------------------------------------------
 * PROGRAMAR NÃO É PAGAR
 * ---------------------------------------------------------------------------
 * O botão registra uma `fin_payment_request`. Nada sai do banco por causa dele:
 * a 0075 diz que `aguardando_autorizacao` é onde o produto termina e a pessoa
 * vai para o aplicativo do Inter. O aviso está no topo E na barra de ação,
 * porque um aviso que só existe no topo não está na tela no instante do clique.
 */

const ICONE_GRUPO: Record<GrupoContas, typeof House> = {
  empresa: Building2,
  folha: Users,
  das: Landmark,
  cartao: CreditCard
};

const ICONE_PARTE: Record<ParteCusto, typeof House> = {
  padrao: House,
  obras: Hammer,
  consultoria: Cpu,
  organizar: CircleDashed
};

/**
 * Os estados de `fin_payment_request` (0075). `rejeitada` e `cancelada` não
 * chegam aqui — a consulta do contrato já as exclui do LEFT JOIN.
 */
const ROTULO_ORDEM: Record<string, string> = {
  rascunho: "rascunho",
  em_aprovacao: "em aprovação",
  aprovada: "aprovada",
  em_lote: "em lote",
  aguardando_autorizacao: "aguardando você no banco",
  pago_parcial: "pago parcial",
  pago: "pago",
  devolvida: "devolvida"
};

/**
 * O CICLO INTEIRO DE UMA CONTA, EM SETE ESTADOS.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UM ESTADO SÓ, E NÃO TRÊS CAMPOS SOLTOS NA CÉLULA
 * ---------------------------------------------------------------------------
 * A coluna Situação mostrava `code` + `ROTULO_ORDEM[status]` para quem tem
 * ordem e "a programar" para quem não tem. Isso responde "existe ordem?", que
 * não é a pergunta do dono — a dele é "onde isso está?": falta cadastro, está
 * pronta, foi programada, foi ENVIADA ao Inter, ou o dinheiro SAIU. Cinco
 * respostas diferentes que cabiam em duas.
 *
 * Um estado único derivado permite as três coisas ao mesmo tempo: o selo da
 * linha, o chip de resumo com contagem e o filtro. Três leituras da MESMA
 * função — se elas divergirem, o chip mente sobre a lista.
 *
 * ---------------------------------------------------------------------------
 * A PRECEDÊNCIA É A MENSAGEM
 * ---------------------------------------------------------------------------
 * `pagoCents > 0` vem primeiro e vence até o `status`. Ele é mantido por
 * GATILHO a partir de `fin_payment_execution` (0075:219) e nunca escrito à
 * mão: se ele é positivo, houve execução registrada. Um `status` pode estar
 * atrasado em relação ao fato; a soma das execuções, não.
 *
 * `em_curso` é a rede de segurança dos estados que a 0075 tem e esta tabela
 * não nomeia (`em_aprovacao`, `aprovada`, `em_lote`, `devolvida`). Sem ele,
 * uma ordem nesses estados cairia em "falta cadastro" ou em "pronta" — dois
 * jeitos diferentes de convidar alguém a programar de novo o que já está no
 * banco.
 *
 * `a_confirmar` fica ABAIXO de `falta_cadastro` de propósito: falta de chave
 * PIX é fila de cadastro e não sai do lugar sozinha; "não confirmada" é fila
 * de decisão e o dono resolve no clique. Quando as duas valem para a mesma
 * linha, a que bloqueia é a que precisa ser dita.
 */
type EstadoCiclo =
  | "paga"
  | "aguardando"
  | "programada"
  | "em_curso"
  | "falta_cadastro"
  | "a_confirmar"
  | "pronta";

function estadoDoCiclo(l: ContaAPagar): EstadoCiclo {
  const o = l.ordem;
  if (o) {
    if (o.pagoCents > 0) return "paga";
    if (o.status === "aguardando_autorizacao") return "aguardando";
    if (o.status === "rascunho") return "programada";
    return "em_curso";
  }
  if (l.impedimento !== null) return "falta_cadastro";
  // `!entraNoTotal` com impedimento nulo é sempre `naoConfirmada`: a outra
  // metade do "não soma" (duplicada) já é impedimento e saiu acima.
  if (!l.entraNoTotal) return "a_confirmar";
  return "pronta";
}

/**
 * Os chips de ciclo, na ordem em que o trabalho anda: o que dá para fazer
 * agora primeiro, o que já está fora das suas mãos depois.
 *
 * `sempre` marca os cinco que aparecem MESMO EM ZERO. "Aguardando aprovação
 * (0)" é informação, não ruído: ele responde "não tem nada parado no meu app
 * do banco" sem a pessoa precisar abrir o aplicativo para descobrir. Os dois
 * de exceção (`a_confirmar` e `em_curso`) só aparecem quando existem — chip
 * zerado de estado raro é vocabulário que ninguém pediu.
 */
const CICLO: { slug: EstadoCiclo; nome: string; sempre: boolean; dica: string }[] = [
  {
    slug: "pronta",
    nome: "Pronta",
    sempre: true,
    dica: "tem favorecido e chave PIX, soma no mês, e nada foi programado ainda"
  },
  {
    slug: "a_confirmar",
    nome: "A confirmar",
    sempre: false,
    dica: "conta real que não soma no mês e que nenhuma outra linha conta — pagável, esperando a sua decisão"
  },
  {
    slug: "programada",
    nome: "Programada",
    sempre: true,
    dica: "a ordem existe aqui e AINDA NÃO foi entregue ao Inter"
  },
  {
    slug: "aguardando",
    nome: "Aguardando aprovação",
    sempre: true,
    dica: "entregue ao Inter — nada sai enquanto você não aprovar no aplicativo do banco"
  },
  {
    slug: "em_curso",
    nome: "Em curso no banco",
    sempre: false,
    dica: "a ordem está num estado intermediário da 0075 (em aprovação, aprovada, em lote, devolvida)"
  },
  {
    slug: "paga",
    nome: "Paga",
    sempre: true,
    dica: "há execução registrada: o dinheiro saiu, com data e end-to-end"
  },
  {
    slug: "falta_cadastro",
    nome: "Falta cadastro",
    sempre: true,
    dica: "não pode virar ordem — falta favorecido, chave PIX ou valor, ou outra linha já conta este dinheiro"
  }
];

/**
 * O EIXO DE FILTRO QUE O DONO PEDIU: "filtrar por salário, prolabore,
 * reembolsos, comissão, etc… para pagar todos reembolsos primeiro".
 *
 * É um eixo só, e não dois, porque o gesto é um só. Para gente ele é a
 * NATUREZA (o contrato já entrega o rótulo pronto e é ela que decide em
 * quantos PIX o pagamento se parte). Para o que não é gente — custo da
 * empresa, DAS, fatura — natureza é `null`, e aí o nome que a pessoa
 * reconhece é o da CATEGORIA. Misturar os dois num eixo só é o que permite
 * "Reembolso" e "Aluguel" serem clicáveis lado a lado.
 */
const SEM_EIXO = "Sem natureza";

/** Quantos chips de natureza/categoria cabem antes do "ver todos". */
const LIMITE_CHIPS = 12;

function eixoDaLinha(l: ContaAPagar): string {
  return l.natureza ?? l.categoriaNome ?? SEM_EIXO;
}

/**
 * Rótulo de natureza → posição na ordem de PAGAMENTO (`ordemDaNatureza`).
 *
 * O contrato guarda o slug (`salario`, `reembolso`) e manda para a tela o
 * rótulo (`Salário`, `Reembolso`); `ContaAPagar.natureza` é string livre, sem
 * o slug junto. Inverter `NATUREZA_DA_VIEW` recupera o slug a partir do
 * rótulo, e é o que deixa os chips saírem na ordem que a casa paga — salário
 * e pró-labore primeiro, reembolso por último — em vez da alfabética ou da
 * ordem de chegada.
 *
 * As duas entradas manuais existem porque há DOIS vocabulários: a view emite
 * a banda `encargo_beneficio` ("Encargos e benefícios") e `naturezaDe`, lendo
 * a categoria, emite "Encargos" (6.03) e "Benefícios" (6.04) separados. Sem
 * elas, esses dois cairiam no fim, no meio das categorias de custo.
 */
const ORDEM_DO_ROTULO: Record<string, number> = (() => {
  const mapa: Record<string, number> = {};
  for (const [slug, rotulo] of Object.entries(NATUREZA_DA_VIEW)) mapa[rotulo] = ordemDaNatureza(slug);
  mapa["Encargos"] = ordemDaNatureza("encargo_beneficio");
  mapa["Benefícios"] = ordemDaNatureza("encargo_beneficio");
  return mapa;
})();

/**
 * O TOTAL DE UM RECORTE, SEM CONTAR A MESMA OBRIGAÇÃO DUAS VEZES.
 *
 * Não é `somarNoTotal`: aquele exige `entraNoTotal`, e isso zeraria as contas
 * "a confirmar" — 31 linhas de R$ 40.044,75 em set/26, que são conta de
 * verdade e ninguém conta por elas. Aqui só sai a DUPLICATA, que é a única
 * metade do "não soma" onde a mesma obrigação aparece duas vezes na lista.
 *
 * Sem este corte, o chip "Pró-labore" somaria a projeção agregada da 0077
 * junto com a composição do cadastro — R$ 439.556,81 em cima de R$ 105.654,76,
 * o mesmo salário contado duas vezes num número que a barra oferece como
 * resposta a "quanto é pagar todos os pró-labores".
 */
function somarSemDuplicata(linhas: ContaAPagar[]): number {
  return linhas.reduce((s, l) => (l.impedimento === "duplicada" ? s : s + l.valorCents), 0);
}

/** Um chip da barra de filtro: o rótulo, quanto é, e quanto disso dá para pagar. */
type Chip = {
  chave: string;
  n: number;
  cents: number;
  /** Quantas das `n` ficaram FORA de `cents` por já serem contadas por outra linha. */
  duplicadas: number;
  prontas: number;
  prontasCents: number;
  /** Natureza vem antes de categoria, sempre — ver `ordenarChips`. */
  ehNatureza: boolean;
  rank: number;
};

function acumularChip(mapa: Map<string, Chip>, chave: string, l: ContaAPagar): void {
  const c: Chip = mapa.get(chave) ?? {
    chave,
    n: 0,
    cents: 0,
    duplicadas: 0,
    prontas: 0,
    prontasCents: 0,
    ehNatureza: l.natureza !== null,
    rank: ORDEM_DO_ROTULO[chave] ?? Number.MAX_SAFE_INTEGER
  };
  // A contagem inclui a duplicata (ela CONTINUA na lista quando o chip é
  // clicado); o valor não. O `title` do chip diz que os dois números têm bases
  // diferentes — o contrário, um total que soma o que a tela apaga, seria a
  // primeira mentira que alguém acreditaria.
  c.n += 1;
  if (l.impedimento === "duplicada") c.duplicadas += 1;
  else c.cents += l.valorCents;
  if (podeProgramar(l)) {
    c.prontas += 1;
    c.prontasCents += l.valorCents;
  }
  mapa.set(chave, c);
}

/**
 * Natureza primeiro e na ordem de pagamento; categoria depois, por total.
 *
 * O desempate por valor decrescente serve às categorias de custo, que não têm
 * ordem canônica nenhuma — e aí o maior número é o critério útil: quem abre a
 * barra quer ver primeiro o que pesa.
 */
function ordenarChips(chips: Chip[]): Chip[] {
  return chips.sort((a, b) => {
    if (a.ehNatureza !== b.ehNatureza) return a.ehNatureza ? -1 : 1;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return b.cents - a.cents;
  });
}

/** Diferença em dias entre duas datas ISO, sem passar por fuso. */
function diasEntre(de: string, ate: string): number {
  const [a1, m1, d1] = de.slice(0, 10).split("-").map(Number);
  const [a2, m2, d2] = ate.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * O próximo dia `dia` do mês que ainda não passou.
 *
 * "Dia 5" e "Dia 20" são os dois vencimentos que a casa usa, e no dia 28 o
 * atalho tem de saltar para o mês seguinte — senão ele produz uma data no
 * passado, que `min` recusa e o banco também. Dia útil NÃO é calculado de
 * propósito: o feriado bancário não está em lugar nenhum desta base, e um
 * "próximo dia útil" errado é pior que uma data que a pessoa ajusta no campo
 * ao lado.
 */
function proximoDiaDoMes(hoje: string, dia: number): string {
  const [a, m, d] = hoje.slice(0, 10).split("-").map(Number);
  const alvo = d <= dia ? Date.UTC(a, m - 1, dia) : Date.UTC(a, m, dia);
  return new Date(alvo).toISOString().slice(0, 10);
}

/** A linha com identidade estável para React e para a seleção. */
type LinhaCap = ContaAPagar & { id: string };

/**
 * O que a rota devolve. Os campos vêm opcionais de propósito: a tela não pode
 * quebrar por causa da forma da resposta no dia em que a rota mudar — ela
 * mostra as três contagens e, se `recusadas` vier vazia ou ausente, some a
 * lista, não a tela.
 */
type RespostaProgramar = {
  criadas?: { id?: number; code?: string }[];
  jaExistiam?: { id?: number; code?: string }[];
  recusadas?: { chaveDedupe?: string; motivo?: string }[];
  /** Preenchido depois do envio ao Inter, na segunda etapa do mesmo clique. */
  enviadas?: { id?: number; code?: string; codigoSolicitacao?: string | null }[];
  falharamNoEnvio?: { id?: number; motivo?: string }[];
  error?: string;
};

function podeProgramar(l: ContaAPagar): boolean {
  return l.impedimento === null && l.ordem === null;
}

function somarNoTotal(linhas: ContaAPagar[]): number {
  return linhas.reduce((s, l) => (l.entraNoTotal ? s + l.valorCents : s), 0);
}

function agruparPorGrupo(linhas: LinhaCap[]): Map<GrupoContas, LinhaCap[]> {
  const mapa = new Map<GrupoContas, LinhaCap[]>();
  for (const l of linhas) {
    const lista = mapa.get(l.grupo) ?? [];
    lista.push(l);
    mapa.set(l.grupo, lista);
  }
  return mapa;
}

/**
 * Soma só o que o teste aceita.
 *
 * Substituiu um `somarFora` que juntava TUDO que não soma num número só. Era o
 * mesmo erro que `naoConfirmada` veio consertar: "não soma" são dois estados
 * opostos — duplicata (pagar as duas paga em dobro) e conta real esperando
 * confirmação. Medido em 31/08/2026, competência 2026-09: 3 duplicatas de
 * R$ 5.900,00 contra 31 a confirmar de R$ 40.044,75. Um número só chamava as
 * 31 de duplicata.
 */
function somarSe(linhas: ContaAPagar[], teste: (l: ContaAPagar) => boolean): number {
  return linhas.reduce((s, l) => (teste(l) ? s + l.valorCents : s), 0);
}

/**
 * DE ONDE VEM CADA LINHA DO BLOCO PESSOAS.
 *
 * Chegam três procedências, e elas NÃO valem o mesmo:
 *
 *   composicao  `pagar_folha_composicao` — uma linha por (pessoa × natureza),
 *               do cadastro de cada pessoa via `fin_time_remuneracao_mes_v`
 *               (0163). É A FOLHA: soma no total, e é o que o dono escolheu em
 *               31/08/2026 ("os valores a serem pagos por pessoa são justamente
 *               os previstos que temos no app pessoal e no cadastro pessoal de
 *               cada um"). Fecha agosto em R$ 105.654,76 contra R$ 105.455,00
 *               de 6.x realmente pagos — 0,2% de erro.
 *   agregada    `pagar_folha` — a projeção velha de `fin_folha_previsao_v`
 *               (0077): R$ 439.556,81, idênticos em todos os meses, ~5x acima
 *               do que sai (AGENTS.md, item 000). O contrato agora a marca como
 *               `duplicada` e ela NÃO soma. Continua na tela, discreta e no fim
 *               do bloco: esconder uma divergência de R$ 333 mil é pior que
 *               mostrá-la.
 *   recorrente  `pagar_recorrente` de categoria 6.x — o que está cadastrado
 *               como recorrente de gente e ainda não foi confirmado no mês.
 *
 * O corte é por `camada` e nunca por `natureza`: a agregada também carrega
 * categoria 6.x em 12 das 26 linhas de set/26, e cortar por natureza chamaria a
 * projeção inteira do Fernando (R$ 35.046,35) de "Pró-labore" — rótulo certo da
 * categoria, leitura errada da linha.
 */
type LeituraFolha = "composicao" | "agregada" | "recorrente";

function leituraDaFolha(l: ContaAPagar): LeituraFolha | null {
  if (l.camada === "pagar_folha_composicao") return "composicao";
  if (l.camada === "pagar_folha") return "agregada";
  if (l.camada === "pagar_recorrente") return "recorrente";
  return null;
}

const ROTULO_LEITURA: Record<LeituraFolha, string> = {
  composicao: "cadastro da pessoa",
  agregada: "projeção agregada antiga",
  recorrente: "recorrente cadastrada"
};

const EXPLICA_LEITURA: Record<LeituraFolha, string> = {
  composicao:
    "a composição do cadastro de cada pessoa (fin_time_remuneracao_mes_v, 0163) — fecha agosto a 0,2% do que realmente saiu, e é esta que soma",
  agregada:
    "a projeção agregada de fin_folha_previsao_v (0077), ~5x acima do que sai e igual em todos os meses — não soma mais",
  recorrente:
    "uma recorrente de categoria 6.x cadastrada para esta pessoa, ainda não confirmada no mês"
};

export function FinContasAPagar({ dados }: { dados: ContasAPagar }) {
  const router = useRouter();

  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [quando, setQuando] = useState(dados.hoje);
  const [emVoo, setEmVoo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<RespostaProgramar | null>(null);
  /* Os dois filtros são MULTI-SELEÇÃO e independentes: "Salário + Pró-labore"
     é um gesto que o dono descreveu, e "só o que está pronta" cruza com ele. */
  const [eixosFiltrados, setEixosFiltrados] = useState<Set<string>>(new Set());
  const [ciclosFiltrados, setCiclosFiltrados] = useState<Set<EstadoCiclo>>(new Set());
  const [verTodosEixos, setVerTodosEixos] = useState(false);

  /*
   * `chaveDedupe` identifica a OBRIGAÇÃO, e a linha perdedora do dedupe pode
   * repetir a do vencedor. O índice desempata para a key do React; só o
   * vencedor é selecionável, então a seleção nunca fica ambígua.
   */
  const linhas: LinhaCap[] = useMemo(
    () => dados.linhas.map((l, i) => ({ ...l, id: `${l.chaveDedupe}#${i}` })),
    [dados.linhas]
  );

  /*
   * OS FILTROS CORTAM A LISTA, NÃO OS KPIs.
   *
   * `porGrupoTudo` é o mês inteiro e alimenta os três indicadores; `porGrupo`
   * é o que passou pelo filtro e alimenta os blocos. Deixar o filtro mexer no
   * KPI faria "Total que sai no mês" dizer R$ 7.193 quando o mês é R$ 154 mil
   * — um número certo sob um rótulo que mente. A barra de filtro carrega o seu
   * próprio total, e é ele que responde "quanto é o que estou vendo".
   */
  const porGrupoTudo = useMemo(() => agruparPorGrupo(linhas), [linhas]);

  const filtroAtivo = eixosFiltrados.size > 0 || ciclosFiltrados.size > 0;

  const visiveis = useMemo(
    () =>
      linhas.filter(
        (l) =>
          (eixosFiltrados.size === 0 || eixosFiltrados.has(eixoDaLinha(l))) &&
          (ciclosFiltrados.size === 0 || ciclosFiltrados.has(estadoDoCiclo(l)))
      ),
    [linhas, eixosFiltrados, ciclosFiltrados]
  );

  const porGrupo = useMemo(() => agruparPorGrupo(visiveis), [visiveis]);

  /** Um chip por natureza/categoria presente no mês — contagem e total. */
  const chipsEixo = useMemo(() => {
    const mapa = new Map<string, Chip>();
    for (const l of linhas) acumularChip(mapa, eixoDaLinha(l), l);
    return ordenarChips([...mapa.values()]);
  }, [linhas]);

  /*
   * A barra corta em 12 chips. Medido em 31/08/2026: 7 naturezas + as
   * categorias de custo da empresa passam de 20 rótulos em algumas
   * competências, e uma barra de filtro com quatro linhas de altura empurra a
   * lista para fora da tela — o oposto do que ela existe para fazer. Chip
   * MARCADO nunca é escondido, senão o filtro ficaria ativo e invisível.
   */
  const eixosMostrados = useMemo(() => {
    if (verTodosEixos || chipsEixo.length <= LIMITE_CHIPS) return chipsEixo;
    const topo = chipsEixo.slice(0, LIMITE_CHIPS);
    return [...topo, ...chipsEixo.slice(LIMITE_CHIPS).filter((c) => eixosFiltrados.has(c.chave))];
  }, [chipsEixo, verTodosEixos, eixosFiltrados]);

  /** Um chip por estado do ciclo. Os cinco canônicos aparecem mesmo em zero. */
  const chipsCiclo = useMemo(() => {
    const contagem = new Map<EstadoCiclo, { n: number; cents: number }>();
    for (const l of linhas) {
      const e = estadoDoCiclo(l);
      const atual = contagem.get(e) ?? { n: 0, cents: 0 };
      // Mesmo corte de `somarSemDuplicata`: `falta_cadastro` recolhe TODAS as
      // duplicatas (duplicada É impedimento), e sem isto o chip dele carregaria
      // a projeção de R$ 439.556,81 da 0077 como se fosse dinheiro a pagar.
      contagem.set(e, {
        n: atual.n + 1,
        cents: atual.cents + (l.impedimento === "duplicada" ? 0 : l.valorCents)
      });
    }
    return CICLO.map((c) => ({ ...c, ...(contagem.get(c.slug) ?? { n: 0, cents: 0 }) })).filter(
      (c) => c.sempre || c.n > 0
    );
  }, [linhas]);

  const visiveisCents = somarSemDuplicata(visiveis);

  const empresaCents = somarNoTotal(porGrupoTudo.get("empresa") ?? []);
  const foraCents =
    somarNoTotal(porGrupoTudo.get("folha") ?? []) +
    somarNoTotal(porGrupoTudo.get("das") ?? []) +
    somarNoTotal(porGrupoTudo.get("cartao") ?? []);
  /*
   * As duas metades de "não soma", separadas — ver `somarSe`. A frase antiga
   * dizia "N linhas que outra linha já conta" sobre as duas, e em set/26 isso
   * era falso para 31 das 34: a consulta de disputa de chave devolveu
   * "vencedora: NENHUMA" para todas elas.
   */
  const duplicadas = linhas.filter((l) => l.impedimento === "duplicada");
  const aConfirmar = linhas.filter((l) => l.naoConfirmada);
  const duplicadasCents = somarSe(linhas, (l) => l.impedimento === "duplicada");
  const aConfirmarCents = somarSe(linhas, (l) => l.naoConfirmada);

  const elegiveis = useMemo(() => linhas.filter(podeProgramar), [linhas]);
  /*
   * "SELECIONAR TUDO" RESPEITA O FILTRO — é o fluxo inteiro do dono.
   *
   * Ele descreveu assim: "filtra Reembolso → seleciona tudo → paga; depois
   * Salário → repete". Um "tudo" que ignorasse o filtro marcaria a folha
   * inteira no primeiro clique e transformaria o filtro em decoração.
   */
  const elegiveisVisiveis = useMemo(() => visiveis.filter(podeProgramar), [visiveis]);
  const escolhidas = useMemo(
    () => elegiveis.filter((l) => selecionadas.has(l.id)),
    [elegiveis, selecionadas]
  );
  /*
   * Trocar o filtro NÃO desmarca o que já estava marcado — mas a barra de ação
   * precisa dizer quantas ficaram atrás do filtro. Um botão que diz "12 linhas"
   * enquanto a tela mostra 4 é a forma mais barata de pagar o que não se vê.
   */
  const idsVisiveis = useMemo(() => new Set(visiveis.map((l) => l.id)), [visiveis]);
  const escolhidasOcultas = escolhidas.filter((l) => !idsVisiveis.has(l.id)).length;
  const totalEscolhidoCents = escolhidas.reduce((s, l) => s + l.valorCents, 0);
  const recusadas = resultado?.recusadas ?? [];

  /*
   * Os quatro atalhos de data. `dados.hoje` é a data do SERVIDOR e é a única
   * que vale aqui: o `min` do input e o que a rota valida saem dela, e o
   * relógio do navegador de quem abre a tela de outro fuso não pode empurrar
   * um agendamento para ontem.
   */
  const atalhosDeData = useMemo(() => {
    const hoje = dados.hoje;
    if (!hoje) return [] as { rotulo: string; data: string }[];
    return [
      { rotulo: "Hoje", data: hoje },
      { rotulo: "Amanhã", data: somarDias(hoje, 1) },
      { rotulo: "Dia 5", data: proximoDiaDoMes(hoje, 5) },
      { rotulo: "Dia 20", data: proximoDiaDoMes(hoje, 20) }
    ];
  }, [dados.hoje]);

  /* O input tem `min`, mas `min` só barra as setinhas — teclado e colagem
     passam. A data no passado é recusada aqui também, e o botão desliga. */
  const dataNoPassado = Boolean(quando && dados.hoje && quando < dados.hoje);
  const podeEnviar = Boolean(quando) && !dataNoPassado;

  /* O filtro dito por extenso, para o "Selecionar tudo" poder se nomear. Três
     nomes e reticências: o rótulo de um checkbox não é lugar de lista longa. */
  const nomesDoFiltro = [
    ...eixosFiltrados,
    ...[...ciclosFiltrados].map((s) => CICLO.find((c) => c.slug === s)?.nome ?? s)
  ];
  const resumoFiltro =
    nomesDoFiltro.length > 3
      ? `${nomesDoFiltro.slice(0, 3).join(" + ")} +${nomesDoFiltro.length - 3}`
      : nomesDoFiltro.join(" + ");

  /*
   * POR QUE NADA PODE SER MARCADO — dito com nome e contagem.
   *
   * Medido em 31/08/2026: `fin_payee_account` tem ZERO linhas. `impedimentoDe`
   * exige `payeeAccountId` para liberar a linha, então as 45 partes da folha de
   * set/26 e todo o resto da tela caem em "sem chave PIX", e o "Selecionar tudo"
   * aparece com (0), desabilitado e mudo.
   *
   * Esta tela não conserta isso — não existe cadastro de chave PIX em nenhum
   * lugar do app ainda —, mas tem de NOMEAR o que falta. Um botão desabilitado
   * sem motivo manda a pessoa procurar o defeito no lugar errado, que aqui
   * seria a composição da folha recém-trocada.
   */
  const motivosBloqueio = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const l of linhas) {
      if (podeProgramar(l) || l.ordem) continue;
      contagem.set(
        l.impedimento ? MOTIVO_IMPEDIMENTO[l.impedimento] : "sem motivo declarado",
        (contagem.get(l.impedimento ? MOTIVO_IMPEDIMENTO[l.impedimento] : "sem motivo declarado") ?? 0) + 1
      );
    }
    return [...contagem.entries()].sort((a, b) => b[1] - a[1]);
  }, [linhas]);

  if (!dados.disponivel) {
    return (
      <section className="card fin-empty">
        <h2 className="card-title">Contas a pagar indisponível</h2>
        <p>{dados.ressalva ?? "sem conexão com o banco do financeiro"}</p>
      </section>
    );
  }

  function trocarMes(mes: string) {
    setSelecionadas(new Set());
    setResultado(null);
    setErro(null);
    // A aba vive na querystring para o link ser colável — a mesma convenção de
    // FinPayables e das visões salvas (0004). O mês vai junto pela mesma razão.
    router.replace(`/financeiro/custos-empresa?aba=contas-a-pagar&mes=${mes}`, { scroll: false });
  }

  function alternarUma(id: string) {
    setSelecionadas((atual) => {
      const proxima = new Set(atual);
      if (proxima.has(id)) proxima.delete(id);
      else proxima.add(id);
      return proxima;
    });
  }

  function alternarVarias(ids: string[], marcar: boolean) {
    setSelecionadas((atual) => {
      const proxima = new Set(atual);
      for (const id of ids) {
        if (marcar) proxima.add(id);
        else proxima.delete(id);
      }
      return proxima;
    });
  }

  /** Clicar marca, clicar de novo desmarca. Multi-seleção nos dois eixos. */
  function alternarEixo(chave: string) {
    setEixosFiltrados((atual) => {
      const proxima = new Set(atual);
      if (proxima.has(chave)) proxima.delete(chave);
      else proxima.add(chave);
      return proxima;
    });
  }

  function alternarCiclo(slug: EstadoCiclo) {
    setCiclosFiltrados((atual) => {
      const proxima = new Set(atual);
      if (proxima.has(slug)) proxima.delete(slug);
      else proxima.add(slug);
      return proxima;
    });
  }

  function limparFiltros() {
    setEixosFiltrados(new Set());
    setCiclosFiltrados(new Set());
  }

  async function programar() {
    if (!escolhidas.length || !podeEnviar) return;
    setEmVoo(true);
    setErro(null);
    setResultado(null);
    try {
      /*
       * Uma obrigação, um alvo. O índice único (entity_id, source, source_id)
       * da 0075 já transforma repetição em no-op do lado do banco; deduplicar
       * aqui evita fazer a rota decidir o que a tela já sabe.
       */
      const vistas = new Set<string>();
      const alvos = [];
      for (const l of escolhidas) {
        if (vistas.has(l.chaveDedupe)) continue;
        vistas.add(l.chaveDedupe);
        alvos.push({
          chaveDedupe: l.chaveDedupe,
          origemTabela: l.origemTabela,
          origemId: l.origemId,
          counterpartyId: l.counterpartyId,
          descricao: l.descricao,
          valorCents: l.valorCents,
          dueDate: l.dia,
          categoryId: l.categoryId,
          nucleo: l.nucleo
        });
      }

      // `urlDaOrigem` e não o path cru: a plataforma abre com Basic Auth, e um
      // fetch relativo herda o userinfo da barra de endereço — o Chromium
      // recusa a requisição inteira. Ver lib/url-origem.ts.
      const resposta = await fetch(urlDaOrigem("/api/financeiro/contas-a-pagar/programar"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledFor: quando, metodo: "pix", alvos })
      });
      const r = (await resposta.json()) as RespostaProgramar;
      if (!resposta.ok) throw new Error(r.error ?? "não programou");

      /*
       * SEGUNDA ETAPA DO MESMO CLIQUE: entregar as ordens ao Inter.
       *
       * O gesto do dono é um só — "seleciono o que vou pagar e mando para
       * aprovação". Duas etapas existem porque são dois fatos diferentes: a
       * ordem gravada no nosso banco (que não depende de rede) e a ordem
       * entregue ao banco (que depende). Separá-las é o que faz uma falha de
       * rede não perder a programação: as ordens ficam em `rascunho` e a guia
       * de Aprovações permite reenviar.
       *
       * E o envio NÃO paga. Ele para em `aguardando_autorizacao` — quem aprova
       * é você, no aplicativo do Inter.
       */
      const ids = (r.criadas ?? []).map((c) => c.id).filter((id): id is number => typeof id === "number");
      if (ids.length > 0) {
        const env = await fetch(urlDaOrigem("/api/financeiro/contas-a-pagar/programar"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acao: "enviar-lote", ids })
        });
        const e = (await env.json()) as {
          enviadas?: { id?: number; code?: string; codigoSolicitacao?: string | null }[];
          falharam?: { id?: number; motivo?: string }[];
          error?: string;
        };
        // Envio que falha não desfaz a programação: as ordens existem, em
        // rascunho, e o motivo aparece junto em vez de virar erro de tela.
        r.enviadas = e.enviadas ?? [];
        r.falharamNoEnvio = env.ok
          ? e.falharam ?? []
          : ids.map((id) => ({ id, motivo: e.error ?? "não enviou" }));
      }

      setResultado(r);
      setSelecionadas(new Set());
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não programou");
    } finally {
      setEmVoo(false);
    }
  }

  return (
    <>
      <header className="fin-cap-topo">
        <label className="fin-cap-mes">
          <span>Competência</span>
          <select
            className="fin-select"
            value={dados.competencia}
            onChange={(e) => trocarMes(e.target.value)}
          >
            {dados.meses.map((mes) => (
              <option key={mes} value={mes}>
                {monthKeyLabel(mes)}
              </option>
            ))}
          </select>
        </label>
        <CaixaTudo
          ids={elegiveisVisiveis.map((l) => l.id)}
          selecionadas={selecionadas}
          onAlternar={alternarVarias}
          rotulo={
            filtroAtivo
              ? `Selecionar tudo de ${resumoFiltro} (${elegiveisVisiveis.length})`
              : `Selecionar tudo (${elegiveisVisiveis.length})`
          }
          dica={
            filtroAtivo
              ? `Marca só o que está visível no filtro e pode virar ordem — ${elegiveisVisiveis.length} de ${visiveis.length} linhas.`
              : "Marca todas as linhas que podem virar ordem de pagamento — o resto fica de fora."
          }
        />
        <p className="fin-cap-topo-resumo">
          {filtroAtivo ? (
            <>
              {visiveis.length} de {linhas.length} {linhas.length === 1 ? "linha" : "linhas"}
            </>
          ) : (
            <>
              {linhas.length} {linhas.length === 1 ? "linha" : "linhas"}
            </>
          )}{" "}
          · hoje é {shortDateLabel(dados.hoje)}
        </p>
      </header>

      <p className="fin-cap-aviso" role="note">
        <ShieldAlert size={18} strokeWidth={2.2} aria-hidden />
        <span>
          <b>Programar aqui NÃO paga.</b> A ordem fica registrada e a aprovação é feita por você no
          aplicativo do Banco Inter.
        </span>
      </p>

      {/*
        A BARRA DE FILTRO E A DATA, ANTES DA SELEÇÃO.
        ---------------------------------------------------------------------
        O pedido do dono, em 31/08/2026: "quero poder selecionar, configurar o
        dia de agendamento do pagamento" e "que na categoria tenha os filtros
        para facilitar pagar por exemplo todos reembolsos primeiro, depois
        todos salários, depois todas comissões".

        As duas coisas moram na MESMA barra porque são um gesto só: escolher a
        data, filtrar a fatia, marcar tudo, pagar. A data ficava escondida
        dentro da barra de ação, que só nasce depois da primeira seleção — ou
        seja, ela só aparecia depois da hora em que decidir a data ainda era
        barato.
      */}
      {linhas.length > 0 ? (
        <section className="fin-cap-filtros" aria-label="Filtros e data de agendamento">
          <div className="fin-cap-filtro-linha">
            <span className="fin-cap-filtro-rot">
              <ListFilter size={13} strokeWidth={2.3} aria-hidden />
              Situação
            </span>
            <div className="fin-cap-chips" role="group" aria-label="Filtrar por situação">
              {chipsCiclo.map((c) => {
                const ativo = ciclosFiltrados.has(c.slug);
                return (
                  <button
                    key={c.slug}
                    type="button"
                    className={`fin-cap-chip fin-cap-chip-${c.slug}${ativo ? " ativo" : ""}`}
                    aria-pressed={ativo}
                    disabled={c.n === 0}
                    title={`${c.nome} — ${c.dica}${c.n ? ` · ${brlPrecise(c.cents)}` : ""}`}
                    onClick={() => alternarCiclo(c.slug)}
                  >
                    <b>{c.nome}</b>
                    <span className="fin-cap-chip-n">({c.n})</span>
                    {c.n > 0 ? <span className="fin-cap-chip-total">{brlCents(c.cents)}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="fin-cap-filtro-linha">
            <span className="fin-cap-filtro-rot">
              <ListFilter size={13} strokeWidth={2.3} aria-hidden />
              Natureza e categoria
            </span>
            <div className="fin-cap-chips" role="group" aria-label="Filtrar por natureza ou categoria">
              {eixosMostrados.map((c) => {
                const ativo = eixosFiltrados.has(c.chave);
                return (
                  <button
                    key={c.chave}
                    type="button"
                    className={`fin-cap-chip${c.ehNatureza ? " natureza" : ""}${ativo ? " ativo" : ""}`}
                    aria-pressed={ativo}
                    title={[
                      `${c.n} ${c.n === 1 ? "linha" : "linhas"} · ${brlPrecise(c.cents)}`,
                      c.duplicadas
                        ? `${c.duplicadas} fora do total — outra linha desta tela já conta`
                        : null,
                      `${c.prontas} ${c.prontas === 1 ? "pronta" : "prontas"} para virar ordem (${brlPrecise(c.prontasCents)})`
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    onClick={() => alternarEixo(c.chave)}
                  >
                    <b>{c.chave}</b>
                    <span className="fin-cap-chip-n">({c.n})</span>
                    <span className="fin-cap-chip-total">{brlCents(c.cents)}</span>
                  </button>
                );
              })}
              {chipsEixo.length > LIMITE_CHIPS ? (
                <button
                  type="button"
                  className="fin-cap-chip fin-cap-chip-mais"
                  onClick={() => setVerTodosEixos((v) => !v)}
                >
                  {verTodosEixos ? "ver menos" : `+${chipsEixo.length - LIMITE_CHIPS} categorias`}
                </button>
              ) : null}
            </div>
          </div>

          <div className="fin-cap-filtro-linha fin-cap-agenda">
            <label className="fin-cap-agenda-data">
              <span className="fin-cap-filtro-rot">
                <CalendarCheck size={13} strokeWidth={2.3} aria-hidden />
                Agendar para
              </span>
              <input
                type="date"
                className="fin-input fin-cap-data"
                value={quando}
                min={dados.hoje || undefined}
                disabled={emVoo}
                onChange={(e) => setQuando(e.target.value)}
              />
            </label>
            <div className="fin-cap-chips" role="group" aria-label="Atalhos de data">
              {atalhosDeData.map((a) => (
                <button
                  key={a.rotulo}
                  type="button"
                  className={quando === a.data ? "fin-cap-chip ativo" : "fin-cap-chip"}
                  disabled={emVoo}
                  title={dateLabel(a.data)}
                  onClick={() => setQuando(a.data)}
                >
                  {a.rotulo}
                </button>
              ))}
            </div>
            {/* O QUE VAI ACONTECER, POR EXTENSO. "12 pagamentos serão agendados
                para 05/09/2026" é a frase que a pessoa confere antes do clique
                — a data no input está em formato do navegador e a contagem só
                existia dentro do botão. */}
            <p className={dataNoPassado ? "fin-cap-agenda-frase erro" : "fin-cap-agenda-frase"}>
              {dataNoPassado ? (
                <>
                  <b>{dateLabel(quando)} já passou.</b> O agendamento tem de ser hoje (
                  {dateLabel(dados.hoje)}) ou à frente.
                </>
              ) : !quando ? (
                <>Escolha a data do agendamento.</>
              ) : escolhidas.length ? (
                <>
                  <b>
                    {escolhidas.length}{" "}
                    {escolhidas.length === 1 ? "pagamento será agendado" : "pagamentos serão agendados"}
                  </b>{" "}
                  para <b>{dateLabel(quando)}</b> · {brlPrecise(totalEscolhidoCents)}
                </>
              ) : (
                <>
                  Nada marcado ainda — o que você marcar será agendado para{" "}
                  <b>{dateLabel(quando)}</b>.
                </>
              )}
            </p>
          </div>

          {filtroAtivo ? (
            <p className="fin-cap-filtro-ativo" role="status">
              <b>{visiveis.length}</b> de {linhas.length} linhas · <b>{brlCents(visiveisCents)}</b> ·{" "}
              {elegiveisVisiveis.length}{" "}
              {elegiveisVisiveis.length === 1 ? "pronta para virar ordem" : "prontas para virar ordem"}
              <button type="button" className="fin-cap-limpar" onClick={limparFiltros}>
                limpar filtros
              </button>
            </p>
          ) : null}
        </section>
      ) : null}

      {linhas.length > 0 && elegiveis.length === 0 ? (
        <p className="fin-cap-bloqueio" role="note">
          <ShieldAlert size={16} strokeWidth={2.2} aria-hidden />
          <span>
            <b>Nenhuma linha desta competência pode virar ordem de pagamento.</b>{" "}
            {motivosBloqueio
              .map(([motivo, n]) => `${n} ${n === 1 ? "linha" : "linhas"} ${motivo}`)
              .join(" · ")}
            . A lista continua toda aqui para conferência — o que falta é cadastro, não
            decisão.
          </span>
        </p>
      ) : null}

      <section className="fin-pessoas-kpis" aria-label="Indicadores de contas a pagar">
        <div className="fin-pessoas-kpi-faixa">
          <KpiAnalise
            destaque
            rotulo="Custo da empresa"
            valor={brlCents(empresaCents)}
            delta={
              <p className="fin-delta neutro">
                {(porGrupoTudo.get("empresa") ?? []).length}{" "}
                {(porGrupoTudo.get("empresa") ?? []).length === 1 ? "linha" : "linhas"} ·{" "}
                {monthKeyLabel(dados.competencia)}
              </p>
            }
            extra={
              <p className="fin-pessoas-kpi-extra">Os mesmos blocos da matriz, olhando para frente.</p>
            }
            pontos={[]}
            crescimento={null}
            ariaSpark="Custo da empresa a pagar no mês"
          />
          <KpiAnalise
            rotulo="Fora do custo da empresa"
            valor={brlCents(foraCents)}
            delta={
              <p className="fin-delta neutro">
                folha, DAS e fatura de cartão <span>não somam com o custo</span>
              </p>
            }
            extra={
              <p className="fin-pessoas-kpi-extra">
                Já contadas em <a className="pp-link" href="/financeiro/pessoas">Pessoas</a>,{" "}
                <a className="pp-link" href="/financeiro/mei">MEI</a> e{" "}
                <a className="pp-link" href="/financeiro/cartoes">Cartões</a>. Aqui só porque saem do
                caixa.
              </p>
            }
            pontos={[]}
            crescimento={null}
            ariaSpark="Saídas contadas em outras telas"
          />
          <KpiAnalise
            rotulo="Total que sai no mês"
            valor={brlCents(empresaCents + foraCents)}
            delta={<p className="fin-delta neutro">caixa, não custo</p>}
            extra={
              <p className="fin-pessoas-kpi-extra">
                A soma dos dois acima. É o que deixa a conta em{" "}
                {monthKeyLabel(dados.competencia)}.
                {aConfirmar.length ? (
                  <>
                    {" "}
                    Fora daqui: {aConfirmar.length}{" "}
                    {aConfirmar.length === 1 ? "linha" : "linhas"} de{" "}
                    {brlCents(aConfirmarCents)} <b>a confirmar</b> — conta de verdade que
                    ninguém está contando.
                  </>
                ) : null}
                {duplicadas.length ? (
                  <>
                    {" "}
                    E {duplicadas.length} {duplicadas.length === 1 ? "duplicata" : "duplicatas"}{" "}
                    de {brlCents(duplicadasCents)} cujo compromisso outra linha desta tela já
                    conta.
                  </>
                ) : null}
              </p>
            }
            pontos={[]}
            crescimento={null}
            ariaSpark="Total de caixa do mês"
          />
        </div>
      </section>

      {escolhidas.length ? (
        <div className="fin-custo-mover fin-cap-barra" role="region" aria-label="Realizar pagamento">
          <b>
            {escolhidas.length} {escolhidas.length === 1 ? "linha" : "linhas"}
          </b>
          <span className="fin-cap-barra-total">{brlPrecise(totalEscolhidoCents)}</span>
          {/* O MESMO CAMPO DA BARRA DE FILTRO, REPETIDO ONDE O DEDO ESTÁ.
              Mesmo argumento do aviso duplicado logo abaixo: a barra de filtro
              rola para fora da tela e o botão fica; um agendamento cuja data
              não está visível no instante do clique é um agendamento no
              escuro. Os dois inputs leem e escrevem o MESMO `quando`. */}
          <label>
            Pagar em
            <input
              type="date"
              className="fin-input fin-cap-data"
              value={quando}
              min={dados.hoje || undefined}
              disabled={emVoo}
              onChange={(e) => setQuando(e.target.value)}
            />
          </label>
          {escolhidasOcultas > 0 ? (
            <span className="fin-cap-barra-ocultas" title="o filtro esconde parte do que está marcado — elas continuam no envio">
              {escolhidasOcultas} fora do filtro
            </span>
          ) : null}
          <button
            type="button"
            className="fin-btn-primary"
            disabled={emVoo || !podeEnviar}
            title={dataNoPassado ? `${dateLabel(quando)} já passou` : undefined}
            onClick={() => void programar()}
          >
            {emVoo ? "Enviando…" : "Realizar pagamento (enviar para aprovação)"}
          </button>
          <button
            type="button"
            className="fin-btn-ghost"
            disabled={emVoo}
            onClick={() => {
              setSelecionadas(new Set());
              setErro(null);
            }}
          >
            Limpar
          </button>
          {/* O aviso do topo repetido onde o dedo está. Um aviso que só existe
              no alto da página não está na tela no instante do clique. */}
          <span className="fin-cap-barra-nota">
            {quando && !dataNoPassado ? (
              <>
                {escolhidas.length}{" "}
                {escolhidas.length === 1 ? "pagamento será agendado" : "pagamentos serão agendados"} para{" "}
                <b>{dateLabel(quando)}</b> ·{" "}
              </>
            ) : null}
            registra a ordem · quem aprova é você, no Inter
          </span>
          {erro ? <span className="fin-badge-atencao">{erro}</span> : null}
        </div>
      ) : null}

      {resultado ? (
        <div className="fin-cap-resultado" role="status">
          <p className="fin-cap-resultado-contagens">
            <b>{resultado.criadas?.length ?? 0}</b> programadas ·{" "}
            <b>{resultado.jaExistiam?.length ?? 0}</b> já existiam ·{" "}
            <b>{recusadas.length}</b> recusadas
          </p>
          {/* Recusada precisa dizer POR QUE. Uma contagem sem motivo devolve à
              pessoa o trabalho de descobrir o que o servidor já sabia. */}
          {recusadas.length ? (
            <ul className="fin-cap-recusadas">
              {recusadas.map((r, i) => (
                <li key={`${r.chaveDedupe ?? "sem-chave"}#${i}`}>
                  <b>{nomeDaChave(linhas, r.chaveDedupe)}</b> — {r.motivo ?? "sem motivo informado"}
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="fin-btn-ghost" onClick={() => setResultado(null)}>
            Fechar
          </button>
        </div>
      ) : null}

      {linhas.length === 0 ? (
        <section className="card fin-empty">
          <h2 className="card-title">Nada a pagar em {monthKeyLabel(dados.competencia)}</h2>
          <p>{dados.ressalva ?? "nenhuma saída prevista nesta competência"}</p>
        </section>
      ) : null}

      {/* Filtro que não casa com nada precisa dizer que é o FILTRO, e não o
          mês — senão ele se lê como "não há contas em setembro". */}
      {linhas.length > 0 && visiveis.length === 0 ? (
        <section className="card fin-empty">
          <h2 className="card-title">Nenhuma linha em {resumoFiltro}</h2>
          <p>
            As {linhas.length} linhas de {monthKeyLabel(dados.competencia)} continuam aqui — é o
            filtro que não casa com nenhuma.{" "}
            <button type="button" className="fin-cap-limpar" onClick={limparFiltros}>
              limpar filtros
            </button>
          </p>
        </section>
      ) : null}

      {/* Na ordem de `GRUPOS`: o assunto da aba primeiro, o caixa alheio
          depois. Bloco vazio não aparece — uma seção "Fatura de cartão · 0
          linhas" só ocupa espaço para dizer que não há nada. */}
      {GRUPOS.map((meta) => {
        const doGrupo = porGrupo.get(meta.slug) ?? [];
        if (!doGrupo.length) return null;
        const Icone = ICONE_GRUPO[meta.slug];
        const idsElegiveis = doGrupo.filter(podeProgramar).map((l) => l.id);

        return (
          <section key={meta.slug} className="fin-custo-parte">
            <header className="fin-custo-parte-cab">
              <span className="fin-custo-parte-icone" aria-hidden>
                <Icone size={15} strokeWidth={2.1} />
              </span>
              <div className="fin-cap-grupo-texto">
                <h2 className="fin-custo-parte-titulo">
                  {meta.nome}
                  {/* O selo diz "já contado" e leva à tela que conta, sem
                      renomeá-la: `ondeJaEConta` é rota, não rótulo, e inventar
                      um nome aqui divergiria da tela de destino no primeiro
                      rename dela. É o mesmo "abrir" da tabela "Fora deste
                      total" em FinCustosEmpresa. */}
                  {meta.ondeJaEConta ? (
                    <a
                      className="fin-cap-selo-onde"
                      href={meta.ondeJaEConta}
                      title={`esta saída já é contada em ${meta.ondeJaEConta}`}
                    >
                      já contado — abrir
                    </a>
                  ) : null}
                </h2>
                <p className="fin-custo-parte-dica">
                  {meta.dica} · {doGrupo.length} {doGrupo.length === 1 ? "linha" : "linhas"} ·{" "}
                  {brlPrecise(somarNoTotal(doGrupo))}
                </p>
              </div>
              <CaixaTudo
                ids={idsElegiveis}
                selecionadas={selecionadas}
                onAlternar={alternarVarias}
                rotulo={`Bloco (${idsElegiveis.length})`}
                dica="Marca só as linhas deste bloco que podem virar ordem."
              />
            </header>

            {meta.slug === "empresa" ? (
              <BlocosDaMatriz
                linhas={doGrupo}
                hoje={dados.hoje}
                selecionadas={selecionadas}
                onAlternar={alternarUma}
              />
            ) : meta.slug === "folha" ? (
              <BlocoPessoas
                linhas={doGrupo}
                competencia={dados.competencia}
                folhaMolde={dados.folhaMolde}
                hoje={dados.hoje}
                selecionadas={selecionadas}
                onAlternar={alternarUma}
                onAlternarVarias={alternarVarias}
              />
            ) : (
              <TabelaContas
                blocos={[{ chave: meta.slug, cabecalho: null, linhas: doGrupo }]}
                hoje={dados.hoje}
                selecionadas={selecionadas}
                onAlternar={alternarUma}
              />
            )}
          </section>
        );
      })}
    </>
  );
}

/** O nome que a pessoa reconhece, no lugar da chave técnica da recusa. */
function nomeDaChave(linhas: LinhaCap[], chave: string | undefined): string {
  if (!chave) return "linha sem chave";
  const achada = linhas.find((l) => l.chaveDedupe === chave);
  if (!achada) return chave;
  return achada.contraparte || achada.descricao || chave;
}

/**
 * O grupo `empresa` nos MESMOS blocos da matriz — parte, depois subparte.
 *
 * A classificação já vem resolvida do contrato (`parte`/`subparte`), inclusive
 * o alias de `utilidades`. Aqui só se agrupa, na ordem de `PARTES` e
 * `subpartesVisiveis()`, para que os dois lados da tela leiam igual.
 */
function BlocosDaMatriz({
  linhas,
  hoje,
  selecionadas,
  onAlternar
}: {
  linhas: LinhaCap[];
  hoje: string;
  selecionadas: Set<string>;
  onAlternar: (id: string) => void;
}) {
  const blocos = useMemo(() => {
    return PARTES.map((parte) => {
      // `subparte` nunca vem null no grupo `empresa` (a heurística sempre cai
      // em algum bloco), mas o tipo permite — quem não tiver bloco lê como
      // "A organizar" em vez de sumir da tela.
      const daParte = linhas.filter((l) => (l.parte ?? "organizar") === parte.slug);
      const subs = subpartesVisiveis()
        .filter((s) => s.parte === parte.slug)
        .map((s) => ({
          slug: s.slug,
          linhas: daParte.filter((l) => (l.subparte ?? "resto") === s.slug)
        }))
        .filter((s) => s.linhas.length > 0);
      return { ...parte, linhas: daParte, subs };
    }).filter((b) => b.linhas.length > 0);
  }, [linhas]);

  return (
    <>
      {blocos.map((bloco) => {
        const Icone = ICONE_PARTE[bloco.slug];
        return (
          <div key={bloco.slug} className="fin-cap-parte">
            <header className="fin-cap-parte-cab">
              <span className="fin-cap-parte-icone" aria-hidden>
                <Icone size={14} strokeWidth={2.1} />
              </span>
              <h3 className="fin-cap-parte-titulo">{bloco.nome}</h3>
              <span className="fin-cap-parte-meta">
                {bloco.linhas.length} · {brlPrecise(somarNoTotal(bloco.linhas))}
              </span>
            </header>
            {bloco.subs.map((sub) => (
              <Subparte
                key={sub.slug}
                titulo={rotuloSubparte(sub.slug)}
                meta={`${sub.linhas.length} · ${brlPrecise(somarNoTotal(sub.linhas))}`}
              >
                <TabelaContas
                  blocos={[{ chave: sub.slug, cabecalho: null, linhas: sub.linhas }]}
                  hoje={hoje}
                  selecionadas={selecionadas}
                  onAlternar={onAlternar}
                />
              </Subparte>
            ))}
          </div>
        );
      })}
    </>
  );
}

/** Uma pessoa do bloco Pessoas, com as partes dela e os dois totais. */
type Pessoa = {
  chave: string;
  nome: string;
  linhas: LinhaCap[];
  idsElegiveis: string[];
  somaCents: number;
  aConfirmarCents: number;
  partes: number;
};

/**
 * O BLOCO PESSOAS AGRUPADO POR PESSOA, COM AS PARTES DENTRO.
 *
 * ---------------------------------------------------------------------------
 * O QUE O AGRUPAMENTO RESOLVE — E O QUE ELE NÃO PRECISOU FAZER
 * ---------------------------------------------------------------------------
 * O pedido do dono, em 31/08/2026: "quero que mostre o detalhamento por pessoa
 * de cada parte (salário, prolabore, comissão, reembolso, estágio, outros) caso
 * exista e o usuário vai escolher se vai pagar a quem e quais itens".
 *
 * Nada precisou ser quebrado aqui. As linhas JÁ chegam quebradas: o contrato
 * emite uma por (pessoa × natureza), com `chaveDedupe` própria —
 * `2026-09|fin_person:12:prolabore`. Marcar N partes de alguém já produz N
 * ordens de pagamento: o loop de `programar()` monta um alvo por `chaveDedupe`,
 * e o índice único (entity_id, source, source_id) da 0075 mantém cada uma
 * separada. Este componente só AGRUPA e oferece o gesto que o dono usa de fato:
 * "paga o Gabriel" — quatro partes, quatro PIX no Inter.
 *
 * ---------------------------------------------------------------------------
 * A CHAVE É `counterpartyId`, O RÓTULO É `contraparte`
 * ---------------------------------------------------------------------------
 * Agrupar por nome funde homônimos e separa a mesma pessoa escrita de dois
 * jeitos. A base já mostra o segundo caso: em set/26 há favorecidos gravados
 * como "63384563 Tawanny De Melo Inacio" e "TALLANNY DE MELO INACIO" — o
 * `counterparty_id` é quem sabe se são duas pessoas ou uma. Quem vem sem
 * favorecido cai num balde só: é fila de cadastro, não de pagamento.
 *
 * A ORDEM É A QUE CHEGA. O contrato já ordena por pessoa e, dentro dela, pela
 * ordem de PAGAMENTO (salário, pró-labore, comissão, estágio, outros,
 * reembolso — `ordemDaNatureza`), que não é a alfabética. Reordenar aqui por
 * valor jogaria reembolso na frente de salário e desfaria a leitura que o
 * contrato monta de propósito.
 *
 * ---------------------------------------------------------------------------
 * UMA TABELA SÓ, COM `<tbody>` POR PESSOA
 * ---------------------------------------------------------------------------
 * E não uma tabela por pessoa: o bloco tem dezenas de favorecidos, e dezenas de
 * tabelas seriam dezenas de cabeçalhos repetidos e larguras de coluna
 * diferentes. `<tbody>` múltiplo é HTML válido, mantém as colunas alinhadas de
 * ponta a ponta e dá o corte visual de graça.
 */
function BlocoPessoas({
  linhas,
  competencia,
  folhaMolde,
  hoje,
  selecionadas,
  onAlternar,
  onAlternarVarias
}: {
  linhas: LinhaCap[];
  competencia: string;
  folhaMolde: string | null;
  hoje: string;
  selecionadas: Set<string>;
  onAlternar: (id: string) => void;
  onAlternarVarias: (ids: string[], marcar: boolean) => void;
}) {
  const { agregadas, agregadasCents, composicao, pessoas } = useMemo(() => {
    /*
     * A projeção agregada antiga sai do agrupamento por pessoa e vai para o pé
     * do bloco. Ela descreve a MESMA folha por um caminho errado (R$
     * 439.556,81 contra R$ 105.654,76 que de fato saíram em agosto); deixá-la
     * ao lado das partes da pessoa convidaria a somar as duas ou a marcar a
     * errada.
     */
    const daProjecao = linhas.filter((l) => leituraDaFolha(l) === "agregada");
    const doPagamento = linhas.filter((l) => leituraDaFolha(l) !== "agregada");

    const mapa = new Map<string, Pessoa>();
    for (const l of doPagamento) {
      const chave = l.counterpartyId == null ? "sem-favorecido" : `cp:${l.counterpartyId}`;
      const p: Pessoa = mapa.get(chave) ?? {
        chave,
        nome:
          l.counterpartyId == null
            ? "Sem favorecido identificado"
            : l.contraparte ?? `favorecido ${l.counterpartyId}`,
        linhas: [],
        idsElegiveis: [],
        somaCents: 0,
        aConfirmarCents: 0,
        partes: 0
      };
      p.linhas.push(l);
      if (podeProgramar(l)) p.idsElegiveis.push(l.id);
      if (l.entraNoTotal) p.somaCents += l.valorCents;
      else if (l.naoConfirmada) p.aConfirmarCents += l.valorCents;
      if (l.natureza) p.partes += 1;
      mapa.set(chave, p);
    }

    return {
      agregadas: daProjecao,
      agregadasCents: daProjecao.reduce((s, l) => s + l.valorCents, 0),
      composicao: doPagamento.filter((l) => leituraDaFolha(l) === "composicao"),
      // `Map` preserva a ordem de inserção — que é a ordem do contrato. Ver o
      // cabeçalho: ordenar aqui desfaria a ordem de pagamento dentro da pessoa.
      pessoas: [...mapa.values()]
    };
  }, [linhas]);

  const molde = folhaMolde && folhaMolde !== competencia ? folhaMolde : null;

  return (
    <>
      <p className="fin-cap-pessoas-nota" role="note">
        <Users size={16} strokeWidth={2.2} aria-hidden />
        <span>
          <b>Cada parte marcada vira um PIX separado no Inter.</b> Marcar as quatro partes de
          uma pessoa programa quatro ordens — salário, pró-labore, comissão, reembolso — e
          nada é somado no envio. É o que faz a conferência bater parte a parte contra o
          extrato depois. Escolha a quem pagar e quais itens.
        </span>
      </p>

      {/*
        MOLDE NÃO É FECHAMENTO, E A TELA TEM DE DIZER QUAL É.
        `fin_time_remuneracao_mes_v` só conhece o passado — ela lê
        `fin_transaction`. Para um mês futuro o contrato aplica o último mês
        fechado como molde. Chamar isso de "a folha de setembro" sem ressalva
        seria afirmar um fechamento que não aconteceu.
      */}
      {molde && composicao.length > 0 ? (
        <p className="fin-cap-molde" role="note">
          <CalendarClock size={15} strokeWidth={2.2} aria-hidden />
          <span>
            Composição de <b>{monthKeyLabel(molde)}</b> aplicada a{" "}
            <b>{monthKeyLabel(competencia)}</b> — é o último mês fechado servindo de molde, não
            o fechamento de {monthKeyLabel(competencia)}. Os valores mudam quando o mês fechar.
          </span>
        </p>
      ) : null}

      <TabelaContas
        blocos={pessoas.map((p) => ({
          chave: p.chave,
          cabecalho: (
            <CabecalhoPessoa
              pessoa={p}
              selecionadas={selecionadas}
              onAlternarVarias={onAlternarVarias}
            />
          ),
          linhas: p.linhas
        }))}
        hoje={hoje}
        selecionadas={selecionadas}
        onAlternar={onAlternar}
        mostrarLeitura
        dentroDePessoa
      />

      {/* A projeção velha, no pé e apagada, com o motivo que o contrato
          escreveu — ele traz os DOIS valores lado a lado, que é o que torna a
          divergência conferível em vez de uma afirmação da tela. */}
      {agregadas.length ? (
        <details className="fin-cap-agregada">
          <summary>
            Projeção agregada antiga · {agregadas.length}{" "}
            {agregadas.length === 1 ? "linha" : "linhas"} · {brlPrecise(agregadasCents)}{" "}
            <span>não soma — substituída pela composição do cadastro</span>
          </summary>
          <TabelaContas
            blocos={[{ chave: "folha-agregada", cabecalho: null, linhas: agregadas }]}
            hoje={hoje}
            selecionadas={selecionadas}
            onAlternar={onAlternar}
            mostrarLeitura
          />
        </details>
      ) : null}
    </>
  );
}

/**
 * A faixa da pessoa dentro da tabela: o checkbox que paga a pessoa inteira, o
 * nome, e os totais dela.
 *
 * Devolve `<td>` soltos de propósito — quem monta o `<tr>` é a tabela, para o
 * checkbox cair na MESMA coluna dos checkboxes das partes abaixo. Um "marcar
 * tudo" fora da coluna do que ele marca não se lê como tal.
 */
function CabecalhoPessoa({
  pessoa,
  selecionadas,
  onAlternarVarias
}: {
  pessoa: Pessoa;
  selecionadas: Set<string>;
  onAlternarVarias: (ids: string[], marcar: boolean) => void;
}) {
  const partes: string[] = [];
  if (pessoa.partes > 0) {
    partes.push(`${pessoa.partes} ${pessoa.partes === 1 ? "parte" : "partes"}`);
  } else {
    partes.push(`${pessoa.linhas.length} ${pessoa.linhas.length === 1 ? "linha" : "linhas"}`);
  }
  // O total do mês da pessoa é o que SOMA. Quando é zero e há algo a confirmar,
  // um "R$ 0,00" ao lado do nome de alguém que tem conta no mês diria a coisa
  // errada — a parcela a confirmar já carrega o número logo ao lado.
  if (pessoa.somaCents > 0 || pessoa.aConfirmarCents === 0) partes.push(brlPrecise(pessoa.somaCents));
  if (pessoa.aConfirmarCents > 0) partes.push(`${brlPrecise(pessoa.aConfirmarCents)} a confirmar`);

  return (
    <>
      <td className="fin-cap-col-sel">
        <CaixaMarcar
          ids={pessoa.idsElegiveis}
          selecionadas={selecionadas}
          onAlternar={onAlternarVarias}
          titulo={
            pessoa.idsElegiveis.length
              ? `Marca as ${pessoa.idsElegiveis.length} partes de ${pessoa.nome} — cada uma vira um PIX`
              : "nenhuma parte desta pessoa pode virar ordem"
          }
          rotulo={`Selecionar todas as partes de ${pessoa.nome}`}
        />
      </td>
      <td className="fin-cap-pessoa-cel" colSpan={6}>
        <span className="fin-cap-pessoa-nome">{pessoa.nome}</span>
        <span className="fin-cap-pessoa-meta">{partes.join(" · ")}</span>
      </td>
    </>
  );
}

/** O mesmo colapsável da matriz, mesmas classes — a tela deve ler igual. */
function Subparte({
  titulo,
  meta,
  children
}: {
  titulo: string;
  meta: string;
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(true);
  return (
    <div className={aberto ? "fin-custo-subparte aberta" : "fin-custo-subparte"}>
      <h4 className="fin-custo-subparte-titulo">
        <button
          type="button"
          className={aberto ? "fin-custo-subparte-cab aberto" : "fin-custo-subparte-cab"}
          aria-expanded={aberto}
          onClick={() => setAberto((v) => !v)}
        >
          <span className="fin-custo-subparte-nome">
            {titulo}
            <span>{meta}</span>
          </span>
          <span className="fin-pessoas-matriz-grupo-chevron" aria-hidden>
            <ChevronRight size={16} strokeWidth={2.2} className={aberto ? "fin-chevron-aberto" : undefined} />
          </span>
        </button>
      </h4>
      {aberto ? children : null}
    </div>
  );
}

/**
 * Só o input que marca um conjunto inteiro.
 *
 * Separado do `<label>` porque o cabeçalho de pessoa precisa dele DENTRO da
 * coluna de seleção da tabela, alinhado com os checkboxes das linhas abaixo —
 * um "marcar tudo" que não fica na coluna do que ele marca não se lê como tal.
 */
function CaixaMarcar({
  ids,
  selecionadas,
  onAlternar,
  titulo,
  rotulo
}: {
  ids: string[];
  selecionadas: Set<string>;
  onAlternar: (ids: string[], marcar: boolean) => void;
  titulo?: string;
  rotulo?: string;
}) {
  const marcadas = ids.filter((id) => selecionadas.has(id)).length;
  const todas = ids.length > 0 && marcadas === ids.length;

  return (
    <input
      type="checkbox"
      checked={todas}
      disabled={ids.length === 0}
      title={titulo}
      aria-label={rotulo}
      // `indeterminate` não existe como atributo em HTML — só como propriedade
      // do elemento. Sem este ref, "parte marcada" aparece igual a "nada
      // marcado", e a pessoa clica achando que vai marcar tudo.
      ref={(el) => {
        if (el) el.indeterminate = marcadas > 0 && !todas;
      }}
      onChange={() => onAlternar(ids, !todas)}
    />
  );
}

function CaixaTudo({
  ids,
  selecionadas,
  onAlternar,
  rotulo,
  dica
}: {
  ids: string[];
  selecionadas: Set<string>;
  onAlternar: (ids: string[], marcar: boolean) => void;
  rotulo: string;
  dica: string;
}) {
  return (
    <label className="fin-custo-sel fin-cap-tudo" title={ids.length ? dica : "nenhuma linha elegível aqui"}>
      <CaixaMarcar ids={ids} selecionadas={selecionadas} onAlternar={onAlternar} />
      <span>{rotulo}</span>
    </label>
  );
}

/** Quantos dias uma ordem pode ficar no app do banco antes de virar alerta. */
const DIAS_PARA_ALERTA = 2;

/**
 * A COLUNA SITUAÇÃO — o ciclo inteiro, um selo por estado.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTAVA FALTANDO
 * ---------------------------------------------------------------------------
 * O pedido do dono, em 31/08/2026: "a parte de situação tem realmente faltando
 * a chave pix, deve mostrar, mas tbm deve mostrar se foi enviado para
 * pagamento, se foi pago e confirmado… tudo organizado".
 *
 * A célula sabia dizer "falta chave PIX" e "existe uma ordem, status X". As
 * duas perguntas que faltavam são as que decidem se ele precisa abrir o
 * aplicativo do banco: ENVIADO (está lá esperando o dedo dele) e PAGO (saiu, e
 * tem end-to-end para conferir no extrato).
 *
 * ---------------------------------------------------------------------------
 * COR NUNCA SOZINHA
 * ---------------------------------------------------------------------------
 * Todo selo carrega o texto do estado. Verde e âmbar aqui separam "o dinheiro
 * saiu" de "parado esperando você" — a distinção mais cara da tela — e uma
 * tela de pagamento não pode depender de quem enxerga a diferença entre dois
 * tons. O âmbar de `aguardando` é o MESMO vocabulário de `.fin-apr-esquecida`
 * em Aprovações: barra âmbar = fila de decisão humana, nunca erro.
 *
 * ---------------------------------------------------------------------------
 * OS 2 DIAS SAEM DE `scheduledFor`, E ISSO É UMA APROXIMAÇÃO
 * ---------------------------------------------------------------------------
 * `OrdemExistente` não traz quando a ordem foi ENTREGUE ao Inter — traz
 * `scheduledFor`, `pagoEm` e o `status`. Então "parada há N dias" conta desde
 * a data agendada, que é o piso: uma ordem entregue depois da data agendada
 * está parada há menos tempo do que isto diz, nunca mais. Errar para o lado do
 * alerta é o lado certo aqui; o número exato mora na guia de Aprovações.
 */
function Situacao({ linha, hoje }: { linha: LinhaCap; hoje: string }) {
  const estado = estadoDoCiclo(linha);
  const o = linha.ordem;

  if (o && estado === "paga") {
    return (
      <>
        <span
          className="fin-cap-selo fin-cap-selo-paga"
          // O end-to-end é o que casa esta linha com o extrato do banco. Ele
          // não ocupa a célula (32 caracteres numa coluna de 12,5px), mas tem
          // de estar alcançável sem sair da tela.
          title={o.endToEndId ? `end-to-end ${o.endToEndId}` : "pagamento confirmado, sem end-to-end registrado"}
        >
          {o.pagoEm ? `Pago em ${shortDateLabel(o.pagoEm)}` : "Pago"}
        </span>
        <span className="fin-cap-ordem-code">{o.code}</span>
        {o.status === "pago_parcial" ? (
          <span className="fin-cap-sub">
            {brlPrecise(o.pagoCents)} de {brlPrecise(linha.valorCents)} — parcial
          </span>
        ) : null}
      </>
    );
  }

  if (o && estado === "aguardando") {
    const dias = o.scheduledFor ? diasEntre(o.scheduledFor, hoje) : null;
    const parada = dias !== null && dias >= DIAS_PARA_ALERTA;
    return (
      <>
        <span
          className={parada ? "fin-cap-selo fin-cap-selo-espera parada" : "fin-cap-selo fin-cap-selo-espera"}
          title="a ordem está no aplicativo do Banco Inter — nada sai enquanto você não aprovar lá"
        >
          Enviado ao Inter · aprove no app
        </span>
        <span className="fin-cap-ordem-code">{o.code}</span>
        {parada ? (
          <span className="fin-cap-sub fin-cap-parada">
            parada há {dias} dias — desde {shortDateLabel(o.scheduledFor)}
          </span>
        ) : o.scheduledFor ? (
          <span className="fin-cap-sub">agendada para {shortDateLabel(o.scheduledFor)}</span>
        ) : null}
      </>
    );
  }

  if (o && estado === "programada") {
    return (
      <>
        <span
          className="fin-cap-selo fin-cap-selo-programada"
          title="a ordem existe aqui e ainda NÃO foi entregue ao banco — reenviar é pela guia de Aprovações"
        >
          {o.scheduledFor ? `Programado para ${shortDateLabel(o.scheduledFor)}` : "Programado"}
        </span>
        <span className="fin-cap-ordem-code">{o.code}</span>
        <span className="fin-cap-sub">não enviado ao banco</span>
      </>
    );
  }

  if (o) {
    // `em_curso`: os estados intermediários da 0075 que esta coluna não
    // nomeia. Mostrar o rótulo cru é melhor que engolir a ordem — sem isto ela
    // apareceria como "pronta" e alguém programaria a mesma conta de novo.
    return (
      <>
        <span className="fin-cap-selo fin-cap-selo-curso">{ROTULO_ORDEM[o.status] ?? o.status}</span>
        <span className="fin-cap-ordem-code">{o.code}</span>
        {o.scheduledFor ? (
          <span className="fin-cap-sub">para {shortDateLabel(o.scheduledFor)}</span>
        ) : null}
      </>
    );
  }

  if (estado === "falta_cadastro") {
    return (
      <>
        <span
          className="fin-cap-selo fin-cap-selo-falta"
          title="não pode virar ordem de pagamento enquanto isto não for resolvido"
        >
          {linha.impedimento ? MOTIVO_IMPEDIMENTO[linha.impedimento] : "não pode ser programada"}
        </span>
        {/*
          Uma linha pode ter os DOIS rótulos: falta cadastro E não confirmada.
          O impedimento aparece primeiro porque é o que barra; o selo âmbar
          continua porque é a fila do dono, e sumir com ele aqui esconderia
          justamente a conta que ninguém está contando.
        */}
        {linha.naoConfirmada ? (
          <span
            className="fin-cap-selo-confirmar"
            title="não soma no total, e nenhuma outra linha conta por ela — é conta de verdade esperando a sua decisão"
          >
            a confirmar
          </span>
        ) : null}
        {/*
          O MOTIVO DA VIEW, NÃO UM RÓTULO GENÉRICO. `MOTIVO_IMPEDIMENTO`
          descreve a CLASSE do impedimento; confiar só nele foi o que fez 31
          linhas de set/26 dizerem "outra linha já conta este dinheiro" quando
          a disputa de chave devolvia "vencedora: NENHUMA" para todas. O motivo
          verdadeiro mora em `motivoNaoSoma`, e na projeção agregada ele traz os
          dois valores lado a lado (o do cadastro contra o da 0077), que é o que
          torna a divergência conferível em vez de uma afirmação da tela.
        */}
        {!linha.entraNoTotal && linha.motivoNaoSoma ? (
          <span className="fin-cap-sub">{linha.motivoNaoSoma}</span>
        ) : null}
      </>
    );
  }

  if (estado === "a_confirmar") {
    /*
     * O selo diz "a confirmar" e NÃO "não soma", apesar de ser `entraNoTotal =
     * false` que traz a linha até aqui. Os dois são o mesmo fato lido de dois
     * lados, e o lado que importa nesta tela é o da decisão: a linha é
     * PAGÁVEL — `impedimento` é null e o checkbox está ligado. Chamá-la de
     * "não soma" na coluna que decide o pagamento repetiria, em outra roupa, o
     * erro que hachurou 31 contas reais de R$ 40.044,75 em set/26.
     */
    return (
      <>
        <span
          className="fin-cap-selo-confirmar"
          title="não soma no total, e nenhuma outra linha conta por ela — é conta de verdade esperando a sua decisão. Pode ser paga."
        >
          a confirmar
        </span>
        {linha.motivoNaoSoma ? <span className="fin-cap-sub">{linha.motivoNaoSoma}</span> : null}
      </>
    );
  }

  return (
    <span className="fin-cap-selo fin-cap-selo-pronta" title="tem favorecido e chave PIX — marque para programar">
      Pronta para pagar
    </span>
  );
}

/**
 * Um pedaço da tabela com um cabeçalho próprio. `cabecalho` são `<td>` soltos:
 * quem monta o `<tr>` é a tabela, para as colunas continuarem alinhadas.
 */
type BlocoDeLinhas = { chave: string; cabecalho: ReactNode | null; linhas: LinhaCap[] };

function TabelaContas({
  blocos,
  hoje,
  selecionadas,
  onAlternar,
  mostrarLeitura = false,
  dentroDePessoa = false
}: {
  blocos: BlocoDeLinhas[];
  /** A data do SERVIDOR — é dela que sai "parada há N dias" na coluna Situação. */
  hoje: string;
  selecionadas: Set<string>;
  onAlternar: (id: string) => void;
  /** Só no bloco Pessoas: rotula de onde a linha vem — ver `leituraDaFolha`. */
  mostrarLeitura?: boolean;
  /**
   * Dentro de uma faixa de pessoa a NATUREZA vira o título da linha e o nome
   * some. O nome já está no cabeçalho da pessoa, e a descrição que o contrato
   * monta é "Gabriel — Comissão": repetir os dois faria a linha dizer o nome
   * três vezes e a parte nenhuma.
   */
  dentroDePessoa?: boolean;
}) {
  return (
    <div className="fin-table-wrap">
      <table className="fin-table fin-cap-tabela">
        <thead>
          <tr>
            <th scope="col" className="fin-cap-col-sel">
              <span className="sr-only">Selecionar</span>
            </th>
            <th scope="col">Dia</th>
            <th scope="col">Descrição e favorecido</th>
            <th scope="col">Categoria</th>
            <th scope="col">Certeza</th>
            <th scope="col" className="num">
              Valor
            </th>
            <th scope="col">Situação</th>
          </tr>
        </thead>
        {blocos.map((bloco) => (
          <tbody key={bloco.chave}>
            {bloco.cabecalho ? <tr className="fin-cap-grupo-linha">{bloco.cabecalho}</tr> : null}
            {bloco.linhas.map((l) => {
              const elegivel = podeProgramar(l);
              const marcada = selecionadas.has(l.id);
              const leitura = mostrarLeitura ? leituraDaFolha(l) : null;
              /*
               * `fin-cap-fora` (apagada e hachurada) ficou SÓ para quem outra
               * linha já conta. A linha a confirmar não soma pelo mesmo campo,
               * mas é o oposto: conta de verdade que ninguém está contando, e
               * pintá-la de "descartada" era o erro que esvaziava a tela — 31
               * linhas de R$ 40.044,75 em set/26 (Ancora, Compesa, Neoenergia,
               * Claro, Embrasul, Localiza) apareciam como duplicata.
               */
              const paga = Boolean(l.ordem && l.ordem.pagoCents > 0);
              const classes = [
                l.vencido && !l.realizadoEm && !paga ? "fin-cap-vencida" : "",
                !l.entraNoTotal && !l.naoConfirmada ? "fin-cap-fora" : "",
                l.naoConfirmada && !paga ? "fin-cap-aconfirmar" : "",
                // O que já saiu do caixa não é fila de ninguém: a barra verde
                // vence a âmbar de "a confirmar" e a vermelha de "vencido".
                paga ? "fin-cap-paga" : "",
                marcada ? "fin-cap-marcada" : ""
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <tr
                  key={l.id}
                  className={classes || undefined}
                  // A linha que não soma continua legível, com o motivo à mão —
                  // ela é dado, não ruído: some da soma, nunca da tela.
                  title={l.entraNoTotal ? undefined : l.motivoNaoSoma ?? "não entra no total do mês"}
                >
                  <td className="fin-cap-col-sel">
                    {l.ordem ? (
                      // Já tem ordem: o checkbox some e o code/status ocupam a
                      // coluna de situação. Deixar a caixa marcada e desligada
                      // sugeriria que o clique de agora foi o que a criou.
                      <span
                        className="fin-cap-ordem-marca"
                        title={`ordem ${l.ordem.code} já registrada`}
                        aria-hidden
                      >
                        ✓
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={marcada}
                        disabled={!elegivel}
                        aria-label={`Selecionar ${l.contraparte ?? l.descricao}`}
                        title={
                          elegivel
                            ? "vira ordem de pagamento"
                            : l.impedimento
                              ? MOTIVO_IMPEDIMENTO[l.impedimento]
                              : "não pode ser programada"
                        }
                        onChange={() => onAlternar(l.id)}
                      />
                    )}
                  </td>
                  <td className="fin-cap-dia">
                    {shortDateLabel(l.dia)}
                    {l.tempo === "hoje" ? <span className="fin-tag">hoje</span> : null}
                    {l.vencido && !l.realizadoEm ? (
                      <span className="fin-tag fin-tag-atencao">vencido</span>
                    ) : null}
                  </td>
                  <td>
                    {/* A NATUREZA EM DESTAQUE. É ela que decide em quantos PIX o
                        pagamento da pessoa se divide, e é por ela que a
                        conferência bate depois. Dentro da faixa da pessoa ela é o
                        TÍTULO da linha; fora dela, uma pílula ao lado do nome —
                        inclusive fora do bloco Pessoas, porque o contrato também
                        a preenche a partir da categoria 6.x. */}
                    {dentroDePessoa && l.natureza ? (
                      <span className="fin-cap-nome fin-cap-nome-natureza">{l.natureza}</span>
                    ) : (
                      <span className="fin-cap-nome">
                        {l.contraparte ?? "sem favorecido"}
                        {l.natureza ? (
                          <span
                            className="fin-cap-natureza"
                            title="natureza do pagamento — cada uma marcada vira um PIX próprio"
                          >
                            {l.natureza}
                          </span>
                        ) : null}
                      </span>
                    )}
                    {/* "Gabriel — Comissão" é exatamente o nome mais a natureza,
                        e as duas já estão na tela quando a linha está sob a
                        pessoa. Só repete quando diz algo novo. */}
                    {dentroDePessoa && l.descricao === `${l.contraparte} — ${l.natureza}` ? null : (
                      <span className="fin-cap-sub">{l.descricao}</span>
                    )}
                    {leitura ? (
                      <span
                        className="fin-cap-leitura"
                        data-leitura={leitura}
                        title={EXPLICA_LEITURA[leitura]}
                      >
                        {ROTULO_LEITURA[leitura]}
                      </span>
                    ) : null}
                    {l.pixMascarado ? (
                      <span className="fin-cap-pix">
                        PIX {l.pixTipo?.toLowerCase() ?? "chave"} {l.pixMascarado}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {l.categoriaCode ? (
                      <>
                        <span className="fin-cap-cat-code">{l.categoriaCode}</span>{" "}
                        {l.categoriaNome ?? ""}
                      </>
                    ) : l.categoriaNome ? (
                      // A composição da folha não tem código de categoria — ela
                      // não vem do plano de contas, vem do cadastro da pessoa —
                      // mas tem nome. Dizer "sem categoria" em cada parte de cada
                      // pessoa seria uma fila de trabalho inventada.
                      l.categoriaNome
                    ) : (
                      <span className="fin-zero">sem categoria</span>
                    )}
                  </td>
                  <td>
                    <SeloCamada camada={l.certeza} />
                  </td>
                  <td className="num fin-table-money">{brlPrecise(l.valorCents)}</td>
                  <td className="fin-cap-sit">
                    <Situacao linha={l} hoje={hoje} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
