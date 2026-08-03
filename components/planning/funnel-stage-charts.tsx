"use client";

import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { ToggleLegend, useLegendToggle, type LegendSeries } from "@/components/charts/useLegendToggle";
import type { ConversionMonthRow } from "@/lib/analysis/types";
import type { FunnelStageChartRow } from "@/lib/analysis/conversion-metrics";
import {
  buildFunnelStackedRows,
  funnelMonthBreakdown,
  getVisibleStages,
  metricKey,
  stageColor,
  type FunnelMetricMode,
  type FunnelViewMode,
  type PipelineFilter
} from "@/lib/analysis/funnel-stage-metrics";
import type { FunnelStageHistory } from "@/lib/analysis/types";
import { brl } from "@/lib/analysis/format";

export type FunnelTimeSeriesId = "averageDaysToWin" | "ganhosAntigosSharePct";

type Props = {
  history: FunnelStageHistory;
  pipelineFilter: PipelineFilter;
  mode: FunnelViewMode;
  metricMode: FunnelMetricMode;
  selectedStageIds: Set<number>;
  selectedMonth: string | null;
  enabledTimeSeries: Set<FunnelTimeSeriesId>;
  conversionMonths: ConversionMonthRow[];
  onSelectMonth: (month: string) => void;
};

function FunnelTooltip({
  active,
  payload,
  label,
  history,
  pipelineFilter,
  mode,
  selectedStageIds,
  conversionMonths
}: {
  active?: boolean;
  payload?: Array<{
    dataKey?: string;
    value?: number;
    color?: string;
    name?: string;
    payload?: FunnelStageChartRow;
  }>;
  label?: string;
  history: FunnelStageHistory;
  pipelineFilter: PipelineFilter;
  mode: FunnelViewMode;
  selectedStageIds: Set<number>;
  conversionMonths: ConversionMonthRow[];
}) {
  if (!active || !payload?.length || !label) return null;

  const monthRow = payload[0]?.payload as FunnelStageChartRow | undefined;
  const month = monthRow?.month;
  if (!month) return null;

  const breakdown = funnelMonthBreakdown(history, pipelineFilter, mode, month, selectedStageIds);
  const conversion = conversionMonths.find((row) => row.month === month);

  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {conversion?.wonDeals ? (
        <p className="commercial-funnel-cohort-note">
          Ganhos: {conversion.wonDeals} · média {Math.round(conversion.averageDaysToWin ?? 0)}d
          {conversion.ganhosAntigosSharePct != null
            ? ` · antigos (>1M) ${conversion.ganhosAntigosSharePct.toFixed(0)}%`
            : ""}
        </p>
      ) : null}
      <ul>
        {breakdown.map((row, index) => (
          <li key={`${row.pipelineId}-${row.stageId}`} style={{ color: stageColor(index) }}>
            {row.stage}: {row.deals} neg. · {brl.format(row.value)}
          </li>
        ))}
      </ul>
      {conversion ? (
        <p className="commercial-funnel-cohort-note">
          Fechamento: M {conversion.winLagM0Pct?.toFixed(0)}% · M−1 {conversion.winLagM1Pct?.toFixed(0)}% · M−2{" "}
          {conversion.winLagM2Pct?.toFixed(0)}% · M−3 {conversion.winLagM3Pct?.toFixed(0)}% · M&gt;4{" "}
          {conversion.winLagM4PlusPct?.toFixed(0)}%
        </p>
      ) : null}
    </div>
  );
}

