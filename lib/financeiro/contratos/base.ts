import "server-only";

/**
 * Os contratos de dados das telas financeiras.
 *
 * Este arquivo não consulta nada. Ele define a FORMA que toda consulta de tela
 * devolve, e existe por um motivo específico deste projeto:
 *
 *   O princípio é "caixa é a validação máxima, nada de estimativa". Numa API
 *   normal, um domínio sem dado devolve `[]` e a tela desenha um gráfico vazio
 *   que parece dizer "não houve movimento". Aqui isso é mentira — e é a pior
 *   espécie, porque não tem como o leitor distinguir "não houve" de "não sei".
 *
 * Por isso todo contrato carrega três coisas além do dado:
 *
 *   1. COBERTURA E FRESCOR — de que fonte veio, até quando ela cobre, e há
 *      quantos dias está parada. É o que permite a tela dizer "este número
 *      está desatualizado há 9 dias" em vez de mostrá-lo como se fosse de hoje.
 *   2. INDETERMINADO DECLARADO — um valor pode ser `null` COM MOTIVO. Zero e
 *      "não sei" são estados diferentes e nunca compartilham representação.
 *   3. PENDÊNCIAS — o que precisa de decisão humana, com o link para a tela que
 *      decide. Nenhuma pendência fica só num relatório: ela é a fila de alguém.
 */

// ---------------------------------------------------------------------------
// Frescor e cobertura
// ---------------------------------------------------------------------------

/**
 * Estado de frescor de uma fonte.
 *
 * `em_dia` não é "tem dado": é "tem dado E ele cobre até onde deveria". A
 * distinção existe porque uma conta pode fechar aritmeticamente no dia em que o
 * extrato termina e ainda assim mentir sobre hoje.
 */
export type EstadoFrescor = "em_dia" | "atrasado" | "vazio" | "indisponivel";

export type Frescor = {
  /** Nome legível da fonte: "extrato Inter", "cobranças Asaas", "espelho do ERP". */
  fonte: string;
  /** Tabela ou view que sustenta o número, para quem for auditar. */
  origem: string;
  /** Última data que a fonte cobre (ISO, `YYYY-MM-DD`), ou null se nunca cobriu. */
  cobreAte: string | null;
  /** Dias entre `cobreAte` e hoje. Null quando não há cobertura nenhuma. */
  diasDesatualizado: number | null;
  /** Quantos dias de atraso ainda são aceitáveis para esta fonte. */
  toleranciaDias: number;
  estado: EstadoFrescor;
  /** Percentual do universo que a fonte cobre, quando faz sentido medir. */
  coberturaPct: number | null;
  /** Por que está vazio ou indisponível. Obrigatório nesses dois estados. */
  motivo: string | null;
};

/** Uma pendência humana, sempre com o endereço da tela que a resolve. */
export type Pendencia = {
  chave: string;
  titulo: string;
  quantidade: number;
  valorCents: number | null;
  severidade: "bloqueante" | "alerta" | "informativo";
  /** Rota da tela de decisão. Pendência sem destino vira relatório morto. */
  telaDeDecisao: string | null;
};

/**
 * Um número que pode legitimamente não existir.
 *
 * `{ valor: 0 }` e `{ valor: null, motivo: "..." }` são coisas diferentes, e o
 * tipo obriga quem consome a tratar as duas.
 */
export type Medida = {
  valorCents: number | null;
  motivo: string | null;
};

export function medida(valorCents: number | null | undefined, motivo?: string): Medida {
  if (valorCents === null || valorCents === undefined) {
    return { valorCents: null, motivo: motivo ?? "sem dado na fonte" };
  }
  return { valorCents, motivo: null };
}

/** O envelope de todo contrato de tela. */
export type Contrato<T> = {
  dominio: string;
  /** Falso quando o banco ou o schema não respondem. A tela renderiza o estado, não um 500. */
  disponivel: boolean;
  dado: T;
  cobertura: Frescor[];
  /** A pior fonte do domínio — é ela que a tela deve exibir no selo. */
  frescorPior: Frescor | null;
  pendencias: Pendencia[];
  /** Ressalvas em português sobre como ler o número (ex.: regime de caixa). */
  ressalvas: string[];
  medidoEm: string;
};

