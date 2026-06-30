import { NextResponse } from "next/server";
import { buildIndicatorHistoryEnriched } from "@/lib/gestao-xpe/indicator-history-server";
import { loadGestaoCatalog, loadWeeklyRecords } from "@/lib/gestao-xpe/weekly-records-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("ids")?.trim();
  if (!idsParam) {
    return NextResponse.json({ error: "Parâmetro ids é obrigatório." }, { status: 400 });
  }

  const indicatorIds = idsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!indicatorIds.length) {
    return NextResponse.json({ error: "Nenhum indicador informado." }, { status: 400 });
  }

  const vendedor = searchParams.get("vendedor");
  const [catalog, records] = await Promise.all([loadGestaoCatalog(), loadWeeklyRecords()]);
  const payload = await buildIndicatorHistoryEnriched(catalog, records, indicatorIds, vendedor);
  return NextResponse.json(payload);
}
