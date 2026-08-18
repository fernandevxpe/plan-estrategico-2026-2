import { query } from "@/lib/financeiro/db";
import { dataDe, rotaDeLeitura, ParametroInvalido } from "@/lib/financeiro/contratos/http";

export const dynamic = "force-dynamic";

const ENTITY = "xpe";

/**
 * GET /api/financeiro/gerencial/receita-composicao?de=YYYY-MM-DD&ate=YYYY-MM-DD
 *
 * De que categoria veio a receita num período — o clique num mês, trimestre
 * ou semestre do gráfico do painel. Mesma fonte (`fin_revenue_cash_v`) e
 * mesmo período que a barra clicada representa, nunca um recorte diferente
 * que faria o total daqui divergir do total que a pessoa acabou de ver.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const de = dataDe(sp, "de");
  const ate = dataDe(sp, "ate");
  if (!de) throw new ParametroInvalido("de", "de é obrigatório (YYYY-MM-DD)");
  if (!ate) throw new ParametroInvalido("ate", "ate é obrigatório (YYYY-MM-DD)");
  if (de > ate) throw new ParametroInvalido("de", "de não pode ser depois de ate");

  const linhas = await query<{ categoria: string | null; total: string; n: string }>(
    `SELECT cat.name AS categoria, SUM(v.amount_cents)::text AS total, count(*)::text AS n
       FROM fin_revenue_cash_v v
       JOIN fin_entity e ON e.id = v.entity_id
       LEFT JOIN fin_category cat ON cat.id = v.category_id
      WHERE e.slug = $1 AND v.posted_on >= $2::date AND v.posted_on <= $3::date
      GROUP BY 1 ORDER BY 2 DESC`,
    [ENTITY, de, ate]
  );

  const composicao = linhas.map((l) => ({
    categoria: l.categoria ?? "sem categoria",
    totalCents: Number(l.total),
    lancamentos: Number(l.n)
  }));
  const totalCents = composicao.reduce((s, c) => s + c.totalCents, 0);

  return Response.json(
    { de, ate, totalCents, composicao },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
});
