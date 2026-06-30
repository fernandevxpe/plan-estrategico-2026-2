import type { GestaoPeriodo } from "@/lib/gestao-xpe/catalog-types";
import { buildCrmPeriodMetrics } from "@/lib/gestao-xpe/crm-week-metrics";
import { defaultPeriodAnchor } from "@/lib/gestao-xpe/week-utils";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const periodo = (searchParams.get("periodo") ?? "semanal") as GestaoPeriodo;
  const chave = searchParams.get("chave") ?? defaultPeriodAnchor(periodo).chave;
  const vendedor = searchParams.get("vendedor");

  const metrics = await buildCrmPeriodMetrics({ periodo, chave, label: "" }, vendedor);
  return Response.json(metrics);
}
