"use client";

import { useCallback, useState } from "react";
import type { ObrasDashboard } from "@/lib/areas/build-obras-dashboard";
import type { AreaDashboardItem } from "@/lib/areas/types";
import { AreaDetailPanel } from "@/components/areas/AreasOverview";
import {
  ObrasFunnelsSection,
  ObrasMonitoringSection,
  ObrasOperationsSection,
  ObrasPerformanceSection,
  ObrasPlaybookSection,
  ObrasRoadmapSection,
  ObrasSummaryBar,
  ObrasTypesSection
} from "@/components/areas/ObrasSections";
import { VendasCollapsibleSection } from "@/components/areas/VendasCollapsibleSection";

type SectionId = "performance" | "tipos" | "funis" | "operacao" | "monitorar" | "playbook" | "roadmap" | "plano";

const DEFAULT_OPEN: Record<SectionId, boolean> = {
  performance: true,
  tipos: true,
  funis: true,
  operacao: false,
  monitorar: true,
  playbook: false,
  roadmap: false,
  plano: false
};

type Props = {
  area: AreaDashboardItem;
  data: ObrasDashboard;
};

export function ObrasAreaPage({ area, data }: Props) {
  const [openSections, setOpenSections] = useState(DEFAULT_OPEN);

  const toggle = useCallback((id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const scrollTo = (id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: true }));
    requestAnimationFrame(() => {
      document.getElementById(`ob-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="vendas-page consultoria-page obras-page">
      <ObrasSummaryBar data={data} />

      <div className="vendas-toolbar">
        <nav className="vendas-nav" aria-label="Seções Obras">
          {[
            { id: "performance" as const, label: "Desempenho" },
            { id: "tipos" as const, label: "Tipos" },
            { id: "funis" as const, label: "Funis entrada" },
            { id: "operacao" as const, label: "Campo & OS" },
            { id: "monitorar" as const, label: "Monitorar" },
            { id: "playbook" as const, label: "Playbook" },
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
          id="ob-performance"
          title="Desempenho 2026 — receita e mix"
          subtitle="13 fechamentos · ~R$ 287k · subgrupos deduplicados"
          variant="monitor"
          open={openSections.performance}
          onToggle={() => toggle("performance")}
        >
          <ObrasPerformanceSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="ob-tipos"
          title="Tipos de obra"
          subtitle="EV · CDM · geral · PIE · adequação"
          open={openSections.tipos}
          onToggle={() => toggle("tipos")}
        >
          <ObrasTypesSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="ob-funis"
          title="Funis de entrada"
          subtitle="LIE→guia · PCC · LDC→CDM · EV direto"
          open={openSections.funis}
          onToggle={() => toggle("funis")}
        >
          <ObrasFunnelsSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="ob-operacao"
          title="Operação de campo & OS"
          subtitle="Fluxo padrão · EV · templates ClickUp"
          open={openSections.operacao}
          onToggle={() => toggle("operacao")}
        >
          <ObrasOperationsSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="ob-monitorar"
          title="O que monitorar"
          subtitle="Comercial · operacional · qualidade"
          open={openSections.monitorar}
          onToggle={() => toggle("monitorar")}
        >
          <ObrasMonitoringSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="ob-playbook"
          title="Playbook operacional H2"
          subtitle="Comercial · planejamento · campo · integração · pós-obra"
          open={openSections.playbook}
          onToggle={() => toggle("playbook")}
        >
          <ObrasPlaybookSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="ob-roadmap"
          title="Roadmap jul–dez/2026"
          subtitle="Estruturar → padronizar → integrar funil → medir"
          open={openSections.roadmap}
          onToggle={() => toggle("roadmap")}
        >
          <ObrasRoadmapSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="ob-plano"
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
