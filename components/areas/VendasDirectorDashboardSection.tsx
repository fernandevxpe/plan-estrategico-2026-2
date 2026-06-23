"use client";

import type { VendasDirectorDashboard } from "@/lib/areas/build-vendas-director-dashboard";
import { brl } from "@/lib/analysis/format";

type Props = {
  dashboard: VendasDirectorDashboard;
};

function statusClass(status: string) {
  if (status === "ok") return "green";
  if (status === "warn") return "amber";
  return "red";
}

function formatGeneratedAt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function VendasDirectorDashboardSection({ dashboard }: Props) {
  const criticalKpis = dashboard.kpis.filter((kpi) => kpi.status === "critical");

  return (
    <div className="vendas-director-dashboard">
      <section className="section-title subsection-title">
        <div>
          <h3>{dashboard.title}</h3>
          <p>
            {dashboard.meeting.cadence} · {dashboard.meeting.duration} · dados de{" "}
            {formatGeneratedAt(dashboard.generatedAt)}
          </p>
        </div>
      </section>

      <div className={`vendas-director-gate ${dashboard.gateOk ? "gate-ok" : "gate-breach"}`}>
        <strong>{dashboard.gateOk ? "Gate OK" : "Gate em risco"}</strong>
        <span>
          {dashboard.gateOk
            ? "Nenhum indicador crítico de SLA de propostas no snapshot atual."
            : `${criticalKpis.length} indicador(es) crítico(s) — revisar na reunião antes de escalar.`}
        </span>
      </div>

      <div className="guide-kpi-row">
        {dashboard.kpis.map((kpi) => (
          <div className={`guide-kpi-card director-kpi-${kpi.status}`} key={kpi.id}>
            <span className="metric-label">{kpi.label}</span>
            <strong>{kpi.current}</strong>
            {kpi.weeklyTarget != null ? (
              <small>Meta semanal time: {kpi.weeklyTarget}</small>
            ) : kpi.gateTarget != null ? (
              <small>Gate: ≤ {kpi.gateTarget}</small>
            ) : (
              <small>{kpi.source}</small>
            )}
            {kpi.note ? <small className="metric-note">{kpi.note}</small> : null}
            <span className={`pill ${statusClass(kpi.status)}`}>
              {kpi.status === "ok" ? "OK" : kpi.status === "warn" ? "Atenção" : "Crítico"}
            </span>
          </div>
        ))}
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Reunião semanal — pauta</h2>
              <span>{dashboard.meeting.purpose}</span>
            </div>
          </div>
          <ol className="director-agenda">
            {dashboard.meeting.agenda.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>{dashboard.salesRhythm.title}</h2>
            </div>
          </div>
          <ul className="area-objectives">
            {dashboard.salesRhythm.notes.map((note) => (
              <li key={note}>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Metas semanais do time</h2>
              <span>
                {dashboard.teamWeeklyTargets.headcountFte.toFixed(1)} FTE efetivos · base 100% por vendedor
              </span>
            </div>
          </div>
          <div className="mini-grid">
            <div className="mini">
              <span className="metric-label">Visitas / diagnósticos</span>
              <strong>{dashboard.teamWeeklyTargets.visitas}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Propostas geradas</span>
              <strong>{dashboard.teamWeeklyTargets.propostasGeradas}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Apresentações</span>
              <strong>{dashboard.teamWeeklyTargets.apresentacoes}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Follow-ups negociação</span>
              <strong>{dashboard.teamWeeklyTargets.followups}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Fechamentos</span>
              <strong>{dashboard.teamWeeklyTargets.fechamentos}</strong>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Atividade recente</h2>
              <span>Janela móvel desde último sync</span>
            </div>
          </div>
          <div className="mini-grid">
            <div className="mini">
              <span className="metric-label">Fechamentos 7d</span>
              <strong>{dashboard.rolling.won7d}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Fechamentos 30d</span>
              <strong>{dashboard.rolling.won30d}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Novos 7d</span>
              <strong>{dashboard.rolling.created7d}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Novos 30d</span>
              <strong>{dashboard.rolling.created30d}</strong>
            </div>
          </div>
        </div>
      </div>

      <section className="section-title subsection-title">
        <div>
          <h3>{dashboard.rampSchedule.title}</h3>
          <p>0% → 33% → 66% → 100% — projetado por mês após contratação</p>
        </div>
      </section>

      <div className="table-wrap">
        <table className="payroll-table director-ramp-table">
          <thead>
            <tr>
              <th>Mês</th>
              <th>Vendedor</th>
              <th>Ramp</th>
              <th>Receita proj.</th>
              <th>Fase</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.rampProjection.map((row) => (
              <tr key={row.month}>
                <td>
                  <strong>{row.label}</strong>
                </td>
                <td>{row.sellerLabel}</td>
                <td>{row.rampPct}%</td>
                <td>{brl.format(row.revenueTarget)}</td>
                <td>{row.isHireMonth ? "Contratação" : row.rampPct < 100 ? "Ramp" : "Pleno"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="investigation-notes">
        {dashboard.rampSchedule.steps.map((step) => (
          <div className="insight-mini" key={step.monthOffset}>
            <strong>
              {step.pct}% — {step.label}
            </strong>
            <span>{step.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
