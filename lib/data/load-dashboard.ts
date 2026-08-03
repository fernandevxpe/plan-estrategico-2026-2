import { readProcessed } from "@/lib/data/processed-store";
import { buildAreasDashboard } from "@/lib/areas/build-areas-dashboard";
import type { AreasDashboard } from "@/lib/areas/types";
import type { Analysis } from "@/lib/analysis/types";

export type DashboardData = {
  analysis: Analysis;
  areasDashboard: AreasDashboard;
  generatedAt: string;
};

export async function loadDashboardData(): Promise<DashboardData> {
  const analysis = await readProcessed<Analysis>("analysis.json");
  const areasDashboard = buildAreasDashboard(analysis);
  const generatedAt = new Date(analysis.generatedAt).toLocaleString("pt-BR");
  return { analysis, areasDashboard, generatedAt };
}
