"use client";

import { useMemo, useState } from "react";
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
import { ChartWithLegend, useLegendToggle } from "@/components/charts/useLegendToggle";
import type { MarketingMetrics } from "@/lib/areas/build-marketing-dashboard";

type DailyRow = MarketingMetrics & { date: string };
type Grain = "day" | "week" | "month";

const PURPLE = "#6d28d9";
const SERIES = [
  { dataKey: "spend", name: "Investimento", color: PURPLE, type: "square" as const, axis: "money" as const },
  { dataKey: "outboundClicks", name: "Cliques externos", color: "#2563eb", type: "line" as const, axis: "count" as const },
  { dataKey: "conversations", name: "Conversas", color: "#16a34a", type: "line" as const, axis: "count" as const },
  { dataKey: "impressions", name: "Impressões", color: "#94a3b8", type: "line" as const, axis: "count" as const },
  { dataKey: "cpc", name: "CPC", color: "#f59e0b", type: "line" as const, axis: "eff" as const },
  {
    dataKey: "costPerConversation",
    name: "Custo / conversa",
    color: "#ef4444",
    type: "line" as const,
    axis: "eff" as const
  }
] as const;

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const integer = (value: number) => Math.round(value).toLocaleString("pt-BR");
const decimal = (value: number) =>
  value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function mondayWeekKey(dateStr: string) {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

function bucketLabel(key: string, grain: Grain) {
  if (grain === "month") {
    return new Date(`${key}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
  }
  if (grain === "week") {
    const end = new Date(`${key}T12:00:00`);
    end.setDate(end.getDate() + 6);
    const a = key.slice(5).replace("-", "/");
    const b = end.toISOString().slice(5, 10).replace("-", "/");
    return `${a}–${b}`;
  }
  return key.slice(5).replace("-", "/");
}

function deriveRates(row: {
  spend: number;
  clicks: number;
  outboundClicks: number;
  conversations: number;
  impressions: number;
  landingPageViews: number;
}) {
  const cpc = row.clicks ? row.spend / row.clicks : null;
  const costPerConversation = row.conversations ? row.spend / row.conversations : null;
  const costPerLandingPageView = row.landingPageViews ? row.spend / row.landingPageViews : null;
  const ctr = row.impressions ? (row.clicks / row.impressions) * 100 : 0;
  const cpm = row.impressions ? (row.spend / row.impressions) * 1000 : 0;
  return { cpc, costPerConversation, costPerLandingPageView, ctr, cpm };
}

function aggregateRows(rows: DailyRow[], grain: Grain) {
  if (grain === "day") {
    return rows.map((row) => ({
      ...row,
      label: bucketLabel(row.date, "day"),
      sortKey: row.date
    }));
  }

  const map = new Map<
    string,
    {
      sortKey: string;
      spend: number;
      impressions: number;
      reach: number;
      clicks: number;
      linkClicks: number;
      outboundClicks: number;
      landingPageViews: number;
      conversations: number;
      leads: number;
      videoViews: number;
      video100: number;
    }
  >();

  for (const row of rows) {
    const sortKey = grain === "week" ? mondayWeekKey(row.date) : row.date.slice(0, 7);
    const prev = map.get(sortKey) ?? {
      sortKey,
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      linkClicks: 0,
      outboundClicks: 0,
      landingPageViews: 0,
      conversations: 0,
      leads: 0,
      videoViews: 0,
      video100: 0
    };
    prev.spend += row.spend;
    prev.impressions += row.impressions;
    prev.reach += row.reach;
    prev.clicks += row.clicks;
    prev.linkClicks += row.linkClicks;
    prev.outboundClicks += row.outboundClicks;
    prev.landingPageViews += row.landingPageViews;
    prev.conversations += row.conversations;
    prev.leads += row.leads;
    prev.videoViews += row.videoViews;
    prev.video100 += row.video100;
    map.set(sortKey, prev);
  }

  return [...map.values()]
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map((row) => {
      const rates = deriveRates(row);
      return {
        date: row.sortKey,
        label: bucketLabel(row.sortKey, grain),
        sortKey: row.sortKey,
        spend: row.spend,
        impressions: row.impressions,
        reach: row.reach,
        frequency: row.reach ? row.impressions / row.reach : 0,
        clicks: row.clicks,
        linkClicks: row.linkClicks,
        outboundClicks: row.outboundClicks,
        landingPageViews: row.landingPageViews,
        conversations: row.conversations,
        leads: row.leads,
        videoViews: row.videoViews,
        video25: 0,
        video50: 0,
        video75: 0,
        video100: row.video100,
        cpc: rates.cpc ?? 0,
        cpm: rates.cpm,
        ctr: rates.ctr,
        costPerConversation: rates.costPerConversation,
        costPerLandingPageView: rates.costPerLandingPageView,
        costPerLead: row.leads ? row.spend / row.leads : null
      };
    });
}

function toCumulative(rows: ReturnType<typeof aggregateRows>) {
  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let linkClicks = 0;
  let outboundClicks = 0;
  let landingPageViews = 0;
  let conversations = 0;
  let leads = 0;
  let videoViews = 0;
  let video100 = 0;
  let reach = 0;

  return rows.map((row) => {
    spend += row.spend;
    impressions += row.impressions;
    clicks += row.clicks;
    linkClicks += row.linkClicks;
    outboundClicks += row.outboundClicks;
    landingPageViews += row.landingPageViews;
    conversations += row.conversations;
    leads += row.leads;
    videoViews += row.videoViews;
    video100 += row.video100;
    reach += row.reach;
    const rates = deriveRates({
      spend,
      clicks,
      outboundClicks,
      conversations,
      impressions,
      landingPageViews
    });
    return {
      ...row,
      spend,
      impressions,
      reach,
      clicks,
      linkClicks,
      outboundClicks,
      landingPageViews,
      conversations,
      leads,
      videoViews,
      video100,
      cpc: rates.cpc ?? 0,
      cpm: rates.cpm,
      ctr: rates.ctr,
      costPerConversation: rates.costPerConversation,
      costPerLandingPageView: rates.costPerLandingPageView,
      costPerLead: leads ? spend / leads : null
    };
  });
}

function formatTickMoney(value: number) {
  if (Math.abs(value) >= 1000) return `R$${Math.round(value / 1000)}k`;
  if (Math.abs(value) >= 100) return `R$${Math.round(value)}`;
  return `R$${decimal(value)}`;
}

function formatTickCount(value: number) {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return integer(value);
}

export function MarketingTrendChart({ daily }: { daily: DailyRow[] }) {
  const [grain, setGrain] = useState<Grain>("day");
  const [cumulative, setCumulative] = useState(false);
  const legend = useLegendToggle(["impressions", "cpc", "costPerConversation"]);

  const chartData = useMemo(() => {
    const aggregated = aggregateRows(daily, grain);
    return cumulative ? toCumulative(aggregated) : aggregated;
  }, [daily, grain, cumulative]);

  const legendSeries = useMemo(
    () => SERIES.map((s) => ({ dataKey: s.dataKey, name: s.name, color: s.color, type: s.type })),
    []
  );

  const showMoney = !legend.isHidden("spend");
  const showEff =
    !legend.isHidden("cpc") || !legend.isHidden("costPerConversation");
  const showCount =
    !legend.isHidden("outboundClicks") ||
    !legend.isHidden("conversations") ||
    !legend.isHidden("impressions");

  const grainLabel = grain === "day" ? "dia" : grain === "week" ? "semana" : "mês";

  return (
    <article className="marketing-panel marketing-chart-panel marketing-trend">
      <header className="marketing-trend-header">
        <div>
          <strong>Desempenho da mídia</strong>
          <span>
            Investimento, cliques, conversas e eficiência por {grainLabel}
            {cumulative ? " · acumulado" : ""}
          </span>
        </div>
        <div className="marketing-trend-controls">
          <div className="marketing-seg" role="group" aria-label="Agregação">
            {(
              [
                ["day", "Dia"],
                ["week", "Semana"],
                ["month", "Mês"]
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={grain === key ? "active" : ""}
                onClick={() => setGrain(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={cumulative ? "marketing-toggle active" : "marketing-toggle"}
            onClick={() => setCumulative((v) => !v)}
            aria-pressed={cumulative}
          >
            Acumulado
          </button>
        </div>
      </header>

      {!chartData.length ? (
        <p className="marketing-empty">Sem série diária no período.</p>
      ) : (
        <ChartWithLegend series={legendSeries} hidden={legend.hidden} onToggle={legend.toggle}>
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "#e2e8f0" }}
                interval="preserveStartEnd"
                minTickGap={28}
              />
              {showCount ? (
                <YAxis
                  yAxisId="count"
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  tickFormatter={formatTickCount}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
              ) : null}
              {showMoney || showEff ? (
                <YAxis
                  yAxisId="money"
                  orientation="right"
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  tickFormatter={formatTickMoney}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                />
              ) : null}
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                  boxShadow: "0 8px 24px rgba(15,23,42,.08)",
                  fontSize: 12
                }}
                labelStyle={{ fontWeight: 700, marginBottom: 6 }}
                formatter={(value, name) => {
                  const key = String(name);
                  const n = Number(value);
                  if (!Number.isFinite(n)) return ["—", key];
                  if (key === "Investimento" || key === "CPC" || key === "Custo / conversa") {
                    return [money(n), key];
                  }
                  return [integer(n), key];
                }}
              />
              {!legend.isHidden("spend") ? (
                <Bar
                  yAxisId="money"
                  dataKey="spend"
                  name="Investimento"
                  fill={PURPLE}
                  fillOpacity={0.85}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={grain === "month" ? 42 : 18}
                />
              ) : null}
              {!legend.isHidden("outboundClicks") ? (
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="outboundClicks"
                  name="Cliques externos"
                  stroke="#2563eb"
                  strokeWidth={2.2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ) : null}
              {!legend.isHidden("conversations") ? (
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="conversations"
                  name="Conversas"
                  stroke="#16a34a"
                  strokeWidth={2.2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ) : null}
              {!legend.isHidden("impressions") ? (
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="impressions"
                  name="Impressões"
                  stroke="#94a3b8"
                  strokeWidth={1.8}
                  strokeDasharray="4 4"
                  dot={false}
                />
              ) : null}
              {!legend.isHidden("cpc") ? (
                <Line
                  yAxisId="money"
                  type="monotone"
                  dataKey="cpc"
                  name="CPC"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ) : null}
              {!legend.isHidden("costPerConversation") ? (
                <Line
                  yAxisId="money"
                  type="monotone"
                  dataKey="costPerConversation"
                  name="Custo / conversa"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </ChartWithLegend>
      )}
      <p className="marketing-trend-hint">
        Clique na legenda para mostrar ou ocultar séries. Eixo esquerdo = volume; eixo direito = R$.
        CPC e custo/conversa ficam ocultos por padrão (mesma escala do investimento).
      </p>
    </article>
  );
}
