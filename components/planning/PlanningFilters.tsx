"use client";

import type { PeriodFilter, ScenarioName, YearFilter } from "@/lib/analysis/types";

const SCENARIOS: ScenarioName[] = [
  "Conservador",
  "Ritmo atual",
  "Realista recomendado"
];

type Props = {
  scenario: ScenarioName;
  year: YearFilter;
  period: PeriodFilter;
  generatedAt: string;
  partialMonth: string;
  onScenarioChange: (value: ScenarioName) => void;
  onYearChange: (value: YearFilter) => void;
  onPeriodChange: (value: PeriodFilter) => void;
};

export function PlanningFilters({
  scenario,
  year,
  period,
  generatedAt,
  partialMonth,
  onScenarioChange,
  onYearChange,
  onPeriodChange
}: Props) {
  return (
    <div className="filter-bar" id="planejamento">
      <div className="filter-group">
        <label htmlFor="scenario">Cenário</label>
        <select
          id="scenario"
          value={scenario}
          onChange={(event) => onScenarioChange(event.target.value as ScenarioName)}
          className={`scenario-select scenario-${scenario.replace(/\s+/g, "-").toLowerCase()}`}
        >
          {SCENARIOS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <span className="filter-label">Ano</span>
        <div className="filter-toggle">
          {(["2025", "2026", "all"] as YearFilter[]).map((item) => (
            <button
              key={item}
              type="button"
              className={year === item ? "active" : ""}
              onClick={() => onYearChange(item)}
            >
              {item === "all" ? "Todos" : item}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <span className="filter-label">Agregação</span>
        <div className="filter-toggle">
          {(
            [
              ["month", "Mês"],
              ["quarter", "Trimestre"],
              ["semester", "Semestre"],
              ["year", "Ano"]
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={period === value ? "active" : ""}
              onClick={() => onPeriodChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-meta">
        <span>Dados de {generatedAt}</span>
        <span className="pill amber">{partialMonth} parcial</span>
      </div>
    </div>
  );
}
