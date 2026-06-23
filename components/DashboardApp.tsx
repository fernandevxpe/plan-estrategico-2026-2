"use client";

import { useMemo, useState } from "react";
import type { Analysis, PeriodFilter, PlanningFilters as Filters, ScenarioName, YearFilter } from "@/lib/analysis/types";
import {
  getBridgeData,
  getExecutiveKpis,
  getMonthDetail,
  getMonthlyRows,
  getQuarterlySeries,
  getTimelineForScenario
} from "@/lib/analysis/metrics";
import { PlanningFilters } from "@/components/planning/PlanningFilters";
import { ExecutiveSummary } from "@/components/planning/ExecutiveSummary";
import { MonthlyMasterTable } from "@/components/planning/MonthlyMasterTable";
import { MonthDrillDown } from "@/components/planning/MonthDrillDown";
import {
  AnnualBridgeChart,
  QuarterlyChart,
  Timeline2026Chart
} from "@/components/planning/planning-charts";
import { DashboardSections } from "@/components/dashboard/DashboardSections";
import { IndicatorAnalysisSection } from "@/components/dashboard/IndicatorAnalysisSection";
import { PerformanceAlerts } from "@/components/dashboard/PerformanceAlerts";
import { DeepAnalysisSection } from "@/components/dashboard/DeepAnalysisSection";
import { GrowthGuidesSection } from "@/components/guides/GrowthGuidesSection";
import { AreasPlanningSection } from "@/components/areas/AreasPlanningSection";
import type { AreasDashboard } from "@/lib/areas/types";
import { brl, formatGrowth, monthLabel } from "@/lib/analysis/format";

type Props = {
  analysis: Analysis;
  areasDashboard: AreasDashboard;
  generatedAt: string;
};

