"use client";

import { Fragment, useMemo, useState } from "react";
import type { Analysis, GoalPlan } from "@/lib/analysis/types";
import {
  buildGoalCompareRows,
  canCompareGoalValues,
  getOrderedGoals,
  getPlanning,
  GOAL_COMPARE_COLORS,
  GOAL_COMPARISON_PRESETS,
  goalIntervalsWithProgress,
  goalShortTitle,
  resolvePresetGoalIds
} from "@/lib/analysis/metrics";
import { brl, number } from "@/lib/analysis/format";
import { GoalCard } from "@/components/planning/GoalCard";
import {
  GoalCumulativeChart,
  GoalProgressChart,
  GoalsCompareChart,
  type GoalCompareMode
} from "@/components/planning/planning-charts";

type Props = {
  analysis: Analysis;
};

function fmtValue(value: number | null | undefined, unit: GoalPlan["unit"]) {
  if (value == null) return "—";
  return unit === "currency" ? brl.format(value) : number.format(value);
}

function fmtPct(value: number | null | undefined) {
  if (value == null) return "—";
  return `${number.format(value)}%`;
}

const COMPARE_MODE_LABELS: Record<GoalCompareMode, string> = {
  values: "Meta x realizado",
  accumulated: "Acumulado",
  attainment: "% da meta"
};

