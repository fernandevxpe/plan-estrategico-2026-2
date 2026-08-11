import "server-only";

import { agrupar, SQL_PENDENTES } from "@/scripts/lib/fin-qualificacao.mjs";

import { isFinanceConfigured, query } from "./db";

/**
 * A fila de qualificação para a tela.
 *
 * O motor mora em `scripts/lib/fin-qualificacao.mjs` e é o MESMO que o CLI usa.
 * Não é economia de digitação: o CLI e a tela precisam sugerir a mesma coisa
 * para o mesmo lançamento, sempre. Duas implementações que concordam hoje
 * divergem em silêncio na primeira correção feita só de um lado — e aí o dono
 * vê uma sugestão na tela, outra no terminal, e para de confiar nas duas.
 *
 * É o mesmo motivo pelo qual `lib/financeiro/db.ts` importa os parsers de tipo
 * de `scripts/lib/`: uma definição, dois consumidores.
 */

const ENTIDADE = "xpe";

export type FonteEvidencia = "transferencia" | "liquidacao" | "contraparte" | "padrao" | "valor";

export type SugestaoQualificacao = {
  fonte: FonteEvidencia;
  code: string;
  categoria: string;
  confianca: number;
  evidencia: string;
  documentoId: number | null;
  transferencia?: boolean;
  alternativas: Omit<SugestaoQualificacao, "alternativas">[];
};

export type ItemQualificacao = {
  id: number;
  postedOn: string;
  amountCents: number;
  descricao: string;
  conta: string;
};

export type GrupoQualificacao = {
  chave: string;
  rotulo: string;
  porContraparte: boolean;
  porItem: boolean;
  direcao: "entrada" | "saida";
  n: number;
  valorCents: number;
  maisRecente: string;
  maisAntigo: string;
  contas: string[];
  valorFixo: boolean;
  valoresDistintos: number;
  sugestao: SugestaoQualificacao | null;
  itens: ItemQualificacao[];
};

export type FilaQualificacao = {
  disponivel: boolean;
  ano: number;
  pendentes: { n: number; valorCents: number };
  grupos: GrupoQualificacao[];
  categorias: { code: string; name: string; kind: string }[];
  /** Quanto do ano já está classificado — o número que diz se a DRE fecha. */
  progresso: { classificados: number; total: number; valorClassificado: number; valorTotal: number };
};

export async function getFilaQualificacao(ano: number): Promise<FilaQualificacao> {
  const vazio: FilaQualificacao = {
    disponivel: false,
    ano,
    pendentes: { n: 0, valorCents: 0 },
    grupos: [],
    categorias: [],
    progresso: { classificados: 0, total: 0, valorClassificado: 0, valorTotal: 0 }
  };
  if (!isFinanceConfigured()) return vazio;

  const [linhas, categorias, progresso] = await Promise.all([
    query<Record<string, unknown>>(SQL_PENDENTES, [ENTIDADE, `${ano}-01-01`, `${ano}-12-31`]),
    query<{ code: string; name: string; kind: string }>(
      `SELECT c.code, c.name, c.kind FROM fin_category c
         JOIN fin_entity e ON e.id = c.entity_id AND e.slug = $1
        ORDER BY c.code`,
      [ENTIDADE]
    ),
    query<{ classificados: number; total: number; v_class: number; v_total: number }>(
      `SELECT count(*) FILTER (WHERE t.category_id IS NOT NULL) AS classificados,
              count(*) AS total,
              COALESCE(sum(abs(t.amount_cents)) FILTER (WHERE t.category_id IS NOT NULL), 0) AS v_class,
              COALESCE(sum(abs(t.amount_cents)), 0) AS v_total
         FROM fin_transaction t
         JOIN fin_entity e ON e.id = t.entity_id AND e.slug = $1
        WHERE extract(year FROM t.posted_on) = $2 AND t.transfer_status = 'nao'`,
      [ENTIDADE, ano]
    )
  ]);

  const grupos = (agrupar(linhas) as Record<string, unknown>[]).map((g) => ({
    chave: String(g.chave),
    rotulo: String(g.rotulo ?? ""),
    porContraparte: Boolean(g.porContraparte),
    porItem: Boolean(g.porItem),
    direcao: (g.direcao as "entrada" | "saida") ?? "saida",
    n: Number(g.n),
    valorCents: Number(g.valorCents),
    maisRecente: String(g.maisRecente),
    maisAntigo: String(g.maisAntigo),
    contas: (g.contas as string[]) ?? [],
    valorFixo: Boolean(g.valorFixo),
    valoresDistintos: Number(g.valoresDistintos ?? 1),
    sugestao: (g.sugestao as SugestaoQualificacao | null) ?? null,
    itens: ((g.itens as Record<string, unknown>[]) ?? []).map((i) => ({
      id: Number(i.id),
      postedOn: String(i.posted_on),
      amountCents: Number(i.amount_cents),
      descricao: String(i.description_raw ?? i.padrao ?? ""),
      conta: String(i.conta ?? "")
    }))
  }));

  const p = progresso[0];
  return {
    disponivel: true,
    ano,
    pendentes: {
      n: linhas.length,
      valorCents: linhas.reduce((s, l) => s + Math.abs(Number(l.amount_cents)), 0)
    },
    grupos,
    categorias,
    progresso: {
      classificados: Number(p?.classificados ?? 0),
      total: Number(p?.total ?? 0),
      valorClassificado: Number(p?.v_class ?? 0),
      valorTotal: Number(p?.v_total ?? 0)
    }
  };
}
