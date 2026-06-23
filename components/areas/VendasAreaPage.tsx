"use client";

import { useCallback, useState } from "react";
import type { VendasDirectorDashboard } from "@/lib/areas/build-vendas-director-dashboard";
import type { VendasFunnelDashboard } from "@/lib/areas/build-vendas-funnel";
import type { VendasScenariosDashboard } from "@/lib/areas/build-vendas-scenarios";
import type { VendasUnitEconomicsDashboard } from "@/lib/areas/build-vendas-unit-economics";
import type { AreaDashboardItem } from "@/lib/areas/types";
import { AreaDetailPanel } from "@/components/areas/AreasOverview";
import { VendasCollapsibleSection } from "@/components/areas/VendasCollapsibleSection";
import { VendasDirectorDashboardSection } from "@/components/areas/VendasDirectorDashboardSection";
import { VendasFunnelSection } from "@/components/areas/VendasFunnelSection";
import { VendasOperationalFocus } from "@/components/areas/VendasOperationalFocus";
import { VendasScenariosSection } from "@/components/areas/VendasScenariosSection";
import { VendasSummaryBar } from "@/components/areas/VendasSummaryBar";
import { VendasUnitEconomicsSection } from "@/components/areas/VendasUnitEconomicsSection";

type SectionId = "gate" | "monitor" | "plano" | "funil" | "cenarios" | "economics";

const DEFAULT_OPEN: Record<SectionId, boolean> = {
  gate: true,
  monitor: true,
  plano: false,
  funil: false,
  cenarios: false,
  economics: false
};

type Props = {
  area: AreaDashboardItem;
  funnel: VendasFunnelDashboard;
  director: VendasDirectorDashboard;
  scenarios: VendasScenariosDashboard;
  unitEconomics: VendasUnitEconomicsDashboard;
};

export function VendasAreaPage({ area, funnel, director, scenarios, unitEconomics }: Props) {
  const [openSections, setOpenSections] = useState(DEFAULT_OPEN);

  const toggle = useCallback((id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const expandAll = () => {
    setOpenSections({
      gate: true,
      monitor: true,
      plano: true,
      funil: true,
      cenarios: true,
      economics: true
    });
  };

  const collapseAll = () => {
    setOpenSections({
      gate: true,
      monitor: false,
      plano: false,
      funil: false,
      cenarios: false,
      economics: false
    });
  };

  const scrollTo = (id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: true }));
    requestAnimationFrame(() => {
      document.getElementById(`vendas-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const criticalCount = director.kpis.filter((k) => k.status === "critical").length;

  return (
    <div className="vendas-page">
      <VendasSummaryBar area={area} funnel={funnel} director={director} scenarios={scenarios} />

      <div className="vendas-toolbar">
        <nav className="vendas-nav" aria-label="Seções da área Vendas">
          {[
            { id: "gate" as const, label: "Prioridade" },
            { id: "monitor" as const, label: "Monitor" },
            { id: "plano" as const, label: "Plano" },
            { id: "funil" as const, label: "Funil" },
            { id: "cenarios" as const, label: "Cenários" },
            { id: "economics" as const, label: "Economics" }
          ].map((item) => (
            <button key={item.id} type="button" className="vendas-nav-pill" onClick={() => scrollTo(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="vendas-toolbar-actions">
          <button type="button" className="vendas-text-btn" onClick={expandAll}>
            Expandir tudo
          </button>
          <button type="button" className="vendas-text-btn" onClick={collapseAll}>
            Recolher
          </button>
        </div>
      </div>

      <div className="vendas-sections">
        <VendasCollapsibleSection
          id="vendas-gate"
          title="Prioridade & gate operacional"
          subtitle="Nada escala antes de destravar propostas — foco na base em Negociação"
          variant="priority"
          open={openSections.gate}
          onToggle={() => toggle("gate")}
          badge={<span className="pill red">SLA 48h</span>}
        >
          <VendasOperationalFocus funnel={funnel} embedded />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="vendas-monitor"
          title="Monitor semanal — Diretor"
          subtitle={`${director.meeting.cadence} · ${director.meeting.duration}`}
          variant="monitor"
          open={openSections.monitor}
          onToggle={() => toggle("monitor")}
          badge={
            criticalCount > 0 ? (
              <span className="pill red">{criticalCount} crítico(s)</span>
            ) : (
              <span className="pill green">OK</span>
            )
          }
        >
          <VendasDirectorDashboardSection dashboard={director} embedded />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="vendas-plano"
          title="Plano de execução"
          subtitle={`${area.activities.length} atividades · ${area.objectives.length} objetivos`}
          open={openSections.plano}
          onToggle={() => toggle("plano")}
          badge={
            <span className="pill amber">
              {area.activities.filter((a) => a.status === "bloqueada").length} bloqueada(s)
            </span>
          }
        >
          <AreaDetailPanel area={area} compact />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="vendas-funil"
          title="Funil comercial"
          subtitle={`${funnel.stagesTotalDeals} abertos · ${funnel.negotiationDeals} em Negociação`}
          open={openSections.funil}
          onToggle={() => toggle("funil")}
        >
          <VendasFunnelSection funnel={funnel} embedded />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="vendas-cenarios"
          title="Projeção & headcount"
          subtitle="Cenários A/B · ramp 0→33→66→100% · remuneração"
          open={openSections.cenarios}
          onToggle={() => toggle("cenarios")}
        >
          <VendasScenariosSection scenarios={scenarios} embedded />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="vendas-economics"
          title="CAC & margem bruta"
          subtitle="Custos de aquisição e unit economics H2"
          open={openSections.economics}
          onToggle={() => toggle("economics")}
        >
          <VendasUnitEconomicsSection unitEconomics={unitEconomics} embedded />
        </VendasCollapsibleSection>
      </div>
    </div>
  );
}
