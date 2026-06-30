import { getOrCreateWeek, listWeekSummaries, loadWeeklyRecords } from "@/lib/gestao-xpe/weekly-records-store";
import { getISOWeekKey } from "@/lib/gestao-xpe/week-utils";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ensure = searchParams.get("ensure");

  if (ensure === "current") {
    const weekKey = getISOWeekKey();
    await getOrCreateWeek(weekKey);
  }

  const file = await loadWeeklyRecords();
  return Response.json({ semanas: listWeekSummaries(file) });
}
