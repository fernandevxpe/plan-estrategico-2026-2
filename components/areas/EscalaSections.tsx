"use client";

import { useMemo, useState } from "react";
import type { EscalaDashboard, EscalaMacroRegion } from "@/lib/areas/build-escala-dashboard";
import { number } from "@/lib/analysis/format";
import { VendasInlineDetails } from "@/components/areas/VendasInlineDetails";

type Props = {
  data: EscalaDashboard;
};

const PRIORITY_CLASS: Record<string, string> = {
  atual: "escala-priority-atual",
  alta: "escala-priority-alta",
  "media": "escala-priority-media",
  "media-baixa": "escala-priority-media-baixa",
  baixa: "escala-priority-baixa",
  "futuro-alta": "escala-priority-futuro",
  "futuro-media": "escala-priority-futuro"
};

const TIER_CLASS: Record<number, string> = {
  0: "escala-tier-base",
  1: "escala-tier-1",
  2: "escala-tier-2",
  3: "escala-tier-3"
};

/** Posição aproximada dos estados no mapa (grid %) */
const STATE_MAP: Record<string, { x: number; y: number; w: number; h: number }> = {
  RR: { x: 42, y: 4, w: 8, h: 6 },
  AP: { x: 52, y: 4, w: 8, h: 6 },
  PA: { x: 48, y: 12, w: 14, h: 10 },
  AM: { x: 28, y: 14, w: 12, h: 10 },
  AC: { x: 18, y: 22, w: 8, h: 6 },
  RO: { x: 32, y: 24, w: 8, h: 6 },
  MT: { x: 40, y: 28, w: 12, h: 10 },
  TO: { x: 52, y: 26, w: 8, h: 8 },
  MA: { x: 58, y: 18, w: 10, h: 8 },
  PI: { x: 62, y: 26, w: 8, h: 8 },
  CE: { x: 68, y: 22, w: 8, h: 8 },
  RN: { x: 72, y: 28, w: 6, h: 5 },
  PB: { x: 74, y: 33, w: 6, h: 5 },
  PE: { x: 70, y: 34, w: 7, h: 5 },
  AL: { x: 72, y: 39, w: 6, h: 5 },
  SE: { x: 68, y: 40, w: 6, h: 5 },
  BA: { x: 58, y: 32, w: 12, h: 10 },
  GO: { x: 48, y: 36, w: 10, h: 8 },
  DF: { x: 52, y: 38, w: 5, h: 4 },
  MG: { x: 58, y: 42, w: 12, h: 10 },
  ES: { x: 66, y: 46, w: 6, h: 6 },
  RJ: { x: 66, y: 52, w: 7, h: 6 },
  SP: { x: 54, y: 50, w: 12, h: 10 },
  PR: { x: 50, y: 58, w: 8, h: 6 },
  SC: { x: 52, y: 64, w: 7, h: 5 },
  RS: { x: 48, y: 68, w: 10, h: 8 },
  MS: { x: 42, y: 48, w: 8, h: 8 }
};

function clampPct(n: number) {
  return Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0));
}

function computeSellers(
  region: EscalaMacroRegion,
  baseline: number,
  evW: number,
  condoW: number,
  proxW: number,
  peEv: number,
  peCondo: number
) {
  const totalW = evW + condoW + proxW || 1;
  const evNorm = region.evSales2025 / peEv;
  const condoNorm = region.condoDensityIndex / peCondo;
  const proxNorm = region.proximityIndex / 100;
  const composite =
    (evNorm * evW + condoNorm * condoW + proxNorm * proxW) / totalW;
  return Math.max(1, Math.round(baseline * composite));
}

export function EscalaSummaryBar({ data }: Props) {
  const b = data.focus.currentBaseline;
  return (
    <div className="vendas-summary-bar consultoria-summary-bar">
      <div className="vendas-summary-gate ok escala-gate">
        <span className="vendas-summary-gate-label">Escala — Recife base</span>
        <span className="vendas-summary-gate-detail">
          {b.sellersToday} vendedores hoje → meta {b.sellersIdeal} · {b.condosVisited}+ cond. visitados · EV PE{" "}
          {number.format(b.evShareNationalPct)}% nacional
        </span>
      </div>
      <div className="vendas-summary-metrics">
        <div className="vendas-summary-metric">
          <span>NE potencial</span>
          <strong>{data.neTotalSellers} vend.</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Ranking estados</span>
          <strong>{data.topStates.length} mapeados</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Próximo hub</span>
          <strong>Salvador / BA</strong>
        </div>
      </div>
      <p className="vendas-sync-note capacity-gap-note">{data.focus.operatingModel.discoveryNote}</p>
    </div>
  );
}