const ORDEM_ESTADO: Record<EstadoFrescor, number> = {
  indisponivel: 0,
  vazio: 1,
  atrasado: 2,
  em_dia: 3
};

/** A fonte mais frágil manda no selo: um domínio é tão fresco quanto seu pior insumo. */
export function piorFrescor(fontes: Frescor[]): Frescor | null {
  if (!fontes.length) return null;
  return fontes.reduce((pior, atual) => {
    const d = ORDEM_ESTADO[atual.estado] - ORDEM_ESTADO[pior.estado];
    if (d !== 0) return d < 0 ? atual : pior;
    return (atual.diasDesatualizado ?? 0) > (pior.diasDesatualizado ?? 0) ? atual : pior;
  });
}

/** Constrói um Frescor a partir da última data coberta. */
export function frescorDeData(args: {
  fonte: string;
  origem: string;
  cobreAte: string | Date | null;
  toleranciaDias: number;
  coberturaPct?: number | null;
  motivoSeVazio?: string;
  hoje?: Date;
}): Frescor {
  const hoje = args.hoje ?? new Date();
  const iso = normalizarData(args.cobreAte);
  if (!iso) {
    return {
      fonte: args.fonte,
      origem: args.origem,
      cobreAte: null,
      diasDesatualizado: null,
      toleranciaDias: args.toleranciaDias,
      estado: "vazio",
      coberturaPct: args.coberturaPct ?? null,
      motivo: args.motivoSeVazio ?? "a fonte nunca entregou dado"
    };
  }
  const dias = diasEntre(iso, hoje);
  return {
    fonte: args.fonte,
    origem: args.origem,
    cobreAte: iso,
    diasDesatualizado: dias,
    toleranciaDias: args.toleranciaDias,
    estado: dias <= args.toleranciaDias ? "em_dia" : "atrasado",
    coberturaPct: args.coberturaPct ?? null,
    motivo: dias <= args.toleranciaDias ? null : `a fonte cobre até ${iso}, ${dias} dia(s) atrás`
  };
}

export function frescorIndisponivel(fonte: string, origem: string, motivo: string): Frescor {
  return {
    fonte,
    origem,
    cobreAte: null,
    diasDesatualizado: null,
    toleranciaDias: 0,
    estado: "indisponivel",
    coberturaPct: null,
    motivo
  };
}

function normalizarData(valor: string | Date | null | undefined): string | null {
  if (!valor) return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  const texto = String(valor);
  return texto.length >= 10 ? texto.slice(0, 10) : null;
}

