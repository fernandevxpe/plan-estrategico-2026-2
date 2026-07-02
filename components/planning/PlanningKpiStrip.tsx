"use client";

import type { PlanningKpi } from "@/lib/analysis/planning-pipedrive";

type Props = {
  items: PlanningKpi[];
  pipelineName?: string;
};

export function PlanningKpiStrip({ items, pipelineName }: Props) {
  if (!items.length) return null;

  return (
    <section className="planning-kpi-strip" aria-label="Indicadores Pipedrive">
      {pipelineName ? (
        <p className="planning-kpi-pipeline">
          Funil principal: <strong>{pipelineName}</strong>
        </p>
      ) : null}
      <div className="planning-kpi-grid">
        {items.map((item) => (
          <article key={item.id} className={`card planning-kpi-card tone-${item.tone}`}>
            <span className="planning-kpi-label">{item.label}</span>
            <strong className="planning-kpi-value">{item.value}</strong>
            <span className="planning-kpi-detail">{item.detail}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
