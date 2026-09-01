/**
 * Eixos do custo da empresa — os MESMOS de Pessoas.
 *
 * Time (consultoria | obras | administrativo | outros | consultoria_obras) e
 * área da empresa (Marketing, Vendas…) são cadastro, não detecção. Ninguém
 * nasce classificado: o dono marca na matriz, um a um. Inventar o time do
 * aluguel seria o mesmo erro de inventar o salário do sócio.
 *
 * `consultoria_obras` é o único que CONTA em duas barras: 50% consultoria,
 * 50% obras. Os chips de filtro continuam quatro times + "sem time"; o
 * híbrido não ganha chip próprio — aparece nas duas pontas.
 *
 * Classe (operacional × máquinas) SAI do plano de contas, que já desenha essa
 * fronteira: 5.xx é despesa operacional, 8.01/8.03 é equipamento/veículo, 4.02
 * é material de obra. Não é o terceiro dropdown — é o filtro "tipo".
 */

export type TimeCusto =
  | "consultoria"
  | "obras"
  | "administrativo"
  | "outros"
  | "consultoria_obras"
  | "sem_time";
export type ClasseCusto = "operacional" | "maquinas";

export const TIMES: { slug: Exclude<TimeCusto, "sem_time">; nome: string }[] = [
  { slug: "consultoria", nome: "Consultoria" },
  { slug: "obras", nome: "Obras" },
  { slug: "consultoria_obras", nome: "Consultoria e Obras" },
  { slug: "administrativo", nome: "Administrativo" },
  { slug: "outros", nome: "Outros" }
];

export const ORDEM_TIME: Exclude<TimeCusto, "consultoria_obras">[] = [
  "consultoria",
  "obras",
  "administrativo",
  "outros",
  "sem_time"
];

export const ROTULO_TIME: Record<TimeCusto, string> = {
  consultoria: "Consultoria",
  obras: "Obras",
  administrativo: "Administrativo",
  outros: "Outros",
  consultoria_obras: "Consultoria e Obras",
  sem_time: "Sem time"
};

export const COR_TIME: Record<Exclude<TimeCusto, "consultoria_obras">, string> = {
  consultoria: "var(--purple)",
  obras: "var(--ink-orange, #c2410c)",
  administrativo: "var(--teal)",
  outros: "var(--amber)",
  sem_time: "var(--muted)"
};

export const CLASSES: { slug: ClasseCusto; nome: string }[] = [
  { slug: "operacional", nome: "Custo operacional" },
  { slug: "maquinas", nome: "Máquinas e equipamentos" }
];

export const ROTULO_CLASSE: Record<ClasseCusto, string> = {
  operacional: "Custo operacional",
  maquinas: "Máquinas e equipamentos"
};

export const COR_CLASSE: Record<ClasseCusto, string> = {
  operacional: "var(--ink-blue)",
  maquinas: "var(--ink-amber)"
};

const TIMES_SET = new Set<string>(TIMES.map((t) => t.slug));

export function timeDe(gravado: string | null): TimeCusto {
  if (gravado && TIMES_SET.has(gravado)) return gravado as TimeCusto;
  return "sem_time";
}

/**
 * Time da PESSOA, a partir de `fin_person.area` (e o núcleo como rede).
 *
 * É o mesmo CASE de `TIME_SQL` em `pessoas.ts`. Duas cópias porque aquele
 * arquivo interpola SQL e este classifica linha a linha no JS — um corte que
 * existe em dois idiomas. Se um mudar sem o outro, a matriz de Pessoas e o
 * filtro de Contas a pagar discordam de quem é "obras".
 *
 * Software/hardware → consultoria (0170). Marketing no campo velho → outros.
 * Cadastro vazio → sem_time, nunca chutado para obras.
 */
export function timeDaPessoa(area: string | null | undefined, defaultNucleo?: string | null): TimeCusto {
  const a = (area ?? "").trim().toLowerCase();
  if (a === "hardware" || a === "software") return "consultoria";
  if (a === "consultoria" || a === "obras" || a === "administrativo" || a === "outros") return a;
  if (a) return "outros";
  const n = (defaultNucleo ?? "").trim().toLowerCase();
  if (n === "obras" || n === "consultoria") return n;
  return "sem_time";
}

/**
 * Área desta CONTA na tela de pagar — um chip, uma linha.
 *
 * Pacote de comissão (obras/consultoria) vence o time da pessoa: o PIX de
 * obras do Gabriel é obras mesmo se o cadastro dele for sócio sem time.
 * `consultoria_obras` (os dois) fica chip próprio, não aparece nos dois
 * lados — "mostrar só os da mesma área" é recorte exclusivo.
 */
