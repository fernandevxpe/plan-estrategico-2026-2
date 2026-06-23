"use client";

import type { VendasDirectorDashboard } from "@/lib/areas/build-vendas-director-dashboard";
import { brl } from "@/lib/analysis/format";
import { VendasInlineDetails } from "@/components/areas/VendasInlineDetails";

type Props = {
  dashboard: VendasDirectorDashboard;
  embedded?: boolean;
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
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function VendasDirectorDashboardSection({ dashboard, embedded = false }: Props) {
  const criticalKpis = dashboard.kpis.filter((kpi) => kpi.status === "critical");

  return (
    <div className={`vendas-director-dashboard ${embedded ? "is-embedded" : ""}`}>
      <p className="vendas-sync-note">
        Dados de {formatGeneratedAt(dashboard.generatedAt)} · {dashboard.meeting.purpose}
      </p>

      <div className={`vendas-director-gate ${dashboard.gateOk ? "gate-ok" : "gate-breach"}`}>
        <strong>{dashboard.gateOk ? "Reunião: gate OK" : "Reunião: revisar gate primeiro"}</strong>
        <span>
          {dashboard.gateOk
            ? "SLA de propostas dentro do esperado."
            : `${criticalKpis.length} indicador(es) crítico(s) na pauta.`}
        </span>
      </div>

      <div className="vendas-kpi-compact">
        {dashboard.kpis.map((kpi) => (
          <div className={`vendas-kpi-chip director-kpi-${kpi.status}`} key={kpi.id}>
            <span className="metric-label">{kpi.label}</span>
            <div className="vendas-kpi-chip-row">
              <strong>{kpi.current}</strong>
              <span className={`pill ${statusClass(kpi.status)}`}>
                {kpi.status === "ok" ? "OK" : kpi.status === "warn" ? "!" : "!!"}
              </span>
            </div>
            {kpi.weeklyTarget != null ? (
              <small>Meta: {kpi.weeklyTarget}</small>
            ) : kpi.gateTarget != null ? (
              <small>Gate ≤ {kpi.gateTarget}</small>
            ) : null}
          </div>
        ))}
      </div>

      <div className="vendas-details-grid">
        <VendasInlineDetails title="Pauta da reunião (1h–2h)" defaultOpen>
          <ol className="director-agenda">
            {dashboard.meeting.agenda.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </VendasInlineDetails>

        <VendasInlineDetails title={dashboard.salesRhythm.title}>
          <ul className="vendas-compact-list">
            {dashboard.salesRhythm.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </VendasInlineDetails>

        <VendasInlineDetails title="Metas semanais do time" defaultOpen>
          <div className="mini-grid">
            <div className="mini">
              <span className="metric-label">FTE efetivos</span>
              <strong>{dashboard.teamWeeklyTargets.headcountFte.toFixed(1)}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Visitas</span>
              <strong>{dashboard.teamWeeklyTargets.visitas}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Propostas</span>
              <strong>{dashboard.teamWeeklyTargets.propostasGeradas}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Apresentações</span>
              <strong>{dashboard.teamWeeklyTargets.apresentacoes}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Follow-ups</span>
              <strong>{dashboard.teamWeeklyTargets.followups}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Fechamentos</span>
              <strong>{dashboard.teamWeeklyTargets.fechamentos}</strong>
            </div>
          </div>
        </VendasInlineDetails>

        <VendasInlineDetails title="Atividade recente">
          <div className="mini-grid">
            <div className="mini">
              <span className="metric-label">Fech. 7d</span>
              <strong>{dashboard.rolling.won7d}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Fech. 30d</span>
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
        </VendasInlineDetails>

        <VendasInlineDetails title={dashboard.rampSchedule.title}>
          <div className="table-wrap">
            <table className="payroll-table director-ramp-table">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th>Ramp</th>
                  <th>Receita proj.</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.rampProjection.map((row) => (
                  <tr key={row.month}>
                    <td>
                      <strong>{row.label}</strong>
                    </td>
                    <td>{row.rampPct}%</td>
                    <td>{brl.format(row.revenueTarget)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="vendas-ramp-steps">
            {dashboard.rampSchedule.steps.map((step) => (
              <span className="vendas-ramp-step" key={step.monthOffset}>
                {step.pct}%
              </span>
            ))}
          </div>
        </VendasInlineDetails>
      </div>
    </div>
  );
}
