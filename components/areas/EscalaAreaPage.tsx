"use client";

import { useCallback, useState } from "react";
import type { EscalaDashboard } from "@/lib/areas/build-escala-dashboard";
import type { AreaDashboardItem } from "@/lib/areas/types";
import { AreaDetailPanel } from "@/components/areas/AreasOverview";
import {
  EscalaBrazilMap,
  EscalaMarketStudy,
  EscalaRoadmapSection,
  EscalaSellerModel,
  EscalaStateRanking,
  EscalaSummaryBar
} from "@/components/areas/EscalaSections";
import { EscalaNucleusProfile } from "@/components/areas/EscalaNucleusProfile";
import { EscalaNucleusSimulator } from "@/components/areas/EscalaNucleusSimulator";
import { VendasCollapsibleSection } from "@/components/areas/VendasCollapsibleSection";

type SectionId = "estudo" | "nucleo" | "mapa" | "modelo" | "ranking" | "roadmap" | "plano";

const DEFAULT_OPEN: Record<SectionId, boolean> = {
  estudo: false,
  nucleo: true,
  mapa: false,
  modelo: false,
  ranking: false,
  roadmap: false,
  plano: false
};

type Props = {
  area: AreaDashboardItem;
  data: EscalaDashboard;
};

export function EscalaAreaPage({ area, data }: Props) {
  const [openSections, setOpenSections] = useState(DEFAULT_OPEN);
  const [highlightUf, setHighlightUf] = useState<string | null>("PE");

  const toggle = useCallback((id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const scrollTo = (id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: true }));
    requestAnimationFrame(() => {
      document.getElementById(`escala-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="vendas-page consultoria-page escala-page">
      <EscalaSummaryBar data={data} />

      <div className="vendas-toolbar">
        <nav className="vendas-nav" aria-label="Seções Escala">
          {[
            { id: "nucleo" as const, label: "Núcleo operacional" },
            { id: "estudo" as const, label: "Estudo mercado" },
            { id: "mapa" as const, label: "Mapa BR" },
            { id: "modelo" as const, label: "Vendedores" },
            { id: "ranking" as const, label: "Ranking UF" },
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
          id="escala-nucleo"
          title="Núcleo operacional"
          subtitle="Demanda por vendedor · mix serviços · capacidade mensal · simulador abertura"
          variant="monitor"
          open={openSections.nucleo}
          onToggle={() => toggle("nucleo")}
        >
          <EscalaNucleusProfile data={data} />
          <div className="escala-nucleus-divider">
            <h3>Simulador — investimento e go/no-go para nova região</h3>
            <p className="metric-note">
              Após validar que o núcleo atende a demanda acima, simule custo de abertura e indicadores mínimos
              por pacote.
            </p>
          </div>
          <EscalaNucleusSimulator data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="escala-estudo"
          title="Estudo de mercado & descobertas"
          subtitle="É · 200+ cond. · EV · indicadores a validar · estratégia geográfica"
          open={openSections.estudo}
          onToggle={() => toggle("estudo")}
        >
          <EscalaMarketStudy data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="escala-mapa"
          title="Mapa estratégico — Brasil"
          subtitle="Ranking visual por estado · vendedores sugeridos · foco NE"
          open={openSections.mapa}
          onToggle={() => toggle("mapa")}
        >
          <EscalaBrazilMap data={data} highlightUf={highlightUf} />
          <div className="escala-uf-pills">
            {data.topStates.slice(0, 8).map((s) => (
              <button
                key={s.uf}
                type="button"
                className={`vendas-nav-pill ${highlightUf === s.uf ? "active" : ""}`}
                onClick={() => setHighlightUf(highlightUf === s.uf ? null : s.uf)}
              >
                {s.uf} · {s.sellersSuggested} vend.
              </button>
            ))}
          </div>
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="escala-modelo"
          title="Modelo de vendedores por região"
          subtitle="Baseline Recife = 4 · pesos editáveis · índice composto"
          open={openSections.modelo}
          onToggle={() => toggle("modelo")}
        >
          <EscalaSellerModel data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="escala-ranking"
          title="Ranking estados — VE 2025 (ABVE)"
          subtitle="Share nacional · tier · vendedores · rota expansão"
          open={openSections.ranking}
          onToggle={() => toggle("ranking")}
        >
          <EscalaStateRanking data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="escala-roadmap"
          title="Roadmap jul/2026 → expansão"
          subtitle="Descobrir limite PE → pesquisa NE → hub BA/CE"
          open={openSections.roadmap}
          onToggle={() => toggle("roadmap")}
        >
          <EscalaRoadmapSection data={data} />
        </VendasCollapsibleSection>

        <VendasCollapsibleSection
          id="escala-plano"
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
