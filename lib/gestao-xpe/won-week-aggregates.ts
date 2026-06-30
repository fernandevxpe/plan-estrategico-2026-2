import "server-only";

import { filterBySeller, loadWonDealRows } from "@/lib/gestao-xpe/crm-deals-server";
import { getISOWeekKey } from "@/lib/gestao-xpe/week-utils";

export type WonWeekAggregate = { qtd: number; valor: number };

export async function buildWonAggregatesByWeek(
  vendedor?: string | null
): Promise<Map<string, WonWeekAggregate>> {
  const wonRows = await loadWonDealRows();
  const scoped = filterBySeller(wonRows, vendedor);
  const byWeek = new Map<string, WonWeekAggregate>();

  for (const row of scoped) {
    const wonDate = row.wonTime?.trim().slice(0, 10);
    if (!wonDate) continue;
    const weekKey = getISOWeekKey(new Date(`${wonDate}T12:00:00`));
    const cur = byWeek.get(weekKey) ?? { qtd: 0, valor: 0 };
    cur.qtd += 1;
    cur.valor += row.value;
    byWeek.set(weekKey, cur);
  }

  return byWeek;
}

export function wonValueForWeek(
  byWeek: Map<string, WonWeekAggregate>,
  weekKey: string,
  indicatorId: "fechamentos-qtd" | "fechamentos-valor"
): number {
  const hit = byWeek.get(weekKey);
  if (!hit) return 0;
  return indicatorId === "fechamentos-valor" ? Math.round(hit.valor) : hit.qtd;
}
