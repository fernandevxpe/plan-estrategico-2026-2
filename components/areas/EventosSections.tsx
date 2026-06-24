"use client";

import Link from "next/link";
import type { EventosDashboard } from "@/lib/areas/build-eventos-dashboard";
import { VendasInlineDetails } from "@/components/areas/VendasInlineDetails";

type Props = {
  data: EventosDashboard;
};

const TIER_LABEL: Record<number, string> = {
  1: "Tier 1 — âncora",
  2: "Tier 2 — alta",
  3: "Tier 3 — observar",
  4: "Experimental"
};

const STATUS_LABEL: Record<string, string> = {
  estande_pago: "Estande pago",
  avaliar: "Avaliar participação",
  observar: "Observar",
  pesquisar: "Pesquisar",
  testar: "Experimentar"
};

const PRIORITY_CLASS: Record<string, string> = {
  critical: "ev-priority-critical",
  high: "ev-priority-high",
  medium: "ev-priority-medium",
  experimental: "ev-priority-experimental"
};

export function EventosSummaryBar({ data }: Props) {
  const fe = data.focus.fesindico2026;
  const first = data.focus.firstEvent;

  return (
    <div className="vendas-summary-bar consultoria-summary-bar">
      <div className={`vendas-summary-gate ${data.fesindicoUrgent ? "warn" : "ok"} ev-fesindico-gate`}>
        <span className="vendas-summary-gate-label">
          FESÍNDICO 2026 — {fe.dates}
          {data.daysToFesindico !== null ? ` · ${data.daysToFesindico} dias` : ""}
        </span>
        <span className="vendas-summary-gate-detail">
          {fe.statusLabel} · {fe.venue}
        </span>
      </div>
      <div className="vendas-summary-metrics">
        <div className="vendas-summary-metric">
          <span>1º evento jun</span>
          <strong>{first.attendanceSyndicsEst} síndicos</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Inscrições</span>
          <strong>{first.registrations}</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Show rate</span>
          <strong>~{first.showRatePct}%</strong>
        </div>
      </div>
      <p className="vendas-sync-note capacity-gap-note">{data.focus.operatingModel.h2Focus}</p>
    </div>
  );
}