export function PlanningPage({ analysis }: Props) {
  const planning = getPlanning(analysis);
  const goals = useMemo(() => (planning ? getOrderedGoals(planning) : []), [planning]);

  const defaultId = planning?.primaryGoalId ?? planning?.highlights.global?.id ?? goals[0]?.id ?? "";
  const [selectedIds, setSelectedIds] = useState<string[]>([defaultId]);
  const [compareMode, setCompareMode] = useState<GoalCompareMode>("values");

  if (!planning || !goals.length) {
    return (
      <section className="page-stack">
        <header className="page-header">
          <h1>Planejamento 2026</h1>
          <p>Metas do Pipedrive ainda não disponíveis. Execute o sync de dados.</p>
        </header>
      </section>
    );
  }

  const { currentMonth } = planning;
  const selectedGoals = selectedIds
    .map((id) => goals.find((goal) => goal.id === id))
    .filter((goal): goal is GoalPlan => Boolean(goal));
  const isComparing = selectedGoals.length > 1;
  const focusGoal = selectedGoals[0] ?? goals[0]!;
  const valuesComparable = canCompareGoalValues(selectedGoals);
  const effectiveMode: GoalCompareMode =
    compareMode === "values" && !valuesComparable ? "attainment" : compareMode;

  const compareRows = isComparing ? buildGoalCompareRows(selectedGoals, currentMonth) : [];
  const hasFunnelPair =
    isComparing &&
    selectedGoals.some((g) => /potencial/i.test(g.title)) &&
    selectedGoals.some((g) => /global/i.test(g.title));

  const conversionRows = compareRows.filter((row) => !row.isFuture && row.conversionPct != null);
  const avgConversion =
    conversionRows.length > 0
      ? conversionRows.reduce((sum, row) => sum + Number(row.conversionPct), 0) / conversionRows.length
      : null;
  const currentConversion = conversionRows.find((row) => row.monthKey === currentMonth)?.conversionPct ?? null;

  function toggleGoal(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev;
        return prev.filter((item) => item !== id);
      }
      return [...prev, id];
    });
  }

  function applyPreset(keys: (typeof GOAL_COMPARISON_PRESETS)[number]["keys"]) {
    const ids = resolvePresetGoalIds(planning!, keys);
    if (ids.length) setSelectedIds(ids);
  }

  function removeFromCompare(id: string) {
    setSelectedIds((prev) => {
      if (prev.length === 1) return prev;
      const next = prev.filter((item) => item !== id);
      return next.length ? next : [id];
    });
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h1>Planejamento 2026</h1>
        <p>
          Metas oficiais do Pipedrive (Goals) com realizado, ritmo e projeção de fechamento. Clique nos cards para
          comparar 2 ou mais metas no mesmo gráfico.
        </p>
        <p className="planning-source-note">
          Fonte: Pipedrive Goals · atualizado em {analysis.generatedAt?.slice(0, 10) ?? "—"} · mês corrente:{" "}
          {currentMonth}
        </p>
      </header>

      <div className="goal-compare-presets">
        <span className="goal-compare-presets-label">Atalhos:</span>
        {GOAL_COMPARISON_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="ghost-btn goal-preset-btn"
            onClick={() => applyPreset(preset.keys)}
          >
            {preset.label}
          </button>
        ))}
        {isComparing ? (
          <button type="button" className="ghost-btn goal-preset-btn" onClick={() => setSelectedIds([focusGoal.id])}>
            Limpar comparação
          </button>
        ) : null}
      </div>

      <div className="goal-grid">
        {goals.map((goal) => {
          const order = selectedIds.indexOf(goal.id);
          return (
            <GoalCard
              key={goal.id}
              goal={goal}
              selected={order >= 0}
              selectionOrder={order >= 0 ? order : undefined}
              selectionColor={order >= 0 ? GOAL_COMPARE_COLORS[order % GOAL_COMPARE_COLORS.length] : undefined}
              onToggle={toggleGoal}
            />
          );
        })}
      </div>

      {isComparing ? (
        <article className="card span-2 planning-compare-panel">
          <div className="goal-compare-toolbar">
            <div>
              <h3>Comparação de metas</h3>
              <p className="goal-compare-hint">
                Cada meta usa a mesma cor: <strong>tracejado = planejado</strong>, <strong>linha sólida = executado</strong>.
                Use <strong>% da meta</strong> para comparar escalas diferentes (ex.: Potencial × Global).
              </p>
            </div>
            <div className="chart-mode-toggle" role="group" aria-label="Modo do gráfico comparativo">
              {(Object.keys(COMPARE_MODE_LABELS) as GoalCompareMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={effectiveMode === mode ? "is-active" : ""}
                  disabled={mode === "values" && !valuesComparable}
                  title={
                    mode === "values" && !valuesComparable
                      ? "Só metas com a mesma unidade (R$ ou quantidade) podem usar valores absolutos"
                      : undefined
                  }
                  onClick={() => setCompareMode(mode)}
                >
                  {COMPARE_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>

          <div className="goal-compare-chips">
            {selectedGoals.map((goal, index) => (
              <span
                key={goal.id}
                className="goal-compare-chip"
                style={{ borderColor: GOAL_COMPARE_COLORS[index % GOAL_COMPARE_COLORS.length] }}
              >
                <span
                  className="goal-compare-chip-dot"
                  style={{ background: GOAL_COMPARE_COLORS[index % GOAL_COMPARE_COLORS.length] }}
                />
                {goalShortTitle(goal)}
                {selectedGoals.length > 1 ? (
                  <button
                    type="button"
                    className="goal-compare-chip-remove"
                    aria-label={`Remover ${goalShortTitle(goal)} da comparação`}
                    onClick={() => removeFromCompare(goal.id)}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
          </div>

          {hasFunnelPair && avgConversion != null ? (
            <div className="goal-correlation-insight">
              <strong>Correlação funil</strong>
              <span>
                Conversão média Global ÷ Potencial (YTD): <strong>{fmtPct(avgConversion)}</strong>
                {currentConversion != null ? (
                  <>
                    {" "}
                    · mês atual: <strong>{fmtPct(Number(currentConversion))}</strong>
                  </>
                ) : null}
              </span>
            </div>
          ) : null}

          <div className="chart-box chart-box-tall">
            <GoalsCompareChart goals={selectedGoals} mode={effectiveMode} currentMonth={currentMonth} />
          </div>

          <div className="table-wrap">
            <table className="planning-goal-table planning-compare-table">
              <thead>
                <tr>
                  <th>Mês</th>
                  {selectedGoals.map((goal, index) => (
                    <th key={goal.id} colSpan={2}>
                      <span
                        className="goal-table-color"
                        style={{ background: GOAL_COMPARE_COLORS[index % GOAL_COMPARE_COLORS.length] }}
                      />
                      {goalShortTitle(goal)}
                    </th>
                  ))}
                  {hasFunnelPair && effectiveMode === "values" ? <th>Conv. %</th> : null}
                </tr>
                <tr>
                  <th />
                  {selectedGoals.map((goal) => (
                    <Fragment key={goal.id}>
                      <th className="num subhead">Meta</th>
                      <th className="num subhead">
                        {effectiveMode === "attainment" ? "% real." : "Realizado"}
                      </th>
                    </Fragment>
                  ))}
                  {hasFunnelPair && effectiveMode === "values" ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row) => (
                  <tr
                    key={row.monthKey}
                    className={`${row.isFuture ? "is-future" : ""} ${row.monthKey === currentMonth ? "is-current" : ""}`}
                  >
                    <td>{row.label}</td>
                    {selectedGoals.map((goal, index) => {
                      const prefix = `g${index}`;
                      const target = row[`target_${prefix}`] as number;
                      const realized = row[`realized_${prefix}`] as number | null;
                      const attainment = row[`attainment_${prefix}`] as number | null;
                      const cumTarget = row[`cumTarget_${prefix}`] as number;
                      const cumRealized = row[`cumRealized_${prefix}`] as number | null;

                      if (effectiveMode === "attainment") {
                        return (
                          <Fragment key={goal.id}>
                            <td className="num">100%</td>
                            <td className="num">{row.isFuture ? "—" : fmtPct(attainment)}</td>
                          </Fragment>
                        );
                      }
                      if (effectiveMode === "accumulated") {
                        return (
                          <Fragment key={goal.id}>
                            <td className="num">{fmtValue(cumTarget, goal.unit)}</td>
                            <td className="num">{row.isFuture ? "—" : fmtValue(cumRealized, goal.unit)}</td>
                          </Fragment>
                        );
                      }
                      return (
                        <Fragment key={goal.id}>
                          <td className="num">{fmtValue(target, goal.unit)}</td>
                          <td className="num">{row.isFuture ? "—" : fmtValue(realized, goal.unit)}</td>
                        </Fragment>
                      );
                    })}
                    {hasFunnelPair && effectiveMode === "values" ? (
                      <td className="num">{row.isFuture ? "—" : fmtPct(row.conversionPct as number | null)}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : (
        <>
          <div className="chart-grid">
            <article className="card">
              <h3>Meta x realizado — {goalShortTitle(focusGoal)}</h3>
              <p className="chart-caption">Por {focusGoal.interval === "quarterly" ? "trimestre" : "mês"}</p>
              <div className="chart-box chart-box-tall">
                <GoalProgressChart goal={focusGoal} currentMonth={currentMonth} />
              </div>
            </article>

            <article className="card">
              <h3>Acumulado no ano — {goalShortTitle(focusGoal)}</h3>
              <p className="chart-caption">Realizado acumulado vs meta acumulada</p>
              <div className="chart-box chart-box-tall">
                <GoalCumulativeChart goal={focusGoal} currentMonth={currentMonth} />
              </div>
            </article>
          </div>

          <article className="card span-2">
            <h3>Detalhe por intervalo — {goalShortTitle(focusGoal)}</h3>
            <div className="table-wrap">
              <table className="planning-goal-table">
                <thead>
                  <tr>
                    <th>Período</th>
                    <th className="num">Meta</th>
                    <th className="num">Realizado</th>
                    <th className="num">% meta</th>
                  </tr>
                </thead>
                <tbody>
                  {goalIntervalsWithProgress(focusGoal, currentMonth).map((interval) => (
                    <tr
                      key={interval.start}
                      className={`${interval.isFuture ? "is-future" : ""} ${interval.isCurrent ? "is-current" : ""}`}
                    >
                      <td>
                        {interval.start}
                        {interval.end !== interval.start ? ` → ${interval.end}` : ""}
                      </td>
                      <td className="num">{fmtValue(interval.target, focusGoal.unit)}</td>
                      <td className="num">
                        {interval.isFuture ? "—" : fmtValue(interval.realized, focusGoal.unit)}
                      </td>
                      <td className="num">
                        {interval.isFuture ? "—" : fmtPct(interval.attainmentPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total ano</td>
                    <td className="num">{fmtValue(focusGoal.totalTarget, focusGoal.unit)}</td>
                    <td className="num">{fmtValue(focusGoal.totalRealized, focusGoal.unit)}</td>
                    <td className="num">{fmtPct(focusGoal.attainmentPct)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </article>
        </>
      )}
    </section>
  );
}
