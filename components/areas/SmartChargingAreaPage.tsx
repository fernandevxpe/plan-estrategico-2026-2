"use client";

import { useCallback, useState } from "react";
import type { SmartChargingDashboard } from "@/lib/areas/build-smart-charging-dashboard";
import type { AreaDashboardItem } from "@/lib/areas/types";
import { AreaDetailPanel } from "@/components/areas/AreasOverview";
import {
  SmartChargingOperationalFocus,
  SmartChargingRoadmapSection,
  SmartChargingSummaryBar
} from "@/components/areas/SmartChargingSections";
import { SmartChargingSalesSimulator } from "@/components/areas/SmartChargingSalesSimulator";
import { VendasCollapsibleSection } from "@/components/areas/VendasCollapsibleSection";

type SectionId = "modelo" | "projecao" | "roadmap" | "plano";

const DEFAULT_OPEN: Record<SectionId, boolean> = {
  modelo: true,
  projecao: true,
  roadmap: false,
  plano: false
};

type Props = {
  area: AreaDashboardItem;
  data: SmartChargingDashboard;
};

export function SmartChargingAreaPage({ area, data }: Props) {
  const [openSections, setOpenSections] = useState(DEFAULT_OPEN);

  const toggle = useCallback((id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const scrollTo = (id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: true }));
    requestAnimationFrame(() => {
      document.getElementById(`sc-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="vendas-page consultoria-page smart-charging-page">
      <SmartChargingSummaryBar data={data} />

      <div className="vendas-toolbar">
        <nav className="vendas-nav" aria-label="Seções Smart Charging">
          {[
            { id: "modelo" as const, label: "Produto & produção" },
            { id: "projecao" as const, label: "Projeção vendas" },
            { id: "roadmap" as const, label: "Roadmap" },
            { id: "plano" as const, label: "Plano" }
          ].map((item) => (
            <button key={item.id} type="button" className="vendas-nav-pill" onClick={() => scrollTo(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="vendas-sections">
        <VendasCollapsibleSection
          id="sc-modelo"
          title="Hardware, produção & time"
          subtitle="Controlador V1.1 · Central 2.1 · PO→instalação · Diogo + Macgyver"
          variant="monitor"
          open={openSections.modelo}
          onToggle={() => toggle("modelo")}
        >
          <SmartChargingOperationalFocus data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="sc-projecao"
          title="Projeção de vendas — 12 meses"
          subtitle="Condomínios + controladores por mês · contrato + mensalidade"
          open={openSections.projecao}
          onToggle={() => toggle("projecao")}
        >
          <SmartChargingSalesSimulator data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="sc-roadmap"
          title="Roadmap jul–dez/2026"
          subtitle="Cliente real → produção padronizada → liberar IoT"
          open={openSections.roadmap}
          onToggle={() => toggle("roadmap")}
        >
          <SmartChargingRoadmapSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="sc-plano"
          title="Plano de execução"
          subtitle={`${area.activities.length} atividades · objetivos e riscos`}
          open={openSections.plano}
          onToggle={() => toggle("plano")}
        >
          <AreaDetailPanel area={area} compact />
        </VendasCollapsibleSection>
      </div>
    </div>
  );
}
