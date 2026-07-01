"use client";

import { useMemo, useState } from "react";
import type { Analysis, GoalPlan } from "@/lib/analysis/types";
import { getPlanning, getOrderedGoals, goalStatus } from "@/lib/analysis/metrics";
import { brl, number } from "@/lib/analysis/format";
import { GoalCard } from "@/components/planning/GoalCard";
import { GoalProgressChart, GoalCumulativeChart } from "@/components/planning/planning-charts";

type Props = {
  analysis: Analysis;
  generatedAt: string;
};

const monthShort = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function intervalLabel(goal: GoalPlan, start: string) {
  const [, rawMonth] = start.split("-");
  const monthIndex = Number(rawMonth) - 1;
  if (goal.interval === "quarterly") return `${monthShort[monthIndex]}–${monthShort[Math.min(11, monthIndex + 2)]}`;
  if (goal.interval === "weekly") return start;
  return monthShort[monthIndex] ?? start;
}

function fmtValue(value: number | null, unit: GoalPlan["unit"]) {
  if (value == null) return "—";
  return unit === "currency" ? brl.format(value) : number.format(value);
}

export function PlanningPage({ analysis, generatedAt }: Props) {
  const planning = getPlanning(analysis);
  const goals = useMemo(() => (planning ? getOrderedGoals(planning) : []), [planning]);
  const [selectedId, setSelectedId] = useState<string | null>(goals[0]?.id ?? null);

  if (!planning || goals.length === 0) {
    return (
      <div className="page-header">
        <h1>Planejamento 2026</h1>
        <p>
          Nenhuma meta encontrada no Pipedrive. Rode <code>npm run sync</code> e{" "}
          <code>npm run analyze</code> para importar as metas do ano.
        </p>
      </div>
    );
  }

  const selected = goals.find((goal) => goal.id === selectedId) ?? goals[0];
  const currentMonth = planning.currentMonth;

  return (
    <>
      <div className="page-header">
        <h1>Planejamento 2026</h1>
        <p>
          Metas reais do Pipedrive × realizado × projeção de fechamento do ano. Fonte:{" "}
          {planning.source}.
        </p>
        <span className="pill green scenario-pill">Mês corrente: {currentMonth}</span>
      </div>

      <div className="filter-meta planning-source-note">
        <span>Dados de {generatedAt}</span>
        <span className="pill amber">Realizado = progress oficial da meta no Pipedrive</span>
      </div>

      <section className="goal-grid">
        {goals.map((goal) => (
          <GoalCard key={goal.id} goal={goal} selected={goal.id === selected.id} onSelect={setSelectedId} />
        ))}
      </section>

      <div className="section-title subsection-title">
        <div>
          <h3>{selected.title.replace(/\s*-\s*2026$/, "").trim()}</h3>
          <p>
            {selected.metricLabel} · {selected.interval === "quarterly" ? "trimestral" : selected.interval === "weekly" ? "semanal" : "mensal"} ·{" "}
            {selected.pipelines.join(" + ") || "Todos os funis"}
          </p>
        </div>
      </div>

      <section className="dashboard-grid planning-charts-grid">
        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Meta × realizado por período</h2>
              <span>Barras = realizado · linha = meta do Pipedrive</span>
            </div>
          </div>
          <div className="chart-box">
            <GoalProgressChart goal={selected} currentMonth={currentMonth} />
          </div>
        </div>

        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Acumulado no ano</h2>
              <span>Realizado acumulado vs meta acumulada</span>
            </div>
          </div>
          <div className="chart-box">
            <GoalCumulativeChart goal={selected} currentMonth={currentMonth} />
          </div>
        </div>
      </section>

      <div className="section-title subsection-title">
        <div>
          <h3>Detalhe período a período</h3>
          <p>Meta, realizado e atingimento de cada período da meta selecionada.</p>
        </div>
      </div>

      <div className="card gestao-table-wrap">
        <table className="gestao-table planning-goal-table">
          <thead>
            <tr>
              <th>Período</th>
              <th className="num">Meta</th>
              <th className="num">Realizado</th>
              <th className="num">Atingimento</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {selected.intervals.map((interval) => {
              const isFuture = (interval.monthKey ?? "0000-00") > currentMonth;
              const status = isFuture ? null : goalStatus(interval.attainmentPct);
              return (
                <tr key={interval.start} className={isFuture ? "is-future" : interval.monthKey === currentMonth ? "is-current" : ""}>
                  <td>{intervalLabel(selected, interval.start)}</td>
                  <td className="num">{fmtValue(interval.target, selected.unit)}</td>
                  <td className="num">{isFuture ? "—" : fmtValue(interval.realized, selected.unit)}</td>
                  <td className="num">
                    {isFuture || interval.attainmentPct == null ? "—" : `${number.format(interval.attainmentPct)}%`}
                  </td>
                  <td>
                    {status ? (
                      <span className={`pill goal-pill goal-pill-${status}`}>
                        {status === "acima" ? "Acima" : status === "no_alvo" ? "No alvo" : status === "abaixo" ? "Abaixo" : "Em risco"}
                      </span>
                    ) : (
                      <span className="gestao-muted">futuro</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total ano</td>
              <td className="num">{fmtValue(selected.totalTarget, selected.unit)}</td>
              <td className="num">{fmtValue(selected.totalRealized, selected.unit)}</td>
              <td className="num">{selected.attainmentPct == null ? "—" : `${number.format(selected.attainmentPct)}%`}</td>
              <td>
                Projeção: <strong>{fmtValue(selected.projectedYearEnd, selected.unit)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
