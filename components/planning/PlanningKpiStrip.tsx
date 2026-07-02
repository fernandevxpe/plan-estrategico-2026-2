"use client";

import type { PlanningKpiGroup } from "@/lib/analysis/planning-pipedrive";

type Props = {
  groups: PlanningKpiGroup[];
};

export function PlanningKpiStrip({ groups }: Props) {
  if (!groups.length) return null;

  return (
    <section className="planning-kpi-strip" aria-label="Indicadores Pipedrive">
      {groups.map((group) => (
        <div key={group.id} className="planning-kpi-group">
          <h2 className="planning-kpi-group-title">{group.title}</h2>
          <div className="planning-kpi-grid">
            {group.items.map((item) => (
              <article key={item.id} className={`card planning-kpi-card tone-${item.tone}`}>
                <span className="planning-kpi-label">{item.label}</span>
                <strong className="planning-kpi-value">{item.value}</strong>
                <span className="planning-kpi-detail">{item.detail}</span>
              </article>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
