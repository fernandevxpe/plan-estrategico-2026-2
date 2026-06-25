"use client";

import { useState } from "react";
import type { Analysis, YearFilter } from "@/lib/analysis/types";
import { MixSections } from "@/components/mix/MixSections";
import { PlanningFilters as PlanningFiltersBar } from "@/components/planning/PlanningFilters";

type Props = {
  analysis: Analysis;
  generatedAt: string;
};

export function MixPage({ analysis, generatedAt }: Props) {
  const [year, setYear] = useState<YearFilter>("all");

  const filterBar = (
    <PlanningFiltersBar
      scenario={(analysis.planningSummary.defaultScenario as "Realista recomendado") ?? "Realista recomendado"}
      year={year}
      period="month"
      generatedAt={generatedAt}
      partialMonth={analysis.planningSummary.partialMonth}
      onScenarioChange={() => undefined}
      onYearChange={setYear}
      onPeriodChange={() => undefined}
      hideScenario
      hidePeriod
    />
  );

  return (
    <>
      {filterBar}

      <div className="page-header">
        <h1>Mix de vendas</h1>
        <p>
          Leitura financeira e operacional por produto: receita, quantidade de fechamentos,
          participação percentual de faturamento e de esforço.
        </p>
      </div>

      <MixSections analysis={analysis} year={year} />
    </>
  );
}
