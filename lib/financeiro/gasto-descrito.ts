import "server-only";

import { query } from "@/lib/financeiro/db";

const ENTITY = "xpe";

/**
 * O painel do gasto DESCRITO — cortado por forma, área, tipo, pessoa e mês.
 *
 * ---------------------------------------------------------------------------
 * POR QUE OS CORTES VÊM DO BANCO, E NÃO DE UM `reduce` NA TELA
 * ---------------------------------------------------------------------------
 * Seriam cinco agrupamentos sobre a mesma lista, e trazer tudo para agrupar em
 * JavaScript funciona hoje, com 194 linhas. Com dois anos de app são dezenas de
 * milhares, e a tela começaria a demorar sem ninguém entender por quê.
 *
 * Somar é o que o Postgres faz melhor, e cada corte é uma consulta que ele
 * resolve num passe. O custo é uma ida a mais ao banco; o ganho é a tela não
 * mudar de comportamento quando o volume crescer.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTES NÚMEROS NÃO SÃO
 * ---------------------------------------------------------------------------
 * Não são a DRE e não são o extrato. São o que PESSOAS descreveram: o custo que
 * alguém fotografou, o reembolso que alguém pediu. `fin_transaction` é o que
 * aconteceu na conta.
 *
 * A divergência entre os dois não é erro — é a fila do financeiro. Somar os
 * dois contaria a mesma compra duas vezes, e é por isso que este módulo não
 * toca em `fin_transaction` em consulta nenhuma.
 */

export type Fatia = {
  chave: string;
  rotulo: string;
  cents: number;
  n: number;
  /** Só para a forma de pagamento e o cartão: a cor que a tela usa na barra. */
  cor?: string | null;
};

export type LinhaGasto = {
  origem: string;
  code: string;
  titulo: string;
  data: string | null;
  mes: string;
  valorCents: number;
  parcelas: number | null;
  forma: string;
  pessoa: string;
  categoria: string | null;
  centro: string | null;
  tipoReembolso: string | null;
  banco: string | null;
  final: string | null;
  status: string;
  anexos: number;
};

export type PainelDescrito = {
  disponivel: boolean;
  totalCents: number;
  quantidade: number;
  /** Quanto do total ainda não tem categoria. É o número que mais importa. */
  semCategoriaCents: number;
  semAreaCents: number;
  semComprovante: number;
  porForma: Fatia[];
  porArea: Fatia[];
  porCategoria: Fatia[];
  porPessoa: Fatia[];
  porMes: Fatia[];
  linhas: LinhaGasto[];
};

const FORMA_ROTULO: Record<string, string> = {
  cartao: "Cartão da empresa",
  pix: "PIX da empresa",
  boleto: "Boleto",
  debito: "Débito automático",
  reembolso: "Do bolso (reembolso)",
  indefinido: "Forma não informada"
};

const FORMA_COR: Record<string, string> = {
  cartao: "var(--purple)",
  pix: "var(--cert-ok, #0d7a5f)",
  boleto: "var(--ink-amber)",
  debito: "#1e5fd4",
  reembolso: "#d6449b",
  indefinido: "var(--muted)"
};

/**
 * @param formas quando informado, restringe o painel a essas formas de
 *   pagamento. A tela de cartões passa `["cartao"]`; a de custos não passa
 *   nada e vê tudo, inclusive reembolso.
 */
