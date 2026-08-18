import { query } from "@/lib/financeiro/db";
import { anoDe, rotaDeLeitura, ParametroInvalido } from "@/lib/financeiro/contratos/http";

export const dynamic = "force-dynamic";

const ENTITY = "xpe";

/**
 * GET /api/financeiro/gerencial/receita-serie?ano=2026
 *
 * Os 12 meses de um ano civil, em fin_revenue_cash_v — a MESMA fonte que já
 * alimenta o gráfico padrão de `lib/financeiro/painel.ts` (35 meses
 * rolantes). Esta rota existe só para o seletor de ano do drill-down: o
 * gráfico nasce com os 35 meses que o servidor já manda, e só busca aqui
 * quando alguém escolhe um ano fora dessa janela.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const ano = anoDe(sp, "ano");
  if (!ano) throw new ParametroInvalido("ano", "ano é obrigatório");

  const linhas = await query<{ mes: string; total: string }>(
    `SELECT to_char(v.month, 'YYYY-MM-01') AS mes, COALESCE(SUM(v.amount_cents), 0)::text AS total
       FROM fin_revenue_cash_v v JOIN fin_entity e ON e.id = v.entity_id
      WHERE e.slug = $1 AND v.month >= make_date($2, 1, 1) AND v.month < make_date($2 + 1, 1, 1)
      GROUP BY 1 ORDER BY 1`,
    [ENTITY, ano]
  );

  const porMes = new Map(linhas.map((l) => [l.mes, Number(l.total)]));
  const hoje = new Date();
  const mesAtualIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;

  const serie = Array.from({ length: 12 }, (_, i) => {
    const mes = `${ano}-${String(i + 1).padStart(2, "0")}-01`;
    return {
      mes,
      receitaCents: porMes.get(mes) ?? 0,
      parcial: mes === mesAtualIso
    };
  });

  return Response.json(
    { ano, serie },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
});
