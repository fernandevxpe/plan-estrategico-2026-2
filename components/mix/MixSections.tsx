"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  BarChart3,
  Layers3,
  LayoutGrid,
  Percent,
  Scale,
  Table2,
  TrendingUp,
  Workflow
} from "lucide-react";
import type { Analysis, YearFilter } from "@/lib/analysis/types";
import {
  getMixEffortInsights,
  getMixPeriodKeys,
  getMixPeriodSummary,
  getMixPeriodSummaries,
  getMixTimelineChartData,
  getMixTypeTotals,
  type MixGranularity
} from "@/lib/analysis/mix-metrics";
import { mixColors, StackedRevenueMixChart } from "@/components/charts";
import { brl, formatGrowth, number } from "@/lib/analysis/format";

type ViewMode = "table" | "compare" | "timeline";

type Props = {
  analysis: Analysis;
  year: YearFilter;
};

function shareLabel(value: number) {
  return `${number.format(value)}%`;
}

function gapLabel(value: number) {
  if (Math.abs(value) < 2) return "equilibrado";
  return value > 0 ? `+${number.format(value)} pp esforço` : `${number.format(value)} pp receita`;
}

export function MixSections({ analysis, year }: Props) {
  const mixRows = useMemo(() => {
    return analysis.businessTypeMonthly.filter((row) => {
      if (year !== "all" && !row.month.startsWith(year)) return false;
      return true;
    });
  }, [analysis.businessTypeMonthly, year]);

  const [granularity, setGranularity] = useState<MixGranularity>("month");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

  const typeTotals = useMemo(() => getMixTypeTotals(analysis.businessTypeMonthly, year), [analysis.businessTypeMonthly, year]);
  const allTypes = typeTotals.map((item) => item.type);
  const visibleTypes = selectedTypes.length ? selectedTypes : allTypes;

  const periodKeys = useMemo(
    () => getMixPeriodKeys(mixRows, granularity, year),
    [mixRows, granularity, year]
  );

  const activePeriodKey =
    selectedPeriodKey && periodKeys.includes(selectedPeriodKey)
      ? selectedPeriodKey
      : periodKeys.at(-1) ?? null;

  useEffect(() => {
    setSelectedPeriodKey(null);
  }, [granularity, year]);

  const periodSummary = useMemo(() => {
    if (!activePeriodKey) return null;
    return getMixPeriodSummary(mixRows, activePeriodKey, granularity, visibleTypes);
  }, [mixRows, activePeriodKey, granularity, visibleTypes]);

  const periodSummaries = useMemo(
    () => getMixPeriodSummaries(mixRows, granularity, year, visibleTypes),
    [mixRows, granularity, year, visibleTypes]
  );

  const effortInsights = useMemo(
    () => (periodSummary ? getMixEffortInsights(periodSummary) : []),
    [periodSummary]
  );

  const topTypesForChart = useMemo(() => {
    return typeTotals
      .filter((item) => visibleTypes.includes(item.type))
      .slice(0, 6)
      .map((item) => item.type);
  }, [typeTotals, visibleTypes]);

  const timelineChartData = useMemo(() => {
    return getMixTimelineChartData(periodSummaries, topTypesForChart).map((item) => ({
      month: String(item.key),
      label: String(item.label),
      totalRevenue: Number(item.totalRevenue),
      ...Object.fromEntries(
        topTypesForChart.map((type) => [type, Number(item[type] ?? 0)])
      )
    }));
  }, [periodSummaries, topTypesForChart]);

  const mixTypeMeta = topTypesForChart.map((type) => ({
    type,
    color: mixColors[Math.max(0, allTypes.indexOf(type)) % mixColors.length]
  }));

  function toggleType(type: string) {
    setSelectedTypes((current) => {
      const base = current.length ? current : allTypes;
      const next = base.includes(type) ? base.filter((item) => item !== type) : [...base, type];
      return next.length === allTypes.length ? [] : next;
    });
  }

  const granularityLabels: Record<MixGranularity, string> = {
    month: "Mensal",
    quarter: "Trimestral",
    semester: "Semestral",
    year: "Anual"
  };

  return (
    <>
      <section className="mix-toolbar">
        <div className="mix-toolbar-group">
          <span className="filter-label">Recorte temporal</span>
          <div className="mix-segmented">
            {(Object.keys(granularityLabels) as MixGranularity[]).map((item) => (
              <button
                key={item}
                type="button"
                className={granularity === item ? "active" : ""}
                onClick={() => setGranularity(item)}
              >
                {granularityLabels[item]}
              </button>
            ))}
          </div>
        </div>

        <div className="mix-toolbar-group">
          <span className="filter-label">Visualização</span>
          <div className="mix-segmented">
            <button type="button" className={viewMode === "table" ? "active" : ""} onClick={() => setViewMode("table")}>
              <Table2 size={14} /> Tabela
            </button>
            <button type="button" className={viewMode === "compare" ? "active" : ""} onClick={() => setViewMode("compare")}>
              <Scale size={14} /> Receita x esforço
            </button>
            <button type="button" className={viewMode === "timeline" ? "active" : ""} onClick={() => setViewMode("timeline")}>
              <TrendingUp size={14} /> Evolução
            </button>
          </div>
        </div>
      </section>

      <section className="mix-workbench mix-workbench-v2">
        <div className="card mix-control-panel">
          <div className="card-title">
            <div>
              <h2>Filtros do mix</h2>
              <span>{selectedTypes.length ? `${selectedTypes.length} produto(s)` : "Todos os produtos"}</span>
            </div>
          </div>

          <div className="mix-filter-group">
            <span className="filter-label">Produtos / tipos</span>
            <div className="mix-type-chips">
              <button
                type="button"
                className={`mix-chip ${selectedTypes.length === 0 ? "active" : ""}`}
                onClick={() => setSelectedTypes([])}
              >
                Todos
              </button>
              {typeTotals.map((item, index) => {
                const active = selectedTypes.length === 0 || selectedTypes.includes(item.type);
                return (
                  <button
                    type="button"
                    className={`mix-chip ${active ? "active" : ""}`}
                    key={item.type}
                    onClick={() => toggleType(item.type)}
                  >
                    <span style={{ background: mixColors[index % mixColors.length] }} />
                    {item.type}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mix-filter-group">
            <span className="filter-label">{granularityLabels[granularity]}</span>
            <div className="mix-month-chips">
              {periodKeys.map((key) => (
                <button
                  type="button"
                  className={key === activePeriodKey ? "active" : ""}
                  key={key}
                  onClick={() => setSelectedPeriodKey(key)}
                >
                  {getMixPeriodSummary(mixRows, key, granularity, visibleTypes).label}
                </button>
              ))}
            </div>
          </div>

          {periodSummary ? (
            <div className="mix-kpi-grid mix-kpi-grid-v2">
              <div className="mini">
                <span className="metric-label">Receita fechada</span>
                <strong>{brl.format(periodSummary.totalRevenue)}</strong>
                <small>{shareLabel(100)} do período selecionado</small>
              </div>
              <div className="mini">
                <span className="metric-label">Fechamentos (esforço)</span>
                <strong>{periodSummary.totalDeals}</strong>
                <small>Ticket médio {brl.format(periodSummary.averageTicket)}</small>
              </div>
              <div className="mini">
                <span className="metric-label">Produtos ativos</span>
                <strong>{periodSummary.activeProducts}</strong>
                <small>{periodSummary.label}</small>
              </div>
            </div>
          ) : null}
        </div>

        {viewMode === "timeline" ? (
          <div className="card chart-card mix-chart-card mix-panel-wide">
            <div className="card-title">
              <div>
                <h2>Receita por produto · {granularityLabels[granularity].toLowerCase()}</h2>
                <span>Clique em um período para detalhar abaixo</span>
              </div>
              <span className="pill green">{topTypesForChart.length} principais</span>
            </div>
            <div className="chart-box mix-chart-box">
              <StackedRevenueMixChart
                data={timelineChartData}
                types={mixTypeMeta}
                selectedMonth={activePeriodKey}
                onSelectMonth={setSelectedPeriodKey}
              />
            </div>
          </div>
        ) : null}

        {viewMode === "compare" && periodSummary ? (
          <div className="card mix-compare-panel mix-panel-wide">
            <div className="card-title">
              <div>
                <h2>Receita x esforço · {periodSummary.label}</h2>
                <span>% do faturamento vs % dos fechamentos — leitura de esforço operacional</span>
              </div>
              <Percent size={18} />
            </div>
            <div className="mix-dual-share-list">
              {periodSummary.products.map((item, index) => (
                <article className="mix-dual-share-row" key={item.type}>
                  <div className="mix-dual-share-head">
                    <strong>{item.type}</strong>
                    <span className={`pill ${Math.abs(item.effortGapPct) >= 8 ? "amber" : "green"}`}>
                      {gapLabel(item.effortGapPct)}
                    </span>
                  </div>
                  <div className="mix-dual-bars">
                    <div className="mix-dual-bar-block">
                      <span className="metric-label">Receita</span>
                      <div className="bar mix-share-bar">
                        <span
                          style={{
                            "--w": `${item.revenueSharePct}%`,
                            background: mixColors[allTypes.indexOf(item.type) % mixColors.length]
                          } as CSSProperties}
                        />
                      </div>
                      <small>{shareLabel(item.revenueSharePct)} · {brl.format(item.revenue)}</small>
                    </div>
                    <div className="mix-dual-bar-block">
                      <span className="metric-label">Fechamentos</span>
                      <div className="bar mix-share-bar mix-share-bar-muted">
                        <span
                          style={{
                            "--w": `${item.dealsSharePct}%`,
                            background: mixColors[allTypes.indexOf(item.type) % mixColors.length],
                            opacity: 0.72
                          } as CSSProperties}
                        />
                      </div>
                      <small>{shareLabel(item.dealsSharePct)} · {item.wonDeals} negócio(s)</small>
                    </div>
                  </div>
                  <p className="metric-note">
                    Ticket {brl.format(item.averageTicket)}
                    {index === 0 ? " · maior receita do período" : ""}
                  </p>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {viewMode === "table" && periodSummary ? (
          <div className="card mix-table-panel mix-panel-wide">
            <div className="card-title">
              <div>
                <h2>Ranking por produto · {periodSummary.label}</h2>
                <span>Volume financeiro (rateado), quantidade e participação relativa · múltiplas etiquetas contam em cada escopo com receita dividida igualmente</span>
              </div>
              <LayoutGrid size={18} />
            </div>
            <div className="table-wrap">
              <table className="mix-ranking-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Produto / tipo</th>
                    <th className="right">Fechamentos</th>
                    <th className="right">% esforço</th>
                    <th className="right">Receita</th>
                    <th className="right">% receita</th>
                    <th className="right">Ticket médio</th>
                    <th className="right">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {periodSummary.products.map((item, index) => (
                    <tr key={item.type}>
                      <td>{index + 1}</td>
                      <td>
                        <span
                          className="mix-type-dot"
                          style={{ background: mixColors[allTypes.indexOf(item.type) % mixColors.length] }}
                        />
                        <strong>{item.type}</strong>
                      </td>
                      <td className="right">{item.wonDeals}</td>
                      <td className="right">{shareLabel(item.dealsSharePct)}</td>
                      <td className="right">{brl.format(item.revenue)}</td>
                      <td className="right">{shareLabel(item.revenueSharePct)}</td>
                      <td className="right">{brl.format(item.averageTicket)}</td>
                      <td className="right">
                        <span className={Math.abs(item.effortGapPct) >= 8 ? "mix-gap-alert" : "muted"}>
                          {gapLabel(item.effortGapPct)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}><strong>Total do período</strong></td>
                    <td className="right"><strong>{periodSummary.totalDeals}</strong></td>
                    <td className="right"><strong>100%</strong></td>
                    <td className="right"><strong>{brl.format(periodSummary.totalRevenue)}</strong></td>
                    <td className="right"><strong>100%</strong></td>
                    <td className="right"><strong>{brl.format(periodSummary.averageTicket)}</strong></td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      {effortInsights.length ? (
        <section className="mix-insights-grid">
          {effortInsights.map((insight) => (
            <article className="card insight mix-effort-insight" key={`${insight.type}-${insight.product.type}`}>
              {insight.type === "high_effort" ? <Workflow size={22} /> : <Layers3 size={22} />}
              <div>
                <h3>{insight.type === "high_effort" ? "Mais esforço que receita" : "Mais receita que esforço"}</h3>
                <p>{insight.message}</p>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <section className="card mix-period-overview">
        <div className="card-title">
          <div>
            <h2>Visão consolidada · {granularityLabels[granularity].toLowerCase()}</h2>
            <span>Todos os períodos com totais, líder de receita e líder de esforço</span>
          </div>
          <BarChart3 size={18} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Período</th>
                <th className="right">Fechamentos</th>
                <th className="right">Receita</th>
                <th className="right">Ticket</th>
                <th>Líder receita</th>
                <th className="right">% receita</th>
                <th>Líder esforço</th>
                <th className="right">% esforço</th>
              </tr>
            </thead>
            <tbody>
              {periodSummaries.map((summary) => {
                const revenueLeader = summary.products[0] ?? null;
                const effortLeader = [...summary.products].sort((a, b) => b.dealsSharePct - a.dealsSharePct)[0] ?? null;
                const isActive = summary.key === activePeriodKey;
                return (
                  <tr
                    key={summary.key}
                    className={isActive ? "mix-period-active" : ""}
                    onClick={() => setSelectedPeriodKey(summary.key)}
                    style={{ cursor: "pointer" }}
                  >
                    <td><strong>{summary.label}</strong></td>
                    <td className="right">{summary.totalDeals}</td>
                    <td className="right">{brl.format(summary.totalRevenue)}</td>
                    <td className="right">{brl.format(summary.averageTicket)}</td>
                    <td>{revenueLeader?.type ?? "—"}</td>
                    <td className="right">{revenueLeader ? shareLabel(revenueLeader.revenueSharePct) : "—"}</td>
                    <td>{effortLeader?.type ?? "—"}</td>
                    <td className="right">{effortLeader ? shareLabel(effortLeader.dealsSharePct) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <details className="appendix-details compact-details">
        <summary>Detalhe mensal bruto por tipo principal</summary>
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
                <th className="right">Fech. MoM</th>
              </tr>
            </thead>
            <tbody>
              {mixRows.slice().sort((a, b) => b.month.localeCompare(a.month) || b.revenue - a.revenue).slice(0, 80).map((item) => (
                <tr key={`${item.month}-${item.type}`}>
                  <td><strong>{item.month}</strong></td>
                  <td>{item.type}</td>
                  <td className="right">{item.wonDeals}</td>
                  <td className="right">{brl.format(item.revenue)}</td>
                  <td className="right">{brl.format(item.averageTicket)}</td>
                  <td className="right">{formatGrowth(item.revenueMoMPct)}</td>
                  <td className="right">{formatGrowth(item.dealsMoMPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