export async function getPainelDescrito(formas?: string[]): Promise<PainelDescrito> {
  const filtro = formas?.length ? `AND v.forma = ANY($2::text[])` : "";
  const args: unknown[] = formas?.length ? [ENTITY, formas] : [ENTITY];
  const base = `FROM fin_gasto_descrito_v v
     JOIN fin_entity e ON e.id = v.entity_id AND e.slug = $1
    WHERE true ${filtro}`;

  try {
    const [resumo, porForma, porArea, porCategoria, porPessoa, porMes, linhas] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT count(*)::int AS n,
                coalesce(sum(v.amount_cents), 0)::bigint AS total,
                coalesce(sum(v.amount_cents) FILTER (WHERE v.categoria_code IS NULL), 0)::bigint AS sem_categoria,
                coalesce(sum(v.amount_cents) FILTER (WHERE v.centro IS NULL), 0)::bigint AS sem_area,
                count(*) FILTER (WHERE v.anexos = 0)::int AS sem_comprovante
           ${base}`,
        args
      ),
      query<Record<string, unknown>>(
        `SELECT v.forma AS chave, count(*)::int AS n, sum(v.amount_cents)::bigint AS cents
           ${base} GROUP BY 1 ORDER BY 3 DESC`,
        args
      ),
      query<Record<string, unknown>>(
        `SELECT coalesce(v.centro, '— sem área —') AS chave, count(*)::int AS n, sum(v.amount_cents)::bigint AS cents
           ${base} GROUP BY 1 ORDER BY 3 DESC`,
        args
      ),
      query<Record<string, unknown>>(
        `SELECT coalesce(v.categoria_code || ' ' || v.categoria,
                         coalesce('reembolso: ' || v.tipo_reembolso, '— sem categoria —')) AS chave,
                count(*)::int AS n, sum(v.amount_cents)::bigint AS cents
           ${base} GROUP BY 1 ORDER BY 3 DESC LIMIT 14`,
        args
      ),
      query<Record<string, unknown>>(
        `SELECT v.pessoa AS chave, count(*)::int AS n, sum(v.amount_cents)::bigint AS cents
           ${base} GROUP BY 1 ORDER BY 3 DESC LIMIT 12`,
        args
      ),
      query<Record<string, unknown>>(
        // Ordem CRESCENTE: o histórico é lido da esquerda para a direita, e
        // inverter na tela seria trabalho que o banco já faz de graça.
        `SELECT to_char(v.mes, 'YYYY-MM') AS chave, count(*)::int AS n, sum(v.amount_cents)::bigint AS cents
           ${base} GROUP BY 1 ORDER BY 1`,
        args
      ),
      query<Record<string, unknown>>(
        `SELECT v.origem, v.code, v.titulo, v.data, to_char(v.mes, 'YYYY-MM') AS mes,
                v.amount_cents, v.parcelas, v.forma, v.pessoa, v.status, v.anexos,
                v.categoria_code, v.categoria, v.centro, v.tipo_reembolso, v.banco, v.card_last4
           ${base}
          ORDER BY v.mes DESC, v.amount_cents DESC
          LIMIT 300`,
        args
      )
    ]);

    const fatias = (rows: Record<string, unknown>[], rotulo?: (k: string) => string, cor?: (k: string) => string) =>
      rows.map((r) => ({
        chave: String(r.chave),
        rotulo: rotulo ? rotulo(String(r.chave)) : String(r.chave),
        cents: Number(r.cents ?? 0),
        n: Number(r.n ?? 0),
        cor: cor ? cor(String(r.chave)) : null
      }));

    const r0 = resumo[0] ?? {};
    return {
      disponivel: true,
      totalCents: Number(r0.total ?? 0),
      quantidade: Number(r0.n ?? 0),
      semCategoriaCents: Number(r0.sem_categoria ?? 0),
      semAreaCents: Number(r0.sem_area ?? 0),
      semComprovante: Number(r0.sem_comprovante ?? 0),
      porForma: fatias(porForma, (k) => FORMA_ROTULO[k] ?? k, (k) => FORMA_COR[k] ?? "var(--muted)"),
      porArea: fatias(porArea),
      porCategoria: fatias(porCategoria),
      porPessoa: fatias(porPessoa),
      porMes: fatias(porMes, (k) => {
        const [ano, mes] = k.split("-");
        return `${mes}/${ano.slice(2)}`;
      }),
      linhas: linhas.map((l) => ({
        origem: String(l.origem),
        code: String(l.code),
        titulo: String(l.titulo),
        data: l.data ? String(l.data).slice(0, 10) : null,
        mes: String(l.mes),
        valorCents: Number(l.amount_cents ?? 0),
        parcelas: l.parcelas == null ? null : Number(l.parcelas),
        forma: String(l.forma),
        pessoa: String(l.pessoa),
        categoria: l.categoria ? `${l.categoria_code} ${l.categoria}` : null,
        centro: (l.centro as string) ?? null,
        tipoReembolso: (l.tipo_reembolso as string) ?? null,
        banco: (l.banco as string) ?? null,
        final: (l.card_last4 as string) ?? null,
        status: String(l.status),
        anexos: Number(l.anexos ?? 0)
      }))
    };
  } catch {
    // A view é da 0151/0152. Onde ela não existe, o painel some em vez de
    // derrubar a página inteira — que responde outras perguntas e continua
    // válida sem esta.
    return {
      disponivel: false,
      totalCents: 0,
      quantidade: 0,
      semCategoriaCents: 0,
      semAreaCents: 0,
      semComprovante: 0,
      porForma: [],
      porArea: [],
      porCategoria: [],
      porPessoa: [],
      porMes: [],
      linhas: []
    };
  }
}

export { FORMA_ROTULO };
