import "server-only";

import type { PeriodAnchor } from "@/lib/gestao-xpe/catalog-types";
import { buildCommercialCrmMetrics } from "@/lib/gestao-xpe/crm-commercial-metrics";
import type { CrmWeekMetrics } from "@/lib/gestao-xpe/crm-week-sync";
import { periodAnchorToDateRange, weekKeyToIsoDates } from "@/lib/gestao-xpe/week-utils";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Analysis } from "@/lib/analysis/types";
import { readProcessed } from "@/lib/data/processed-store";

export type { CrmWeekMetrics } from "@/lib/gestao-xpe/crm-week-sync";

async function loadAnalysis(): Promise<Analysis> {
    return await readProcessed<any>("analysis.json") as Analysis;
}

export async function buildCrmWeekMetrics(
  weekKey: string,
  vendedor?: string | null
): Promise<CrmWeekMetrics> {
  const { weekStart, weekEnd } = weekKeyToIsoDates(weekKey);
  const analysis = await loadAnalysis();
  return buildCommercialCrmMetrics(weekStart, weekEnd, weekKey, vendedor, analysis);
}

export async function buildCrmPeriodMetrics(
  anchor: PeriodAnchor,
  vendedor?: string | null
): Promise<CrmWeekMetrics> {
  const { start, end } = periodAnchorToDateRange(anchor);
  const analysis = await loadAnalysis();
  return buildCommercialCrmMetrics(start, end, anchor.chave, vendedor, analysis);
}