export function EventosFirstEventSection({ data }: Props) {
  const ev = data.focus.firstEvent;

  return (
    <div className="vendas-operational-focus is-embedded">
      <p className="vendas-gate-statement">{data.focus.operatingModel.headline}</p>

      <div className="card area-sub-card ev-first-event-card">
        <div className="ev-event-header">
          <div>
            <h4>{ev.title}</h4>
            <span className="ev-event-meta">
              {ev.month} · {ev.partner} · início {ev.startTime}
            </span>
          </div>
          <span className="ev-topic-badge">{ev.topic}</span>
        </div>

        <div className="ev-metrics-row">
          <div className="ev-metric-pill">
            <span>Inscrições</span>
            <strong>{ev.registrations}</strong>
          </div>
          <div className="ev-metric-pill">
            <span>Síndicos presentes (est.)</span>
            <strong>{ev.attendanceSyndicsEst}</strong>
          </div>
          <div className="ev-metric-pill">
            <span>Show rate</span>
            <strong>~{ev.showRatePct}%</strong>
          </div>
        </div>

        <VendasInlineDetails title="Lições aprendidas" defaultOpen>
          <ul className="vendas-compact-list">
            {ev.learnings.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </VendasInlineDetails>

        <VendasInlineDetails title="Pontos positivos">
          <ul className="vendas-compact-list">
            {ev.positives.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </VendasInlineDetails>

        <VendasInlineDetails title="Métricas para próximos eventos">
          <ul className="vendas-compact-list">
            {ev.metricsToTrack.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </VendasInlineDetails>
      </div>
    </div>
  );
}

export function EventosFesindicoSection({ data }: Props) {
  const fe = data.focus.fesindico2026;
  const ref = fe.reference2025;
  const pb = fe.playbook;

  return (
    <div className="ev-fesindico-wrap">
      <div className="card area-sub-card ev-fesindico-hero">
        <div className="ev-fesindico-hero-top">
          <div>
            <h4>{fe.title}</h4>
            <p className="metric-note">
              {fe.dates} · {fe.hours} · {fe.venue}
            </p>
            {fe.entry ? <p className="metric-note ev-entry-note">{fe.entry}</p> : null}
          </div>
          <span className="ev-status-paid">{fe.statusLabel}</span>
        </div>

        <p className="metric-note capacity-gap-note">
          Referência 2025: ~{ref.visitors.toLocaleString("pt-BR")} visitantes · {ref.exhibitors}+ expositores — {ref.note}
        </p>

        <div className="ev-hero-links">
          {fe.website ? (
            <a href={fe.website} target="_blank" rel="noopener noreferrer" className="ev-external-link">
              fesindico.com.br ↗
            </a>
          ) : null}
          {fe.instagram ? <span className="ev-instagram">{fe.instagram}</span> : null}
        </div>

        <VendasInlineDetails title="Objetivos no estande" defaultOpen>
          <ul className="vendas-compact-list">
            {fe.objectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </VendasInlineDetails>
      </div>

      <div className="ev-playbook-intro card area-sub-card">
        <h3 className="escala-section-title">{pb.title}</h3>
        <p className="metric-note">{pb.intro}</p>
      </div>

      <VendasInlineDetails title={pb.contextToKnow.title} defaultOpen>
        <ul className="vendas-compact-list">
          {pb.contextToKnow.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </VendasInlineDetails>

      <div className="ev-kpi-section">
        <h3 className="escala-section-title">{pb.successMetrics.title}</h3>
        <div className="ev-kpi-grid">
          {pb.successMetrics.kpis.map((kpi) => (
            <div className="ev-kpi-card" key={kpi.id}>
              <span className="ev-kpi-label">{kpi.label}</span>
              <strong className="ev-kpi-target">{kpi.target}</strong>
              <small>{kpi.note}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="ev-timeline-section">
        <h3 className="escala-section-title">Cronograma pré e pós-evento</h3>
        <div className="ev-timeline">
          {pb.timeline.map((block) => (
            <div className="ev-timeline-block" key={block.phase}>
              <div className="ev-timeline-header">
                <span className="ev-timeline-phase">{block.phase}</span>
                <strong>{block.title}</strong>
              </div>
              <ul>
                {block.tasks.map((task) => (
                  <li key={task}>{task}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <h3 className="escala-section-title">Guia operacional detalhado</h3>
      <div className="ev-playbook-sections">
        {pb.sections.map((section) => (
          <VendasInlineDetails key={section.id} title={section.title} defaultOpen={section.id === "demos" || section.id === "equipe"}>
            {section.subtitle ? <p className="metric-note ev-section-subtitle">{section.subtitle}</p> : null}
            <div className="ev-playbook-groups">
              {section.groups.map((group) => (
                <div className="ev-playbook-group" key={group.name}>
                  <strong>{group.name}</strong>
                  <ul>
                    {group.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </VendasInlineDetails>
        ))}
      </div>

      <div className="ev-personas-section">
        <h3 className="escala-section-title">Personas — como abordar</h3>
        <div className="ev-personas-grid">
          {pb.personas.map((p) => (
            <div className="ev-persona-card" key={p.id}>
              <strong>{p.name}</strong>
              <span className="ev-persona-signal">{p.signal}</span>
              <p>{p.approach}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="ev-scripts-section card area-sub-card">
        <h3 className="escala-section-title">{pb.scripts.title}</h3>
        <div className="ev-script-block">
          <strong>Abertura</strong>
          <p>{pb.scripts.opening}</p>
        </div>
        <div className="ev-script-block">
          <strong>Qualificação</strong>
          <ul>
            {pb.scripts.qualification.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
        <div className="ev-script-block">
          <strong>Fechamento</strong>
          <p>{pb.scripts.closing}</p>
        </div>
      </div>

      <h3 className="escala-section-title">{fe.standPlanning.title}</h3>
      <div className="ev-stand-grid">
        {fe.standPlanning.pillars.map((pillar) => (
          <div className="ev-stand-pillar" key={pillar.id}>
            <strong>{pillar.name}</strong>
            <ul>
              {pillar.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EventosCalendarSection({ data }: Props) {
  const cal = data.focus.eventCalendar;

  return (
    <div className="ev-calendar-wrap">
      <p className="metric-note">{cal.note}</p>
      <div className="ev-calendar-table-wrap">
        <table className="ev-calendar-table">
          <thead>
            <tr>
              <th>Evento</th>
              <th>Época</th>
              <th>Datas 2026</th>
              <th>Local</th>
              <th>Prioridade</th>
              <th>Status XPE</th>
              <th>EV</th>
            </tr>
          </thead>
          <tbody>
            {data.calendar.map((ev) => (
              <tr key={ev.id} className={PRIORITY_CLASS[ev.priority] ?? ""}>
                <td>
                  <strong>{ev.name}</strong>
                  {ev.edition ? <span className="ev-edition">{ev.edition}</span> : null}
                  {ev.organizer ? <span className="ev-organizer">{ev.organizer}</span> : null}
                </td>
                <td>{ev.period}</td>
                <td>{ev.dates}</td>
                <td>{ev.location}</td>
                <td>
                  <span className="ev-tier-badge">T{ev.tier}</span> {TIER_LABEL[ev.tier]}
                </td>
                <td>
                  <span className={`ev-xpe-status ev-xpe-${ev.xpeStatus}`}>
                    {STATUS_LABEL[ev.xpeStatus] ?? ev.xpeStatus}
                  </span>
                  <small>{ev.costNote}</small>
                </td>
                <td>{ev.evRelevance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EventosStrategySection({ data }: Props) {
  const s = data.focus.strategy;

  return (
    <div className="ev-strategy-wrap">
      <VendasInlineDetails title={s.title} defaultOpen>
        <ul className="vendas-compact-list">
          {s.principles.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </VendasInlineDetails>

      <div className="ev-budget-grid">
        {s.budgetCategories.map((cat) => (
          <div className="ev-budget-card" key={cat.id}>
            <strong>{cat.label}</strong>
            <span>{cat.example}</span>
          </div>
        ))}
      </div>

      <p className="metric-note capacity-gap-note">
        <strong>Responsável:</strong> {s.ownerNote}
      </p>

      <p className="metric-note">
        Smart Charging e demos EV:{" "}
        <Link href="/areas/smart-charging" className="ev-linked-area">
          área Smart Charging →
        </Link>
      </p>
    </div>
  );
}

export function EventosRoadmapSection({ data }: Props) {
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
    </div>
  );
}