export function DashboardApp({ analysis, areasDashboard, generatedAt }: Props) {
  const [scenario, setScenario] = useState<ScenarioName>(
    (analysis.planningSummary.defaultScenario as ScenarioName) ?? "Realista recomendado"
  );
  const [year, setYear] = useState<YearFilter>("all");
  const [period, setPeriod] = useState<PeriodFilter>("month");
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const filters: Filters = useMemo(
    () => ({ scenario, year, period, selectedMonth }),
    [scenario, year, period, selectedMonth]
  );

  const kpis = useMemo(() => getExecutiveKpis(analysis, scenario), [analysis, scenario]);
  const tableRows = useMemo(() => getMonthlyRows(analysis, filters), [analysis, filters]);
  const bridgeData = useMemo(() => getBridgeData(analysis, scenario), [analysis, scenario]);
  const quarterlyData = useMemo(() => getQuarterlySeries(analysis), [analysis]);
  const timelineData = useMemo(() => getTimelineForScenario(analysis, scenario), [analysis, scenario]);
  const monthDetail = useMemo(
    () => (selectedMonth ? getMonthDetail(analysis, selectedMonth) : null),
    [analysis, selectedMonth]
  );
  const latestHighAlert = useMemo(
    () => [...analysis.deepAnalysis.performanceAlerts].reverse().find((alert) => alert.severity === "high"),
    [analysis.deepAnalysis.performanceAlerts]
  );
  const mainInsight = analysis.planningSummary.insights[0];

  return (
    <>
      <PlanningFilters
        scenario={scenario}
        year={year}
        period={period}
        generatedAt={generatedAt}
        partialMonth={analysis.planningSummary.partialMonth}
        onScenarioChange={setScenario}
        onYearChange={setYear}
        onPeriodChange={setPeriod}
      />

      <section className="executive-brief" aria-label="Resumo executivo de decisão">
        <article className="brief-primary">
          <span className="brief-kicker">Forecast recomendado</span>
          <strong>{brl.format(kpis.projected2026Total)}</strong>
          <p>
            {kpis.scenarioName} · H2 {brl.format(kpis.projected2026H2)} ·{" "}
            {formatGrowth(kpis.growthVs2025Pct)} vs 2025
          </p>
        </article>
        <article className="brief-card">
          <span className="brief-kicker">Risco imediato</span>
          <strong>{latestHighAlert ? monthLabel(latestHighAlert.month) : "Sem alerta alto"}</strong>
          <p>{latestHighAlert?.message ?? "Nenhuma queda múltipla crítica no recorte atual."}</p>
        </article>
        <article className="brief-card">
          <span className="brief-kicker">Alavanca</span>
          <strong>{mainInsight?.title ?? "Foco no pipeline"}</strong>
          <p>{mainInsight?.body ?? "Priorizar conversão e destravamento da base aberta."}</p>
        </article>
      </section>

      <ExecutiveSummary kpis={kpis} />

      <section className="page-zone" id="planejamento">
        <div className="section-title">
          <div>
            <h2>Planejamento e projeção</h2>
            <p>Cenários, visão anual e linha do tempo 2026 com base no ritmo real e sazonalidade.</p>
          </div>
          <span className="pill green scenario-pill">{scenario}</span>
        </div>

        <section className="dashboard-grid planning-charts-grid">
          <div className="card chart-card">
            <div className="card-title">
              <div>
                <h2>Ponte anual</h2>
                <span>2025 → YTD 2026 → restante projetado → total</span>
              </div>
            </div>
            <div className="chart-box">
              <AnnualBridgeChart data={bridgeData} />
            </div>
          </div>

          <div className="card chart-card">
            <div className="card-title">
              <div>
                <h2>Trimestres 2025 x 2026</h2>
                <span>Realizado e projeção por trimestre</span>
              </div>
            </div>
            <div className="chart-box">
              <QuarterlyChart data={quarterlyData} />
            </div>
          </div>
        </section>

        <section className="dashboard-grid">
          <div className="card chart-card span-2">
            <div className="card-title">
              <div>
                <h2>Linha do tempo 2026</h2>
                <span>Realizado, parcial e projetado (jul–dez)</span>
              </div>
            </div>
            <div className="chart-box chart-box-tall">
              <Timeline2026Chart data={timelineData} />
            </div>
          </div>
        </section>

        <div className="section-title subsection-title">
          <div>
            <h3>Análise mês a mês</h3>
            <p>Clique em um mês para drill-down por tipo e fechamentos.</p>
          </div>
        </div>

        <div className={`planning-table-layout ${monthDetail ? "with-drilldown" : ""}`}>
          <MonthlyMasterTable
            rows={tableRows}
            selectedMonth={selectedMonth}
            onSelectMonth={setSelectedMonth}
          />
          {monthDetail ? <MonthDrillDown detail={monthDetail} onClose={() => setSelectedMonth(null)} /> : null}
        </div>
      </section>

      <DashboardSections analysis={analysis} filters={filters} kpis={kpis} />

      <GrowthGuidesSection guides={analysis.growthGuides} />

      <AreasPlanningSection dashboard={areasDashboard} />

      <section className="page-zone appendix-zone" id="apendice">
        <div className="section-title">
          <div>
            <h2>Apêndice investigativo</h2>
            <p>Alertas, recordes e investigação profunda ficam compactados aqui para não diluir a decisão executiva.</p>
          </div>
        </div>

        <details className="appendix-details" open>
          <summary>Alertas operacionais e qualidade</summary>
          <PerformanceAlerts alerts={analysis.deepAnalysis.performanceAlerts} />
          {analysis.dataQualityAlerts?.length ? (
            <div className="alerts-grid data-quality-grid">
              {analysis.dataQualityAlerts.map((alert) => (
                <article className={`card alert-card alert-${alert.severity}`} key={alert.id}>
                  <div className="alert-card-head">
                    <strong>{alert.title}</strong>
                    <span className={`pill ${alert.severity === "high" ? "amber" : "blue"}`}>{alert.count}</span>
                  </div>
                  <p>{alert.message}</p>
                </article>
              ))}
            </div>
          ) : null}
        </details>

        <details className="appendix-details">
          <summary>Recordes e picos comerciais</summary>
          <IndicatorAnalysisSection analysis={analysis} />
        </details>

        <details className="appendix-details">
          <summary>Investigação profunda do funil</summary>
          <DeepAnalysisSection analysis={analysis} />
        </details>
      </section>
    </>
  );
}
