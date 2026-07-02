"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { CommercialFunnelChartRow } from "@/lib/analysis/planning-pipedrive";
import type { CommercialFunnelScope } from "@/lib/analysis/types";
import { brl } from "@/lib/analysis/format";

export type CommercialFunnelSeriesId =
  | "goalTarget"
  | "goalRealized"
  | "createdValue"
  | "wonValue"
  | "lostValue"
  | "openValue"
  | "createdDeals"
  | "wonDeals"
  | "lostDeals"
  | "openDeals"
  | "stageCohortConversionPct"
  | "closedConversionPct"
  | "averageDaysToWin"
  | "ganhosAntigosSharePct"
  | "winLagM0Pct"
  | "winLagM1Pct"
  | "winLagM2Pct"
  | "winLagM3Pct"
  | "winLagM4PlusPct";

type SeriesKind = "currency" | "count" | "percent" | "days";

type SeriesConfig = {
  id: CommercialFunnelSeriesId;
  label: string;
  kind: SeriesKind;
  axis: "left" | "right" | "days";
  type: "bar" | "line";
  color: string;
  dash?: string;
};

const SERIES_CONFIG: SeriesConfig[] = [
  { id: "goalTarget", label: "Meta", kind: "currency", axis: "left", type: "bar", color: "#9fb2bd" },
  { id: "goalRealized", label: "Realizado (meta)", kind: "currency", axis: "left", type: "bar", color: "#2368a0" },
  { id: "createdValue", label: "Criado (R$)", kind: "currency", axis: "left", type: "bar", color: "#64748b" },
  { id: "wonValue", label: "Ganho (R$)", kind: "currency", axis: "left", type: "bar", color: "#21a67a" },
  { id: "lostValue", label: "Perdido (R$)", kind: "currency", axis: "left", type: "bar", color: "#e5484d" },
  { id: "openValue", label: "Aberto (R$)", kind: "currency", axis: "left", type: "line", color: "#b67818" },
  { id: "createdDeals", label: "Criados (qtd)", kind: "count", axis: "left", type: "line", color: "#94a3b8" },
  { id: "wonDeals", label: "Ganhos (qtd)", kind: "count", axis: "left", type: "line", color: "#0f766e" },
  { id: "lostDeals", label: "Perdidos (qtd)", kind: "count", axis: "left", type: "line", color: "#dc2626" },
  { id: "openDeals", label: "Base aberta (qtd)", kind: "count", axis: "left", type: "line", color: "#d97706" },
  {
    id: "stageCohortConversionPct",
    label: "Conversão etapa qualificada",
    kind: "percent",
    axis: "right",
    type: "line",
    color: "#7c3aed"
  },
  {
    id: "closedConversionPct",
    label: "Conversão fechados",
    kind: "percent",
    axis: "right",
    type: "line",
    color: "#be185d",
    dash: "2 2"
  },
  {
    id: "averageDaysToWin",
    label: "Média dias até ganho",
    kind: "days",
    axis: "days",
    type: "line",
    color: "#14b8a6"
  },
  {
    id: "ganhosAntigosSharePct",
    label: "Ganhos antigos (>1M)",
    kind: "percent",
    axis: "right",
    type: "line",
    color: "#64748b",
    dash: "4 3"
  },
  { id: "winLagM0Pct", label: "Fechamento M", kind: "percent", axis: "right", type: "line", color: "#2368a0" },
  { id: "winLagM1Pct", label: "Fechamento M−1", kind: "percent", axis: "right", type: "line", color: "#21a67a", dash: "3 2" },
  { id: "winLagM2Pct", label: "Fechamento M−2", kind: "percent", axis: "right", type: "line", color: "#b67818", dash: "3 2" },
  { id: "winLagM3Pct", label: "Fechamento M−3", kind: "percent", axis: "right", type: "line", color: "#d97706", dash: "3 2" },
  {
    id: "winLagM4PlusPct",
    label: "Fechamento M>4",
    kind: "percent",
    axis: "right",
    type: "line",
    color: "#94a3b8",
    dash: "5 3"
  }
];

const DEFAULT_SERIES: CommercialFunnelSeriesId[] = [
  "goalTarget",
  "goalRealized",
  "createdValue",
  "wonValue",
  "openValue",
  "stageCohortConversionPct",
  "averageDaysToWin"
];

const SCOPE_LABELS: Record<CommercialFunnelScope, string> = {
  collective: "Coletivo",
  consultoria: "Consultoria",
  obras: "Obras"
};

type Props = {
  data: CommercialFunnelChartRow[];
  scope: CommercialFunnelScope;
  onScopeChange: (scope: CommercialFunnelScope) => void;
};

function formatValue(value: number, kind: SeriesKind) {
  if (kind === "percent") return `${value.toFixed(1)}%`;
  if (kind === "days") return `${Math.round(value)}d`;
  if (kind === "count") return String(Math.round(value));
  return brl.format(value);
}

function FunnelTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: Array<{
    dataKey?: string;
    value?: number;
    name?: string;
    color?: string;
    payload?: CommercialFunnelChartRow;
  }>;
  label?: string;
}) {
  if (!active || !payload?.length || !label) return null;

  const row = payload[0]?.payload as CommercialFunnelChartRow | undefined;
  const items = payload.filter((item) => item.value != null && item.value !== 0);

  return (
    <div className="chart-tooltip commercial-funnel-tooltip">
      <strong>{label}</strong>
      <ul>
        {items.map((item) => (
          <li key={String(item.dataKey)} style={{ color: item.color }}>
            {item.name}: {formatSeriesValue(item.dataKey as CommercialFunnelSeriesId, Number(item.value))}
          </li>
        ))}
      </ul>
      {row ? (
        <>
          <p className="commercial-funnel-cohort-note">
            Conversão etapa qualificada: {formatPct(row.stageCohortConversionPct)}
          </p>
          <p className="commercial-funnel-cohort-note">
            Origem dos ganhos: M {formatPct(row.winLagM0Pct)} · M−1 {formatPct(row.winLagM1Pct)} · M−2{" "}
            {formatPct(row.winLagM2Pct)} · M−3 {formatPct(row.winLagM3Pct)} · M&gt;4 {formatPct(row.winLagM4PlusPct)}
          </p>
        </>
      ) : null}
    </div>
  );
}

function formatPct(value: number | null | undefined) {
  if (value == null) return "—";
  return `${value.toFixed(1)}%`;
}

function formatSeriesValue(id: CommercialFunnelSeriesId, value: number) {
  const config = SERIES_CONFIG.find((item) => item.id === id);
  if (!config) return String(value);
  return formatValue(value, config.kind);
}

export function CommercialFunnelChart({ data, scope, onScopeChange }: Props) {
  const [enabledSeries, setEnabledSeries] = useState<Set<CommercialFunnelSeriesId>>(
    () => new Set(DEFAULT_SERIES)
  );

  const activeConfigs = useMemo(
    () => SERIES_CONFIG.filter((item) => enabledSeries.has(item.id)),
    [enabledSeries]
  );

  function toggleSeries(id: CommercialFunnelSeriesId) {
    setEnabledSeries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size === 1) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (!data.length) return <p className="chart-empty">Sem dados de funil comercial para 2026.</p>;

  const hasPercent = activeConfigs.some((item) => item.axis === "right");
  const hasDays = activeConfigs.some((item) => item.axis === "days");
  const hasCurrency = activeConfigs.some((item) => item.kind === "currency");

  return (
    <div className="commercial-funnel-chart-wrap">
      <div className="commercial-funnel-controls">
        <div className="funnel-pipeline-toggle" role="group" aria-label="Escopo do funil">
          {(Object.keys(SCOPE_LABELS) as CommercialFunnelScope[]).map((item) => (
            <button
              key={item}
              type="button"
              className={`goal-preset-btn ${scope === item ? "is-active" : ""}`}
              onClick={() => onScopeChange(item)}
            >
              {SCOPE_LABELS[item]}
            </button>
          ))}
        </div>
        <p className="chart-caption commercial-funnel-legend-note">
          Conversão principal = oportunidades que entraram em Diagnóstico/Proposta no mês. Fechamento M…M&gt;4 = % dos
          ganhos do mês vindos de negócios criados no mesmo mês, 1, 2, 3 ou mais de 4 meses antes.
        </p>
      </div>

      <div className="commercial-funnel-series-chips">
        <span className="goal-compare-presets-label">Séries:</span>
        {SERIES_CONFIG.map((item) => {
          const active = enabledSeries.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              className={`funnel-stage-chip ${active ? "is-active" : ""}`}
              style={active ? { borderColor: item.color, background: `${item.color}14` } : undefined}
              onClick={() => toggleSeries(item.id)}
            >
              <span className="funnel-stage-chip-dot" style={{ background: item.color }} />
              {item.label}
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 12, right: hasPercent && hasDays ? 56 : hasPercent || hasDays ? 40 : 8, left: 4, bottom: 0 }}
        >
          <CartesianGrid stroke="#dce5e8" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis
            yAxisId="left"
            tickFormatter={(value) =>
              hasCurrency ? `${Math.round(Number(value) / 1000)}k` : String(Math.round(Number(value)))
            }
            tickLine={false}
            axisLine={false}
            width={48}
          />
          {hasPercent ? (
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={(value) => `${Math.round(Number(value))}%`}
              tickLine={false}
              axisLine={false}
              width={40}
              domain={[0, "auto"]}
            />
          ) : null}
          {hasDays ? (
            <YAxis
              yAxisId="days"
              orientation="right"
              tickFormatter={(value) => `${Math.round(Number(value))}d`}
              tickLine={false}
              axisLine={false}
              width={hasPercent ? 36 : 40}
              domain={[0, "auto"]}
            />
          ) : null}
          <Tooltip content={<FunnelTooltip />} />
          <Legend />
          {activeConfigs.map((item) => {
            const common = {
              yAxisId: item.axis,
              dataKey: item.id,
              name: item.label,
              stroke: item.color,
              fill: item.color
            };
            if (item.type === "bar") {
              return <Bar key={item.id} {...common} radius={[4, 4, 0, 0]} />;
            }
            return (
              <Line
                key={item.id}
                {...common}
                type="monotone"
                strokeWidth={2}
                strokeDasharray={item.dash}
                dot={{ r: 2 }}
                connectNulls={false}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
