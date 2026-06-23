"use client";

import { useMemo } from "react";
import type { Analysis } from "@/lib/analysis/types";
import {
  getBridgeData,
  getMonthlyRows,
  getMonthDetail,
  getQuarterlySeries,
  getTimelineForScenario
} from "@/lib/analysis/metrics";
import { usePlanningFilters } from "@/components/planning/usePlanningFilters";
import { MonthlyMasterTable } from "@/components/planning/MonthlyMasterTable";
import { MonthDrillDown } from "@/components/planning/MonthDrillDown";
import {
  AnnualBridgeChart,
  QuarterlyChart,
  Timeline2026Chart
} from "@/components/planning/planning-charts";

type Props = {
  analysis: Analysis;
  generatedAt: string;
};

export function PlanningPage({ analysis, generatedAt }: Props) {
  const { filters, filterBar, selectedMonth, setSelectedMonth } = usePlanningFilters(
    analysis,
    generatedAt
  );
  const tableRows = useMemo(() => getMonthlyRows(analysis, filters), [analysis, filters]);
  const bridgeData = useMemo(() => getBridgeData(analysis, filters.scenario), [analysis, filters.scenario]);
  const quarterlyData = useMemo(() => getQuarterlySeries(analysis), [analysis]);
  const timelineData = useMemo(() => getTimelineForScenario(analysis, filters.scenario), [analysis, filters.scenario]);
  const monthDetail = useMemo(
    () => (selectedMonth ? getMonthDetail(analysis, selectedMonth) : null),
    [analysis, selectedMonth]
  );

  return (
    <>
      {filterBar}

      <div className="page-header">
        <h1>Planejamento e projeção</h1>
        <p>Cenários, visão anual e linha do tempo 2026 com base no ritmo real e sazonalidade.</p>
        <span className="pill green scenario-pill">{filters.scenario}</span>
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
        <MonthlyMasterTable rows={tableRows} selectedMonth={selectedMonth} onSelectMonth={setSelectedMonth} />
        {monthDetail ? <MonthDrillDown detail={monthDetail} onClose={() => setSelectedMonth(null)} /> : null}
      </div>
    </>
  );
}
