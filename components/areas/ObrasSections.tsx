"use client";

import Link from "next/link";
import type { ObrasDashboard } from "@/lib/areas/build-obras-dashboard";
import { brl } from "@/lib/analysis/format";
import { VendasInlineDetails } from "@/components/areas/VendasInlineDetails";

type Props = {
  data: ObrasDashboard;
};

const GATE_CLASS: Record<string, string> = {
  ok: "ok",
  warn: "warn",
  critical: "critical"
};

const CONFIDENCE_CLASS: Record<string, string> = {
  alta: "ob-conf-high",
  média: "ob-conf-medium",
  baixa: "ob-conf-low",
  confirmed: "ob-conf-high",
  high: "ob-conf-high",
  medium: "ob-conf-medium",
  low: "ob-conf-low",
  probable: "ob-conf-medium"
};

export function ObrasSummaryBar({ data }: Props) {
  const ytd = data.ytd2026;
  const gate = data.gateStatus;

  return (
    <div className="vendas-summary-bar consultoria-summary-bar">
      <div className={`vendas-summary-gate ${GATE_CLASS[gate] ?? "ok"} ob-gate`}>
        <span className="vendas-summary-gate-label">
          Obras YTD — {brl.format(ytd.revenue)} · {ytd.wonDeals} fechamentos
        </span>
        <span className="vendas-summary-gate-detail">
          Ticket {brl.format(ytd.avgTicket)} · {ytd.sharePct.toFixed(1)}% do mix · meta ticket ≥ {data.targets.ticketMin}
        </span>
      </div>
      <div className="vendas-summary-metrics">
        <div className="vendas-summary-metric">
          <span>Meta volume H2</span>
          <strong>{data.targets.volumeH2}</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Share meta</span>
          <strong>{data.targets.shareObras}</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Mai/jun</span>
          <strong className={gate !== "ok" ? "ob-alert-text" : ""}>Atenção</strong>
        </div>
      </div>
      <p className="vendas-sync-note capacity-gap-note">{data.focus.operatingModel.h2Focus}</p>
    </div>
  );
}

