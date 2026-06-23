"use client";

import type { VendasFunnelDashboard } from "@/lib/areas/build-vendas-funnel";
import vendasFocusJson from "@/data/areas/vendas-focus.json";
import { brl } from "@/lib/analysis/format";
import { VendasInlineDetails } from "@/components/areas/VendasInlineDetails";

type VendasFocus = typeof vendasFocusJson;

type Props = {
  funnel: VendasFunnelDashboard;
  embedded?: boolean;
};

export function VendasOperationalFocus({ funnel, embedded = false }: Props) {
  const focus = vendasFocusJson as VendasFocus;
  const gate = focus.operationalGate;
  const hiring = focus.hiringPolicy;
  const pipeline = focus.pipelinePriority;
  const process = focus.processAndApp;
  const proposals = focus.killerProposals;
  const rituals = focus.weeklyRitualsScope;

  return (
    <div className={`vendas-operational-focus ${embedded ? "is-embedded" : ""}`}>
      <div className="vendas-gate-compact" role="alert">
        <p className="vendas-gate-statement">{gate.statement}</p>
        <p className="vendas-gate-criteria">
          <strong>Critério:</strong> {gate.releaseCriteria}
        </p>
        <div className="vendas-gate-stats">
          <div className="mini">
            <span className="metric-label">Negociação</span>
            <strong>
              {funnel.negotiationDeals} neg. · {brl.format(funnel.negotiationValue)}
            </strong>
          </div>
          <div className="mini">
            <span className="metric-label">1º vendedor (ago)</span>
            <strong>Base existente</strong>
            <small>{hiring.firstSeller.focus}</small>
          </div>
          <div className="mini">
            <span className="metric-label">2º vendedor</span>
            <strong>Gate + meta</strong>
            <small>{hiring.secondSeller.when}</small>
          </div>
        </div>
      </div>

      <ul className="vendas-compact-list">
        {pipeline.actions.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <div className="vendas-details-grid">
        <VendasInlineDetails title="Contratação & ramp 0→100%" defaultOpen>
          <div className="guide-risks">
            <div className="guide-risk">
              <strong>1º vendedor — {hiring.firstSeller.when}</strong>
              <p>{hiring.firstSeller.focus}</p>
              <p className="metric-note">{hiring.firstSeller.onboarding}</p>
            </div>
            <div className="guide-risk">
              <strong>2º vendedor — {hiring.secondSeller.when}</strong>
              <p>{hiring.secondSeller.then}</p>
              <p className="metric-note">{hiring.secondSeller.note}</p>
            </div>
          </div>
        </VendasInlineDetails>

        <VendasInlineDetails title="Bloqueado até destravar propostas">
          <ul className="vendas-compact-list">
            {gate.blockedUntilCleared.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </VendasInlineDetails>

        <VendasInlineDetails title={process.title}>
          <p className="metric-note">{process.statement}</p>
          <p className="metric-note">{process.leadership}</p>
          <ul className="vendas-compact-list">
            {process.deliverables.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </VendasInlineDetails>

        <VendasInlineDetails title="Templates LDC → LIE → LCC">
          <p className="metric-note">{proposals.rolloutNote}</p>
          <div className="vendas-template-row">
            {proposals.templates.map((template) => (
              <div className="vendas-template-chip" key={template.id}>
                <span className="vendas-template-priority">#{template.priority}</span>
                <strong>{template.name}</strong>
                <small>{template.duePhase}</small>
              </div>
            ))}
          </div>
          <p className="metric-note">{proposals.postSalesNote}</p>
        </VendasInlineDetails>

        <VendasInlineDetails title={rituals.title}>
          <p className="metric-note">{rituals.status}</p>
          <ul className="vendas-compact-list">
            {rituals.topics.map((topic) => (
              <li key={topic}>{topic}</li>
            ))}
          </ul>
        </VendasInlineDetails>
      </div>
    </div>
  );
}
