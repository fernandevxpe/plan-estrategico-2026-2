"use client";

import { useCallback, useState } from "react";
import type { AutomacoesFerramentasDashboard } from "@/lib/areas/build-automacoes-ferramentas-dashboard";
import type { AreaDashboardItem } from "@/lib/areas/types";
import { AreaDetailPanel } from "@/components/areas/AreasOverview";
import {
  AutomacoesAppSection,
  AutomacoesBottleneckStudy,
  AutomacoesEndToEndFlow,
  AutomacoesRoadmapSection,
  AutomacoesServicePipeline,
  AutomacoesSummaryBar,
  AutomacoesWebPlatform
} from "@/components/areas/AutomacoesFerramentasSections";
import { VendasCollapsibleSection } from "@/components/areas/VendasCollapsibleSection";

type SectionId = "app" | "servicos" | "fluxo" | "gargalos" | "roadmap" | "plano";

const DEFAULT_OPEN: Record<SectionId, boolean> = {
  app: true,
  servicos: true,
  fluxo: false,
  gargalos: true,
  roadmap: false,
  plano: false
};

type Props = {
  area: AreaDashboardItem;
  data: AutomacoesFerramentasDashboard;
};

export function AutomacoesFerramentasAreaPage({ area, data }: Props) {
  const [openSections, setOpenSections] = useState(DEFAULT_OPEN);

  const toggle = useCallback((id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const scrollTo = (id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: true }));
    requestAnimationFrame(() => {
      document.getElementById(`af-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="vendas-page consultoria-page automacoes-page">
      <AutomacoesSummaryBar data={data} />

      <div className="vendas-toolbar">
        <nav className="vendas-nav" aria-label="Seções Automações">
          {[
            { id: "app" as const, label: "App offline" },
            { id: "servicos" as const, label: "Módulos serviço" },
            { id: "fluxo" as const, label: "Fluxo ponta a ponta" },
            { id: "gargalos" as const, label: "Gargalos" },
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
          id="af-app"
          title="App offline + ClickUp"
          subtitle="~6 meses dev · fora da loja · sync tarefas · bloqueio teste campo"
          variant="monitor"
          open={openSections.app}
          onToggle={() => toggle("app")}
        >
          <AutomacoesAppSection data={data} />
          <div className="af-web-inline">
            <h3 className="escala-section-title">Plataforma web</h3>
            <AutomacoesWebPlatform data={data} />
          </div>
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="af-servicos"
          title="Módulos de serviço — prioridade dev"
          subtitle="EV → LIE → LDC → IoT → levantamento → visita comercial"
          open={openSections.servicos}
          onToggle={() => toggle("servicos")}
        >
          <AutomacoesServicePipeline data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="af-fluxo"
          title="Fluxo ponta a ponta"
          subtitle="Visita → proposta → fechamento → execução → entrega"
          open={openSections.fluxo}
          onToggle={() => toggle("fluxo")}
        >
          <AutomacoesEndToEndFlow data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="af-gargalos"
          title="Estudo de gargalos operacionais"
          subtitle="Priorizar automação por impacto · volume · prontidão template"
          open={openSections.gargalos}
          onToggle={() => toggle("gargalos")}
        >
          <AutomacoesBottleneckStudy data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="af-roadmap"
          title="Roadmap jul–dez/2026"
          subtitle="Mapear → teste campo → LDC/LIE → visita comercial"
          open={openSections.roadmap}
          onToggle={() => toggle("roadmap")}
        >
          <AutomacoesRoadmapSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="af-plano"
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
