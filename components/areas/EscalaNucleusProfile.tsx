"use client";

import type { EscalaDashboard, SellerProductivityProfile } from "@/lib/areas/build-escala-dashboard";
import { brl, number } from "@/lib/analysis/format";

type Props = {
  data: EscalaDashboard;
};

const PROFILE_ACCENT: Record<string, string> = {
  historical: "escala-profile-real",
  "meta-h2": "escala-profile-meta",
  conservative: "escala-profile-conservative"
};

function ProfileCard({ profile }: { profile: SellerProductivityProfile }) {
  const metrics = [
    { label: "Fechamentos / mês", value: number.format(profile.closingsPerMonth), highlight: true },
    { label: "Faturamento / mês", value: brl.format(profile.revenuePerMonth), highlight: true },
    { label: "Ticket médio", value: brl.format(profile.averageTicket) },
    { label: "Negócios criados", value: number.format(profile.dealsCreatedPerMonth) },
    { label: "Conversão", value: `${number.format(profile.conversionPct)}%` },
    { label: "Visitas / mês", value: String(profile.visitsPerMonth), note: "est." },
    { label: "Reuniões / mês", value: String(profile.meetingsPerMonth), note: "est." },
    { label: "Orçamentos / mês", value: number.format(profile.budgetsPerMonth) },
    { label: "Propostas / mês", value: number.format(profile.proposalsPerMonth), note: "est." }
  ];

  return (
    <div className={`escala-profile-card ${PROFILE_ACCENT[profile.id] ?? ""}`}>
      <div className="escala-profile-header">
        <strong>{profile.label}</strong>
        <span>{profile.source}</span>
      </div>
      <div className="escala-profile-metrics">
        {metrics.map((m) => (
          <div className={`escala-profile-metric ${m.highlight ? "highlight" : ""}`} key={m.label}>
            <span>{m.label}</span>
            <strong>
              {m.value}
              {m.note ? <small> ({m.note})</small> : null}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EscalaNucleusProfile({ data }: Props) {
  const unit = data.nucleusUnit;
  const nuc = data.focus.nucleusOperation;
  const historical = unit.profiles.find((p) => p.id === "historical");
  const meta = unit.profiles.find((p) => p.id === "meta-h2");

  const maxMixRevenue = Math.max(...unit.serviceMix.map((s) => s.revenueYtd), 1);
  const maxNucleusRevenue = Math.max(...unit.nucleusCapacity.map((n) => n.revenuePerMonth), 1);

  return (
    <div className="escala-nucleus-profile">
      <div className="escala-profile-intro card area-sub-card">
        <h4>Núcleo operacional — demanda mensal por vendedor</h4>
        <p className="vendas-gate-statement">{nuc.headline}</p>
        <p className="sc-sim-formula">{nuc.matrixNote}</p>
        <p className="metric-note">{nuc.unitProfileNote}</p>
      </div>

      <div className="escala-profile-hero">
        <div className="escala-hero-stat">
          <span>1 vendedor hoje (real)</span>
          <strong>{historical ? brl.format(historical.revenuePerMonth) : "—"}</strong>
          <small>
            {historical ? `${number.format(historical.closingsPerMonth)} fech./mês` : ""} · ticket{" "}
            {historical ? brl.format(historical.averageTicket) : ""}
          </small>
        </div>
        <div className="escala-hero-arrow">→</div>
        <div className="escala-hero-stat meta">
          <span>Meta H2 por vendedor</span>
          <strong>{meta ? brl.format(meta.revenuePerMonth) : "—"}</strong>
          <small>{meta ? `${number.format(meta.closingsPerMonth)} fech./mês` : ""}</small>
        </div>
        <div className="escala-hero-stat nucleus">
          <span>RM Recife (4 vend.)</span>
          <strong>
            {meta ? brl.format(meta.revenuePerMonth * 4) : "—"}
          </strong>
          <small>demanda mensal alvo do núcleo matriz</small>
        </div>
      </div>

      <h3 className="escala-section-title">Perfil por vendedor — 3 cenários</h3>
      <div className="escala-profiles-grid">
        {unit.profiles.map((p) => (
          <ProfileCard profile={p} key={p.id} />
        ))}
      </div>

      <h3 className="escala-section-title">
        Mix de serviços por vendedor ({unit.periodLabel} · {unit.ytdMonths} meses · {unit.sellersCount}{" "}
        vend.)
      </h3>
      <div className="escala-mix-panel">
        <div className="escala-mix-bars">
          {unit.serviceMix.map((svc) => (
            <div className="escala-mix-row" key={svc.type}>
              <div className="escala-mix-label">
                <strong>{svc.shortLabel}</strong>
                <span>
                  {number.format(svc.closingsPerSellerMonth)}/vend./mês · ticket{" "}
                  {brl.format(svc.averageTicket)}
                </span>
              </div>
              <div className="escala-mix-bar-track">
                <div
                  className="escala-mix-bar-fill"
                  style={{ width: `${(svc.revenueYtd / maxMixRevenue) * 100}%` }}
                />
              </div>
              <div className="escala-mix-values">
                <strong>{brl.format(svc.revenueYtd)}</strong>
                <small>{number.format(svc.revenueSharePct)}%</small>
              </div>
            </div>
          ))}
        </div>
        <p className="metric-note">
          Fonte: CRM business types 2026 · LDC lidera volume e faturamento · ICV/EV em crescimento H2
        </p>
      </div>

      <h3 className="escala-section-title">Capacidade mensal por tamanho de núcleo</h3>
      <p className="metric-note">{unit.technicianNote}</p>

      <div className="table-wrap escala-capacity-table-wrap">
        <table className="escala-capacity-table">
          <thead>
            <tr>
              <th>Núcleo</th>
              <th>Equipe</th>
              <th>Fech./mês</th>
              <th>Faturamento/mês</th>
              <th>Visitas</th>
              <th>Reuniões</th>
              <th>Orçamentos</th>
              <th>Medidores</th>
              <th>Fixo/mês</th>
            </tr>
          </thead>
          <tbody>
            {unit.nucleusCapacity.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.label}</strong>
                </td>
                <td>
                  {row.sellers} vend. + {row.technicians} téc.
                </td>
                <td>
                  <strong>{number.format(row.closingsPerMonth)}</strong>
                </td>
                <td className="cell-revenue">
                  <strong>{brl.format(row.revenuePerMonth)}</strong>
                </td>
                <td>{row.visitsPerMonth}</td>
                <td>{row.meetingsPerMonth}</td>
                <td>{row.budgetsPerMonth}</td>
                <td>{row.medidoresStock}</td>
                <td>{brl.format(row.monthlyFixedCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="escala-capacity-chart">
        <h4>Faturamento mensal por núcleo</h4>
        <div className="escala-capacity-bars">
          {unit.nucleusCapacity.map((row) => (
            <div className="escala-capacity-bar-col" key={row.id}>
              <div
                className="escala-capacity-bar"
                style={{ height: `${(row.revenuePerMonth / maxNucleusRevenue) * 100}%` }}
              />
              <span className="escala-capacity-bar-label">{row.label}</span>
              <strong>{brl.format(row.revenuePerMonth)}</strong>
              <small>
                {row.sellers}v + {row.technicians}t
              </small>
            </div>
          ))}
        </div>
      </div>

      <div className="escala-demand-flow">
        <h4>Fluxo de demanda — 1 vendedor / mês (real jan–mai/26)</h4>
        <div className="escala-flow-steps">
          {historical ? (
            <>
              <div className="escala-flow-step">
                <span className="escala-flow-num">{historical.visitsPerMonth}</span>
                <span>Visitas</span>
              </div>
              <div className="escala-flow-arrow">→</div>
              <div className="escala-flow-step">
                <span className="escala-flow-num">{historical.meetingsPerMonth}</span>
                <span>Reuniões</span>
              </div>
              <div className="escala-flow-arrow">→</div>
              <div className="escala-flow-step">
                <span className="escala-flow-num">{number.format(historical.budgetsPerMonth)}</span>
                <span>Orçamentos</span>
              </div>
              <div className="escala-flow-arrow">→</div>
              <div className="escala-flow-step">
                <span className="escala-flow-num">{number.format(historical.closingsPerMonth)}</span>
                <span>Fechamentos</span>
              </div>
              <div className="escala-flow-arrow">→</div>
              <div className="escala-flow-step highlight">
                <span className="escala-flow-num">{brl.format(historical.revenuePerMonth)}</span>
                <span>Faturamento</span>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
