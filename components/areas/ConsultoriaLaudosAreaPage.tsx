"use client";

import { useCallback, useState } from "react";
import type { ConsultoriaLaudosDashboard } from "@/lib/areas/build-consultoria-laudos-dashboard";
import type { AreaDashboardItem } from "@/lib/areas/types";
import { AreaDetailPanel } from "@/components/areas/AreasOverview";
import {
  ConsultoriaLaudosCapacitySection,
  ConsultoriaLaudosOperationalFocus,
  ConsultoriaLaudosRoadmapSection,
  ConsultoriaLaudosSummaryBar
} from "@/components/areas/ConsultoriaLaudosSections";
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
  data: ConsultoriaLaudosDashboard;
};

export function ConsultoriaLaudosAreaPage({ area, data }: Props) {
  const [openSections, setOpenSections] = useState(DEFAULT_OPEN);

  const toggle = useCallback((id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const scrollTo = (id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: true }));
    requestAnimationFrame(() => {
      document.getElementById(`cl-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="vendas-page consultoria-page consultoria-laudos-page">
      <ConsultoriaLaudosSummaryBar data={data} />

      <div className="vendas-toolbar">
        <nav className="vendas-nav" aria-label="Seções Laudos">
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
          id="cl-modelo"
          title="Modelo operacional & pilares"
          subtitle="LIE H2 · app campo · plataforma revisão · apresentação web · guia→obra · visitas"
          variant="monitor"
          open={openSections.modelo}
          onToggle={() => toggle("modelo")}
        >
          <ConsultoriaLaudosOperationalFocus data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="cl-capacidade"
          title="Capacidade & mix"
          subtitle={`YTD ${data.ytd2026.avgMonthlyDeals}/mês · LDC meta ${data.targets.ldcPerMonth}`}
          open={openSections.capacidade}
          onToggle={() => toggle("capacidade")}
        >
          <ConsultoriaLaudosCapacitySection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="cl-roadmap"
          title="Roadmap jul–dez/2026"
          subtitle="Baseline → automatizar ICV → plataforma carregadores/condomínio"
          open={openSections.roadmap}
          onToggle={() => toggle("roadmap")}
        >
          <ConsultoriaLaudosRoadmapSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="cl-plano"
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
