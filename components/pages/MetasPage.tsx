"use client";

import { Circle } from "lucide-react";
import type { GrowthGuides } from "@/lib/analysis/types";

type Props = {
  guides: GrowthGuides;
};

const priorityLabel = {
  critical: "Crítico",
  high: "Alta",
  medium: "Média"
} as const;

const priorityClass = {
  critical: "amber",
  high: "blue",
  medium: "green"
} as const;

export function MetasPage({ guides }: Props) {
  // Um único plano de ação — sem cenários 2x/3x. Conteúdo será revisado depois.
  const pillars = guides.projection2x.pillars;

  return (
    <>
      <div className="page-header">
        <h1>Plano de ação</h1>
        <p>Ações por pilar — prioridade e métrica de acompanhamento.</p>
      </div>

      <section className="growth-guides page-zone" id="metas">
        <div className="section-title">
          <div>
            <h2>Por pilar</h2>
            <p>Base inicial; vamos ajustar o conteúdo juntos.</p>
          </div>
        </div>

        <div className="guide-pillars">
          {pillars.map((pillar) => (
            <article className="card guide-pillar" key={pillar.id}>
              <div className="guide-pillar-head">
                <div>
                  <h4>{pillar.title}</h4>
                  <span>{pillar.subtitle}</span>
                </div>
              </div>
              <ul className="guide-actions">
                {pillar.actions.map((action) => (
                  <li className="guide-action" key={action.title}>
                    <Circle size={14} className="guide-action-icon" />
                    <div>
                      <div className="guide-action-head">
                        <strong>{action.title}</strong>
                        <span className={`pill ${priorityClass[action.priority]}`}>
                          {priorityLabel[action.priority]}
                        </span>
                      </div>
                      <p>{action.detail}</p>
                      {action.metric ? (
                        <div className="guide-action-meta">
                          <span>{action.metric}</span>
                          <strong>{action.target}</strong>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
