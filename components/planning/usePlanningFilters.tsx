"use client";

import { useMemo, useState } from "react";
import type { Analysis, PeriodFilter, PlanningFilters, ScenarioName, YearFilter } from "@/lib/analysis/types";
import { PlanningFilters as PlanningFiltersBar } from "@/components/planning/PlanningFilters";

export function usePlanningFilters(analysis: Analysis, generatedAt: string) {
  const [scenario, setScenario] = useState<ScenarioName>(
    (analysis.planningSummary.defaultScenario as ScenarioName) ?? "Realista recomendado"
  );
  const [year, setYear] = useState<YearFilter>("all");
  const [period, setPeriod] = useState<PeriodFilter>("month");
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const filters: PlanningFilters = useMemo(
    () => ({ scenario, year, period, selectedMonth }),
    [scenario, year, period, selectedMonth]
  );

  const filterBar = (
    <PlanningFiltersBar
      scenario={scenario}
      year={year}
      period={period}
      generatedAt={generatedAt}
      partialMonth={analysis.planningSummary.partialMonth}
      onScenarioChange={setScenario}
      onYearChange={setYear}
      onPeriodChange={setPeriod}
    />
  );

  return {
    scenario,
    year,
    period,
    selectedMonth,
    setSelectedMonth,
    filters,
    filterBar
  };
}
