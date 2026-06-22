"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  BriefcaseBusiness,
  Database,
  LineChart,
  Target,
  TrendingDown,
  TrendingUp
} from "lucide-react";
import {
  ProjectionChart,
  RevenueChart,
  ServiceMixChart,
  TicketChart,
  YearComparisonChart
} from "@/components/charts";
import type { Analysis, ExecutiveKpis, PlanningFilters } from "@/lib/analysis/types";
import {
  filterBusinessTypes,
  filterFunnel,
  filterWonDeals
} from "@/lib/analysis/metrics";
import { brl, formatGrowth, monthLabel, number, serviceClass } from "@/lib/analysis/format";

type Props = {
  analysis: Analysis;
  filters: PlanningFilters;
  kpis: ExecutiveKpis;
};

export function DashboardSections({ analysis, filters, kpis }: Props) {
  const months2026 = analysis.monthly.filter((item) => item.month.startsWith("2026"));
  const currentMonth = months2026[months2026.length - 1];
  const funnelRows = filterFunnel(analysis, filters);
  const businessTypes = filterBusinessTypes(analysis, filters).slice(0, 40);
  const wonDealsFiltered = [...filterWonDeals(analysis, filters)].sort((a, b) => b.value - a.value);
  const topWonDeals = wonDealsFiltered.slice(0, 12);
  const postSales2026 = analysis.postSalesMonthly.filter((item) => {
    if (filters.year === "2025") return item.month.startsWith("2025");
    if (filters.year === "2026") return item.month.startsWith("2026");
    return true;
  });
  const repeatRevenue = analysis.repeatSalesByAccount.reduce((sum, item) => sum + item.repeatRevenue, 0);
  const cnpjCoveragePct = analysis.cnpjCoverage.organizations
    ? (analysis.cnpjCoverage.organizationsWithCnpj / analysis.cnpjCoverage.organizations) * 100
    : 0;
  const maxServiceRevenue = Math.max(...analysis.serviceSummary.map((item) => item.revenue), 1);
  const activeScenario = analysis.projection2026H2.scenarios.find((item) => item.name === filters.scenario);
  const growthRows =
    filters.year === "2025"
      ? analysis.growthComparison
      : filters.year === "2026"
        ? analysis.growthComparison.slice(0, 6)
        : analysis.growthComparison;

  const chartData = months2026.map((item) => ({
    ...item,
    label: monthLabel(item.month),
    revenueK: Math.round(item.wonRevenue / 1000)
  }));

  const completeMonths = months2026.filter((item) => item.month >= "2026-01" && item.month <= "2026-05");
  const h1Revenue = completeMonths.reduce((sum, item) => sum + item.wonRevenue, 0);
  const h1Won = completeMonths.reduce((sum, item) => sum + item.wonDeals, 0);
  const avgRevenue = h1Revenue / Math.max(1, completeMonths.length);
  const avgWon = h1Won / Math.max(1, completeMonths.length);

  return (
    <>
      <section className="hero-band">
        <div className="headline">
          <p className="eyebrow">
            <Activity size={16} /> Análise operacional
          </p>
          <h1>Funil, serviços, recorrência e fechamentos.</h1>
          <p>
            Seções abaixo respeitam os filtros de ano
            {filters.selectedMonth ? ` e o mês ${filters.selectedMonth}` : ""}.
          </p>
        </div>

        <aside className="status-panel" id="qualidade">
          <div className="status-item">
            <div className="status-icon"><Database size={18} /></div>
            <div>
              <strong>{analysis.totals.pipedriveDealsAll.toLocaleString("pt-BR")} negócios no Pipedrive</strong>
              <span>{analysis.totals.analysisDeals.toLocaleString("pt-BR")} entraram no recorte 2025-2026.</span>
            </div>
          </div>
          <div className="status-item">
            <div className="status-icon"><BriefcaseBusiness size={18} /></div>
            <div>
              <strong>{analysis.totals.clickupTasksAll.toLocaleString("pt-BR")} tarefas do ClickUp</strong>
              <span>{analysis.clickupProjectCandidates.length.toLocaleString("pt-BR")} candidatas de produção.</span>
            </div>
          </div>
          <div className="status-item">
            <div className="status-icon"><AlertTriangle size={18} /></div>
            <div>
              <strong>Junho é parcial</strong>
              <span>Projeção usa janeiro a maio como meses completos de 2026.</span>
            </div>
          </div>
        </aside>
      </section>

      <section className="kpi-grid kpi-grid-secondary">
        <KpiCard title="Receita jan-mai" value={brl.format(h1Revenue)} note={`Média mensal ${brl.format(avgRevenue)}`} icon={<TrendingUp size={18} />} />
        <KpiCard title="Projetos fechados" value={h1Won.toLocaleString("pt-BR")} note={`Média de ${number.format(avgWon)} fechamentos/mês`} icon={<Target size={18} />} />
        <KpiCard title="Crescimento vs 2025" value={formatGrowth(analysis.projection2026H2.basis.yoyGrowthPct)} note="Receita jan-mai/2026 contra jan-mai/2025" icon={<LineChart size={18} />} />
        <KpiCard title="Cenário ativo H2" value={brl.format(kpis.projected2026H2)} note={filters.scenario} icon={<TrendingUp size={18} />} />
      </section>

      <section className="section-title" id="funil">
        <div>
          <h2>Funil comercial mensal</h2>
          <p>Novos negócios, conversão da coorte, ganhos e base aberta.</p>
        </div>
        <span className="pill green">{funnelRows.at(-1)?.openBaseDealsEndOfMonth ?? 0} negócios abertos</span>
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mês</th>
              <th className="right">Novos</th>
              <th className="right">Valor criado</th>
              <th className="right">Conv. coorte</th>
              <th className="right">Ganhos</th>
              <th className="right">Receita ganha</th>
              <th className="right">Perdidos</th>
              <th className="right">Base aberta</th>
              <th className="right">Valor aberto</th>
            </tr>
          </thead>
          <tbody>
            {funnelRows.map((item) => (
              <tr key={item.month}>
                <td><strong>{item.month}</strong></td>
                <td className="right">{item.createdDeals}</td>
                <td className="right">{brl.format(item.createdValue)}</td>
                <td className="right">{formatGrowth(item.cohortConversionPct)}</td>
                <td className="right">{item.wonDeals}</td>
                <td className="right">{brl.format(item.wonValue)}</td>
                <td className="right">{item.lostDeals}</td>
                <td className="right">{item.openBaseDealsEndOfMonth}</td>
                <td className="right">{brl.format(item.openBaseValueEndOfMonth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="dashboard-grid">
        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Receita, novos negócios e fechamentos</h2>
              <span>2026 mês a mês</span>
            </div>
            <span className="pill">Junho parcial</span>
          </div>
          <div className="chart-box">
            <RevenueChart data={chartData} />
          </div>
        </div>

        <div className="card chart-card" id="servicos">
          <div className="card-title">
            <div>
              <h2>Mix de serviços</h2>
              <span>Receita ganha 2025-2026</span>
            </div>
            <BarChart3 size={18} />
          </div>
          <div className="chart-box">
            <ServiceMixChart data={analysis.serviceSummary} />
          </div>
        </div>
      </section>

      <section className="dashboard-grid" id="crescimento">
        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>2025 x 2026 por mês</h2>
              <span>Receita ganha realizada em cada mês</span>
            </div>
            <span className="pill green">{formatGrowth(analysis.projection2026H2.basis.yoyGrowthPct)} jan-mai</span>
          </div>
          <div className="chart-box">
            <YearComparisonChart data={growthRows} />
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Base histórica usada</h2>
              <span>O que 2025 muda na projeção</span>
            </div>
          </div>
          <div className="mini-grid">
            <div className="mini">
              <span className="metric-label">Jan-mai 2025</span>
              <strong>{brl.format(analysis.projection2026H2.basis.h1LikeRevenue2025)}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Jan-mai 2026</span>
              <strong>{brl.format(analysis.projection2026H2.basis.h1LikeRevenue2026)}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Jul-dez 2025</span>
              <strong>{brl.format(analysis.projection2026H2.basis.h2Revenue2025)}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Fechamentos jul-dez/25</span>
              <strong>{analysis.projection2026H2.basis.h2WonDeals2025}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="dashboard-grid" id="projecoes">
        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Projeção mensal jul-dez/2026</h2>
              <span>Ritmo atual, sazonalidade 2025 e base ponderada</span>
            </div>
          </div>
          <div className="chart-box">
            <ProjectionChart data={analysis.projection2026H2.months} />
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Cenários 2026.2</h2>
              <span>Receita e fechamentos estimados</span>
            </div>
          </div>
          <div className="scenario-list">
            {analysis.projection2026H2.scenarios.map((scenario) => (
              <div
                className={`scenario ${scenario.name === filters.scenario ? "scenario-active" : ""}`}
                key={scenario.name}
              >
                <div>
                  <strong>{scenario.name}</strong>
                  <span>{scenario.premise}</span>
                </div>
                <div className="scenario-values">
                  <strong>{brl.format(scenario.revenue)}</strong>
                  <span>{Math.round(scenario.wonDeals)} fechamentos</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-title" id="tipos">
        <div>
          <h2>Tipos de negócios fechados por mês</h2>
          <p>Etiquetas comerciais do Pipedrive com crescimento MoM e YoY.</p>
        </div>
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mês</th>
              <th>Tipo</th>
              <th className="right">Fechados</th>
              <th className="right">Receita</th>
              <th className="right">Ticket</th>
              <th className="right">Receita MoM</th>
              <th className="right">Receita YoY</th>
            </tr>
          </thead>
          <tbody>
            {businessTypes.map((item) => (
              <tr key={`${item.month}-${item.type}`}>
                <td><strong>{item.month}</strong></td>
                <td>{item.type}</td>
                <td className="right">{item.wonDeals}</td>
                <td className="right">{brl.format(item.revenue)}</td>
                <td className="right">{brl.format(item.averageTicket)}</td>
                <td className="right">{formatGrowth(item.revenueMoMPct)}</td>
                <td className="right">{formatGrowth(item.revenueYoYPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="dashboard-grid" id="pos-venda">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Pós-venda e recorrência</h2>
              <span>Negócios ganhos com CNPJ/conta repetida</span>
            </div>
          </div>
          <div className="mini-grid">
            <div className="mini">
              <span className="metric-label">CNPJs recorrentes</span>
              <strong>{analysis.postSalesByCnpj.length}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Contas recorrentes</span>
              <strong>{analysis.repeatSalesByAccount.length}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Receita repetida</span>
              <strong>{brl.format(repeatRevenue)}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Cobertura CNPJ</span>
              <strong>{number.format(cnpjCoveragePct)}%</strong>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Recorrência mensal</h2>
              <span>Participação dos fechamentos repetidos</span>
            </div>
          </div>
          {postSales2026.map((item) => (
            <div className="service-row" key={item.month}>
              <div className="service-header">
                <strong>{item.month}</strong>
                <span className="pill green">{formatGrowth(item.repeatShareByAccountPct)}</span>
              </div>
              <div className="mini-grid">
                <div className="mini">
                  <span className="metric-label">Repetidos</span>
                  <strong>{item.repeatDealsByAccount}</strong>
                </div>
                <div className="mini">
                  <span className="metric-label">Receita repetida</span>
                  <strong>{brl.format(item.repeatRevenueByAccount)}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Ticket médio por mês</h2>
              <span>Qualidade econômica dos fechamentos</span>
            </div>
          </div>
          <div className="chart-box">
            <TicketChart data={chartData} />
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Serviços fechados</h2>
              <span>Volume, receita e ticket</span>
            </div>
          </div>
          {analysis.serviceSummary.map((service) => (
            <div className="service-row" key={service.service}>
              <div className="service-header">
                <strong>{service.service}</strong>
                <span className={`pill ${serviceClass(service.service)}`}>{service.wonDeals} ganhos</span>
              </div>
              <div className="bar" style={{ "--w": `${(service.revenue / maxServiceRevenue) * 100}%` } as React.CSSProperties}>
                <span />
              </div>
              <div className="mini-grid">
                <div className="mini">
                  <span className="metric-label">Receita</span>
                  <strong>{brl.format(service.revenue)}</strong>
                </div>
                <div className="mini">
                  <span className="metric-label">Ticket médio</span>
                  <strong>{brl.format(service.averageTicket)}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="insights">
        {analysis.planningSummary.insights.map((insight) => (
          <div className="card insight" key={insight.title}>
            {insight.kind === "decline" ? <TrendingDown size={24} /> : insight.kind === "seasonal" ? <Target size={24} /> : <Database size={24} />}
            <div>
              <h3>{insight.title}</h3>
              <p>{insight.body}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="section-title">
        <div>
          <h2>Taxas de crescimento detalhadas</h2>
          <p>MoM contra mês anterior; YoY contra o mesmo mês de 2025.</p>
        </div>
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mês</th>
              <th className="right">Receita 2025</th>
              <th className="right">Receita 2026</th>
              <th className="right">YoY receita</th>
              <th className="right">MoM 2026</th>
              <th className="right">Novos YoY</th>
              <th className="right">Fechados YoY</th>
            </tr>
          </thead>
          <tbody>
            {growthRows.map((item) => (
              <tr key={item.monthNumber}>
                <td><strong>{item.label}</strong></td>
                <td className="right">{item.revenue2025 == null ? "—" : brl.format(item.revenue2025)}</td>
                <td className="right">{item.revenue2026 == null ? "—" : brl.format(item.revenue2026)}</td>
                <td className="right">{formatGrowth(item.revenueYoYPct)}</td>
                <td className="right">{formatGrowth(item.revenueMoM2026Pct)}</td>
                <td className="right">{formatGrowth(item.createdYoYPct)}</td>
                <td className="right">{formatGrowth(item.wonDealsYoYPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="section-title">
        <div>
          <h2>Projeção mensal do segundo semestre</h2>
          <p>Cenário ativo: {filters.scenario}</p>
        </div>
        <span className="pill green">{brl.format(activeScenario?.revenue ?? kpis.projected2026H2)}</span>
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mês</th>
              <th className="right">Realizado 2025</th>
              <th className="right">Ritmo atual</th>
              <th className="right">Sazonal 2025 ajustado</th>
              <th className="right">Base ponderada</th>
              <th className="right">Fechamentos</th>
            </tr>
          </thead>
          <tbody>
            {analysis.projection2026H2.months.map((item) => (
              <tr key={item.month}>
                <td><strong>{item.month}</strong></td>
                <td className="right">{brl.format(item.baselineRevenue2025)}</td>
                <td className="right">{brl.format(item.runRateRevenue)}</td>
                <td className="right">{brl.format(item.seasonalRevenue)}</td>
                <td className="right"><strong>{brl.format(item.projectedRevenue)}</strong></td>
                <td className="right">{Math.round(item.projectedWonDeals)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="section-title" id="fechamentos">
        <div>
          <h2>Fechamentos filtrados</h2>
          <p>Ordenado por valor ganho conforme filtros ativos.</p>
        </div>
        <span className="pill">{wonDealsFiltered.length} negócios</span>
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mês</th>
              <th>Negócio</th>
              <th>Cliente</th>
              <th>Serviço</th>
              <th className="right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {topWonDeals.map((deal) => (
              <tr key={deal.id}>
                <td>{deal.wonMonth}</td>
                <td><strong>{deal.title}</strong></td>
                <td className="muted">{deal.organization ?? "Não informado"}</td>
                <td><span className={`pill ${serviceClass(deal.service)}`}>{deal.service}</span></td>
                <td className="right"><strong>{brl.format(deal.value)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="section-title">
        <div>
          <h2>2026 mês a mês</h2>
          <p>Base completa para leitura de crescimento mensal.</p>
        </div>
        <span className="pill">{currentMonth?.month ?? "2026"} em andamento</span>
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mês</th>
              <th className="right">Novos negócios</th>
              <th className="right">Fechados</th>
              <th className="right">Receita</th>
              <th className="right">Ticket médio</th>
              <th className="right">Crescimento</th>
            </tr>
          </thead>
          <tbody>
            {months2026.map((item) => (
              <tr key={item.month}>
                <td><strong>{item.month}</strong></td>
                <td className="right">{item.createdDeals}</td>
                <td className="right">{item.wonDeals}</td>
                <td className="right">{brl.format(item.wonRevenue)}</td>
                <td className="right">{brl.format(item.averageTicket)}</td>
                <td className="right">{formatGrowth(item.revenueGrowthPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function KpiCard({
  title,
  value,
  note,
  icon
}: {
  title: string;
  value: string;
  note: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="card kpi-card">
      <div className="card-title">
        <span>{title}</span>
        {icon}
      </div>
      <p className="metric">{value}</p>
      <p className="metric-note">{note}</p>
    </article>
  );
}
