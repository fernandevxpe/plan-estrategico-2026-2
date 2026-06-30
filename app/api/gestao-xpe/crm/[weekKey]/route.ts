import { buildCrmWeekMetrics } from "@/lib/gestao-xpe/crm-week-metrics";

type RouteParams = { params: Promise<{ weekKey: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const { weekKey } = await params;
  const vendedor = new URL(request.url).searchParams.get("vendedor");
  const metrics = await buildCrmWeekMetrics(decodeURIComponent(weekKey), vendedor);
  return Response.json(metrics);
}