function diasEntre(iso: string, hoje: Date): number {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const alvo = Date.UTC(ano, mes - 1, dia);
  const referencia = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  return Math.round((referencia - alvo) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Paginação e ordenação
// ---------------------------------------------------------------------------

export type Paginacao = { pagina?: number; porPagina?: number };

export type Ordenacao<C extends string = string> = { campo: C; direcao: "asc" | "desc" };

export type Pagina<T> = {
  itens: T[];
  /** Total de linhas que casam com o filtro, não o tamanho de `itens`. */
  total: number;
  pagina: number;
  porPagina: number;
  paginas: number;
  temMais: boolean;
  ordenacao: Ordenacao;
  /** Preenchido quando o filtro não devolveu nada — diz se é "nada" ou "não sei". */
  vazio: EstadoVazio | null;
};

/**
 * Por que um resultado veio vazio.
 *
 * "Nenhum lançamento neste filtro" e "esta conta nunca foi importada" produzem
 * a mesma lista vazia e exigem telas completamente diferentes.
 */
export type EstadoVazio = {
  causa: "sem_dado_na_fonte" | "filtro_sem_resultado" | "fonte_indisponivel" | "fora_do_escopo";
  motivo: string;
  /** O que a pessoa pode fazer a respeito, se houver algo. */
  acao: string | null;
};

const POR_PAGINA_PADRAO = 50;
const POR_PAGINA_MAX = 500;

export function normalizarPaginacao(p: Paginacao = {}): { pagina: number; porPagina: number; offset: number } {
  const porPagina = Math.min(Math.max(Math.trunc(p.porPagina ?? POR_PAGINA_PADRAO), 1), POR_PAGINA_MAX);
  const pagina = Math.max(Math.trunc(p.pagina ?? 1), 1);
  return { pagina, porPagina, offset: (pagina - 1) * porPagina };
}

export function montarPagina<T>(args: {
  itens: T[];
  total: number;
  pagina: number;
  porPagina: number;
  ordenacao: Ordenacao;
  vazio?: EstadoVazio | null;
}): Pagina<T> {
  const paginas = Math.max(1, Math.ceil(args.total / args.porPagina));
  return {
    itens: args.itens,
    total: args.total,
    pagina: args.pagina,
    porPagina: args.porPagina,
    paginas,
    temMais: args.pagina < paginas,
    ordenacao: args.ordenacao,
    vazio: args.itens.length === 0 ? args.vazio ?? { causa: "filtro_sem_resultado", motivo: "nenhuma linha casa com o filtro", acao: "afrouxe o filtro" } : null
  };
}

/**
 * Traduz um campo de ordenação vindo da URL para SQL, por lista branca.
 *
 * Interpolar o nome da coluna direto seria injeção; devolver sempre a mesma
 * ordem tornaria a tabela inútil. A lista branca é o meio-termo, e o padrão
 * entra quando o campo não existe — silenciosamente NÃO, o campo aplicado volta
 * no `Pagina.ordenacao` para a tela poder destacar a coluna certa.
 */
export function ordenarPor<C extends string>(
  pedido: Ordenacao<C> | undefined,
  colunas: Record<C, string>,
  padrao: Ordenacao<C>
): { sql: string; aplicada: Ordenacao<C> } {
  const campo = pedido && pedido.campo in colunas ? pedido.campo : padrao.campo;
  const direcao = pedido?.direcao === "asc" || pedido?.direcao === "desc" ? pedido.direcao : padrao.direcao;
  return {
    sql: `${colunas[campo]} ${direcao === "asc" ? "ASC" : "DESC"} NULLS LAST`,
    aplicada: { campo, direcao }
  };
}

// ---------------------------------------------------------------------------
// Séries e drill-down
// ---------------------------------------------------------------------------

/** Um ponto de série mensal. `mes` é sempre o primeiro dia do mês, `YYYY-MM-01`. */
export type PontoMes = {
  mes: string;
  valorCents: number;
  n: number;
  /** Verdadeiro quando o mês está dentro da janela mas a fonte não o cobre. */
  incompleto: boolean;
  motivoIncompleto: string | null;
};

export type SerieMensal = {
  chave: string;
  rotulo: string;
  pontos: PontoMes[];
  /** Endereço para a tela abrir o detalhe de um ponto. */
  drill: Drill | null;
};

/**
 * O endereço de um detalhamento.
 *
 * Toda agregação carrega o filtro que a reproduz linha a linha. Sem isso o
 * usuário vê "R$ 84 mil em despesa administrativa" e não tem como descobrir de
 * quê — e um número que não se abre não é auditável.
 */
export type Drill = {
  dominio: string;
  filtros: Record<string, string | number | boolean | null>;
};

/**
 * Completa os meses faltantes de uma série, marcando-os como incompletos em vez
 * de deixar buraco. Buraco no eixo o olho lê como zero.
 */
export function preencherMeses(
  pontos: PontoMes[],
  de: string,
  ate: string,
  motivoIncompleto = "a fonte não cobre este mês"
): PontoMes[] {
  const porMes = new Map(pontos.map((p) => [p.mes.slice(0, 7), p]));
  const saida: PontoMes[] = [];
  const [anoDe, mesDe] = de.slice(0, 7).split("-").map(Number);
  const [anoAte, mesAte] = ate.slice(0, 7).split("-").map(Number);
  let ano = anoDe;
  let mes = mesDe;
  while (ano < anoAte || (ano === anoAte && mes <= mesAte)) {
    const chave = `${ano}-${String(mes).padStart(2, "0")}`;
    const existente = porMes.get(chave);
    saida.push(
      existente ?? { mes: `${chave}-01`, valorCents: 0, n: 0, incompleto: true, motivoIncompleto }
    );
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Montagem do envelope
// ---------------------------------------------------------------------------

export function contrato<T>(args: {
  dominio: string;
  dado: T;
  cobertura?: Frescor[];
  pendencias?: Pendencia[];
  ressalvas?: string[];
}): Contrato<T> {
  const cobertura = args.cobertura ?? [];
  return {
    dominio: args.dominio,
    disponivel: true,
    dado: args.dado,
    cobertura,
    frescorPior: piorFrescor(cobertura),
    pendencias: args.pendencias ?? [],
    ressalvas: args.ressalvas ?? [],
    medidoEm: new Date().toISOString()
  };
}

export function contratoIndisponivel<T>(dominio: string, vazio: T, motivo: string): Contrato<T> {
  const fonte = frescorIndisponivel(dominio, "-", motivo);
  return {
    dominio,
    disponivel: false,
    dado: vazio,
    cobertura: [fonte],
    frescorPior: fonte,
    pendencias: [],
    ressalvas: [motivo],
    medidoEm: new Date().toISOString()
  };
}

/**
 * Envolve uma consulta de contrato.
 *
 * Erro de banco vira `disponivel: false` com motivo, nunca exceção que estoura a
 * página inteira: o resto do painel continua legível e a única coisa que muda é
 * que aquele cartão diz por que está apagado.
 */
export async function comFallback<T>(
  dominio: string,
  vazio: T,
  fn: () => Promise<Contrato<T>>
): Promise<Contrato<T>> {
  try {
    return await fn();
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    console.error(`[contrato:${dominio}]`, motivo);
    return contratoIndisponivel(dominio, vazio, motivo);
  }
}

/** A entidade única desta base. Declarada num lugar só. */
export const ENTIDADE = "xpe";

/**
 * O escopo temporal padrão das telas.
 *
 * Decisão do Fernando (16/08/2026): o escopo é 2026. O histórico anterior fica
 * pendente por decisão, não por dívida — e medir na base inteira esconde isso.
 * As telas que quiserem o histórico têm de pedir explicitamente.
 */
export const ANO_ESCOPO = 2026;
export const INICIO_ESCOPO = `${ANO_ESCOPO}-01-01`;

/**
 * Os filtros que quase toda tela aceita. Cada domínio estende o que precisar,
 * mas estes têm sempre o mesmo nome e o mesmo significado — filtro que muda de
 * nome entre telas é filtro que o usuário aprende duas vezes.
 */
export type FiltrosComuns = {
  de?: string;
  ate?: string;
  nucleo?: string;
  categoria?: string;
  centroCusto?: string;
  contraparte?: number;
  conta?: string;
  busca?: string;
};

/** Construtor de WHERE parametrizado. Nunca interpola valor em SQL. */
export class Condicoes {
  private readonly partes: string[] = [];
  readonly params: unknown[] = [];

  constructor(iniciais: string[] = [], params: unknown[] = []) {
    this.partes.push(...iniciais);
    this.params.push(...params);
  }

  /** `add("t.posted_on >= $?", "2026-01-01")` — o `$?` vira o próximo índice. */
  add(sql: string, valor: unknown): this {
    if (valor === undefined || valor === null || valor === "") return this;
    this.params.push(valor);
    this.partes.push(sql.replaceAll("$?", `$${this.params.length}`));
    return this;
  }

  /** Condição sem parâmetro (literal já seguro). */
  raw(sql: string): this {
    this.partes.push(sql);
    return this;
  }

  get where(): string {
    return this.partes.length ? this.partes.join(" AND ") : "true";
  }

  /** Índice do próximo parâmetro, para LIMIT/OFFSET. */
  proximo(valor: unknown): string {
    this.params.push(valor);
    return `$${this.params.length}`;
  }
}
