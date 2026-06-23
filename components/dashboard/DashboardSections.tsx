"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BriefcaseBusiness,
  Database,
  Repeat2,
  Target,
  TrendingUp
} from "lucide-react";
import {
  mixColors,
  RevenueChart,
  RevenueShareMixChart,
  StackedRevenueMixChart,
  YearComparisonChart
} from "@/components/charts";
import type { Analysis, BusinessTypeMonthly, ExecutiveKpis, PlanningFilters } from "@/lib/analysis/types";
import { filterBusinessTypes, filterFunnel, filterWonDeals } from "@/lib/analysis/metrics";
import {
  brl,
  formatGrowth,
  monthLabel,
  NEW_DEALS_CONVERSION_SHORT,
  number,
  serviceClass
} from "@/lib/analysis/format";

type Props = {
  analysis: Analysis;
  filters: PlanningFilters;
  kpis: ExecutiveKpis;
};

function weightedAverage(rows: { value: number; weight: number }[]) {
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  return totalWeight ? rows.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight : null;
}

function topTypes(rows: BusinessTypeMonthly[]) {
  const map = new Map<string, { type: string; revenue: number; wonDeals: number }>();
  for (const row of rows) {
    const current = map.get(row.type) ?? { type: row.type, revenue: 0, wonDeals: 0 };
    current.revenue += row.revenue;
    current.wonDeals += row.wonDeals;
    map.set(row.type, current);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6);
}

