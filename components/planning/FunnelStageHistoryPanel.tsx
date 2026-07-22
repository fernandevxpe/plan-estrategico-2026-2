"use client";

import { useMemo, useState } from "react";
import type { Analysis } from "@/lib/analysis/types";
import {
  allStageIdsForPipelines,
  buildFunnelStackedRows,
  funnelMonthBreakdown,
  getFunnelStageHistory,
  hasFunnelFlowData,
  pipelineShortName,
  stageColor,
  type FunnelMetricMode,
  type FunnelViewMode,
  type PipelineFilter
} from "@/lib/analysis/funnel-stage-metrics";
import {
  conversionMonthsForPipeline,
  getConversionMonth,
  pipelineFilterToScope
} from "@/lib/analysis/conversion-metrics";
import { brl, number } from "@/lib/analysis/format";
import {
  FunnelStageStackedChart,
  type FunnelTimeSeriesId
} from "@/components/planning/funnel-stage-charts";

type Props = {
  analysis: Analysis;
  defaultMonth?: string;
};

const MODE_LABELS: Record<FunnelViewMode, string> = {
  entries: "Novos no mês",
  stock: "Acumulado (fim do mês)"
};

const METRIC_LABELS: Record<FunnelMetricMode, string> = {
  deals: "Quantidade",
  value: "Valor (R$)"
};

const TIME_SERIES_LABELS: Record<FunnelTimeSeriesId, string> = {
  averageDaysToWin: "Média dias até ganho",
  ganhosAntigosSharePct: "Ganhos antigos (>1M)"
};

