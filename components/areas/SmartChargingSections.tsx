"use client";

import type { SmartChargingDashboard } from "@/lib/areas/build-smart-charging-dashboard";
import { brl } from "@/lib/analysis/format";
import { VendasInlineDetails } from "@/components/areas/VendasInlineDetails";

type Props = {
  data: SmartChargingDashboard;
};

export function SmartChargingSummaryBar({ data }: Props) {
  const d = data.focus.salesProjection.defaults;
  const ticketHint = d.baseInfraTicket + d.controllersPerCondoHint * d.controllerUnitPrice;
  return (
    <div className="vendas-summary-bar consultoria-summary-bar">
      <div className="vendas-summary-gate ok laudos-icv-gate">
        <span className="vendas-summary-gate-label">H2 — Smart Charging</span>
        <span className="vendas-summary-gate-detail">
          Ticket ~{brl.format(ticketHint)}/cond. · {d.controllersPerCondoHint} controladores · {brl.format(d.monthlyFeePerCondo)}/mês
        </span>
      </div>
      <div className="vendas-summary-metrics">
        <div className="vendas-summary-metric">
          <span>Infra + instalação</span>
          <strong>{brl.format(d.baseInfraTicket)}</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Controlador</span>
          <strong>{brl.format(d.controllerUnitPrice)}/un</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Validação H2</span>
          <strong>Cliente real</strong>
        </div>
      </div>
      <p className="vendas-sync-note capacity-gap-note">{data.focus.operatingModel.sequencingNote}</p>
    </div>
  );
}

export function SmartChargingOperationalFocus({ data }: Props) {
  const hw = data.focus.hardwareRoadmap;
  const prod = data.focus.productionProcess;
  const team = data.focus.teamAndCompensation;

  return (
    <div className="vendas-operational-focus is-embedded">
      <p className="vendas-gate-statement">{data.focus.operatingModel.headline}</p>

      <VendasInlineDetails title="Prioridades H2" defaultOpen>
        <ul className="vendas-compact-list">
          {data.focus.h2Priorities.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </VendasInlineDetails>

      <VendasInlineDetails title={hw.title} defaultOpen>
        <div className="evolution-phases icv-pipeline">
          {hw.items.map((item) => (
            <div className="evolution-phase" key={item.product}>
              <span className="vendas-template-priority">
                {item.from} → {item.to}
              </span>
              <strong>{item.product}</strong>
              <p>{item.note}</p>
            </div>
          ))}
        </div>
      </VendasInlineDetails>

      <VendasInlineDetails title={prod.title} defaultOpen>
        <p className="metric-note">{prod.headline}</p>
        <p className="metric-note capacity-gap-note">{prod.gap}</p>
        <ol className="director-agenda">
          {prod.steps.map((s) => (
            <li key={s.step}>
              <strong>{s.name}</strong> — {s.description}
            </li>
          ))}
        </ol>
      </VendasInlineDetails>

      <VendasInlineDetails title={team.title} defaultOpen>
        {team.members.map((m) => (
          <div className="mini" key={m.name} style={{ marginBottom: 12 }}>
            <span className="metric-label">
              {m.name} — {m.role}
            </span>
            <strong>{m.monthly}</strong>
            <small>{m.h2}</small>
          </div>
        ))}
      </VendasInlineDetails>

      <p className="metric-note">Integração: {data.focus.linkedAreas.join(" · ")}</p>
    </div>
  );
}

export function SmartChargingRoadmapSection({ data }: Props) {
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
