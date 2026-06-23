"use client";

import { useMemo, useState } from "react";
import type { GrowthGuides } from "@/lib/analysis/types";
import { brl } from "@/lib/analysis/format";
import { ProjectionGuidePanel } from "@/components/guides/ProjectionGuidePanel";

type Props = {
  guides: GrowthGuides;
};

type ScenarioId = "2x" | "3x";

export function GrowthGuidesSection({ guides }: Props) {
  const [scenario, setScenario] = useState<ScenarioId>("2x");

  const activeGuide = scenario === "2x" ? guides.projection2x : guides.projection3x;

  const summary = useMemo(
    () => ({
      annual: activeGuide.annualTarget,
      h1: activeGuide.h1Target,
      h2: activeGuide.h2Target,
      contracts: Math.round(activeGuide.fullYearPlan.reduce((s, r) => s + r.wonDealsTarget, 0)),
      traffic: activeGuide.trafficInvestment.annualTotal
    }),
    [activeGuide]
  );

  return (
    <section className="growth-guides page-zone" id="metas">
      <div className="section-title guide-section-head">
        <div>
          <h2>Projeções 2x e 3x</h2>
          <p>Metas mensais, gráficos e plano operacional — alterne o cenário abaixo.</p>
        </div>
        <div className="scenario-toggle" role="tablist" aria-label="Cenário de projeção">
          <button
            type="button"
            role="tab"
            aria-selected={scenario === "2x"}
            className={scenario === "2x" ? "active" : ""}
            onClick={() => setScenario("2x")}
          >
            2x
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scenario === "3x"}
            className={scenario === "3x" ? "active" : ""}
            onClick={() => setScenario("3x")}
          >
            3x
          </button>
        </div>
      </div>

      <div className="scenario-compare-bar">
        <div className={`scenario-compare-item ${scenario === "2x" ? "active" : ""}`}>
          <span>2x — ano</span>
          <strong>{brl.format(guides.projection2x.annualTarget)}</strong>
        </div>
        <div className={`scenario-compare-item ${scenario === "3x" ? "active" : ""}`}>
          <span>3x — ano</span>
          <strong>{brl.format(guides.projection3x.annualTarget)}</strong>
        </div>
        <div className="scenario-compare-item muted-item">
          <span>Cenário ativo · H1 / H2</span>
          <strong>
            {brl.format(summary.h1)} / {brl.format(summary.h2)}
          </strong>
        </div>
        <div className="scenario-compare-item muted-item">
          <span>Contratos · tráfego</span>
          <strong>
            {summary.contracts} · {brl.format(summary.traffic)}
          </strong>
        </div>
      </div>

      <div role="tabpanel" key={scenario}>
        <ProjectionGuidePanel guide={activeGuide} />
      </div>
    </section>
  );
}
