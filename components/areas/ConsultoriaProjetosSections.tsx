"use client";

import type { ConsultoriaProjetosDashboard } from "@/lib/areas/build-consultoria-projetos-dashboard";
import { brl } from "@/lib/analysis/format";
import { VendasInlineDetails } from "@/components/areas/VendasInlineDetails";

type Props = {
  data: ConsultoriaProjetosDashboard;
};

export function ConsultoriaProjetosSummaryBar({ data }: Props) {
  return (
    <div className="vendas-summary-bar consultoria-summary-bar">
      <div className="vendas-summary-gate ok">
        <span className="vendas-summary-gate-label">Time consultoria</span>
        <span className="vendas-summary-gate-detail">
          <strong>{data.team.currentFte} FTE</strong> (era {data.team.historicalFte}) · cenário{" "}
          {data.targets.scenario}
        </span>
      </div>
      <div className="vendas-summary-metrics">
        <div className="vendas-summary-metric">
          <span>PIE+PROJ YTD</span>
          <strong>
            {data.ytd2026.totalDeals} · {brl.format(data.ytd2026.totalRevenue)}
          </strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Média/mês</span>
          <strong>{data.ytd2026.avgMonthlyDeals} entregas</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Meta PIE (auto)</span>
          <strong>{data.targets.piePerMonth}/mês</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Meta projetos total</span>
          <strong>{data.targets.projectsTotalPerMonth}/mês</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>LDC (contexto)</span>
          <strong>~{data.laudosContext.ldcAvgMonthly}/mês</strong>
        </div>
      </div>
      <p className="vendas-sync-note capacity-gap-note">{data.capacityGap.headline}</p>
    </div>
  );
}

export function ConsultoriaProjetosOperationalFocus({ data }: Props) {
  const model = data.focus.operatingModel;
  const pillars = data.focus.strategicPillars;
  const loop = data.focus.learningLoop;
  const presentation = data.focus.presentationDecentralization;

  return (
    <div className="vendas-operational-focus is-embedded">
      <p className="vendas-gate-statement">{model.headline}</p>

      <div className="vendas-gate-stats">
        <div className="mini">
          <span className="metric-label">Engenheiro</span>
          <strong>Laudos + inspeção</strong>
          <small>{model.teamComposition.engineerRole}</small>
        </div>
        <div className="mini">
          <span className="metric-label">Lacuna atual</span>
          <strong>Projetos variados</strong>
          <small>{model.teamComposition.projectsFocus}</small>
        </div>
        <div className="mini">
          <span className="metric-label">Flexibilidade</span>
          <strong>Cross-training</strong>
          <small>{model.teamComposition.flexibilityGoal}</small>
        </div>
      </div>

      <div className="vendas-details-grid">
        <VendasInlineDetails title="Evolução: executor → especialista → gerente" defaultOpen>
          <div className="evolution-phases">
            {model.evolutionPath.map((step) => (
              <div className="evolution-phase" key={step.phase}>
                <span className="vendas-template-priority">{step.phase}</span>
                <strong>{step.label}</strong>
                <p>{step.description}</p>
              </div>
            ))}
          </div>
        </VendasInlineDetails>

        <VendasInlineDetails title={presentation.title} defaultOpen>
          <p className="metric-note">{presentation.current}</p>
          <p className="metric-note">{presentation.target}</p>
          <p className="metric-note">{presentation.goal}</p>
        </VendasInlineDetails>

        <VendasInlineDetails title={loop.title}>
          <ol className="director-agenda">
            {loop.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </VendasInlineDetails>
      </div>

      <div className="pillars-grid">
        {pillars.map((pillar) => (
          <div className="pillar-card" key={pillar.id}>
            <span className={`pill ${pillar.status === "em_andamento" ? "green" : pillar.status === "planejando" ? "blue" : "amber"}`}>
              {pillar.status.replace("_", " ")}
            </span>
            <strong>{pillar.title}</strong>
            <p>{pillar.description}</p>
          </div>
        ))}
      </div>

      <VendasInlineDetails title={data.focus.automationBacklog.title} defaultOpen>
        <p className="metric-note">Concluído:</p>
        <ul className="vendas-compact-list">
          {data.focus.automationBacklog.completed.map((item) => (
            <li key={item.id}>
              <strong>{item.name}</strong> — {item.impact}
            </li>
          ))}
        </ul>
        <p className="metric-note">Próximos na fila:</p>
        <div className="automation-queue">
          {data.focus.automationBacklog.next.map((item) => (
            <div className="vendas-template-chip" key={item.id}>
              <span className="vendas-template-priority">#{item.priority}</span>
              <strong>{item.name}</strong>
              <small>{item.note}</small>
            </div>
          ))}
        </div>
        <p className="metric-note">Ferramentas da biblioteca interna:</p>
        <ul className="vendas-compact-list">
          {data.focus.automationBacklog.libraryTools.map((tool) => (
            <li key={tool}>{tool}</li>
          ))}
        </ul>
      </VendasInlineDetails>

      <VendasInlineDetails title={data.focus.performanceCulture.title} defaultOpen>
        <p className="metric-note">{data.focus.performanceCulture.dailyRhythm}</p>
        <p className="metric-note">Métricas:</p>
        <ul className="vendas-compact-list">
          {data.focus.performanceCulture.metrics.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <p className="metric-note">Ações:</p>
        <ul className="vendas-compact-list">
          {data.focus.performanceCulture.actions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </VendasInlineDetails>
    </div>
  );
}

export function ConsultoriaProjetosCapacitySection({ data }: Props) {
  const maxDeals = Math.max(...data.monthly.map((m) => m.totalDeals), 1);

  return (
    <div className="consultoria-capacity is-embedded">
      <p className="vendas-sync-note">{data.capacityGap.detail}</p>

      <div className="card">
        <div className="card-title">
          <div>
            <h2>Entregas PIE + PROJETOS por mês (2026)</h2>
            <span>Fechados no Pipedrive — ticket médio YTD {brl.format(data.ytd2026.avgTicket)}</span>
          </div>
        </div>
        <div className="funnel-stages">
          {data.monthly.map((row) => (
            <div className="funnel-stage-row" key={row.month}>
              <div className="funnel-stage-head">
                <strong>{row.label}</strong>
                <span>
                  {row.totalDeals} total (PIE {row.pieDeals} · PROJ {row.projetosDeals}) ·{" "}
                  {brl.format(row.totalRevenue)}
                </span>
              </div>
              <div className="funnel-stage-bar">
                <div
                  className="funnel-stage-fill"
                  style={{ width: `${Math.max(8, (row.totalDeals / maxDeals) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mini-grid">
        <div className="mini">
          <span className="metric-label">PIE YTD</span>
          <strong>
            {data.ytd2026.pieDeals} · {brl.format(data.ytd2026.pieRevenue)}
          </strong>
        </div>
        <div className="mini">
          <span className="metric-label">PROJETOS YTD</span>
          <strong>
            {data.ytd2026.projetosDeals} · {brl.format(data.ytd2026.projetosRevenue)}
          </strong>
        </div>
        <div className="mini">
          <span className="metric-label">LDC YTD (time compartilhado)</span>
          <strong>{data.laudosContext.ldcDeals} laudos</strong>
        </div>
        <div className="mini">
          <span className="metric-label">LIE YTD</span>
          <strong>{data.laudosContext.lieDeals} laudos</strong>
        </div>
      </div>
    </div>
  );
}

export function ConsultoriaProjetosRoadmapSection({ data }: Props) {
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
