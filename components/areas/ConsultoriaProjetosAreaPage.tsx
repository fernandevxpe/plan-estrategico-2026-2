"use client";

import { useCallback, useState } from "react";
import type { ConsultoriaProjetosDashboard } from "@/lib/areas/build-consultoria-projetos-dashboard";
import type { AreaDashboardItem } from "@/lib/areas/types";
import { AreaDetailPanel } from "@/components/areas/AreasOverview";
import {
  ConsultoriaProjetosCapacitySection,
  ConsultoriaProjetosOperationalFocus,
  ConsultoriaProjetosRoadmapSection,
  ConsultoriaProjetosSummaryBar
} from "@/components/areas/ConsultoriaProjetosSections";
import { VendasCollapsibleSection } from "@/components/areas/VendasCollapsibleSection";

type SectionId = "modelo" | "capacidade" | "roadmap" | "plano";

const DEFAULT_OPEN: Record<SectionId, boolean> = {
  modelo: true,
  capacidade: true,
  roadmap: false,
  plano: false
};

type Props = {
  area: AreaDashboardItem;
  data: ConsultoriaProjetosDashboard;
};

export function ConsultoriaProjetosAreaPage({ area, data }: Props) {
  const [openSections, setOpenSections] = useState(DEFAULT_OPEN);

  const toggle = useCallback((id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const scrollTo = (id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: true }));
    requestAnimationFrame(() => {
      document.getElementById(`cp-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="vendas-page consultoria-page">
      <ConsultoriaProjetosSummaryBar data={data} />

      <div className="vendas-toolbar">
        <nav className="vendas-nav" aria-label="Seções Projetos">
          {[
            { id: "modelo" as const, label: "Modelo" },
            { id: "capacidade" as const, label: "Capacidade" },
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
          id="cp-modelo"
          title="Modelo operacional & pilares"
          subtitle="LDC escala · projetos variados = lacuna · cross-training · PDS"
          variant="monitor"
          open={openSections.modelo}
          onToggle={() => toggle("modelo")}
        >
          <ConsultoriaProjetosOperationalFocus data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="cp-capacidade"
          title="Capacidade & entregas"
          subtitle={`YTD ${data.ytd2026.avgMonthlyDeals}/mês · meta ${data.targets.projectsTotalPerMonth} · PIE ${data.targets.piePerMonth}`}
          open={openSections.capacidade}
          onToggle={() => toggle("capacidade")}
        >
          <ConsultoriaProjetosCapacitySection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="cp-roadmap"
          title="Roadmap jul–dez/2026"
          subtitle="Estabilizar → padronizar → escalar & descentralizar apresentação"
          open={openSections.roadmap}
          onToggle={() => toggle("roadmap")}
        >
          <ConsultoriaProjetosRoadmapSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="cp-plano"
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