function typeTotals(rows: BusinessTypeMonthly[]) {
  const map = new Map<string, { type: string; revenue: number; wonDeals: number; months: number }>();
  for (const row of rows) {
    const current = map.get(row.type) ?? { type: row.type, revenue: 0, wonDeals: 0, months: 0 };
    current.revenue += row.revenue;
    current.wonDeals += row.wonDeals;
    current.months += row.revenue > 0 || row.wonDeals > 0 ? 1 : 0;
    map.set(row.type, current);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

function revenueShare(revenue: number, total: number) {
  if (!total) return "0%";
  return `${number.format((revenue / total) * 100)}%`;
}

export function DashboardSections({ analysis, filters, kpis }: Props) {
  const funnelRows = filterFunnel(analysis, filters);
  const businessTypes = filterBusinessTypes(analysis, filters);
  const mixRows = useMemo(() => {
    return analysis.businessTypeMonthly.filter((row) => {
      if (filters.year !== "all" && !row.month.startsWith(filters.year)) return false;
      return true;
    });
  }, [analysis.businessTypeMonthly, filters.year]);
  const [selectedMixMonth, setSelectedMixMonth] = useState<string | null>(filters.selectedMonth);
  const [selectedMixTypes, setSelectedMixTypes] = useState<string[]>([]);
  const wonDealsFiltered = [...filterWonDeals(analysis, filters)].sort((a, b) => b.value - a.value);
  const topWonDeals = wonDealsFiltered.slice(0, 12);
  const latestFunnel = funnelRows.at(-1);
  const matureRows = funnelRows.filter((row) => row.isMatureCohort);
  const matureConversion = weightedAverage(
    matureRows
      .filter((row) => row.matureConversionPct != null)
      .map((row) => ({ value: row.matureConversionPct ?? 0, weight: row.createdDeals }))
  );
  const closedConversion = weightedAverage(
    funnelRows
      .filter((row) => row.closedConversionPct != null)
      .map((row) => ({ value: row.closedConversionPct ?? 0, weight: row.closedDealsFromCohort ?? 0 }))
  );
  const repeatRevenue = analysis.repeatSalesByAccount.reduce((sum, item) => sum + item.repeatRevenue, 0);
  const cnpjCoveragePct = analysis.cnpjCoverage.organizations
    ? (analysis.cnpjCoverage.organizationsWithCnpj / analysis.cnpjCoverage.organizations) * 100
    : 0;
  const growthRows =
    filters.year === "2025"
      ? analysis.growthComparison
      : filters.year === "2026"
        ? analysis.growthComparison.slice(0, 6)
        : analysis.growthComparison;
  const months2026 = analysis.monthly.filter((item) => item.month.startsWith("2026"));
  const chartData = months2026.map((item) => ({
    ...item,
    label: monthLabel(item.month),
    revenueK: Math.round(item.wonRevenue / 1000)
  }));
  const typeLeaders = topTypes(businessTypes);
  const postSalesConfidence = analysis.postSalesConfidence;

  useEffect(() => {
    if (filters.selectedMonth) setSelectedMixMonth(filters.selectedMonth);
  }, [filters.selectedMonth]);

  const mixTypeTotals = useMemo(() => typeTotals(mixRows), [mixRows]);
  const allMixTypes = mixTypeTotals.map((item) => item.type);
  const visibleMixTypes = selectedMixTypes.length ? selectedMixTypes : allMixTypes;
  const mixTypeMeta = visibleMixTypes.map((type) => ({
    type,
    color: mixColors[Math.max(0, allMixTypes.indexOf(type)) % mixColors.length]
  }));
  const mixMonths = [...new Set(mixRows.map((row) => row.month))].sort();
  const selectedMonthForMix = selectedMixMonth && mixMonths.includes(selectedMixMonth)
    ? selectedMixMonth
    : mixMonths.at(-1) ?? null;
  const mixChartData = mixMonths.map((month) => {
    const rows = mixRows.filter((row) => row.month === month);
    const item: { month: string; label: string; totalRevenue: number; [key: string]: string | number } = {
      month,
      label: monthLabel(month),
      totalRevenue: 0
    };
    for (const type of visibleMixTypes) item[type] = 0;
    for (const row of rows) {
      if (!visibleMixTypes.includes(row.type)) continue;
      item[row.type] = Number(item[row.type] ?? 0) + row.revenue;
      item.totalRevenue += row.revenue;
    }
    return item;
  });
  const selectedMonthMixRows = mixRows
    .filter((row) => row.month === selectedMonthForMix && visibleMixTypes.includes(row.type))
    .sort((a, b) => b.revenue - a.revenue);
  const selectedMonthRevenue = selectedMonthMixRows.reduce((sum, row) => sum + row.revenue, 0);
  const selectedMonthDeals = selectedMonthMixRows.reduce((sum, row) => sum + row.wonDeals, 0);
  const topSelectedMonthType = selectedMonthMixRows[0] ?? null;
  const filteredMixTotals = typeTotals(mixRows.filter((row) => visibleMixTypes.includes(row.type)));
  const mixTotalRevenue = filteredMixTotals.reduce((sum, row) => sum + row.revenue, 0);
  const mixTotalDeals = filteredMixTotals.reduce((sum, row) => sum + row.wonDeals, 0);

  function toggleMixType(type: string) {
    setSelectedMixTypes((current) => {
      const base = current.length ? current : allMixTypes;
      const next = base.includes(type) ? base.filter((item) => item !== type) : [...base, type];
      return next.length === allMixTypes.length ? [] : next;
    });
  }

  return (
    <>
      <section className="hero-band" id="comercial">
        <div className="headline">
          <p className="eyebrow">
            <Activity size={16} /> Motor comercial
          </p>
          <h1>O que sustenta a projeção realista.</h1>
          <p>
            A leitura principal mostra pipeline bruto, conversão madura, mix de vendas sem duplicar receita
            e recorrência separada por nível de confiança.
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
              <strong>Pipeline aberto é bruto</strong>
              <span>Negócios antigos ou frios aparecem na base, mas não entram como forecast automático.</span>
            </div>
          </div>
        </aside>
      </section>

      <section className="kpi-grid kpi-grid-secondary">
        <KpiCard title="Base aberta" value={`${latestFunnel?.openBaseDealsEndOfMonth ?? 0}`} note={brl.format(latestFunnel?.openBaseValueEndOfMonth ?? 0)} icon={<Target size={18} />} />
        <KpiCard title="Conversão madura" value={formatGrowth(matureConversion)} note={`Coortes com ${latestFunnel?.matureCohortMinAgeDays ?? 45}+ dias`} icon={<TrendingUp size={18} />} />
        <KpiCard title="Conversão fechados" value={formatGrowth(closedConversion)} note="Ganhos / (ganhos + perdidos)" icon={<BarChart3 size={18} />} />
        <KpiCard title="Forecast H2 realista" value={brl.format(kpis.projected2026H2)} note={filters.scenario} icon={<TrendingUp size={18} />} />
      </section>

      <section className="dashboard-grid">
        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Receita, novos negócios e fechamentos</h2>
              <span>2026 mês a mês · junho parcial</span>
            </div>
          </div>
          <div className="chart-box">
            <RevenueChart data={chartData} />
          </div>
        </div>

        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>2025 x 2026</h2>
              <span>Comparação anual por mês</span>
            </div>
            <span className="pill green">{formatGrowth(analysis.projection2026H2.basis.yoyGrowthPct)} jan-mai</span>
          </div>
          <div className="chart-box">
            <YearComparisonChart data={growthRows} />
          </div>
        </div>
      </section>

      <details className="appendix-details compact-details" open>
        <summary>Detalhe do motor comercial</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mês</th>
                <th className="right">Novos</th>
                <th className="right">Valor criado</th>
                <th className="right">{NEW_DEALS_CONVERSION_SHORT}</th>
                <th className="right">Conv. madura</th>
                <th className="right">Conv. fechados</th>
                <th className="right">Ganhos</th>
                <th className="right">Receita ganha</th>
                <th className="right">Base aberta</th>
              </tr>
            </thead>
            <tbody>
              {funnelRows.map((item) => (
                <tr key={item.month}>
                  <td><strong>{item.month}</strong></td>
                  <td className="right">{item.createdDeals}</td>
                  <td className="right">{brl.format(item.createdValue)}</td>
                  <td className="right">{formatGrowth(item.cohortConversionPct)}</td>
                  <td className="right">{item.isMatureCohort ? formatGrowth(item.matureConversionPct ?? null) : "Coorte nova"}</td>
                  <td className="right">{formatGrowth(item.closedConversionPct ?? null)}</td>
                  <td className="right">{item.wonDeals}</td>
                  <td className="right">{brl.format(item.wonValue)}</td>
                  <td className="right">{item.openBaseDealsEndOfMonth}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <section className="section-title" id="mix">
        <div>
          <h2>Mix de vendas</h2>
          <p>Tipo principal por negócio, com faturamento mensal, participação por serviço e filtros visuais.</p>
        </div>
      </section>

      <section className="insights mix-summary">
        {(selectedMonthMixRows.length ? selectedMonthMixRows.slice(0, 6) : typeLeaders).map((item) => (
          <div className="card insight" key={item.type}>
            <BarChart3 size={24} />
            <div>
              <h3>{item.type}</h3>
              <p>
                {brl.format(item.revenue)} · {item.wonDeals} fechamento(s) ·{" "}
                {selectedMonthForMix ? `${revenueShare(item.revenue, selectedMonthRevenue)} do mês` : `ticket ${brl.format(item.revenue / Math.max(1, item.wonDeals))}`}
              </p>
            </div>
          </div>
        ))}
      </section>

      <section className="mix-workbench">
        <div className="card mix-control-panel">
          <div className="card-title">
            <div>
              <h2>Filtros do mix</h2>
              <span>{selectedMixTypes.length ? `${selectedMixTypes.length} serviço(s) selecionado(s)` : "Todos os serviços"}</span>
            </div>
          </div>

          <div className="mix-filter-group">
            <span className="filter-label">Serviços</span>
            <div className="mix-type-chips">
              <button
                type="button"
                className={`mix-chip ${selectedMixTypes.length === 0 ? "active" : ""}`}
                onClick={() => setSelectedMixTypes([])}
              >
                Todos
              </button>
              {mixTypeTotals.map((item, index) => {
                const active = selectedMixTypes.length === 0 || selectedMixTypes.includes(item.type);
                return (
                  <button
                    type="button"
                    className={`mix-chip ${active ? "active" : ""}`}
                    key={item.type}
                    onClick={() => toggleMixType(item.type)}
                  >
                    <span style={{ background: mixColors[index % mixColors.length] }} />
                    {item.type}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mix-filter-group">
            <span className="filter-label">Mês em foco</span>
            <div className="mix-month-chips">
              {mixMonths.map((month) => (
                <button
                  type="button"
                  className={month === selectedMonthForMix ? "active" : ""}
                  key={month}
                  onClick={() => setSelectedMixMonth(month)}
                >
                  {monthLabel(month)}
                </button>
              ))}
            </div>
          </div>

          <div className="mix-kpi-grid">
            <div className="mini">
              <span className="metric-label">Receita filtrada</span>
              <strong>{brl.format(mixTotalRevenue)}</strong>
              <small>{mixTotalDeals} fechamentos no período</small>
            </div>
            <div className="mini">
              <span className="metric-label">Mês selecionado</span>
              <strong>{selectedMonthForMix ? monthLabel(selectedMonthForMix) : "n/a"}</strong>
              <small>{brl.format(selectedMonthRevenue)} · {selectedMonthDeals} fechamentos</small>
            </div>
            <div className="mini">
              <span className="metric-label">Líder do mês</span>
              <strong>{topSelectedMonthType ? revenueShare(topSelectedMonthType.revenue, selectedMonthRevenue) : "n/a"}</strong>
              <small>{topSelectedMonthType?.type ?? "Sem fechamentos no filtro"}</small>
            </div>
          </div>
        </div>

        <div className="card chart-card mix-chart-card">
          <div className="card-title">
            <div>
              <h2>Receita fechada por serviço</h2>
              <span>Barras empilhadas por mês · clique no gráfico ou nos meses para focar</span>
            </div>
            <span className="pill green">{visibleMixTypes.length} tipos</span>
          </div>
          <div className="chart-box mix-chart-box">
            <StackedRevenueMixChart
              data={mixChartData}
              types={mixTypeMeta}
              selectedMonth={selectedMonthForMix}
              onSelectMonth={setSelectedMixMonth}
            />
          </div>
        </div>

        <div className="card chart-card mix-chart-card">
          <div className="card-title">
            <div>
              <h2>% da receita por mês</h2>
              <span>Participação percentual dos serviços no faturamento fechado</span>
            </div>
          </div>
          <div className="chart-box mix-chart-box">
            <RevenueShareMixChart data={mixChartData} types={mixTypeMeta} onSelectMonth={setSelectedMixMonth} />
          </div>
        </div>

        <div className="card mix-month-panel">
          <div className="card-title">
            <div>
              <h2>{selectedMonthForMix ? `Fechados em ${monthLabel(selectedMonthForMix)}` : "Fechados do mês"}</h2>
              <span>Receita, participação, quantidade e ticket por tipo</span>
            </div>
          </div>
          <div className="mix-service-list">
            {selectedMonthMixRows.map((item, index) => (
              <div className="mix-service-row" key={`${item.month}-${item.type}`}>
                <div className="mix-service-head">
                  <strong>{item.type}</strong>
                  <span>{revenueShare(item.revenue, selectedMonthRevenue)}</span>
                </div>
                <div className="bar mix-share-bar">
                  <span
                    style={{
                      "--w": `${selectedMonthRevenue ? (item.revenue / selectedMonthRevenue) * 100 : 0}%`,
                      background: mixColors[allMixTypes.indexOf(item.type) % mixColors.length]
                    } as CSSProperties}
                  />
                </div>
                <p className="metric-note">
                  {brl.format(item.revenue)} · {item.wonDeals} fechamento(s) · ticket {brl.format(item.averageTicket)}
                  {index === 0 ? " · maior fatia do mês" : ""}
                </p>
              </div>
            ))}
            {!selectedMonthMixRows.length ? (
              <p className="metric-note">Não há fechamentos para o mês e filtro selecionados.</p>
            ) : null}
          </div>
        </div>
      </section>

      <details className="appendix-details compact-details">
        <summary>Detalhe mensal por tipo principal</summary>
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
              {businessTypes.slice(0, 60).map((item) => (
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
      </details>

      <section className="dashboard-grid" id="pos-venda">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Pós-venda por confiança</h2>
              <span>CNPJ exato separado de aproximações por conta</span>
            </div>
            <Repeat2 size={18} />
          </div>
          <div className="mini-grid">
            <div className="mini">
              <span className="metric-label">CNPJ exato</span>
              <strong>{postSalesConfidence?.cnpjExact.accounts ?? analysis.postSalesByCnpj.length}</strong>
              <small>{brl.format(postSalesConfidence?.cnpjExact.repeatRevenue ?? 0)}</small>
            </div>
            <div className="mini">
              <span className="metric-label">Conta normalizada</span>
              <strong>{postSalesConfidence?.accountName.accounts ?? analysis.repeatSalesByAccount.length}</strong>
              <small>{brl.format(postSalesConfidence?.accountName.repeatRevenue ?? repeatRevenue)}</small>
            </div>
            <div className="mini">
              <span className="metric-label">Multi-serviço no mês</span>
              <strong>{postSalesConfidence?.sameMonthMultiService.accounts ?? 0}</strong>
              <small>{brl.format(postSalesConfidence?.sameMonthMultiService.revenue ?? 0)}</small>
            </div>
            <div className="mini">
              <span className="metric-label">Cobertura CNPJ</span>
              <strong>{number.format(cnpjCoveragePct)}%</strong>
              <small>{analysis.cnpjCoverage.organizationsWithCnpj}/{analysis.cnpjCoverage.organizations}</small>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Principais contas recorrentes</h2>
              <span>Ordenado por receita repetida</span>
            </div>
          </div>
          {analysis.repeatSalesByAccount.slice(0, 5).map((item) => (
            <div className="service-row" key={item.key}>
              <div className="service-header">
                <strong>{item.organization ?? "Não informado"}</strong>
                <span className={`pill ${item.cnpj ? "green" : "amber"}`}>{item.cnpj ? "CNPJ" : "Conta"}</span>
              </div>
              <p className="metric-note">
                {item.wonDeals} fechamentos · repetição {brl.format(item.repeatRevenue)} · {item.firstWonMonth} a {item.lastWonMonth}
              </p>
            </div>
          ))}
        </div>
      </section>

      <details className="appendix-details compact-details">
        <summary>Fechamentos e recorrência detalhados</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mês</th>
                <th>Negócio</th>
                <th>Cliente</th>
                <th>Tipo principal</th>
                <th className="right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {topWonDeals.map((deal) => (
                <tr key={deal.id}>
                  <td>{deal.wonMonth}</td>
                  <td><strong>{deal.title}</strong></td>
                  <td className="muted">{deal.organization ?? "Não informado"}</td>
                  <td><span className={`pill ${serviceClass(deal.service)}`}>{deal.primaryBusinessType ?? deal.service}</span></td>
                  <td className="right"><strong>{brl.format(deal.value)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
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
