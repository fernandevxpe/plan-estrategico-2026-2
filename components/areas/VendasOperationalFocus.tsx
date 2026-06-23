"use client";

import type { VendasFunnelDashboard } from "@/lib/areas/build-vendas-funnel";
import vendasFocusJson from "@/data/areas/vendas-focus.json";
import { brl } from "@/lib/analysis/format";

type VendasFocus = typeof vendasFocusJson;

type Props = {
  funnel: VendasFunnelDashboard;
};

export function VendasOperationalFocus({ funnel }: Props) {
  const focus = vendasFocusJson as VendasFocus;
  const gate = focus.operationalGate;
  const hiring = focus.hiringPolicy;
  const pipeline = focus.pipelinePriority;
  const process = focus.processAndApp;
  const proposals = focus.killerProposals;
  const rituals = focus.weeklyRitualsScope;

  return (
    <div className="vendas-operational-focus">
      <div className="vendas-gate-banner" role="alert">
        <p className="vendas-gate-eyebrow">Prioridade absoluta</p>
        <h2>{gate.title}</h2>
        <p className="vendas-gate-statement">{gate.statement}</p>
        <p className="vendas-gate-criteria">
          <strong>Critério de liberação:</strong> {gate.releaseCriteria}
        </p>
        <div className="vendas-gate-stats">
          <div className="mini">
            <span className="metric-label">Em Negociação agora</span>
            <strong>
              {funnel.negotiationDeals} neg. · {brl.format(funnel.negotiationValue)}
            </strong>
          </div>
          <div className="mini">
            <span className="metric-label">Novo vendedor (ago)</span>
            <strong>Foco na base existente</strong>
            <small>{hiring.firstSeller.focus}</small>
          </div>
          <div className="mini">
            <span className="metric-label">2º vendedor (Cenário B)</span>
            <strong>Só após gate + meta</strong>
            <small>{hiring.secondSeller.when}</small>
          </div>
        </div>
      </div>

      <section className="section-title subsection-title">
        <div>
          <h3>{pipeline.title}</h3>
          <p>{pipeline.headline}</p>
        </div>
      </section>
      <div className="investigation-notes">
        {pipeline.actions.map((item) => (
          <div className="insight-mini insight-priority" key={item}>
            <span>{item}</span>
          </div>
        ))}
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>{hiring.title}</h2>
            </div>
          </div>
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
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Bloqueado até destravar propostas</h2>
            </div>
          </div>
          <ul className="area-objectives">
            {gate.blockedUntilCleared.map((item) => (
              <li key={item}>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <section className="section-title subsection-title">
        <div>
          <h3>{process.title}</h3>
          <p>{process.statement}</p>
          <p className="metric-note">{process.leadership}</p>
        </div>
      </section>
      <div className="mini-grid">
        {process.deliverables.map((item) => (
          <div className="mini" key={item}>
            <strong>{item}</strong>
          </div>
        ))}
      </div>

      <section className="section-title subsection-title">
        <div>
          <h3>{proposals.title}</h3>
          <p>{proposals.rolloutNote}</p>
          <p>{proposals.postSalesNote}</p>
        </div>
      </section>
      <div className="areas-sub-grid">
        {proposals.templates.map((template) => (
          <div className="card area-sub-card" key={template.id}>
            <span className="vendas-template-priority">#{template.priority}</span>
            <h4>{template.name}</h4>
            <p>{template.role}</p>
            <small className="metric-note">Meta rollout: {template.duePhase}</small>
          </div>
        ))}
      </div>

      <section className="section-title subsection-title">
        <div>
          <h3>{rituals.title}</h3>
          <p>
            {rituals.status} — alinhar follow-up, leads, assembleias, entregas e pós-venda na rotina real do
            time.
          </p>
        </div>
      </section>
      <div className="dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Agenda a definir</h2>
            </div>
          </div>
          <ul className="area-objectives">
            {rituals.topics.map((topic) => (
              <li key={topic}>
                <span>{topic}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Restrições reais</h2>
            </div>
          </div>
          <ul className="area-objectives">
            {rituals.constraints.map((item) => (
              <li key={item}>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
