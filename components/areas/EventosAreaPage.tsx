"use client";

import { useCallback, useState } from "react";
import type { EventosDashboard } from "@/lib/areas/build-eventos-dashboard";
import type { AreaDashboardItem } from "@/lib/areas/types";
import { AreaDetailPanel } from "@/components/areas/AreasOverview";
import {
  EventosCalendarSection,
  EventosFesindicoSection,
  EventosFirstEventSection,
  EventosRoadmapSection,
  EventosStrategySection,
  EventosSummaryBar
} from "@/components/areas/EventosSections";
import { VendasCollapsibleSection } from "@/components/areas/VendasCollapsibleSection";

type SectionId = "experiencia" | "fesindico" | "calendario" | "estrategia" | "roadmap" | "plano";

const DEFAULT_OPEN: Record<SectionId, boolean> = {
  experiencia: true,
  fesindico: true,
  calendario: true,
  estrategia: false,
  roadmap: false,
  plano: false
};

type Props = {
  area: AreaDashboardItem;
  data: EventosDashboard;
};

export function EventosAreaPage({ area, data }: Props) {
  const [openSections, setOpenSections] = useState(DEFAULT_OPEN);

  const toggle = useCallback((id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const scrollTo = (id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: true }));
    requestAnimationFrame(() => {
      document.getElementById(`ev-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="vendas-page consultoria-page eventos-page">
      <EventosSummaryBar data={data} />

      <div className="vendas-toolbar">
        <nav className="vendas-nav" aria-label="Seções Eventos">
          {[
            { id: "experiencia" as const, label: "1º evento" },
            { id: "fesindico" as const, label: "FESÍNDICO" },
            { id: "calendario" as const, label: "Carteira PE" },
            { id: "estrategia" as const, label: "Estratégia" },
            { id: "roadmap" as const, label: "Roadmap H2" },
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
          id="ev-experiencia"
          title="1º evento — jun/2026"
          subtitle="~200 inscritos · ~30 síndicos · parceria administradora · EV"
          variant="monitor"
          open={openSections.experiencia}
          onToggle={() => toggle("experiencia")}
        >
          <EventosFirstEventSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="ev-fesindico"
          title="FESÍNDICO 2026 — playbook completo"
          subtitle="Cronograma · KPIs · operação · scripts · personas · 6 pilares"
          open={openSections.fesindico}
          onToggle={() => toggle("fesindico")}
        >
          <EventosFesindicoSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="ev-calendario"
          title="Carteira de eventos — PE"
          subtitle="Feiras, congressos, networking — custos e prioridades"
          open={openSections.calendario}
          onToggle={() => toggle("calendario")}
        >
          <EventosCalendarSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="ev-estrategia"
          title="Estratégia & budget"
          subtitle="Princípios · carteira dedicada · responsável"
          open={openSections.estrategia}
          onToggle={() => toggle("estrategia")}
        >
          <EventosStrategySection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="ev-roadmap"
          title="Roadmap jul–dez/2026"
          subtitle="Planejar FESÍNDICO → operar → debrief"
          open={openSections.roadmap}
          onToggle={() => toggle("roadmap")}
        >
          <EventosRoadmapSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="ev-plano"
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