export function EscalaBrazilMap({ data, highlightUf }: Props & { highlightUf?: string | null }) {
  const stateByUf = useMemo(() => {
    const map = new Map(data.topStates.map((s) => [s.uf, s]));
    return map;
  }, [data.topStates]);

  return (
    <div className="escala-map-wrap">
      <div className="escala-map-legend">
        <span className="escala-legend-item escala-tier-base">Base (PE)</span>
        <span className="escala-legend-item escala-tier-1">Tier 1</span>
        <span className="escala-legend-item escala-tier-2">Tier 2 NE/Sudeste</span>
        <span className="escala-legend-item escala-tier-3">Tier 3</span>
        <span className="escala-legend-item escala-tier-none">Sem prioridade</span>
      </div>
      <div className="escala-map" role="img" aria-label="Mapa estratégico do Brasil por estado">
        {Object.entries(STATE_MAP).map(([uf, pos]) => {
          const state = stateByUf.get(uf);
          const tier = state?.tier ?? -1;
          const isHighlight = highlightUf === uf;
          const isNe = ["PE", "BA", "CE", "RN", "PB", "AL", "SE", "MA", "PI"].includes(uf);
          return (
            <div
              key={uf}
              className={`escala-map-state ${TIER_CLASS[tier] ?? "escala-tier-none"} ${isNe ? "is-ne" : ""} ${isHighlight ? "is-highlight" : ""}`}
              style={{
                left: `${pos.x}%`,
                top: `${pos.y}%`,
                width: `${pos.w}%`,
                height: `${pos.h}%`
              }}
              title={
                state
                  ? `${state.name}: ${state.evSales2025.toLocaleString("pt-BR")} VE 2025 · ${state.sellersSuggested} vend.`
                  : uf
              }
            >
              <span className="escala-map-uf">{uf}</span>
              {state ? (
                <span className="escala-map-sellers">{state.sellersSuggested}</span>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="escala-map-note">
        Número em cada estado = vendedores sugeridos · Fonte EV: ABVE 2025 · Densidade cond.: estimativa a validar
      </p>
    </div>
  );
}

export function EscalaSellerModel({ data }: Props) {
  const model = data.focus.sellerModel;
  const pe = data.focus.currentBaseline;
  const defaults = model.defaults;

  const [baseline, setBaseline] = useState(defaults.recifeBaselineSellers);
  const [evW, setEvW] = useState(defaults.evWeight);
  const [condoW, setCondoW] = useState(defaults.condoWeight);
  const [proxW, setProxW] = useState(defaults.proximityWeight);

  const regions = useMemo(
    () =>
      data.focus.macroRegions.map((r) => ({
        ...r,
        computedSellers: computeSellers(r, baseline, evW, condoW, proxW, pe.evSales2025, 82)
      })),
    [data.focus.macroRegions, baseline, evW, condoW, proxW, pe.evSales2025]
  );

  const totalComputed = regions.reduce((s, r) => s + r.computedSellers, 0);

  return (
    <div className="escala-seller-model">
      <p className="metric-note">{model.description}</p>
      <p className="sc-sim-formula">{model.formulaNote}</p>

      <div className="sc-margin-fields escala-model-fields">
        <label>
          Baseline Recife (vendedores)
          <input
            type="number"
            min={1}
            max={20}
            value={baseline}
            onChange={(e) => setBaseline(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <label>
          Peso EV (%)
          <input type="number" min={0} max={100} value={evW} onChange={(e) => setEvW(clampPct(Number(e.target.value)))} />
        </label>
        <label>
          Peso condomínios (%)
          <input
            type="number"
            min={0}
            max={100}
            value={condoW}
            onChange={(e) => setCondoW(clampPct(Number(e.target.value)))}
          />
        </label>
        <label>
          Peso proximidade (%)
          <input
            type="number"
            min={0}
            max={100}
            value={proxW}
            onChange={(e) => setProxW(clampPct(Number(e.target.value)))}
          />
        </label>
      </div>

      <div className="guide-kpi-row">
        <div className="guide-kpi-card sc-kpi-highlight">
          <span>Total vendedores (modelo)</span>
          <strong>{totalComputed}</strong>
          <small>Baseline {baseline} em Recife</small>
        </div>
        <div className="guide-kpi-card">
          <span>NE (fases 1–4)</span>
          <strong>{regions.filter((r) => r.phase <= 4).reduce((s, r) => s + r.computedSellers, 0)}</strong>
        </div>
        <div className="guide-kpi-card">
          <span>Nacional (fase 5)</span>
          <strong>{regions.filter((r) => r.phase >= 5).reduce((s, r) => s + r.computedSellers, 0)}</strong>
        </div>
      </div>

      <div className="table-wrap">
        <table className="escala-ranking-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Região</th>
              <th>Fase</th>
              <th>VE 2025</th>
              <th>Cond. est.</th>
              <th>Índice</th>
              <th>Vendedores</th>
            </tr>
          </thead>
          <tbody>
            {[...regions]
              .sort((a, b) => b.compositeIndex - a.compositeIndex)
              .map((r, i) => (
                <tr key={r.id} className={PRIORITY_CLASS[r.priority] ?? ""}>
                  <td>{i + 1}</td>
                  <td>
                    <strong>{r.name}</strong>
                    <small>{r.notes.slice(0, 60)}…</small>
                  </td>
                  <td>{r.phaseLabel}</td>
                  <td>{r.evSales2025.toLocaleString("pt-BR")}</td>
                  <td>~{r.condosEstimate}</td>
                  <td>{number.format(r.compositeIndex * 100)}</td>
                  <td>
                    <strong>{r.computedSellers}</strong>
                    {r.computedSellers !== r.recommendedSellers ? (
                      <small> (ref. {r.recommendedSellers})</small>
                    ) : null}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EscalaMarketStudy({ data }: Props) {
  const research = data.focus.researchIndicators;
  const geo = data.focus.geoStrategy;
  const phases = data.focus.expansionPhases;

  return (
    <div className="vendas-operational-focus is-embedded">
      <p className="vendas-gate-statement">{data.focus.operatingModel.headline}</p>

      <div className="card area-sub-card escala-baseline-card">
        <h4>{data.focus.currentBaseline.title}</h4>
        <div className="escala-baseline-grid">
          <div className="mini">
            <span>Vendedores</span>
            <strong>
              {data.focus.currentBaseline.sellersToday} → {data.focus.currentBaseline.sellersIdeal}
            </strong>
          </div>
          <div className="mini">
            <span>Condomínios visitados</span>
            <strong>{data.focus.currentBaseline.condosVisited}+</strong>
          </div>
          <div className="mini">
            <span>VE emplacados PE 2025</span>
            <strong>{data.focus.currentBaseline.evSales2025.toLocaleString("pt-BR")}</strong>
          </div>
          <div className="mini">
            <span>Propostas</span>
            <strong>{data.focus.currentBaseline.proposalsStatus}</strong>
          </div>
        </div>
        <p className="metric-note">{data.focus.currentBaseline.partnerNote}</p>
      </div>

      <VendasInlineDetails title={research.title} defaultOpen>
        <div className="escala-research-grid">
          {research.items.map((item) => (
            <div className={`escala-research-item status-${item.status}`} key={item.id}>
              <span className="escala-research-status">{item.status}</span>
              <strong>{item.name}</strong>
              <small>{item.source}</small>
              <p>{item.note}</p>
            </div>
          ))}
        </div>
      </VendasInlineDetails>

      <VendasInlineDetails title={geo.title} defaultOpen>
        <p className="metric-note">{geo.principle}</p>
        <ol className="director-agenda">
          {geo.priorityOrder.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </VendasInlineDetails>

      <VendasInlineDetails title="Fases de expansão" defaultOpen>
        <div className="evolution-phases">
          {phases.map((p) => (
            <div className="evolution-phase" key={p.phase}>
              <span className="vendas-template-priority">Fase {p.phase} · {p.timeline}</span>
              <strong>{p.title}</strong>
              <p>{p.regions.join(" · ")}</p>
              <p>
                <strong>{p.sellersTotal} vendedores</strong> — {p.goal}
              </p>
            </div>
          ))}
        </div>
      </VendasInlineDetails>
    </div>
  );
}

export function EscalaStateRanking({ data }: Props) {
  return (
    <div className="table-wrap">
      <table className="escala-ranking-table escala-states-table">
        <thead>
          <tr>
            <th>#</th>
            <th>UF</th>
            <th>Estado</th>
            <th>VE 2025</th>
            <th>Share BR</th>
            <th>Tier</th>
            <th>Vendedores</th>
            <th>Expansão</th>
          </tr>
        </thead>
        <tbody>
          {data.topStates.map((s, i) => (
            <tr key={s.uf} className={TIER_CLASS[s.tier] ?? ""}>
              <td>{i + 1}</td>
              <td>
                <strong>{s.uf}</strong>
              </td>
              <td>{s.name}</td>
              <td>{s.evSales2025.toLocaleString("pt-BR")}</td>
              <td>{number.format(s.sharePct)}%</td>
              <td>{s.tier === 0 ? "Base" : `T${s.tier}`}</td>
              <td>
                <strong>{s.sellersSuggested}</strong>
              </td>
              <td>{s.expansion}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EscalaRoadmapSection({ data }: Props) {
  return (
    <div className="consultoria-roadmap is-embedded">
      {data.focus.roadmapPhases.map((phase) => (
        <div className="card area-sub-card" key={phase.phase}>
          <span className="vendas-template-priority">{phase.phase}</span>
          <h4>{phase.title}</h4>
          <ul className="vendas-compact-list">
            {phase.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