export function areaDaConta(l: { parte?: string | null; time: TimeCusto }): TimeCusto {
  if (l.parte === "obras" || l.parte === "consultoria") return l.parte;
  return l.time;
}

export function timeValido(valor: string | null): valor is Exclude<TimeCusto, "sem_time"> {
  return Boolean(valor && TIMES_SET.has(valor));
}

/**
 * Para onde o gráfico manda este custo. `consultoria_obras` vira as duas
 * barras; o resto é uma fatia. Recorte estreito (só Consultoria ligada)
 * devolve só o destino visível — senão a soma do gráfico deixa de bater
 * com a tabela, que ainda mostra o item inteiro.
 */
export function destinosTime(
  time: TimeCusto,
  slugsLigados: ReadonlySet<string> | null = null
): { slug: string; nome: string }[] {
  const todos =
    time === "consultoria_obras"
      ? [
          { slug: "consultoria", nome: ROTULO_TIME.consultoria },
          { slug: "obras", nome: ROTULO_TIME.obras }
        ]
      : [{ slug: time, nome: ROTULO_TIME[time] }];
  if (!slugsLigados) return todos;
  return todos.filter((d) => slugsLigados.has(d.slug));
}

export function nomeClasse(slug: ClasseCusto): string {
  return ROTULO_CLASSE[slug];
}

/**
 * Operacional vs. máquinas — o plano de contas já desenha essa fronteira.
 * 4.02 (material/insumo de obra) entra em máquinas porque é ferramenta e
 * material de campo, não aluguel nem software.
 */
export function classeDe(categoriaCode: string | null): ClasseCusto {
  const c = categoriaCode ?? "";
  if (c === "8.01" || c === "8.03" || c === "4.02") return "maquinas";
  return "operacional";
}

export function chaveCusto(counterpartyId: number | null, categoryId: number): string {
  return `${counterpartyId ?? 0}:${categoryId}`;
}

/**
 * O banco rotula o mesmo DAS de três jeitos (Receita Federal, DAS-SIMPLES
 * NACIONAL, PIX sem favorecido). O grão da matriz é contraparte × categoria,
 * então viram três linhas para um único tributo 7.01.
 */
export function chaveAgrupamentoCusto(item: {
  categoriaCode: string;
  counterpartyId: number | null;
  categoryId: number;
}): string {
  if (item.categoriaCode === "7.01") return "grupo:7.01";
  return chaveCusto(item.counterpartyId, item.categoryId);
}

export function nomeAgrupadoCusto(itens: { nome: string; categoriaCode: string; categoriaNome: string }[]): string {
  const das = itens.find((i) => i.categoriaCode === "7.01");
  if (das) return das.categoriaNome;
  return itens[0]?.nome ?? "";
}

/** 6.% é gente; 4.01 é comissão paga a vendedor, também gente. */
export function categoriaEGente(code: string | null): boolean {
  if (!code) return false;
  return code.startsWith("6.") || code === "4.01";
}

/**
 * Rita (0168): papel Limpeza, 4.03, R$ 6.150 em 2026. O dono tirou da folha —
 * é faxina do escritório, bloco de aluguel/água, 50/50 consultoria-obras na
 * linha. Sem esta guarda o PIX dela somaria em Pessoas E em Custo da empresa.
 */
export const PAPEL_SERVICO_DA_CASA = "Limpeza";

export function sqlPessoaNaoEServicoDaCasa(aliasPessoa: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(aliasPessoa)) {
    throw new Error(`sqlPessoaNaoEServicoDaCasa: alias recusado (${aliasPessoa})`);
  }
  return `coalesce(${aliasPessoa}.role, '') <> '${PAPEL_SERVICO_DA_CASA}'`;
}

/**
 * Predicado SQL: a contraparte está ligada a alguém do roster, confirmada,
 * e não é serviço da casa (faxina). É o MESMO JOIN que Pessoas usa no grão.
 * Contar Kevin em Marketing aqui e lá somaria duas vezes; Rita é a exceção
 * explícita — serviço, não folha.
 *
 * `aliasId` é a coluna de counterparty_id (ex.: `t.counterparty_id`).
 */
export function sqlContraparteEPessoa(aliasId: string): string {
  if (!/^[a-z_]+\.counterparty_id$/.test(aliasId)) {
    throw new Error(`sqlContraparteEPessoa: alias recusado (${aliasId})`);
  }
  return (
    `EXISTS (SELECT 1 FROM fin_person_counterparty l ` +
    `JOIN fin_person _pe ON _pe.id = l.person_id ` +
    `WHERE l.counterparty_id = ${aliasId} AND l.status = 'confirmado' ` +
    `AND ${sqlPessoaNaoEServicoDaCasa("_pe")})`
  );
}
