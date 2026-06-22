"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Circle,
  Target,
  TrendingUp,
  Users,
  Wrench
} from "lucide-react";
import type { GrowthGuide } from "@/lib/analysis/types";
import { brl, formatGrowth, monthLabel, NEW_DEALS_CONVERSION_SHORT } from "@/lib/analysis/format";
import {
  buildGuideChartData,
  GuideCommercialChart,
  GuideContractsChart,
  GuideProjectsByTypeChart,
  GuideRevenueChart,
  GuideTrafficChart
} from "@/components/guides/growth-guide-charts";

type Props = {
  guide: GrowthGuide;
};

const priorityLabel = {
  critical: "Crítico",
  high: "Alta",
  medium: "Média"
} as const;

const priorityClass = {
  critical: "amber",
  high: "blue",
  medium: "green"
} as const;

const capacityClass = {
  ok: "green",
  attention: "amber",
  critical: "amber"
} as const;

export function ProjectionGuidePanel({ guide }: Props) {
  const { kpis, operationalCapacity: ops, trafficInvestment: traffic } = guide;
  const topTypes = guide.typeMixAnnual.slice(0, 5);
  const chartData = useMemo(() => buildGuideChartData(guide.fullYearPlan), [guide.fullYearPlan]);
  const topTypeNames = useMemo(() => guide.typeMix.slice(0, 5).map((row) => row.type), [guide.typeMix]);

  return (
    <div className="guide-panel">
      <div className="guide-hero">
        <div>
          <p className="eyebrow">
            <Target size={16} /> {guide.name}
          </p>
          <h3>{guide.tagline}</h3>
          <p className="guide-premise">{guide.premise}</p>
          <p className="guide-recurrence-note">{guide.recurrenceNote}</p>
        </div>
        <div className="guide-targets guide-targets-3">
          <div className="guide-target-card highlight">
            <span>Meta H1 (jan–jun)</span>
            <strong>{brl.format(guide.h1Target)}</strong>
            <small>
              Projeção auto: {brl.format(guide.baseline.h1Projected)}
              {guide.h1GapVsProjected !== 0 ? ` · Ajuste ${brl.format(guide.h1GapVsProjected)}` : ""}
            </small>
          </div>
          <div className="guide-target-card">
            <span>Meta H2 (jul–dez)</span>
            <strong>{brl.format(guide.h2Target)}</strong>
            <small>
              {guide.h2MultiplierVs2025.toFixed(1)}× jul-dez/2025
              {guide.h2GapVsBase > 0 ? ` · Gap +${brl.format(guide.h2GapVsBase)}` : " · Cenário Realista"}
            </small>
          </div>
          <div className="guide-target-card">
            <span>Meta anual 2026</span>
            <strong>{brl.format(guide.annualTarget)}</strong>
            <small>
              {Math.round(guide.fullYearPlan.reduce((s, r) => s + r.wonDealsTarget, 0))} contratos · Tráfego{" "}
              {brl.format(traffic.annualTotal)}
            </small>
          </div>
        </div>
      </div>

      <section className="section-title subsection-title">
        <div>
          <h3>Metas mensais — gráficos do cenário {guide.id}</h3>
          <p>Todos os indicadores que precisam ser alcançados mês a mês em 2026.</p>
        </div>
        <span className="pill green">H1 azul · H2 verde</span>
      </section>

      <section className="dashboard-grid planning-charts-grid">
        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Vendas (receita)</h2>
              <span>Meta mensal + acumulado no ano</span>
            </div>
            <BarChart3 size={18} />
          </div>
          <div className="chart-box">
            <GuideRevenueChart data={chartData} />
          </div>
        </div>

        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Contratos e prospecção</h2>
              <span>Fechamentos, novos negócios e carga/projetista</span>
            </div>
          </div>
          <div className="chart-box">
            <GuideContractsChart data={chartData} />
          </div>
        </div>
      </section>

      <section className="dashboard-grid planning-charts-grid">
        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Comercial (2 pessoas)</h2>
              <span>Fechamentos por vendedor e {NEW_DEALS_CONVERSION_SHORT.toLowerCase()}</span>
            </div>
            <Users size={18} />
          </div>
          <div className="chart-box">
            <GuideCommercialChart data={chartData} />
          </div>
        </div>

        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Tráfego pago</h2>
              <span>Investimento mensal e CPA por contrato</span>
            </div>
          </div>
          <div className="chart-box">
            <GuideTrafficChart data={chartData} />
          </div>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="card chart-card span-2">
          <div className="card-title">
            <div>
              <h2>Projetos por tipo de serviço</h2>
              <span>Trabalhos a entregar mês a mês (top 5 tipos)</span>
            </div>
            <Wrench size={18} />
          </div>
          <div className="chart-box chart-box-tall">
            <GuideProjectsByTypeChart data={guide.fullYearPlan} topTypes={topTypeNames} />
          </div>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="card guide-capacity-card">
          <div className="card-title">
            <div>
              <h2>Comercial — 2 pessoas</h2>
              <span>Resultado por vendedor e quando contratar</span>
            </div>
            <Users size={18} />
          </div>
          <div className="mini-grid">
            <div className="mini">
              <span className="metric-label">Fechamentos/pessoa H1</span>
              <strong>{ops.commercialTeam.perPersonH1.monthlyClosings.toFixed(1)}/mês</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Fechamentos/pessoa H2</span>
              <strong>{ops.commercialTeam.perPersonH2.monthlyClosings.toFixed(1)}/mês</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Receita/pessoa H2</span>
              <strong>{brl.format(ops.commercialTeam.perPersonH2.monthlyRevenue)}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Novos neg./pessoa H2</span>
              <strong>{ops.commercialTeam.perPersonH2.monthlyNewDeals.toFixed(0)}/mês</strong>
            </div>
          </div>
          <p className="metric-note">
            Equipe atual: <strong>{ops.commercialTeam.currentHeadcount} comerciais</strong> · Recomendado:{" "}
            <strong>{ops.commercialTeam.recommendedHeadcount}</strong>
            {ops.commercialTeam.recommendedHeadcount > ops.commercialTeam.currentHeadcount ? (
              <span className={`pill ${capacityClass.attention}`}> Avaliar contratação</span>
            ) : (
              <span className="pill green"> Capacidade OK</span>
            )}
          </p>
          <p className="metric-note">{ops.commercialTeam.hireTrigger}</p>
        </div>

        <div className="card guide-capacity-card">
          <div className="card-title">
            <div>
              <h2>Operação — 5 projetistas</h2>
              <span>Trabalhos a entregar (3 → 5 + automação)</span>
            </div>
            <Wrench size={18} />
          </div>
          <div className="mini-grid">
            <div className="mini">
              <span className="metric-label">Com 3 projetistas (hist.)</span>
              <strong>{ops.deliveryTeam.historicalProjectsPerPerson.toFixed(1)} proj./mês</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Com 5 projetistas (meta H2)</span>
              <strong>{ops.deliveryTeam.h2ProjectsPerPerson.toFixed(1)} proj./mês</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Contratos H2 total</span>
              <strong>{Math.round(guide.monthlyTargets.reduce((s, r) => s + r.wonDealsTarget, 0))}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Contratos ano total</span>
              <strong>{Math.round(guide.fullYearPlan.reduce((s, r) => s + r.wonDealsTarget, 0))}</strong>
            </div>
          </div>
          <p className="metric-note">
            <span className={`pill ${capacityClass[ops.deliveryTeam.capacityStatus]}`}>
              {ops.deliveryTeam.capacityStatus === "ok"
                ? "Capacidade OK"
                : ops.deliveryTeam.capacityStatus === "attention"
                  ? "Atenção"
                  : "Crítico"}
            </span>{" "}
            {ops.deliveryTeam.capacityNote}
          </p>
          <p className="metric-note">{ops.deliveryTeam.automationNote}</p>
        </div>
      </section>

      <section className="section-title subsection-title">
        <div>
          <h3>Investimento em tráfego</h3>
          <p>{traffic.h1ScheduleNote ?? "Jan–mar R$ 2.000/mês · Abr–jun R$ 2.500/mês · H2 proporcional ao cenário."}</p>
        </div>
      </section>

      <div className="traffic-h1-schedule">
        {traffic.monthly.map((row) => (
          <div
            className={`traffic-month-chip ${row.semester === "H2" ? "h2" : ""} ${row.semester === "H1" && row.month === "2026-06" ? "total" : ""}`}
            key={row.month}
          >
            <span>
              {row.label}
              {row.semester === "H2" ? " H2" : ""}
            </span>
            <strong>{brl.format(row.adSpend)}/mês</strong>
          </div>
        ))}
      </div>

      <div className="guide-kpi-grid">
        <div className="guide-kpi-card">
          <span className="metric-label">Tráfego H1</span>
          <strong>{brl.format(traffic.h1Total)}</strong>
          <small>6 × mensal: 2k + 2k + 2k + 2,5k + 2,5k + 2,5k</small>
        </div>
        <div className="guide-kpi-card">
          <span className="metric-label">Tráfego H2</span>
          <strong>{brl.format(traffic.h2Total)}</strong>
          <small>{traffic.note}</small>
        </div>
        <div className="guide-kpi-card">
          <span className="metric-label">Investimento anual</span>
          <strong>{brl.format(traffic.annualTotal)}</strong>
        </div>
        <div className="guide-kpi-card">
          <span className="metric-label">CPA médio (tráfego)</span>
          <strong>
            {traffic.averageCostPerClosing ? brl.format(traffic.averageCostPerClosing) : "n/a"}
          </strong>
          <small>Investimento ÷ contratos projetados</small>
        </div>
      </div>

      <section className="section-title subsection-title">
        <div>
          <h3>Tabela mestra — indicadores mensais</h3>
          <p>Receita, contratos, tráfego, comercial, operação e conversão.</p>
        </div>
      </section>

      <div className="table-wrap table-scroll">
        <table className="guide-master-table">
          <thead>
            <tr>
              <th>Mês</th>
              <th className="right">Receita</th>
              <th className="right">Acumulado</th>
              <th className="right">Contratos</th>
              <th className="right">Novos neg.</th>
              <th className="right">{NEW_DEALS_CONVERSION_SHORT}</th>
              <th className="right">Ticket</th>
              <th className="right">Tráfego</th>
              <th className="right">CPA</th>
              <th className="right">Fech./com.</th>
              <th className="right">Novos/com.</th>
              <th className="right">Proj./projet.</th>
            </tr>
          </thead>
          <tbody>
            {guide.fullYearPlan.map((row) => (
              <tr key={row.month} className={row.month <= "2026-06" ? "row-h1" : "row-h2"}>
                <td>
                  <strong>{monthLabel(row.month)}</strong>
                  <span className={`pill ${row.month <= "2026-06" ? "green" : "blue"} tiny`}>
                    {row.month <= "2026-06" ? "H1" : "H2"}
                  </span>
                </td>
                <td className="right">{brl.format(row.revenueTarget)}</td>
                <td className="right">{brl.format(row.cumulativeRevenue)}</td>
                <td className="right">{Math.round(row.wonDealsTarget)}</td>
                <td className="right">{Math.round(row.createdDealsTarget)}</td>
                <td className="right">{formatGrowth(row.conversionTargetPct)}</td>
                <td className="right">{brl.format(row.averageTicketTarget)}</td>
                <td className="right">{brl.format(row.adSpend)}</td>
                <td className="right">{row.costPerClosing ? brl.format(row.costPerClosing) : "—"}</td>
                <td className="right">{row.perCommercial.closings.toFixed(1)}</td>
                <td className="right">{row.perCommercial.newDeals.toFixed(0)}</td>
                <td className="right">{row.perProjectista.activeProjects.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Total / média</strong></td>
              <td className="right"><strong>{brl.format(guide.annualTarget)}</strong></td>
              <td className="right">—</td>
              <td className="right">
                <strong>{Math.round(guide.fullYearPlan.reduce((s, r) => s + r.wonDealsTarget, 0))}</strong>
              </td>
              <td className="right">
                <strong>{Math.round(guide.fullYearPlan.reduce((s, r) => s + r.createdDealsTarget, 0))}</strong>
              </td>
              <td className="right"><strong>{formatGrowth(kpis.h2AverageConversionPct)}</strong></td>
              <td className="right"><strong>{brl.format(kpis.h2AverageTicket)}</strong></td>
              <td className="right"><strong>{brl.format(traffic.annualTotal)}</strong></td>
              <td className="right">
                <strong>{traffic.averageCostPerClosing ? brl.format(traffic.averageCostPerClosing) : "—"}</strong>
              </td>
              <td className="right"><strong>{ops.commercialTeam.perPersonH2.monthlyClosings.toFixed(1)}</strong></td>
              <td className="right"><strong>{ops.commercialTeam.perPersonH2.monthlyNewDeals.toFixed(0)}</strong></td>
              <td className="right"><strong>{ops.deliveryTeam.h2ProjectsPerPerson.toFixed(1)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <section className="section-title subsection-title">
        <div>
          <h3>Tipos de projeto — volume anual e no H2</h3>
          <p>Mix proporcional ao histórico jan–mai/2026{guide.id === "3x" ? ", escalado pelo Realista" : ""}.</p>
        </div>
      </section>

      <div className="table-wrap compact">
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th className="right">Share</th>
              <th className="right">Contratos/ano</th>
              <th className="right">Contratos H2</th>
              <th className="right">Receita H2</th>
              <th className="right">Ticket</th>
            </tr>
          </thead>
          <tbody>
            {topTypes.map((row) => {
              const h2 = guide.typeMix.find((item) => item.type === row.type);
              return (
                <tr key={row.type}>
                  <td>{row.type}</td>
                  <td className="right">{formatGrowth(row.revenueSharePct)}</td>
                  <td className="right">{Math.ceil(row.wonDealsTarget)}</td>
                  <td className="right">{h2 ? Math.ceil(h2.wonDealsTarget) : "—"}</td>
                  <td className="right">{h2 ? brl.format(h2.revenueTarget) : "—"}</td>
                  <td className="right">{brl.format(row.averageTicket)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="guide-kpi-grid">
        <KpiCompare
          label="Receita/mês H2"
          current={kpis.currentH1.averageRevenue}
          target={kpis.h2AverageMonthlyRevenue}
          uplift={kpis.uplift.revenuePct}
          format="currency"
        />
        <KpiCompare
          label="Fechamentos/mês"
          current={kpis.currentH1.averageWonDeals}
          target={kpis.h2AverageWonDeals}
          uplift={kpis.uplift.wonDealsPct}
        />
        <KpiCompare
          label="Ticket médio"
          current={kpis.currentH1.averageTicket}
          target={kpis.h2AverageTicket}
          uplift={kpis.uplift.ticketPct}
          format="currency"
        />
        <KpiCompare
          label={NEW_DEALS_CONVERSION_SHORT}
          current={kpis.currentH1.averageConversionPct}
          target={kpis.h2AverageConversionPct}
          uplift={kpis.uplift.conversionPts}
          format="percent"
          isPoints
        />
      </section>

      <section className="section-title subsection-title">
        <div>
          <h3>Plano de ação por pilar</h3>
        </div>
      </section>

      <div className="guide-pillars">
        {guide.pillars.map((pillar) => (
          <article className="card guide-pillar" key={pillar.id}>
            <div className="guide-pillar-head">
              <div>
                <h4>{pillar.title}</h4>
                <span>{pillar.subtitle}</span>
              </div>
            </div>
            <ul className="guide-actions">
              {pillar.actions.map((action) => (
                <li className="guide-action" key={action.title}>
                  <Circle size={14} className="guide-action-icon" />
                  <div>
                    <div className="guide-action-head">
                      <strong>{action.title}</strong>
                      <span className={`pill ${priorityClass[action.priority]}`}>
                        {priorityLabel[action.priority]}
                      </span>
                    </div>
                    <p>{action.detail}</p>
                    {action.metric ? (
                      <div className="guide-action-meta">
                        <span>{action.metric}</span>
                        <strong>{action.target}</strong>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <section className="dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Marcos H2</h2>
              <span>H1 R$ 1M + acumulado do semestre</span>
            </div>
            <TrendingUp size={18} />
          </div>
          <div className="guide-milestones">
            {guide.milestones.map((item) => (
              <div className="guide-milestone" key={item.month}>
                <div>
                  <strong>{monthLabel(item.month)}</strong>
                  <span>{item.checkpoint}</span>
                </div>
                <strong>{brl.format(item.cumulativeTarget)}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Riscos e mitigação</h2>
            </div>
            <AlertTriangle size={18} />
          </div>
          <div className="guide-risks">
            {guide.risks.map((risk) => (
              <div className="guide-risk" key={risk.title}>
                <strong>{risk.title}</strong>
                <p>{risk.mitigation}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="guide-footer-note">
        <CheckCircle2 size={16} />
        <p>
          Meta consolidada: <strong>{brl.format(guide.h1Target)}</strong> no H1 +{" "}
          <strong>{brl.format(guide.h2Target)}</strong> no H2 ={" "}
          <strong>{brl.format(guide.annualTarget)}</strong> ·{" "}
          {Math.round(guide.fullYearPlan.reduce((s, r) => s + r.wonDealsTarget, 0))} contratos · Tráfego{" "}
          {brl.format(traffic.annualTotal)} · Recorrência à parte.
        </p>
      </div>
    </div>
  );
}

function KpiCompare({
  label,
  current,
  target,
  uplift,
  format,
  isPoints
}: {
  label: string;
  current: number;
  target: number;
  uplift: number;
  format?: "currency" | "percent";
  isPoints?: boolean;
}) {
  const formatValue = (value: number) => {
    if (format === "currency") return brl.format(value);
    if (format === "percent") return formatGrowth(value);
    return value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  };

  const upliftLabel = isPoints
    ? `${uplift >= 0 ? "+" : ""}${uplift.toFixed(1)} p.p.`
    : formatGrowth(uplift);

  return (
    <div className="guide-kpi-card">
      <span className="metric-label">{label}</span>
      <div className="guide-kpi-values">
        <div>
          <small>H1 (jan–mai)</small>
          <strong>{formatValue(current)}</strong>
        </div>
        <div>
          <small>Meta H2</small>
          <strong>{formatValue(target)}</strong>
        </div>
      </div>
      <span className={`pill ${uplift >= 0 ? "green" : "amber"}`}>{upliftLabel}</span>
    </div>
  );
}