export function ObrasPerformanceSection({ data }: Props) {
  const perf = data.focus.performance2026;

  return (
    <div className="vendas-operational-focus is-embedded">
      <p className="vendas-gate-statement">{data.focus.operatingModel.headline}</p>
      <p className="metric-note capacity-gap-note">{data.focus.operatingModel.dataQualityNote}</p>

      <div className="ob-monthly-grid">
        {data.monthly.map((row) => (
          <div className={`ob-month-card ${row.revenue < 20000 && row.month >= "2026-05" ? "is-low" : ""}`} key={row.month}>
            <span className="ob-month-label">{row.label}</span>
            <strong>{brl.format(row.revenue)}</strong>
            <span>{row.deals} fech.</span>
            {row.note ? <small>{row.note}</small> : null}
          </div>
        ))}
      </div>

      <h3 className="escala-section-title">Mix por subgrupo (2026)</h3>
      <div className="ob-subgroup-table-wrap">
        <table className="ob-subgroup-table">
          <thead>
            <tr>
              <th>Subgrupo</th>
              <th>Fech.</th>
              <th>Receita</th>
              <th>Ticket</th>
            </tr>
          </thead>
          <tbody>
            {data.subgroups
              .sort((a, b) => b.revenue - a.revenue)
              .map((sg) => (
                <tr key={sg.subgroup}>
                  <td>{sg.subgroup}</td>
                  <td>{sg.wonDeals}</td>
                  <td>{brl.format(sg.revenue)}</td>
                  <td>{brl.format(sg.averageTicket)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <VendasInlineDetails title="Negócios recentes (evidência CRM + ClickUp)" defaultOpen>
        <div className="ob-deals-list">
          {data.recentDeals.map((deal) => (
            <div className={`ob-deal-card ${CONFIDENCE_CLASS[deal.confidence] ?? ""}`} key={deal.id}>
              <div className="ob-deal-top">
                <strong>{deal.title}</strong>
                <span>{brl.format(deal.value)}</span>
              </div>
              <span className="ob-deal-meta">
                {deal.month.slice(0, 7)} · {deal.subgroup} · {deal.confidence}
              </span>
              {deal.note ? <small>{deal.note}</small> : null}
            </div>
          ))}
        </div>
      </VendasInlineDetails>
    </div>
  );
}

export function ObrasTypesSection({ data }: Props) {
  const types = data.focus.obraTypes;

  return (
    <div className="ob-types-wrap">
      {types.types.map((t) => (
        <div className={`ob-type-card ${CONFIDENCE_CLASS[t.confidence] ?? ""}`} key={t.id}>
          <div className="ob-type-header">
            <strong>{t.name}</strong>
            <span className="ob-type-stats">
              {t.ytd2026.deals} fech. · {brl.format(t.ytd2026.revenue)}
            </span>
          </div>
          <VendasInlineDetails title="Exemplos 2026">
            <ul className="vendas-compact-list">
              {t.examples.map((ex) => (
                <li key={ex}>{ex}</li>
              ))}
            </ul>
          </VendasInlineDetails>
          <p className="metric-note">
            <strong>Origem:</strong> {t.upstream.join(" · ")}
          </p>
          <p className="metric-note ob-exec-note">{t.executionNotes}</p>
        </div>
      ))}
    </div>
  );
}

export function ObrasFunnelsSection({ data }: Props) {
  const funnels = data.focus.upstreamFunnels;

  return (
    <div className="ob-funnels-wrap">
      <p className="metric-note">{funnels.title}</p>
      {funnels.sources.map((src) => (
        <div className="ob-funnel-card" key={src.id}>
          <div className="ob-funnel-header">
            <strong>{src.name}</strong>
            <span className={`ob-status ob-status-${src.status.replace(/_/g, "-")}`}>{src.status}</span>
          </div>
          <p className="metric-note">
            <strong>Responsável:</strong> {src.owner} · <strong>Marco H2:</strong> {src.h2Milestone}
          </p>
          <p className="metric-note">
            <strong>Tipos obra:</strong> {src.obraTypes.join(", ")}
          </p>
          <VendasInlineDetails title="O que monitorar">
            <ul className="vendas-compact-list">
              {src.monitor.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </VendasInlineDetails>
          {src.id === "ev-direct" ? (
            <Link href="/areas/smart-charging" className="ob-linked-area">
              Smart Charging →
            </Link>
          ) : null}
          {src.id === "lie-guia" ? (
            <Link href="/areas/consultoria-laudos" className="ob-linked-area">
              Consultoria Laudos →
            </Link>
          ) : null}
          {src.id === "pcc" ? (
            <Link href="/areas/consultoria-projetos" className="ob-linked-area">
              Consultoria Projetos →
            </Link>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function ObrasOperationsSection({ data }: Props) {
  const ops = data.focus.fieldOperations;

  return (
    <div className="ob-ops-wrap">
      <h3 className="escala-section-title">{ops.standardFlow.title}</h3>
      <div className="ob-flow-steps">
        {ops.standardFlow.steps.map((s) => (
          <div className="ob-flow-step" key={s.step}>
            <span className="ob-flow-num">{s.step}</span>
            <strong>{s.name}</strong>
            <ul>
              {s.actions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <VendasInlineDetails title={ops.evFlow.title} defaultOpen>
        <p className="metric-note">{ops.evFlow.gap}</p>
        <ol className="director-agenda">
          {ops.evFlow.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </VendasInlineDetails>

      <VendasInlineDetails title={ops.osClickUp.title}>
        <p className="metric-note">Status: {ops.osClickUp.status}</p>
        <div className="ob-os-grid">
          <div>
            <strong>Templates necessários</strong>
            <ul className="vendas-compact-list">
              {ops.osClickUp.templatesNeeded.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div>
            <strong>Campos por OS</strong>
            <ul className="vendas-compact-list">
              {ops.osClickUp.fieldsPerOs.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      </VendasInlineDetails>
    </div>
  );
}

export function ObrasMonitoringSection({ data }: Props) {
  const mon = data.focus.monitoring;

  const renderTable = (rows: typeof mon.commercial, title: string) => (
    <div className="ob-monitor-block" key={title}>
      <h4>{title}</h4>
      <table className="ob-monitor-table">
        <thead>
          <tr>
            <th>Indicador</th>
            <th>Frequência</th>
            <th>Dono</th>
            <th>Meta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.label}</td>
              <td>{row.frequency}</td>
              <td>{row.owner}</td>
              <td>{row.target}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="ob-monitor-wrap">
      {renderTable(mon.commercial, "Comercial")}
      {renderTable(mon.operational, "Operacional")}
      {renderTable(mon.quality, "Qualidade & dados")}
    </div>
  );
}

export function ObrasPlaybookSection({ data }: Props) {
  const pb = data.focus.playbook;
  const cap = data.focus.capacity;

  return (
    <div className="ob-playbook-wrap">
      {pb.sections.map((section) => (
        <VendasInlineDetails key={section.id} title={section.title} defaultOpen={section.id === "comercial" || section.id === "campo"}>
          <ul className="vendas-compact-list">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </VendasInlineDetails>
      ))}

      <div className="card area-sub-card ob-capacity-card">
        <h4>{cap.title}</h4>
        <p className="metric-note">{cap.headline}</p>
        <VendasInlineDetails title="Premissas" defaultOpen>
          <ul className="vendas-compact-list">
            {cap.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </VendasInlineDetails>
        <VendasInlineDetails title="Gates de decisão">
          <ul className="vendas-compact-list">
            {cap.decisionGates.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </VendasInlineDetails>
      </div>
    </div>
  );
}

export function ObrasRoadmapSection({ data }: Props) {
  return (
    <div className="ev-roadmap-wrap">
      {data.focus.roadmapPhases.map((phase) => (
        <div className="ev-roadmap-phase" key={phase.phase}>
          <div className="ev-roadmap-phase-header">
            <span className="ev-roadmap-period">{phase.phase}</span>
            <strong>{phase.title}</strong>
          </div>
          <ul className="vendas-compact-list">
            {phase.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}

      <div className="card area-sub-card ob-questions-card">
        <h4>Perguntas em aberto — preencher com a gestão</h4>
        <ul className="vendas-compact-list">
          {data.focus.openQuestions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
