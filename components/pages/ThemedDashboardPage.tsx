"use client";

import { useMemo } from "react";
import type { Analysis } from "@/lib/analysis/types";
import { getExecutiveKpis } from "@/lib/analysis/metrics";
import { DashboardSections } from "@/components/dashboard/DashboardSections";
import { usePlanningFilters } from "@/components/planning/usePlanningFilters";

type Props = {
  analysis: Analysis;
  generatedAt: string;
  view: "comercial" | "mix" | "pos-venda";
  title: string;
  description: string;
};

export function ThemedDashboardPage({ analysis, generatedAt, view, title, description }: Props) {
  const { filters, filterBar } = usePlanningFilters(analysis, generatedAt);
  const kpis = useMemo(() => getExecutiveKpis(analysis, filters.scenario), [analysis, filters.scenario]);

  return (
    <>
      {filterBar}
      <div className="page-header">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <DashboardSections analysis={analysis} filters={filters} kpis={kpis} view={view} />
    </>
  );
}
