"use client";

import { useCallback, useState } from "react";
import type { MedidoresIoTDashboard } from "@/lib/areas/build-medidores-iot-dashboard";
import type { AreaDashboardItem } from "@/lib/areas/types";
import { AreaDetailPanel } from "@/components/areas/AreasOverview";
import {
  MedidoresIoTOperationalFocus,
  MedidoresIoTPurchaseSimulator,
  MedidoresIoTRoadmapSection,
  MedidoresIoTSummaryBar
} from "@/components/areas/MedidoresIoTSections";
import { VendasCollapsibleSection } from "@/components/areas/VendasCollapsibleSection";

type SectionId = "modelo" | "simulacao" | "roadmap" | "plano";

const DEFAULT_OPEN: Record<SectionId, boolean> = {
  modelo: true,
  simulacao: true,
  roadmap: false,
  plano: false
};

type Props = {
  area: AreaDashboardItem;
  data: MedidoresIoTDashboard;
};

export function MedidoresIoTAreaPage({ area, data }: Props) {
  const [openSections, setOpenSections] = useState(DEFAULT_OPEN);

  const toggle = useCallback((id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const scrollTo = (id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: true }));
    requestAnimationFrame(() => {
      document.getElementById(`iot-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="vendas-page consultoria-page iot-page">
      <MedidoresIoTSummaryBar data={data} />

      <div className="vendas-toolbar">
        <nav className="vendas-nav" aria-label="Seções IoT">
          {[
            { id: "modelo" as const, label: "Operação" },
            { id: "simulacao" as const, label: "Simulação" },
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
          id="iot-modelo"
          title="Frota, produtos & time"
          subtitle="40 medidores 4G · SM3F2.0 · SA3F1.0 · Diogo + Macgyver"
          variant="monitor"
          open={openSections.modelo}
          onToggle={() => toggle("modelo")}
        >
          <MedidoresIoTOperationalFocus data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="iot-simulacao"
          title="Simulação de compra"
          subtitle="SM3F2.0 + sensores 100A/600A/1000A + SA3F1.0"
          open={openSections.simulacao}
          onToggle={() => toggle("simulacao")}
        >
          <MedidoresIoTPurchaseSimulator data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="iot-roadmap"
          title="Roadmap jul–dez/2026"
          subtitle="Manutenção frota → Smart Charging → SM3F2.0"
          open={openSections.roadmap}
          onToggle={() => toggle("roadmap")}
        >
          <MedidoresIoTRoadmapSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="iot-plano"
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
