"use client";

import { useMemo } from "react";
import type { Analysis, PlanningFilters, ScenarioName } from "@/lib/analysis/types";

/** Defaults fixos — a barra de filtros foi removida por não estar confiável. */
export function getDefaultPlanningFilters(analysis: Analysis): PlanningFilters {
  return {
    scenario:
      (analysis.planningSummary.defaultScenario as ScenarioName) ?? "Realista recomendado",
    year: "all",
    period: "month",
    selectedMonth: null
  };
}

export function usePlanningFilters(analysis: Analysis) {
  const filters = useMemo(() => getDefaultPlanningFilters(analysis), [analysis]);
  return { filters };
}
