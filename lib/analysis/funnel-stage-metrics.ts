import type { FunnelStageHistory, FunnelStageMonthlyRow } from "./types";

export type FunnelViewMode = "entries" | "stock";

export type FunnelStackedRow = {
  month: string;
  label: string;
  total: number;
  totalValue: number;
  [key: string]: string | number;
};

const STAGE_COLORS = [
  "#2368a0",
  "#21a67a",
  "#b67818",
  "#7c3aed",
  "#e5484d",
  "#0f766e",
  "#64727a",
  "#d97706"
];

export function getFunnelStageHistory(analysis: { funnelStageHistory?: FunnelStageHistory }) {
  return analysis.funnelStageHistory ?? null;
}

export function stageColor(stageIndex: number) {
  return STAGE_COLORS[stageIndex % STAGE_COLORS.length];
}

export function buildFunnelStackedRows(
  history: FunnelStageHistory,
  pipelineId: number,
  mode: FunnelViewMode,
  selectedStageIds: Set<number>
): FunnelStackedRow[] {
  const pipeline = history.pipelines.find((item) => item.id === pipelineId);
  if (!pipeline) return [];

  const source = mode === "entries" ? history.entries : history.stock;
  const stages = pipeline.stages.filter((stage) => selectedStageIds.has(stage.id));

  return history.months.map(({ month, label }) => {
    const row: FunnelStackedRow = { month, label, total: 0, totalValue: 0 };
    for (const stage of stages) {
      const key = `s${stage.id}`;
      const match = source.find(
        (item) => item.month === month && item.pipelineId === pipelineId && item.stageId === stage.id
      );
      const deals = match?.deals ?? 0;
      const value = match?.value ?? 0;
      row[key] = deals;
      row[`v${stage.id}`] = value;
      row.total += deals;
      row.totalValue += value;
    }
    return row;
  });
}

export function funnelMonthBreakdown(
  history: FunnelStageHistory,
  pipelineId: number,
  mode: FunnelViewMode,
  month: string,
  selectedStageIds: Set<number>
) {
  const pipeline = history.pipelines.find((item) => item.id === pipelineId);
  if (!pipeline) return [];

  const source = mode === "entries" ? history.entries : history.stock;
  return pipeline.stages
    .filter((stage) => selectedStageIds.has(stage.id))
    .map((stage) => {
      const match = source.find(
        (item) => item.month === month && item.pipelineId === pipelineId && item.stageId === stage.id
      );
      return {
        stageId: stage.id,
        stage: stage.name,
        order: stage.order,
        deals: match?.deals ?? 0,
        value: match?.value ?? 0
      };
    })
    .filter((row) => row.deals > 0)
    .sort((a, b) => a.order - b.order);
}

export function hasFunnelFlowData(history: FunnelStageHistory) {
  return history.entries.length > 0 || history.stock.length > 0;
}

export function sumFunnelRows(rows: FunnelStageMonthlyRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.deals += row.deals;
      acc.value += row.value;
      return acc;
    },
    { deals: 0, value: 0 }
  );
}
