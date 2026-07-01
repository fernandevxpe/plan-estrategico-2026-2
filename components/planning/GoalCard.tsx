"use client";

import type { GoalPlan } from "@/lib/analysis/types";
import { goalStatus } from "@/lib/analysis/metrics";
import { brl, number } from "@/lib/analysis/format";

const STATUS_LABEL: Record<string, string> = {
  acima: "Acima da meta",
  no_alvo: "No alvo",
  abaixo: "Abaixo",
  em_risco: "Em risco"
};

function fmtValue(value: number, unit: GoalPlan["unit"]) {
  return unit === "currency" ? brl.format(value) : number.format(value);
}

type Props = {
  goal: GoalPlan;
  selected: boolean;
  onSelect: (id: string) => void;
};

export function GoalCard({ goal, selected, onSelect }: Props) {
  const status = goalStatus(goal.attainmentPct);
  const attainment = goal.attainmentPct ?? 0;
  const projected = goal.projectedAttainmentPct ?? 0;
  const barPct = Math.min(100, Math.max(0, attainment));
  const projectedBarPct = Math.min(100, Math.max(0, projected));

  return (
    <button
      type="button"
      className={`card goal-card ${selected ? "is-selected" : ""} goal-status-${status}`}
      onClick={() => onSelect(goal.id)}
    >
      <div className="goal-card-head">
        <div>
          <strong>{goal.title.replace(/\s*-\s*2026$/, "").trim()}</strong>
          <span className="goal-card-meta">
            {goal.metricLabel} · {goal.pipelines.join(" + ") || "Todos os funis"}
          </span>
        </div>
        <span className={`pill goal-pill goal-pill-${status}`}>{STATUS_LABEL[status]}</span>
      </div>

      <div className="goal-card-values">
        <div>
          <span className="goal-card-label">Realizado</span>
          <strong>{fmtValue(goal.totalRealized, goal.unit)}</strong>
        </div>
        <div>
          <span className="goal-card-label">Meta ano</span>
          <strong>{fmtValue(goal.totalTarget, goal.unit)}</strong>
        </div>
      </div>

      <div className="goal-progress">
        <div className="goal-progress-track">
          <div className="goal-progress-fill" style={{ width: `${barPct}%` }} />
          <div className="goal-progress-projected" style={{ width: `${projectedBarPct}%` }} />
        </div>
        <div className="goal-progress-legend">
          <span>{number.format(attainment)}% da meta</span>
          <span>Projeção fim de ano: {number.format(projected)}%</span>
        </div>
      </div>

      <div className="goal-card-projection">
        Projeção de fechamento: <strong>{fmtValue(goal.projectedYearEnd, goal.unit)}</strong>
        {goal.paceRatio != null ? (
          <span className="goal-card-pace"> · ritmo {number.format(goal.paceRatio * 100)}% do planejado</span>
        ) : null}
      </div>
    </button>
  );
}
