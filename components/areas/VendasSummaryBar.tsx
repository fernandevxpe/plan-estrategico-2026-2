"use client";

import type { VendasDirectorDashboard } from "@/lib/areas/build-vendas-director-dashboard";
import type { VendasFunnelDashboard } from "@/lib/areas/build-vendas-funnel";
import type { VendasScenariosDashboard } from "@/lib/areas/build-vendas-scenarios";
import type { AreaDashboardItem } from "@/lib/areas/types";
import { brl } from "@/lib/analysis/format";

type Props = {
  area: AreaDashboardItem;
  funnel: VendasFunnelDashboard;
  director: VendasDirectorDashboard;
  scenarios: VendasScenariosDashboard;
};

export function VendasSummaryBar({ area, funnel, director, scenarios }: Props) {
  const slaKpi = director.kpis.find((k) => k.id === "sla48h");
  const criticalCount = director.kpis.filter((k) => k.status === "critical").length;
  const scenarioA = scenarios.scenarios[0];

  return (
    <div className="vendas-summary-bar">
      <div className={`vendas-summary-gate ${director.gateOk ? "ok" : "alert"}`}>
        <span className="vendas-summary-gate-label">{director.gateOk ? "Gate OK" : "Gate em risco"}</span>
        <span className="vendas-summary-gate-detail">
          SLA 48h: <strong>{slaKpi?.current ?? "—"}</strong> atrasos
          {!director.gateOk ? ` · ${criticalCount} crítico(s)` : ""}
        </span>
      </div>

      <div className="vendas-summary-metrics">
        <div className="vendas-summary-metric">
          <span>Negociação</span>
          <strong>
            {funnel.negotiationDeals} · {brl.format(funnel.negotiationValue)}
          </strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Receita YTD</span>
          <strong>{area.metrics.revenue2026Ytd != null ? brl.format(area.metrics.revenue2026Ytd) : "—"}</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Meta 2026</span>
          <strong>{brl.format(scenarios.targets.annual3M)}</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Proj. ano (A)</span>
          <strong className={scenarioA.gapVs3M >= 0 ? "text-positive" : "text-negative"}>
            {brl.format(scenarioA.annualTotal)}
          </strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Fech. 7d</span>
          <strong>{director.rolling.won7d}</strong>
        </div>
      </div>
    </div>
  );
}