export function FunnelStageHistoryPanel({ analysis, defaultMonth }: Props) {
  const history = getFunnelStageHistory(analysis);
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter>(() => history?.pipelines[0]?.id ?? "all");
  const [mode, setMode] = useState<FunnelViewMode>("entries");
  const [metricMode, setMetricMode] = useState<FunnelMetricMode>("deals");
  const [enabledTimeSeries, setEnabledTimeSeries] = useState<Set<FunnelTimeSeriesId>>(
    () => new Set<FunnelTimeSeriesId>(["averageDaysToWin"])
  );
  const [selectedMonth, setSelectedMonth] = useState<string | null>(defaultMonth ?? null);
  const [selectedStageIds, setSelectedStageIds] = useState<Set<number>>(() => {
    if (!history) return new Set();
    return allStageIdsForPipelines(history, history.pipelines[0]?.id ?? "all");
  });

  const conversionMonths = useMemo(
    () => conversionMonthsForPipeline(analysis, pipelineFilter),
    [analysis, pipelineFilter]
  );

  function toggleTimeSeries(id: FunnelTimeSeriesId) {
    setEnabledTimeSeries((prev) => {
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

  const chartRows = useMemo(() => {
    if (!history) return [];
    return buildFunnelStackedRows(history, pipelineFilter, mode, selectedStageIds, metricMode);
  }, [history, pipelineFilter, mode, selectedStageIds, metricMode]);

  const activeMonth = useMemo(() => {
    if (!history || !chartRows.length) return null;
    if (selectedMonth && chartRows.some((row) => row.month === selectedMonth)) return selectedMonth;
    return chartRows[chartRows.length - 1]?.month ?? null;
  }, [history, chartRows, selectedMonth]);

  const activeConversion = useMemo(() => {
    if (!activeMonth) return null;
    return getConversionMonth(analysis, pipelineFilterToScope(pipelineFilter), activeMonth);
  }, [analysis, pipelineFilter, activeMonth]);

  const monthDetail = useMemo(() => {
    if (!history || !activeMonth) return [];
    return funnelMonthBreakdown(history, pipelineFilter, mode, activeMonth, selectedStageIds);
  }, [history, pipelineFilter, mode, activeMonth, selectedStageIds]);

  const monthTotals = useMemo(() => {
    return monthDetail.reduce(
      (acc, row) => {
        acc.deals += row.deals;
        acc.value += row.value;
        return acc;
      },
      { deals: 0, value: 0 }
    );
  }, [monthDetail]);

  if (!history || !hasFunnelFlowData(history)) {
    return (
      <article className="card span-2 funnel-stage-panel">
        <h3>Funil por etapa — histórico</h3>
        <p className="chart-caption">
          Histórico de entradas e estoque por etapa ainda não disponível. Execute <code>npm run sync</code>{" "}
          (Pipedrive) para buscar o flow dos negócios.
        </p>
      </article>
    );
  }

  function switchPipeline(filter: PipelineFilter) {
    setPipelineFilter(filter);
    setSelectedStageIds(allStageIdsForPipelines(history!, filter));
  }

  function toggleStage(stageId: number) {
    setSelectedStageIds((prev) => {
      const next = new Set(prev);
      if (next.has(stageId)) {
        if (next.size === 1) return prev;
        next.delete(stageId);
      } else {
        next.add(stageId);
      }
      return next;
    });
  }

  const monthLabel = history.months.find((item) => item.month === activeMonth)?.label ?? activeMonth;
  const pipelineLabel =
    pipelineFilter === "all"
      ? "Laudos + Obras"
      : history.pipelines.find((item) => item.id === pipelineFilter)?.name ?? "—";

  return (
    <article className="card span-2 funnel-stage-panel">
      <div className="funnel-stage-head">
        <div>
          <h3>Funil por etapa — histórico</h3>
          <p className="chart-caption">
            Barras empilhadas por mês. <strong>Novos</strong> = entradas na etapa naquele mês.{" "}
            <strong>Acumulado</strong> = quantos negócios estavam na etapa no fim do mês. A linha verde mostra a{" "}
            <strong>média de dias</strong> entre criação e ganho dos fechamentos daquele mês.
          </p>
        </div>
        <div className="funnel-stage-toggles">
          <div className="chart-mode-toggle" role="group" aria-label="Modo do funil">
            {(Object.keys(MODE_LABELS) as FunnelViewMode[]).map((item) => (
              <button
                key={item}
                type="button"
                className={mode === item ? "is-active" : ""}
                onClick={() => setMode(item)}
              >
                {MODE_LABELS[item]}
              </button>
            ))}
          </div>
          <div className="chart-mode-toggle" role="group" aria-label="Métrica do funil">
            {(Object.keys(METRIC_LABELS) as FunnelMetricMode[]).map((item) => (
              <button
                key={item}
                type="button"
                className={metricMode === item ? "is-active" : ""}
                onClick={() => setMetricMode(item)}
              >
                {METRIC_LABELS[item]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="funnel-pipeline-toggle">
        <button
          type="button"
          className={`goal-preset-btn ${pipelineFilter === "all" ? "is-active" : ""}`}
          onClick={() => switchPipeline("all")}
        >
          Ambos
        </button>
        {history.pipelines.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`goal-preset-btn ${pipelineFilter === item.id ? "is-active" : ""}`}
            onClick={() => switchPipeline(item.id)}
          >
            {pipelineShortName(item.id, item.name)}
          </button>
        ))}
      </div>

      <div className="funnel-stage-chips">
        <span className="goal-compare-presets-label">Etapas:</span>
        {history.pipelines
          .filter((pipeline) => pipelineFilter === "all" || pipeline.id === pipelineFilter)
          .map((pipeline) => (
            <div key={pipeline.id} className="funnel-stage-chip-group">
              {pipelineFilter === "all" ? (
                <span className="funnel-stage-chip-group-label">{pipelineShortName(pipeline.id, pipeline.name)}</span>
              ) : null}
              {pipeline.stages.map((stage, index) => {
                const active = selectedStageIds.has(stage.id);
                const color = stageColor(index);
                return (
                  <button
                    key={stage.id}
                    type="button"
                    className={`funnel-stage-chip ${active ? "is-active" : ""}`}
                    style={active ? { borderColor: color, background: `${color}14` } : undefined}
                    onClick={() => toggleStage(stage.id)}
                  >
                    <span className="funnel-stage-chip-dot" style={{ background: color }} />
                    {stage.name}
                  </button>
                );
              })}
            </div>
          ))}
      </div>

      <div className="commercial-funnel-series-chips">
        <span className="goal-compare-presets-label">Tempo de fechamento:</span>
        {(Object.keys(TIME_SERIES_LABELS) as FunnelTimeSeriesId[]).map((id) => (
          <button
            key={id}
            type="button"
            className={`funnel-stage-chip ${enabledTimeSeries.has(id) ? "is-active" : ""}`}
            onClick={() => toggleTimeSeries(id)}
          >
            {TIME_SERIES_LABELS[id]}
          </button>
        ))}
      </div>

      <div className="funnel-month-cards">
        <article className="card planning-kpi-card tone-neutral">
          <span className="planning-kpi-label">Mês selecionado</span>
          <strong className="planning-kpi-value">{monthLabel ?? "—"}</strong>
          <span className="planning-kpi-detail">{pipelineLabel}</span>
        </article>
        <article className="card planning-kpi-card tone-neutral">
          <span className="planning-kpi-label">Média até ganho</span>
          <strong className="planning-kpi-value">
            {activeConversion?.averageDaysToWin != null
              ? `${Math.round(activeConversion.averageDaysToWin)}d`
              : "—"}
          </strong>
          <span className="planning-kpi-detail">
            {activeConversion?.wonDeals
              ? `${number.format(activeConversion.wonDeals)} ganhos no mês`
              : "sem ganhos no mês"}
          </span>
        </article>
        <article className="card planning-kpi-card tone-neutral">
          <span className="planning-kpi-label">Ganhos antigos (&gt;1M)</span>
          <strong className="planning-kpi-value">
            {activeConversion?.ganhosAntigosSharePct != null
              ? `${Math.round(activeConversion.ganhosAntigosSharePct)}%`
              : "—"}
          </strong>
          <span className="planning-kpi-detail">
            M {activeConversion?.winLagM0Pct != null ? `${Math.round(activeConversion.winLagM0Pct)}%` : "—"} · M−1{" "}
            {activeConversion?.winLagM1Pct != null ? `${Math.round(activeConversion.winLagM1Pct)}%` : "—"} · M−2{" "}
            {activeConversion?.winLagM2Pct != null ? `${Math.round(activeConversion.winLagM2Pct)}%` : "—"}
          </span>
        </article>
      </div>

      <div className="funnel-month-cards funnel-month-cards-secondary">
        <article className="card planning-kpi-card tone-neutral">
          <span className="planning-kpi-label">{mode === "entries" ? "Novos no mês" : "No funil (fim)"}</span>
          <strong className="planning-kpi-value">
            {metricMode === "value" ? brl.format(monthTotals.value) : number.format(monthTotals.deals)}
          </strong>
          <span className="planning-kpi-detail">
            {metricMode === "value" ? "valor nas etapas visíveis" : "negócios nas etapas visíveis"}
          </span>
        </article>
        <article className="card planning-kpi-card tone-neutral">
          <span className="planning-kpi-label">{metricMode === "value" ? "Negócios" : "Valor"}</span>
          <strong className="planning-kpi-value">
            {metricMode === "value" ? number.format(monthTotals.deals) : brl.format(monthTotals.value)}
          </strong>
          <span className="planning-kpi-detail">complemento do mês</span>
        </article>
      </div>

      <div className="chart-box chart-box-tall funnel-stage-chart">
        <FunnelStageStackedChart
          history={history}
          pipelineFilter={pipelineFilter}
          mode={mode}
          metricMode={metricMode}
          selectedStageIds={selectedStageIds}
          selectedMonth={activeMonth}
          enabledTimeSeries={enabledTimeSeries}
          conversionMonths={conversionMonths}
          onSelectMonth={setSelectedMonth}
        />
      </div>

      {monthDetail.length > 0 ? (
        <div className="funnel-month-table-wrap">
          <table className="funnel-month-table">
            <thead>
              <tr>
                <th>Etapa</th>
                <th>Negócios</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              {monthDetail.map((row) => (
                <tr key={`${row.pipelineId}-${row.stageId}`}>
                  <td>{row.stage}</td>
                  <td>{number.format(row.deals)}</td>
                  <td>{brl.format(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  );
}
