"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { FunnelStageHistory } from "@/lib/analysis/types";
import {
  buildFunnelStackedRows,
  funnelMonthBreakdown,
  stageColor,
  type FunnelViewMode
} from "@/lib/analysis/funnel-stage-metrics";
import { brl } from "@/lib/analysis/format";

type Props = {
  history: FunnelStageHistory;
  pipelineId: number;
  mode: FunnelViewMode;
  selectedStageIds: Set<number>;
  selectedMonth: string | null;
  onSelectMonth: (month: string) => void;
};

function FunnelTooltip({
  active,
  payload,
  label,
  history,
  pipelineId,
  mode,
  selectedStageIds
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; color?: string; name?: string; payload?: { month?: string } }>;
  label?: string;
  history: FunnelStageHistory;
  pipelineId: number;
  mode: FunnelViewMode;
  selectedStageIds: Set<number>;
}) {
  if (!active || !payload?.length || !label) return null;

  const monthRow = payload[0]?.payload as { month?: string } | undefined;
  const month = monthRow?.month;
  if (!month) return null;

  const breakdown = funnelMonthBreakdown(history, pipelineId, mode, month, selectedStageIds);

  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      <ul>
        {breakdown.map((row, index) => (
          <li key={row.stageId} style={{ color: stageColor(index) }}>
            {row.stage}: {row.deals} neg. · {brl.format(row.value)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FunnelStageStackedChart({
  history,
  pipelineId,
  mode,
  selectedStageIds,
  selectedMonth,
  onSelectMonth
}: Props) {
  const pipeline = history.pipelines.find((item) => item.id === pipelineId);
  const data = buildFunnelStackedRows(history, pipelineId, mode, selectedStageIds);
  const stages = pipeline?.stages.filter((stage) => selectedStageIds.has(stage.id)) ?? [];

  if (!stages.length) {
    return <p className="chart-empty">Selecione ao menos uma etapa do funil.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        margin={{ top: 12, right: 12, left: 4, bottom: 0 }}
        onClick={(state) => {
          const month = state?.activePayload?.[0]?.payload?.month;
          if (typeof month === "string") onSelectMonth(month);
        }}
      >
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
        <Tooltip
          content={
            <FunnelTooltip
              history={history}
              pipelineId={pipelineId}
              mode={mode}
              selectedStageIds={selectedStageIds}
            />
          }
        />
        <Legend />
        {stages.map((stage, index) => (
          <Bar
            key={stage.id}
            dataKey={`s${stage.id}`}
            name={stage.name}
            stackId="funnel"
            fill={stageColor(index)}
            radius={index === stages.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            opacity={selectedMonth ? 0.72 : 1}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
