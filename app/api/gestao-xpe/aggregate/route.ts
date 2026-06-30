import type { GestaoPeriodo } from "@/lib/gestao-xpe/catalog-types";
import { aggregatePeriod } from "@/lib/gestao-xpe/aggregations";
import { loadGestaoCatalog, loadWeeklyRecords } from "@/lib/gestao-xpe/weekly-records-store";
import { defaultPeriodAnchor, weekKeysInPeriod } from "@/lib/gestao-xpe/week-utils";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const periodo = (searchParams.get("periodo") ?? "semanal") as GestaoPeriodo;
  const chave = searchParams.get("chave") ?? defaultPeriodAnchor(periodo).chave;

  const anchor = { periodo, chave, label: "" };
  const [catalog, records] = await Promise.all([loadGestaoCatalog(), loadWeeklyRecords()]);
  const weekKeys = weekKeysInPeriod(anchor);
  const aggregated = aggregatePeriod(catalog, records, anchor);

  return Response.json({
    aggregated,
    weekKeys,
    semanasNoPeriodo: weekKeys.length
  });
}
