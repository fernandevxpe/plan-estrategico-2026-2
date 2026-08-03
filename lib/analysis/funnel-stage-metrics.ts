import type { FunnelStageHistory, FunnelStageMonthlyRow } from "./types";

export type FunnelViewMode = "entries" | "stock";
export type PipelineFilter = number | "all";
export type FunnelMetricMode = "deals" | "value";

export type FunnelStageDisplay = {
  pipelineId: number;
  pipelineName: string;
  stageId: number;
  stageName: string;
  label: string;
  order: number;
};

export type FunnelStackedRow = {
  month: string;
  label: string;
  total: number;
  totalValue: number;
  [key: string]: string | number;
};

const STAGE_COLORS = [
  "#6d28d9",
  "#21a67a",
  "#b67818",
  "#7c3aed",
  "#e5484d",
  "#0f766e",
  "#64727a",
  "#d97706",
  "#0891b2",
  "#be185d",
  "#4d7c0f"
];

const PIPELINE_SHORT: Record<number, string> = {
  11: "Laudos",
  14: "Obras"
};

export function getFunnelStageHistory(analysis: { funnelStageHistory?: FunnelStageHistory }) {
  return analysis.funnelStageHistory ?? null;
}

export function stageColor(stageIndex: number) {
  return STAGE_COLORS[stageIndex % STAGE_COLORS.length];
}

export function pipelineShortName(pipelineId: number, pipelineName: string) {
  return PIPELINE_SHORT[pipelineId] ?? pipelineName;
}

export function stageDisplayLabel(pipelineId: number, pipelineName: string, stageName: string) {
  return `${pipelineShortName(pipelineId, pipelineName)} · ${stageName}`;
}

export function getVisibleStages(
  history: FunnelStageHistory,
  pipelineFilter: PipelineFilter,
  selectedStageIds: Set<number>
): FunnelStageDisplay[] {
  const pipelines =
    pipelineFilter === "all"
      ? history.pipelines
      : history.pipelines.filter((item) => item.id === pipelineFilter);

  return pipelines.flatMap((pipeline) =>
    pipeline.stages
      .filter((stage) => selectedStageIds.has(stage.id))
      .map((stage) => ({
        pipelineId: pipeline.id,
        pipelineName: pipeline.name,
        stageId: stage.id,
        stageName: stage.name,
        label: stageDisplayLabel(pipeline.id, pipeline.name, stage.name),
        order: stage.order
      }))
  );
}

export function metricKey(stageId: number, metricMode: FunnelMetricMode) {
  return metricMode === "value" ? `v${stageId}` : `s${stageId}`;
}

export function buildFunnelStackedRows(
  history: FunnelStageHistory,
  pipelineFilter: PipelineFilter,
  mode: FunnelViewMode,
  selectedStageIds: Set<number>,
  metricMode: FunnelMetricMode = "deals"
): FunnelStackedRow[] {
  const stages = getVisibleStages(history, pipelineFilter, selectedStageIds);
  if (!stages.length) return [];

  const source = mode === "entries" ? history.entries : history.stock;

  return history.months.map(({ month, label }) => {
    const row: FunnelStackedRow = { month, label, total: 0, totalValue: 0 };
    for (const stage of stages) {
      const key = metricKey(stage.stageId, metricMode);
      const match = source.find(
        (item) =>
          item.month === month &&
          item.pipelineId === stage.pipelineId &&
          item.stageId === stage.stageId
      );
      const deals = match?.deals ?? 0;
      const value = match?.value ?? 0;
      row[`s${stage.stageId}`] = deals;
      row[`v${stage.stageId}`] = value;
      row[key] = metricMode === "value" ? value : deals;
      row.total += deals;
      row.totalValue += value;
    }
    return row;
  });
}

export function funnelMonthBreakdown(
  history: FunnelStageHistory,
  pipelineFilter: PipelineFilter,
  mode: FunnelViewMode,
  month: string,
  selectedStageIds: Set<number>
) {
  const stages = getVisibleStages(history, pipelineFilter, selectedStageIds);
  const source = mode === "entries" ? history.entries : history.stock;

  return stages
    .map((stage) => {
      const match = source.find(
        (item) =>
          item.month === month &&
          item.pipelineId === stage.pipelineId &&
          item.stageId === stage.stageId
      );
      return {
        stageId: stage.stageId,
        pipelineId: stage.pipelineId,
        stage: stage.label,
        order: stage.order,
        deals: match?.deals ?? 0,
        value: match?.value ?? 0
      };
    })
    .filter((row) => row.deals > 0 || row.value > 0)
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

export function allStageIdsForPipelines(history: FunnelStageHistory, pipelineFilter: PipelineFilter) {
  const pipelines =
    pipelineFilter === "all"
      ? history.pipelines
      : history.pipelines.filter((item) => item.id === pipelineFilter);
  return new Set(pipelines.flatMap((pipeline) => pipeline.stages.map((stage) => stage.id)));
}
