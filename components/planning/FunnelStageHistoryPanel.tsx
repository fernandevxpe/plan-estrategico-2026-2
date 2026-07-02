"use client";

import { useMemo, useState } from "react";
import type { Analysis } from "@/lib/analysis/types";
import {
  buildFunnelStackedRows,
  funnelMonthBreakdown,
  getFunnelStageHistory,
  hasFunnelFlowData,
  type FunnelViewMode
} from "@/lib/analysis/funnel-stage-metrics";
import { brl, number } from "@/lib/analysis/format";
import { FunnelStageStackedChart } from "@/components/planning/funnel-stage-charts";

type Props = {
  analysis: Analysis;
  defaultMonth?: string;
};

const MODE_LABELS: Record<FunnelViewMode, string> = {
  entries: "Novos no mês",
  stock: "Acumulado (fim do mês)"
};

export function FunnelStageHistoryPanel({ analysis, defaultMonth }: Props) {
  const history = getFunnelStageHistory(analysis);
  const [pipelineId, setPipelineId] = useState(11);
  const [mode, setMode] = useState<FunnelViewMode>("entries");
  const [selectedMonth, setSelectedMonth] = useState<string | null>(defaultMonth ?? null);

  const pipeline = history?.pipelines.find((item) => item.id === pipelineId);
  const [selectedStageIds, setSelectedStageIds] = useState<Set<number>>(() => {
    const initial = history?.pipelines.find((item) => item.id === 11);
    return new Set(initial?.stages.map((stage) => stage.id) ?? []);
  });

  const chartRows = useMemo(() => {
    if (!history) return [];
    return buildFunnelStackedRows(history, pipelineId, mode, selectedStageIds);
  }, [history, pipelineId, mode, selectedStageIds]);

  const activeMonth = useMemo(() => {
    if (!history || !chartRows.length) return null;
    if (selectedMonth && chartRows.some((row) => row.month === selectedMonth)) return selectedMonth;
    return chartRows[chartRows.length - 1]?.month ?? null;
  }, [history, chartRows, selectedMonth]);

  const monthDetail = useMemo(() => {
    if (!history || !activeMonth) return [];
    return funnelMonthBreakdown(history, pipelineId, mode, activeMonth, selectedStageIds);
  }, [history, pipelineId, mode, activeMonth, selectedStageIds]);

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
          Histórico de entradas e estoque por etapa ainda não disponível. Execute{" "}
          <code>npm run sync</code> (Pipedrive) para buscar o flow dos negócios.
        </p>
      </article>
    );
  }

  function switchPipeline(id: number) {
    setPipelineId(id);
    const next = history!.pipelines.find((item) => item.id === id);
    if (next) setSelectedStageIds(new Set(next.stages.map((stage) => stage.id)));
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

  return (
    <article className="card span-2 funnel-stage-panel">
      <div className="funnel-stage-head">
        <div>
          <h3>Funil por etapa — histórico</h3>
          <p className="chart-caption">
            Barras empilhadas por mês. <strong>Novos</strong> = entradas na etapa naquele mês.{" "}
            <strong>Acumulado</strong> = quantos negócios estavam na etapa no fim do mês.
          </p>
        </div>
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
      </div>

      <div className="funnel-pipeline-toggle">
        {history.pipelines.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`goal-preset-btn ${pipelineId === item.id ? "is-active" : ""}`}
            onClick={() => switchPipeline(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div className="funnel-stage-chips">
        <span className="goal-compare-presets-label">Etapas:</span>
        {pipeline?.stages.map((stage, index) => {
          const active = selectedStageIds.has(stage.id);
          const color = ["#2368a0", "#21a67a", "#b67818", "#7c3aed", "#e5484d", "#0f766e"][index % 6];
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

      <div className="funnel-month-cards">
        <article className="card planning-kpi-card tone-neutral">
          <span className="planning-kpi-label">Mês selecionado</span>
          <strong className="planning-kpi-value">{monthLabel ?? "—"}</strong>
          <span className="planning-kpi-detail">{pipeline?.name}</span>
        </article>
        <article className="card planning-kpi-card tone-neutral">
          <span className="planning-kpi-label">{mode === "entries" ? "Novos no mês" : "No funil (fim)"}</span>
          <strong className="planning-kpi-value">{number.format(monthTotals.deals)}</strong>
          <span className="planning-kpi-detail">negócios nas etapas visíveis</span>
        </article>
        <article className="card planning-kpi-card tone-neutral">
          <span className="planning-kpi-label">Valor</span>
          <strong className="planning-kpi-value">{brl.format(monthTotals.value)}</strong>
          <span className="planning-kpi-detail">soma das etapas selecionadas</span>
        </article>
      </div>

      <div className="chart-box chart-box-tall funnel-stage-chart">
        <FunnelStageStackedChart
          history={history}
          pipelineId={pipelineId}
          mode={mode}
          selectedStageIds={selectedStageIds}
          selectedMonth={activeMonth}
          onSelectMonth={setSelectedMonth}
        />
      </div>

      {monthDetail.length ? (
        <div className="table-wrap">
          <table className="planning-goal-table funnel-stage-table">
            <thead>
              <tr>
                <th>Etapa</th>
                <th className="num">Negócios</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {monthDetail.map((row, index) => (
                <tr key={row.stageId}>
                  <td>
                    <span
                      className="goal-table-color"
                      style={{
                        background: ["#2368a0", "#21a67a", "#b67818", "#7c3aed", "#e5484d", "#0f766e"][index % 6]
                      }}
                    />
                    {row.stage}
                  </td>
                  <td className="num">{number.format(row.deals)}</td>
                  <td className="num">{brl.format(row.value)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total visível</td>
                <td className="num">{number.format(monthTotals.deals)}</td>
                <td className="num">{brl.format(monthTotals.value)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
    </article>
  );
}
