"use client";

import Link from "next/link";
import type { AutomacoesFerramentasDashboard } from "@/lib/areas/build-automacoes-ferramentas-dashboard";
import { VendasInlineDetails } from "@/components/areas/VendasInlineDetails";

type Props = {
  data: AutomacoesFerramentasDashboard;
};

const STATUS_CLASS: Record<string, string> = {
  template_pronto: "af-status-ready",
  base_existente: "af-status-base",
  colheita_campo: "af-status-field",
  registros_parciais: "af-status-partial",
  checklist_completo: "af-status-checklist",
  planejando: "af-status-plan"
};

const IMPACT_CLASS: Record<string, string> = {
  critical: "af-impact-critical",
  high: "af-impact-high",
  medium: "af-impact-medium"
};

export function AutomacoesSummaryBar({ data }: Props) {
  const app = data.focus.offlineApp;
  const modules = data.serviceModules;
  const ready = modules.filter((m) =>
    ["template_pronto", "base_existente", "checklist_completo"].includes(m.status)
  ).length;

  return (
    <div className="vendas-summary-bar consultoria-summary-bar">
      <div className="vendas-summary-gate ok af-gate">
        <span className="vendas-summary-gate-label">App offline · ~{app.devMonths} meses dev</span>
        <span className="vendas-summary-gate-detail">
          ClickUp sync · {modules.length} módulos de serviço · {ready} com base/template pronta
        </span>
      </div>
      <div className="vendas-summary-metrics">
        <div className="vendas-summary-metric">
          <span>P1 dev</span>
          <strong>Smart Charging</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>P2 dev</span>
          <strong>LIE</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Bloqueio</span>
          <strong>Teste campo</strong>
        </div>
      </div>
      <p className="vendas-sync-note capacity-gap-note">{data.focus.operatingModel.h2Focus}</p>
    </div>
  );
}

export function AutomacoesAppSection({ data }: Props) {
  const app = data.focus.offlineApp;

  return (
    <div className="vendas-operational-focus is-embedded">
      <p className="vendas-gate-statement">{data.focus.operatingModel.headline}</p>

      <div className="card area-sub-card af-app-card">
        <div className="af-app-header">
          <div>
            <h4>{app.title}</h4>
            <span className="af-app-meta">
              {app.distribution} · {app.integration}
            </span>
          </div>
          <span className="af-dev-badge">~{app.devMonths} meses</span>
        </div>
        <p className="metric-note">{app.goal}</p>

        <VendasInlineDetails title="Bloqueios atuais" defaultOpen>
          <ul className="vendas-compact-list af-blocker-list">
            {app.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </VendasInlineDetails>
        <p className="metric-note capacity-gap-note">
          <strong>Expectativa:</strong> {app.expectation}
        </p>
      </div>
    </div>
  );
}

export function AutomacoesEndToEndFlow({ data }: Props) {
  const flow = data.focus.endToEndFlow;

  return (
    <div className="af-flow-wrap">
      <p className="metric-note">{flow.title} — do agendamento à entrega</p>
      <div className="af-flow-steps">
        {flow.steps.map((s, i) => (
          <div className="af-flow-step" key={s.step}>
            <span className="af-flow-num">{s.step}</span>
            <strong>{s.name}</strong>
            <span className="af-flow-where">{s.where}</span>
            <small>{s.output}</small>
            {i < flow.steps.length - 1 ? <span className="af-flow-arrow">→</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AutomacoesServicePipeline({ data }: Props) {
  return (
    <div className="af-services-pipeline">
      {data.serviceModules.map((mod) => (
        <div className={`af-service-card ${STATUS_CLASS[mod.status] ?? ""}`} key={mod.id}>
          <div className="af-service-header">
            <span className="af-service-priority">P{mod.priority}</span>
            <span className={`af-service-status ${STATUS_CLASS[mod.status] ?? ""}`}>
              {mod.statusLabel}
            </span>
          </div>
          <div className="af-service-title">
            <strong>{mod.code}</strong>
            <h4>{mod.name}</h4>
          </div>

          <div className="af-service-roles">
            <div className="af-role">
              <span>Campo (app)</span>
              <p>{mod.fieldRole}</p>
            </div>
            <div className="af-role">
              <span>Web / analista</span>
              <p>{mod.webRole}</p>
            </div>
          </div>

          <VendasInlineDetails title="Checklist / entregas" defaultOpen={mod.priority <= 2}>
            <ul className="vendas-compact-list">
              {mod.checklistHighlights.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </VendasInlineDetails>

          <div className="af-data-tags">
            {mod.dataPoints.map((d) => (
              <span className="af-data-tag" key={d}>
                {d}
              </span>
            ))}
          </div>

          <p className="af-service-blocker">
            <strong>Gargalo:</strong> {mod.blocker}
          </p>

          {mod.linkedArea ? (
            <Link href={`/areas/${mod.linkedArea}`} className="af-linked-area">
              Ver área →
            </Link>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function AutomacoesWebPlatform({ data }: Props) {
  const web = data.focus.webPlatform;

  return (
    <div className="vendas-operational-focus is-embedded">
      <p className="vendas-gate-statement">{web.headline}</p>
      <ul className="director-agenda">
        {web.principles.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

export function AutomacoesBottleneckStudy({ data }: Props) {
  const study = data.focus.bottleneckStudy;

  return (
    <div className="af-bottleneck-panel">
      <p className="vendas-gate-statement">{study.headline}</p>
      <p className="metric-note">{study.method}</p>
      <div className="af-bottleneck-grid">
        {study.candidates.map((b) => (
          <div className={`af-bottleneck-card ${IMPACT_CLASS[b.impact] ?? ""}`} key={b.id}>
            <span className="af-impact-badge">{b.impact}</span>
            <strong>{b.area}</strong>
            <p>{b.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AutomacoesRoadmapSection({ data }: Props) {
  return (
    <div className="consultoria-roadmap is-embedded">
      <VendasInlineDetails title="Prioridades H2" defaultOpen>
        <ul className="vendas-compact-list">
          {data.focus.h2Priorities.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </VendasInlineDetails>

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
