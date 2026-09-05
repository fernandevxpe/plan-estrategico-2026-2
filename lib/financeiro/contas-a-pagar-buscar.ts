import "server-only";

import { isFinanceConfigured, query } from "./db";

const ENTITY = "xpe";

/**
 * Busca textual no histórico da plataforma para preencher o painel Adicionar.
 *
 * A fonte é a agenda (o que já foi previsto/pago) — não o ledger puro — porque
 * a pergunta do dono é "quanto eu costumo pagar de X", e a agenda já amarra
 * descrição, favorecido, categoria e dia. DISTINCT ON pelo trio
 * (descrição normalizada, contraparte, categoria) devolve a ocorrência mais
 * recente de cada combinação: o último valor vira referência, não média.
 */

export type ResultadoBuscaConta = {
  descricao: string;
  valorCents: number;
  dia: string;
  diaDoMes: number;
  competencia: string;
  counterpartyId: number | null;
  contraparte: string | null;
  categoryId: number | null;
  categoriaCode: string | null;
  categoriaNome: string | null;
  /** Chave da obrigação nesta competência — se existir, dá para anexar boleto nela. */
  chaveDedupe: string | null;
  itemId: number | null;
  /** Quantas vezes este trio apareceu nos últimos 24 meses. */
  ocorrencias: number;
};

export async function buscarHistoricoContas(texto: string): Promise<{
  disponivel: boolean;
  resultados: ResultadoBuscaConta[];
  ressalva: string | null;
}> {
  const q = texto.trim().replace(/\s+/g, " ");
  if (q.length < 2) {
    return { disponivel: true, resultados: [], ressalva: "digite ao menos 2 caracteres" };
  }
  if (!isFinanceConfigured()) {
    return { disponivel: false, resultados: [], ressalva: "sem conexão com o banco do financeiro" };
  }

  try {
    const like = `%${q}%`;
    const rows = await query<{
      descricao: string;
      valor_cents: number;
      dia: string;
      dia_do_mes: number;
      competencia: string;
      counterparty_id: number | null;
      contraparte: string | null;
      category_id: number | null;
      categoria_code: string | null;
      categoria: string | null;
      chave_dedupe: string;
      item_id: number | null;
      ocorrencias: number;
    }>(
      `WITH base AS (
         SELECT v.descricao,
                v.valor_cents,
                v.dia::text AS dia,
                EXTRACT(day FROM v.dia)::int AS dia_do_mes,
                to_char(v.competencia, 'YYYY-MM') AS competencia,
                v.counterparty_id,
                v.contraparte,
                v.category_id,
                v.categoria_code,
                v.categoria,
                v.chave_dedupe,
                v.item_id,
                lower(trim(v.descricao)) AS desc_n,
                COALESCE(v.counterparty_id, 0) AS cp_n,
                COALESCE(v.category_id, 0) AS cat_n
           FROM fin_agenda_dia_v v
           JOIN fin_entity e ON e.id = v.entity_id AND e.slug = $1
          WHERE v.direcao = 'pagar'
            AND v.dia >= (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '24 months')
            AND (
              v.descricao ILIKE $2
              OR COALESCE(v.contraparte, '') ILIKE $2
              OR COALESCE(v.categoria, '') ILIKE $2
              OR COALESCE(v.categoria_code, '') ILIKE $2
            )
            AND COALESCE(v.estado, '') NOT IN ('cancelado')
            AND v.valor_cents > 0
       ),
       contagem AS (
         SELECT desc_n, cp_n, cat_n, count(*)::int AS ocorrencias
           FROM base
          GROUP BY 1, 2, 3
       )
       SELECT DISTINCT ON (b.desc_n, b.cp_n, b.cat_n)
              b.descricao, b.valor_cents, b.dia, b.dia_do_mes, b.competencia,
              b.counterparty_id, b.contraparte, b.category_id,
              b.categoria_code, b.categoria, b.chave_dedupe, b.item_id,
              c.ocorrencias
         FROM base b
         JOIN contagem c ON c.desc_n = b.desc_n AND c.cp_n = b.cp_n AND c.cat_n = b.cat_n
        ORDER BY b.desc_n, b.cp_n, b.cat_n, b.dia DESC
        LIMIT 25`,
      [ENTITY, like]
    );

    return {
      disponivel: true,
      resultados: rows.map((r) => ({
        descricao: String(r.descricao),
        valorCents: Number(r.valor_cents),
        dia: String(r.dia),
        diaDoMes: Number(r.dia_do_mes),
        competencia: String(r.competencia),
        counterpartyId: r.counterparty_id == null ? null : Number(r.counterparty_id),
        contraparte: r.contraparte == null ? null : String(r.contraparte),
        categoryId: r.category_id == null ? null : Number(r.category_id),
        categoriaCode: r.categoria_code == null ? null : String(r.categoria_code),
        categoriaNome: r.categoria == null ? null : String(r.categoria),
        chaveDedupe: r.chave_dedupe == null ? null : String(r.chave_dedupe),
        itemId: r.item_id == null ? null : Number(r.item_id),
        ocorrencias: Number(r.ocorrencias)
      })),
      ressalva: rows.length === 0 ? "nenhum registro bateu com a busca" : null
    };
  } catch (error) {
    console.error("[financeiro] buscar histórico contas:", error);
    return { disponivel: false, resultados: [], ressalva: "a busca falhou — ver log do servidor" };
  }
}