export function FunnelStageStackedChart({
  history,
  pipelineFilter,
  mode,
  metricMode,
  selectedStageIds,
  selectedMonth,
  enabledTimeSeries,
  conversionMonths,
  onSelectMonth
}: Props) {
  const stages = getVisibleStages(history, pipelineFilter, selectedStageIds);
  const data = useMemo(() => {
    const funnelRows = buildFunnelStackedRows(history, pipelineFilter, mode, selectedStageIds, metricMode);
    const byMonth = Object.fromEntries(conversionMonths.map((row) => [row.month, row]));
    return funnelRows.map((row) => ({
      ...row,
      averageDaysToWin: byMonth[row.month]?.averageDaysToWin ?? null,
      ganhosAntigosSharePct: byMonth[row.month]?.ganhosAntigosSharePct ?? null
    }));
  }, [history, pipelineFilter, mode, selectedStageIds, metricMode, conversionMonths]);

  const showTime = enabledTimeSeries.size > 0;
  const showDays = enabledTimeSeries.has("averageDaysToWin");
  const showAntigos = enabledTimeSeries.has("ganhosAntigosSharePct");
  const { hidden, isHidden, toggle } = useLegendToggle();
  const series = useMemo((): LegendSeries[] => {
    const items: LegendSeries[] = stages.map((stage, index) => ({
      dataKey: metricKey(stage.stageId, metricMode),
      name: stage.label,
      color: stageColor(index),
      type: "square" as const
    }));
    if (enabledTimeSeries.has("averageDaysToWin")) {
      items.push({
        dataKey: "averageDaysToWin",
        name: "Média dias até ganho",
        color: "#14b8a6",
        type: "line" as const
      });
    }
    if (enabledTimeSeries.has("ganhosAntigosSharePct")) {
      items.push({
        dataKey: "ganhosAntigosSharePct",
        name: "Ganhos antigos (>1M)",
        color: "#64748b",
        type: "line" as const
      });
    }
    return items;
  }, [stages, metricMode, enabledTimeSeries]);

  if (!stages.length) {
    return <p className="chart-empty">Selecione ao menos uma etapa do funil.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={data}
        margin={{ top: 12, right: showDays && showAntigos ? 56 : showTime ? 44 : 12, left: 4, bottom: 0 }}
        onClick={(state) => {
          const month = state?.activePayload?.[0]?.payload?.month;
          if (typeof month === "string") onSelectMonth(month);
        }}
      >
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis
          yAxisId="left"
          allowDecimals={metricMode === "value"}
          tickFormatter={(value) =>
            metricMode === "value" ? `${Math.round(Number(value) / 1000)}k` : String(Math.round(Number(value)))
          }
          tickLine={false}
          axisLine={false}
          width={metricMode === "value" ? 48 : 36}
        />
        {showDays ? (
          <YAxis
            yAxisId="days"
            orientation="right"
            tickFormatter={(value) => `${Math.round(Number(value))}d`}
            tickLine={false}
            axisLine={false}
            width={showAntigos ? 36 : 40}
            domain={[0, "auto"]}
          />
        ) : null}
        {showAntigos ? (
          <YAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={(value) => `${Math.round(Number(value))}%`}
            tickLine={false}
            axisLine={false}
            width={40}
            domain={[0, 100]}
          />
        ) : null}
        <Tooltip
          content={
            <FunnelTooltip
              history={history}
              pipelineFilter={pipelineFilter}
              mode={mode}
              selectedStageIds={selectedStageIds}
              conversionMonths={conversionMonths}
            />
          }
        />
        <ToggleLegend series={series} hidden={hidden} onToggle={toggle} />
        {stages.map((stage, index) => (
          <Bar
            key={`${stage.pipelineId}-${stage.stageId}`}
            yAxisId="left"
            dataKey={metricKey(stage.stageId, metricMode)}
            name={stage.label}
            stackId="funnel"
            fill={stageColor(index)}
            radius={index === stages.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            opacity={selectedMonth ? 0.72 : 1}
            hide={isHidden(metricKey(stage.stageId, metricMode))}
          />
        ))}
        {enabledTimeSeries.has("averageDaysToWin") ? (
          <Line
            yAxisId="days"
            type="monotone"
            dataKey="averageDaysToWin"
            name="Média dias até ganho"
            stroke="#14b8a6"
            strokeWidth={2.5}
            dot={{ r: 3 }}
            connectNulls
            hide={isHidden("averageDaysToWin")}
          />
        ) : null}
        {enabledTimeSeries.has("ganhosAntigosSharePct") ? (
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="ganhosAntigosSharePct"
            name="Ganhos antigos (>1M)"
            stroke="#64748b"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={{ r: 2 }}
            connectNulls
            hide={isHidden("ganhosAntigosSharePct")}
          />
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
