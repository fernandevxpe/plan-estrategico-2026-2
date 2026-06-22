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

type Props = {
  analysis: Analysis;
  generatedAt: string;
};

export function DashboardApp({ analysis, generatedAt }: Props) {
  const [scenario, setScenario] = useState<ScenarioName>(
    (analysis.planningSummary.defaultScenario as ScenarioName) ?? "Base recomendada"
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

      <ExecutiveSummary kpis={kpis} />

      <PerformanceAlerts alerts={analysis.deepAnalysis.performanceAlerts} />

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

      <GrowthGuidesSection guides={analysis.growthGuides} />

      <DeepAnalysisSection analysis={analysis} />

      <section className="page-zone" id="recordes">
        <IndicatorAnalysisSection analysis={analysis} />
      </section>

      <DashboardSections analysis={analysis} filters={filters} kpis={kpis} />
    </>
  );
}
