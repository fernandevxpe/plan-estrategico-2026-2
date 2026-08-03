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
  type TooltipProps,
  XAxis,
  YAxis
} from "recharts";
import type { CommercialFunnelChartRow } from "@/lib/analysis/planning-pipedrive";
import type { CommercialFunnelScope } from "@/lib/analysis/types";
import { brl } from "@/lib/analysis/format";

type ViewId = "revenue" | "volume" | "closing";
type SeriesKind = "currency" | "count" | "percent" | "days";
type Series = { id: keyof CommercialFunnelChartRow; label: string; kind: SeriesKind; axis: "left" | "right"; type: "bar" | "line"; color: string; dash?: string };

const VIEWS: Record<ViewId, { label: string; description: string; series: Series[] }> = {
  revenue: {
    label: "Receita e meta",
    description: "Meta, realizado, valor ganho e valor criado. O pipeline aberto é mostrado como linha para não disputar a leitura das barras.",
    series: [
      { id: "goalTarget", label: "Meta", kind: "currency", axis: "left", type: "bar", color: "#9fb2bd" },
      { id: "goalRealized", label: "Realizado", kind: "currency", axis: "left", type: "bar", color: "#bc13fe" },
      { id: "wonValue", label: "Ganho", kind: "currency", axis: "left", type: "bar", color: "#21a67a" },
      { id: "createdValue", label: "Criado", kind: "currency", axis: "left", type: "line", color: "#64748b" },
      { id: "openValue", label: "Pipeline aberto", kind: "currency", axis: "left", type: "line", color: "#b67818", dash: "4 3" }
    ]
  },
  volume: {
    label: "Volume e conversão",
    description: "Quantidade de negócios por mês no eixo esquerdo; conversão de oportunidades que alcançaram diagnóstico/proposta no eixo direito.",
    series: [
      { id: "createdDeals", label: "Criados", kind: "count", axis: "left", type: "bar", color: "#64748b" },
      { id: "wonDeals", label: "Ganhos", kind: "count", axis: "left", type: "bar", color: "#21a67a" },
      { id: "lostDeals", label: "Perdidos", kind: "count", axis: "left", type: "bar", color: "#e5484d" },
      { id: "openDeals", label: "Base aberta", kind: "count", axis: "left", type: "line", color: "#b67818" },
      { id: "stageCohortConversionPct", label: "Conversão por etapa", kind: "percent", axis: "right", type: "line", color: "#7c3aed" }
    ]
  },
  closing: {
    label: "Fechamento e ciclo",
    description: "Qualidade dos fechamentos: taxa de ganho entre negócios encerrados, ciclo médio e origem temporal dos ganhos.",
    series: [
      { id: "closedConversionPct", label: "Win rate dos fechados", kind: "percent", axis: "left", type: "line", color: "#be185d" },
      { id: "ganhosAntigosSharePct", label: "Ganhos criados há >1 mês", kind: "percent", axis: "left", type: "line", color: "#64748b", dash: "4 3" },
      { id: "averageDaysToWin", label: "Dias até ganho", kind: "days", axis: "right", type: "line", color: "#14b8a6" }
    ]
  }
};

const SCOPE_LABELS: Record<CommercialFunnelScope, string> = { collective: "Coletivo", consultoria: "Consultoria", obras: "Obras" };

function formatValue(value: number, kind: SeriesKind) {
  if (kind === "percent") return `${value.toFixed(1)}%`;
  if (kind === "days") return `${Math.round(value)} dias`;
  if (kind === "count") return String(Math.round(value));
  return brl.format(value);
}

export function CommercialFunnelChart({ data, scope, onScopeChange }: { data: CommercialFunnelChartRow[]; scope: CommercialFunnelScope; onScopeChange: (scope: CommercialFunnelScope) => void }) {
  const [view, setView] = useState<ViewId>("revenue");
  const config = VIEWS[view];
  const hasRight = config.series.some((item) => item.axis === "right");
  const leftKind = config.series.find((item) => item.axis === "left")?.kind ?? "count";
  const tooltip = useMemo(() => ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload?.length || !label) return null;
    return <div className="chart-tooltip commercial-funnel-tooltip"><strong>{label}</strong><ul>{payload.filter((item) => item.value != null).map((item) => {
      const series = config.series.find((candidate) => candidate.id === String(item.dataKey));
      return <li key={String(item.dataKey)} style={{ color: item.color }}>{item.name}: {formatValue(Number(item.value), series?.kind ?? "count")}</li>;
    })}</ul></div>;
  }, [config]);

  if (!data.length) return <p className="chart-empty">Sem dados de funil comercial para 2026.</p>;

  return <div className="commercial-funnel-chart-wrap">
    <div className="commercial-funnel-controls">
      <div className="funnel-pipeline-toggle" role="group" aria-label="Escopo do funil">
        {(Object.keys(SCOPE_LABELS) as CommercialFunnelScope[]).map((item) => <button key={item} type="button" className={`goal-preset-btn ${scope === item ? "is-active" : ""}`} onClick={() => onScopeChange(item)}>{SCOPE_LABELS[item]}</button>)}
      </div>
      <div className="chart-mode-toggle" role="group" aria-label="Visão do funil">
        {(Object.keys(VIEWS) as ViewId[]).map((item) => <button key={item} type="button" className={view === item ? "is-active" : ""} onClick={() => setView(item)}>{VIEWS[item].label}</button>)}
      </div>
    </div>
    <p className="chart-caption commercial-funnel-legend-note">{config.description}</p>
    <div className="commercial-funnel-plot">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: hasRight ? 48 : 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke="#dce5e8" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis yAxisId="left" tickFormatter={(value) => leftKind === "currency" ? `${Math.round(Number(value) / 1000)}k` : leftKind === "percent" ? `${Math.round(Number(value))}%` : String(Math.round(Number(value)))} tickLine={false} axisLine={false} width={48} domain={leftKind === "percent" ? [0, 100] : [0, "auto"]} />
          {hasRight ? <YAxis yAxisId="right" orientation="right" tickFormatter={(value) => `${Math.round(Number(value))}d`} tickLine={false} axisLine={false} width={42} domain={[0, "auto"]} /> : null}
          <Tooltip content={tooltip} /><Legend />
          {config.series.map((item) => item.type === "bar" ? <Bar key={String(item.id)} yAxisId={item.axis} dataKey={item.id} name={item.label} fill={item.color} radius={[4, 4, 0, 0]} /> : <Line key={String(item.id)} yAxisId={item.axis} dataKey={item.id} name={item.label} type="monotone" stroke={item.color} strokeWidth={2.5} strokeDasharray={item.dash} dot={{ r: 3 }} connectNulls={false} />)}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  </div>;
}
