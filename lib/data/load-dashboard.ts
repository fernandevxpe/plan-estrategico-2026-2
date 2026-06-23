import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildAreasDashboard } from "@/lib/areas/build-areas-dashboard";
import type { AreasDashboard } from "@/lib/areas/types";
import type { Analysis } from "@/lib/analysis/types";

export type DashboardData = {
  analysis: Analysis;
  areasDashboard: AreasDashboard;
  generatedAt: string;
};

export async function loadDashboardData(): Promise<DashboardData> {
  const file = path.join(process.cwd(), "data/processed/analysis.json");
  const analysis: Analysis = JSON.parse(await readFile(file, "utf8"));
  const areasDashboard = buildAreasDashboard(analysis);
  const generatedAt = new Date(analysis.generatedAt).toLocaleString("pt-BR");
  return { analysis, areasDashboard, generatedAt };
}
