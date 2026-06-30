"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { LineChart as LineChartIcon, X } from "lucide-react";
import type { GestaoCatalog, GestaoPeriodo } from "@/lib/gestao-xpe/catalog-types";
import type { IndicatorHistoryPayload, IndicatorHistorySeries } from "@/lib/gestao-xpe/indicator-history";
import {
  applyHistoryView,
  granularityTitle,
  mergeViewSeriesForChart,
  viewSummary,
  type HistoryViewConfig
} from "@/lib/gestao-xpe/indicator-history-view";

const SERIES_COLORS = ["#21a67a", "#2368a0", "#b67818", "#0f766e", "#7c5cbe", "#c8553d"];

const GRANULARITY_OPTIONS: { id: GestaoPeriodo; short: string; label: string }[] = [
  { id: "semanal", short: "Sem.", label: "Semanal" },
  { id: "mensal", short: "Mês", label: "Mensal" },
  { id: "trimestral", short: "Trim.", label: "Trimestral" },
  { id: "semestral", short: "Sem.", label: "Semestral" },
  { id: "anual", short: "Ano", label: "Anual" }
];

type Props = {
  catalog: GestaoCatalog;
  selectedIds: string[];
  selectedNames: Record<string, string>;
  highlightWeekKey?: string;
  vendedor?: string;
  onRemove: (id: string) => void;
  onClear: () => void;
};

function formatAxisValue(value: number, tipo?: string) {
  if (tipo === "moeda") {
    if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `R$ ${Math.round(value / 1_000)}k`;
    return `R$ ${value}`;
  }
  return String(value);
}
function formatValue(value: number | null | undefined, unidade?: string, tipo?: string) {
  if (value === null || value === undefined) return "—";
  if (tipo === "moeda") {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(
      value
    );
  }
  if (tipo === "percentual") return `${value}%`;
  return unidade ? `${value} ${unidade}` : String(value);
}

function growthClass(value: number | null) {
  if (value === null) return "";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "";
}

function GrowthCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className={`gestao-ind-growth-cell ${growthClass(value)}`}>
      <span>{label}</span>
      <strong>{value === null ? "—" : `${value > 0 ? "+" : ""}${value}%`}</strong>
    </div>
  );
}

function formatTooltipValue(
  value: number,
  name: string,
  viewedSeries: IndicatorHistorySeries[]
): [string, string] {
  if (String(name).endsWith("__meta")) {
    const id = String(name).replace("__meta", "");
    const s = viewedSeries.find((row) => row.id === id);
    return [formatValue(value, s?.unidade, s?.tipo), `Meta · ${s?.nome ?? id}`];
  }
  const s = viewedSeries.find((row) => row.id === name);
  return [formatValue(value, s?.unidade, s?.tipo), s?.nome ?? String(name)];
}

function ChartMetaLines({
  series,
  colorById
}: {
  series: IndicatorHistorySeries[];
  colorById: Record<string, string>;
}) {
  return (
    <>
      {series.map((s) => {
        const hasMeta = s.points.some((p) => p.meta !== null);
        if (!hasMeta) return null;
        return (
          <Line
            key={`${s.id}-meta`}
            type="monotone"
            dataKey={`${s.id}__meta`}
            name={`${s.id}__meta`}
            stroke={colorById[s.id]}
            strokeWidth={1.5}
            strokeDasharray="6 4"
            strokeOpacity={0.5}
            dot={false}
            connectNulls
            legendType="none"
            isAnimationActive={false}
          />
        );
      })}
    </>
  );
}
function SeriesStats({ series, pointLabel }: { series: IndicatorHistorySeries; pointLabel: string }) {
  const metaRef = [...series.points].reverse().find((p) => p.meta !== null)?.meta ?? null;
  return (
    <article className="gestao-ind-stats-card">
      <header>
        <span className="gestao-ind-stats-dot" style={{ background: "var(--series-color)" }} />
        <strong>{series.nome}</strong>
      </header>
      <div className="gestao-ind-stats-grid">
        <div>
          <span>Mín</span>
          <strong>{formatValue(series.stats.min, series.unidade, series.tipo)}</strong>
        </div>
        <div>
          <span>Máx</span>
          <strong>{formatValue(series.stats.max, series.unidade, series.tipo)}</strong>
        </div>
        <div>
          <span>Média</span>
          <strong>{formatValue(series.stats.media, series.unidade, series.tipo)}</strong>
        </div>
        <div>
          <span>Último</span>
          <strong>{formatValue(series.stats.ultimo, series.unidade, series.tipo)}</strong>
        </div>
        <div>
          <span>Meta ref.</span>
          <strong>{formatValue(metaRef, series.unidade, series.tipo)}</strong>
        </div>
      </div>
      <div className="gestao-ind-growth-grid">
        <GrowthCell label="Semanal" value={series.growth.semanal} />
        <GrowthCell label="Mensal" value={series.growth.mensal} />
        <GrowthCell label="Trimestral" value={series.growth.trimestral} />
        <GrowthCell label="Semestral" value={series.growth.semestral} />
        <GrowthCell label="Anual" value={series.growth.anual} />
      </div>
      <p className="gestao-muted gestao-ind-stats-note">
        {series.stats.semanasComDado} {pointLabel} com dado · taxas sobre a série exibida
      </p>
    </article>
  );
}

