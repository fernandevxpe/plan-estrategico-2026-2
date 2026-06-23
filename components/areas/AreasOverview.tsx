"use client";

import Link from "next/link";
import type { AreaDashboardItem, AreasDashboard } from "@/lib/areas/types";
import { brl, formatGrowth, monthLabel } from "@/lib/analysis/format";

const statusLabel = {
  estruturando: "Estruturando",
  planejando: "Planejando",
  executando: "Executando",
  monitorando: "Monitorando"
} as const;

const statusClass = {
  estruturando: "blue",
  planejando: "amber",
  executando: "green",
  monitorando: "green"
} as const;

const activityStatusLabel = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  bloqueada: "Bloqueada"
} as const;

const priorityLabel = {
  critical: "Crítico",
  high: "Alta",
  medium: "Média"
} as const;

type Props = {
  dashboard: AreasDashboard;
  linkToPages?: boolean;
};

export function AreasOverview({ dashboard, linkToPages = false }: Props) {
  const { overview } = dashboard;
  const progressPct = overview.totalActivities
    ? Math.round((overview.activitiesDone / overview.totalActivities) * 100)
    : 0;

  const flatAreas = flattenAll(dashboard.areas);

  return (
    <div className="areas-overview">
      <div className="areas-overview-kpis">
        <div className="guide-kpi-card">
          <span className="metric-label">Áreas</span>
          <strong>{overview.totalAreas}</strong>
          <small>{overview.areasExecuting} em execução</small>
        </div>
        <div className="guide-kpi-card">
          <span className="metric-label">Atividades</span>
          <strong>{overview.totalActivities}</strong>
          <small>
            {overview.activitiesInProgress} em andamento · {overview.activitiesPending} pendentes
          </small>
        </div>
        <div className="guide-kpi-card">
          <span className="metric-label">Progresso plano</span>
          <strong>{progressPct}%</strong>
          <small>{overview.activitiesDone} concluídas</small>
        </div>
        <div className="guide-kpi-card">
          <span className="metric-label">Receita YTD mapeada</span>
          <strong>{brl.format(overview.attributedRevenueYtd)}</strong>
          <small>
            {overview.unmappedRevenueYtd > 0
              ? `${brl.format(overview.unmappedRevenueYtd)} sem área`
              : "Cobertura completa"}
          </small>
        </div>
      </div>

      <div className="areas-grid">
        {flatAreas.map((area) => {
          const card = (
            <>
              <div className="area-card-head">
                <div>
                  <h4>{area.name}</h4>
                  {area.parentId ? <span className="area-parent">↳ {parentName(dashboard, area.parentId)}</span> : null}
                </div>
                <span className={`pill ${statusClass[area.status]}`}>{statusLabel[area.status]}</span>
              </div>
              <p className="area-card-desc">{area.description}</p>
              <div className="mini-grid">
                <div className="mini">
                  <span className="metric-label">Líder</span>
                  <strong>{area.lead}</strong>
                </div>
                <div className="mini">
                  <span className="metric-label">Atividades</span>
                  <strong>{area.activities.length}</strong>
                </div>
                {area.metrics.revenue2026Ytd != null ? (
                  <div className="mini">
                    <span className="metric-label">Receita 2026</span>
                    <strong>{brl.format(area.metrics.revenue2026Ytd)}</strong>
                  </div>
                ) : null}
                {area.metrics.revenueSharePct != null ? (
                  <div className="mini">
                    <span className="metric-label">Share</span>
                    <strong>{formatGrowth(area.metrics.revenueSharePct)}</strong>
                  </div>
                ) : null}
              </div>
              {area.metrics.highlights[0] ? <p className="metric-note">{area.metrics.highlights[0]}</p> : null}
              {linkToPages ? (
                <span className="area-card-cta">Abrir página da área →</span>
              ) : null}
            </>
          );

          if (linkToPages) {
            return (
              <Link className="card area-card area-card-link" href={`/areas/${area.id}`} key={area.id}>
                {card}
              </Link>
            );
          }

          return (
            <article className="card area-card" key={area.id}>
              {card}
            </article>
          );
        })}
      </div>

      <section className="section-title subsection-title">
        <div>
          <h3>Matriz consolidada — responsáveis e prazos</h3>
          <p>Todas as atividades de todas as áreas em um só lugar.</p>
        </div>
      </section>

      <div className="table-wrap table-scroll">
        <table>
          <thead>
            <tr>
              <th>Área</th>
              <th>Atividade</th>
              <th>Responsável</th>
              <th>Prazo</th>
              <th>Prioridade</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {flatAreas.flatMap((area) =>
              area.activities.map((activity) => (
                <tr key={activity.id}>
                  <td>
                    <strong>{area.shortName}</strong>
                  </td>
                  <td>{activity.title}</td>
                  <td>{activity.responsible}</td>
                  <td>{activity.dueMonth ? monthLabel(activity.dueMonth) : "—"}</td>
                  <td>
                    <span className={`pill ${activity.priority === "critical" ? "amber" : activity.priority === "high" ? "blue" : "green"}`}>
                      {priorityLabel[activity.priority]}
                    </span>
                  </td>
                  <td>{activityStatusLabel[activity.status]}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AreaDetailPanel({ area }: { area: AreaDashboardItem }) {
  const done = area.activities.filter((item) => item.status === "concluida").length;
  const progress = area.activities.length ? Math.round((done / area.activities.length) * 100) : 0;

  return (
    <div className="area-detail">
      <div className="area-detail-hero">
        <div>
          <p className="eyebrow">{area.parentId ? "Subárea" : "Área"}</p>
          <h3>{area.name}</h3>
          <p>{area.description}</p>
        </div>
        <div className="area-detail-meta">
          <span className={`pill ${statusClass[area.status]}`}>{statusLabel[area.status]}</span>
          <div className="mini">
            <span className="metric-label">Líder</span>
            <strong>{area.lead}</strong>
          </div>
          <div className="mini">
            <span className="metric-label">Plano</span>
            <strong>{progress}% concluído</strong>
          </div>
        </div>
      </div>

      {area.metrics.highlights.length ? (
        <div className="investigation-notes">
          {area.metrics.highlights.map((note) => (
            <div className="insight-mini" key={note}>
              <span>{note}</span>
            </div>
          ))}
        </div>
      ) : null}

      <section className="dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Indicadores 2026</h2>
              <span>Dados reais onde disponíveis</span>
            </div>
          </div>
          <div className="mini-grid">
            <div className="mini">
              <span className="metric-label">Receita YTD</span>
              <strong>{area.metrics.revenue2026Ytd != null ? brl.format(area.metrics.revenue2026Ytd) : "—"}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Contratos</span>
              <strong>{area.metrics.wonDeals2026Ytd ?? "—"}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Ticket médio</span>
              <strong>{area.metrics.averageTicket != null ? brl.format(area.metrics.averageTicket) : "—"}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Share receita</span>
              <strong>{area.metrics.revenueSharePct != null ? formatGrowth(area.metrics.revenueSharePct) : "—"}</strong>
            </div>
            {area.metrics.pipelineOpenDeals != null ? (
              <div className="mini">
                <span className="metric-label">Pipeline aberto</span>
                <strong>{area.metrics.pipelineOpenDeals} neg.</strong>
              </div>
            ) : null}
            {area.metrics.pipelineOpenValue != null ? (
              <div className="mini">
                <span className="metric-label">Valor aberto</span>
                <strong>{brl.format(area.metrics.pipelineOpenValue)}</strong>
              </div>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Objetivos estratégicos</h2>
            </div>
          </div>
          <ul className="area-objectives">
            {area.objectives.map((objective) => (
              <li key={objective.id}>
                <strong>{objective.title}</strong>
                {objective.metric ? (
                  <span>
                    {objective.metric}: {objective.target}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section-title subsection-title">
        <div>
          <h3>Notas estratégicas</h3>
        </div>
      </section>
      <div className="investigation-notes">
        {area.strategicNotes.map((note) => (
          <div className="insight-mini" key={note}>
            <span>{note}</span>
          </div>
        ))}
      </div>

      <section className="section-title subsection-title">
        <div>
          <h3>Plano de execução</h3>
          <p>Atividades, responsáveis e prazos — vamos detalhar juntos.</p>
        </div>
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Atividade</th>
              <th>Responsável</th>
              <th>Prazo</th>
              <th>Prioridade</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {area.activities.map((activity) => (
              <tr key={activity.id}>
                <td>
                  <strong>{activity.title}</strong>
                  {activity.notes ? <p className="metric-note">{activity.notes}</p> : null}
                </td>
                <td>{activity.responsible}</td>
                <td>{activity.dueMonth ? monthLabel(activity.dueMonth) : "—"}</td>
                <td>
                  <span className={`pill ${activity.priority === "critical" ? "amber" : activity.priority === "high" ? "blue" : "green"}`}>
                    {priorityLabel[activity.priority]}
                  </span>
                </td>
                <td>{activityStatusLabel[activity.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {area.children?.length ? (
        <>
          <section className="section-title subsection-title">
            <div>
              <h3>Subáreas</h3>
            </div>
          </section>
          <div className="areas-sub-grid">
            {area.children.map((child) => (
              <Link className="card area-sub-card area-card-link" href={`/areas/${child.id}`} key={child.id}>
                <h4>{child.name}</h4>
                <p>{child.description}</p>
                <div className="mini-grid">
                  <div className="mini">
                    <span className="metric-label">Atividades</span>
                    <strong>{child.activities.length}</strong>
                  </div>
                  <div className="mini">
                    <span className="metric-label">Receita YTD</span>
                    <strong>{child.metrics.revenue2026Ytd != null ? brl.format(child.metrics.revenue2026Ytd) : "—"}</strong>
                  </div>
                </div>
                <span className="area-card-cta">Ver plano →</span>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      {area.risks.length ? (
        <section className="dashboard-grid">
          <div className="card">
            <div className="card-title">
              <div>
                <h2>Riscos e mitigação</h2>
              </div>
            </div>
            <div className="guide-risks">
              {area.risks.map((risk) => (
                <div className="guide-risk" key={risk.title}>
                  <strong>{risk.title}</strong>
                  <p>{risk.mitigation}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function flattenAll(areas: AreaDashboardItem[]): AreaDashboardItem[] {
  return areas.flatMap((area) => [area, ...(area.children ? flattenAll(area.children) : [])]);
}

function parentName(dashboard: AreasDashboard, parentId: string) {
  return flattenAll(dashboard.areas).find((area) => area.id === parentId)?.name ?? parentId;
}