const CHART_HEIGHT = 300;

function pointLabelForGranularity(g: GestaoPeriodo) {
  if (g === "semanal") return "semana(s)";
  if (g === "mensal") return "mês(es)";
  if (g === "trimestral") return "trimestre(s)";
  if (g === "semestral") return "semestre(s)";
  return "ano(s)";
}

function tooltipPeriodLabel(g: GestaoPeriodo) {
  if (g === "semanal") return "Semana";
  if (g === "mensal") return "Mês";
  if (g === "trimestral") return "Trimestre";
  if (g === "semestral") return "Semestre";
  return "Ano";
}

export function GestaoIndicadorChartPanel({
  catalog,
  selectedIds,
  selectedNames,
  highlightWeekKey,
  vendedor,
  onRemove,
  onClear
}: Props) {
  const [payload, setPayload] = useState<IndicatorHistoryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [granularity, setGranularity] = useState<GestaoPeriodo>("semanal");

  const viewConfig = useMemo<HistoryViewConfig>(() => ({ granularity }), [granularity]);

  useEffect(() => {
    if (!selectedIds.length) {
      setPayload(null);
      setError("");
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");

    const q = new URLSearchParams({ ids: selectedIds.join(",") });
    if (vendedor && vendedor !== "todos") q.set("vendedor", vendedor);

    void fetch(`/api/gestao-xpe/indicators/history?${q}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Falha ao carregar histórico.");
        return res.json() as Promise<IndicatorHistoryPayload>;
      })
      .then((data) => setPayload(data))
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message || "Erro ao carregar histórico.");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [selectedIds.join(","), vendedor]);

  const viewedSeries = useMemo(
    () => (payload ? applyHistoryView(payload.series, catalog, viewConfig) : []),
    [payload, catalog, viewConfig]
  );

  const chartData = useMemo(() => mergeViewSeriesForChart(viewedSeries), [viewedSeries]);

  const hasPoints = useMemo(
    () =>
      viewedSeries.some(
        (s) => s.stats.semanasComDado > 0 || s.points.some((p) => p.realizado !== null)
      ),
    [viewedSeries]
  );

  const colorById = useMemo(() => {
    const map: Record<string, string> = {};
    selectedIds.forEach((id, i) => {
      map[id] = SERIES_COLORS[i % SERIES_COLORS.length];
    });
    return map;
  }, [selectedIds]);

  const chartYAxis = useMemo(() => {
    const moeda = viewedSeries.some((s) => s.tipo === "moeda");
    const tipo = moeda ? "moeda" : viewedSeries[0]?.tipo;
    return {
      width: moeda ? 56 : 42,
      tickFormatter: (v: number) => formatAxisValue(v, tipo)
    };
  }, [viewedSeries]);

  const highlightLabel = useMemo(() => {
    if (!highlightWeekKey || granularity !== "semanal") return undefined;
    return chartData.find((r) => r.weekKey === highlightWeekKey)?.label as string | undefined;
  }, [chartData, highlightWeekKey, granularity]);

  useEffect(() => {
    if (!selectedIds.length) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [selectedIds.length]);

  if (!selectedIds.length) return null;

  const periodTooltip = tooltipPeriodLabel(granularity);
  const pointLabel = pointLabelForGranularity(granularity);

  return (
    <div className="gestao-ind-portal-layer" role="presentation">
      <button
        type="button"
        className="gestao-ind-sidebar-backdrop"
        aria-label="Fechar análise histórica"
        onClick={onClear}
      />
      <aside
        className="gestao-ind-chart-sidebar"
        role="dialog"
        aria-modal="true"
        aria-label="Análise histórica de indicadores"
      >
        <header className="gestao-ind-chart-header">
          <div className="gestao-ind-chart-header-main">
            <span className="gestao-ind-chart-header-icon" aria-hidden>
              <LineChartIcon size={20} />
            </span>
            <div>
              <h3>Análise histórica</h3>
              <p className="gestao-ind-chart-subtitle">
                {loading
                  ? "Carregando série temporal…"
                  : payload?.nota ?? "Selecione indicadores na tabela para comparar."}
              </p>
              {payload?.fonte ? (
                <span className={`gestao-ind-source-badge ${payload.fonte}`}>
                  {payload.fonte === "crm"
                    ? "Fonte: Pipedrive por semana"
                    : payload.fonte === "misto"
                      ? "Fonte: lançamentos + CRM"
                      : "Fonte: lançamentos semanais"}
                </span>
              ) : null}
            </div>
          </div>
          <button type="button" className="gestao-ind-sidebar-close" onClick={onClear} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>

        <div className="gestao-ind-selected-chips">
          {selectedIds.map((id) => (
            <button
              type="button"
              key={id}
              className="gestao-ind-chip"
              style={{ borderColor: colorById[id], color: colorById[id] }}
              onClick={() => onRemove(id)}
              title="Remover do gráfico"
            >
              {selectedNames[id] ?? id}
              <X size={12} />
            </button>
          ))}
          <button type="button" className="gestao-btn secondary tiny" onClick={onClear}>
            Limpar
          </button>
        </div>

        <div className="gestao-ind-view-toolbar" role="toolbar" aria-label="Agrupamento da visualização">
          <div className="gestao-ind-view-row">
            <div className="gestao-ind-view-group">
              <span className="gestao-period-toolbar-label">Agrupar</span>
              <div className="mix-segmented gestao-period-compact">
                {GRANULARITY_OPTIONS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={granularity === p.id ? "active" : ""}
                    onClick={() => setGranularity(p.id)}
                    title={p.label}
                  >
                    {p.short}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="gestao-ind-view-hint gestao-muted">
            {payload?.weekCount ?? "—"} semanas no histórico · linha tracejada = meta quando houver
          </p>
        </div>

        <div className="gestao-ind-sidebar-body">
          {loading ? (
            <div className="gestao-ind-chart-loading">
              <div className="gestao-ind-loading-bar" />
              <p className="gestao-muted">Montando série temporal dos indicadores…</p>
            </div>
          ) : null}
          {error ? <p className="gestao-ind-chart-error">{error}</p> : null}

          {!loading && payload ? (
            <>
              <div className="gestao-ind-chart-card">
                <div className="gestao-ind-chart-card-head">
                  <strong>Evolução {granularityTitle(granularity)}</strong>
                  <span className="gestao-muted">
                    {viewSummary(viewConfig, chartData.length, payload?.weekCount)} · linha tracejada = meta
                  </span>
                </div>
                <div className="gestao-ind-chart-wrap">
                  {!hasPoints ? (
                    <div className="gestao-ind-chart-empty">
                      <p>
                        <strong>Sem pontos no gráfico para esta visualização.</strong>
                      </p>
                      <p className="gestao-muted">
                        Tente outro agrupamento. O histórico usa lançamentos ou Pipedrive por semana. Rode{" "}
                        <em>Lançar semana → Atualizar do CRM</em> para gravar a série.
                      </p>
                    </div>
                  ) : chartData.length < 2 ? (
                    <div className="gestao-ind-chart-empty">
                      <p>
                        <strong>1 {pointLabel.replace("(s)", "")} com dado</strong> — amplie o histórico ou mude o
                        agrupamento para ver tendência.
                      </p>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.08)" />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} width={chartYAxis.width} tickFormatter={chartYAxis.tickFormatter} />
                          <Tooltip
                            formatter={(value: number, name: string) =>
                              formatTooltipValue(value, name, viewedSeries)
                            }
                          />
                          {viewedSeries.map((s) => (
                            <Line
                              key={s.id}
                              type="monotone"
                              dataKey={s.id}
                              name={s.id}
                              stroke={colorById[s.id]}
                              strokeWidth={2.5}
                              dot={{ r: 4, fill: colorById[s.id] }}
                              connectNulls
                            />
                          ))}
                          <ChartMetaLines series={viewedSeries} colorById={colorById} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                      <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.08)" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={20} />
                        <YAxis tick={{ fontSize: 11 }} width={chartYAxis.width} tickFormatter={chartYAxis.tickFormatter} />
                        <Tooltip
                          formatter={(value: number, name: string) =>
                            formatTooltipValue(value, name, viewedSeries)
                          }
                          labelFormatter={(label) => `${periodTooltip} ${label}`}
                        />
                        <Legend formatter={(value) => viewedSeries.find((s) => s.id === value)?.nome ?? value} />
                        {highlightLabel ? (
                          <ReferenceLine
                            x={highlightLabel}
                            stroke="#94a3b8"
                            strokeDasharray="4 4"
                            label={{ value: "Atual", position: "top", fontSize: 10, fill: "#64748b" }}
                          />
                        ) : null}
                        {viewedSeries.map((s) => (
                          <Line
                            key={s.id}
                            type="monotone"
                            dataKey={s.id}
                            name={s.id}
                            stroke={colorById[s.id]}
                            strokeWidth={2.5}
                            dot={{ r: 3, fill: colorById[s.id] }}
                            activeDot={{ r: 5 }}
                            connectNulls
                          />
                        ))}
                        <ChartMetaLines series={viewedSeries} colorById={colorById} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="gestao-ind-stats-list">
                {viewedSeries.map((s) => (
                  <div key={s.id} style={{ ["--series-color" as string]: colorById[s.id] }}>
                    <SeriesStats series={s} pointLabel={pointLabel} />
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
