import type {
  Analysis,
  BridgeItem,
  ExecutiveKpis,
  GoalPlan,
  MonthDetail,
  Planning2026,
  PlanningFilters,
  QuarterlySeriesItem,
  ScenarioName,
  TableRow,
  Timeline2026Item,
  YearFilter
} from "./types";
import { monthLabel, quarterLabel, semesterLabel } from "./format";

export type GoalStatus = "acima" | "no_alvo" | "abaixo" | "em_risco";

export function goalStatus(attainmentPct: number | null): GoalStatus {
  if (attainmentPct == null) return "no_alvo";
  if (attainmentPct >= 100) return "acima";
  if (attainmentPct >= 90) return "no_alvo";
  if (attainmentPct >= 70) return "abaixo";
  return "em_risco";
}

const GOAL_DISPLAY_ORDER = ["global", "consultoria", "obras", "potencial", "quarter", "reuniao"] as const;

export function getPlanning(analysis: Analysis): Planning2026 | null {
  return analysis.planning2026 ?? null;
}

/** Metas na ordem de exibição preferida: consolidada primeiro, apoio depois. */
export function getOrderedGoals(planning: Planning2026): GoalPlan[] {
  const byKey = planning.highlights;
  const ordered: GoalPlan[] = [];
  const seen = new Set<string>();
  for (const key of GOAL_DISPLAY_ORDER) {
    const goal = byKey[key];
    if (goal && !seen.has(goal.id)) {
      ordered.push(goal);
      seen.add(goal.id);
    }
  }
  for (const goal of planning.goals) {
    if (!seen.has(goal.id)) {
      ordered.push(goal);
      seen.add(goal.id);
    }
  }
  return ordered;
}

/** Só os intervalos já iniciados (realizado disponível) para gráficos meta x realizado. */
export function goalIntervalsWithProgress(goal: GoalPlan, currentMonth: string) {
  return goal.intervals.map((interval) => ({
    ...interval,
    isFuture: (interval.monthKey ?? "0000-00") > currentMonth,
    isCurrent: interval.monthKey === currentMonth
  }));
}

function getScenarioProjection(analysis: Analysis, scenario: ScenarioName) {
  return (
    analysis.planningSummary.yearProjectionByScenario.find((item) => item.scenario === scenario) ??
    analysis.planningSummary.yearProjectionByScenario.find(
      (item) => item.scenario === analysis.planningSummary.defaultScenario
    )!
  );
}

export function getExecutiveKpis(analysis: Analysis, scenario: ScenarioName): ExecutiveKpis {
  const { planningSummary } = analysis;
  const projection = getScenarioProjection(analysis, scenario);

  return {
    revenue2025: planningSummary.annual["2025"].revenue,
    wonDeals2025: planningSummary.annual["2025"].wonDeals,
    revenue2026Ytd: planningSummary.annual["2026Ytd"].revenue,
    wonDeals2026Ytd: planningSummary.annual["2026Ytd"].wonDeals,
    projected2026H1: projection.h1Projected,
    projected2026H2: projection.h2Projected,
    projected2026Total: projection.totalProjected,
    growthVs2025Pct: planningSummary.annual["2025"].revenue
      ? ((projection.totalProjected - planningSummary.annual["2025"].revenue) /
          planningSummary.annual["2025"].revenue) *
        100
      : 0,
    scenarioName: projection.scenario
  };
}

export function getTimelineForScenario(
  analysis: Analysis,
  scenario: ScenarioName
): Timeline2026Item[] {
  const projection = getScenarioProjection(analysis, scenario);
  const h2Factor =
    analysis.projection2026H2.scenarios.find((item) => item.name === scenario)?.revenue ??
    projection.h2Projected;
  const baseH2 =
    analysis.projection2026H2.scenarios.find((item) => item.name === "Realista recomendado")?.revenue ??
    1;
  const scale = baseH2 ? h2Factor / baseH2 : 1;

  return analysis.planningSummary.timeline2026.map((item) => {
    if (item.kind !== "projected") return item;
    return {
      ...item,
      projectedRevenue: (item.projectedRevenue ?? 0) * scale,
      projectedWonDeals: (item.projectedWonDeals ?? 0) * scale
    };
  });
}

export function getBridgeData(analysis: Analysis, scenario: ScenarioName): BridgeItem[] {
  const kpis = getExecutiveKpis(analysis, scenario);
  const remaining = Math.max(0, kpis.projected2026Total - kpis.revenue2026Ytd);

  return [
    { label: "2025 realizado", value: kpis.revenue2025, type: "base" },
    { label: "2026 YTD", value: kpis.revenue2026Ytd, type: "increment" },
    { label: "Restante projetado", value: remaining, type: "increment" },
    { label: "2026 total proj.", value: kpis.projected2026Total, type: "total" }
  ];
}

export function getQuarterlySeries(analysis: Analysis): QuarterlySeriesItem[] {
  const keys = Object.keys(analysis.planningSummary.quarters).sort();
  const h1Projected = analysis.planningSummary.h1Projection.totalProjected;
  const h1Actual = analysis.planningSummary.semesters["2026-H1"]?.revenue ?? 0;

  return keys.map((key) => {
    const agg = analysis.planningSummary.quarters[key];
    const is2026 = key.startsWith("2026");
    let projected = 0;
    if (key === "2026-Q2") {
      const q2Actual = agg.revenue;
      const juneProjected = analysis.planningSummary.h1Projection.juneProjected;
      const juneActual = analysis.planningSummary.h1Projection.juneActual;
      projected = q2Actual - juneActual + juneProjected;
    }
    if (key.startsWith("2026-Q") && key >= "2026-Q3") {
      projected = agg.revenue;
    }

    return {
      key,
      label: quarterLabel(key),
      revenue2025: analysis.planningSummary.quarters[key.replace("2026", "2025")]?.revenue ?? 0,
      revenue2026: is2026 ? agg.revenue : 0,
      revenue2026Projected: is2026 ? projected || agg.revenue : 0
    };
  });
}

function growthForRows(rows: { revenue: number }[], index: number) {
  if (index === 0) return null;
  const prev = rows[index - 1].revenue;
  if (!prev) return null;
  return ((rows[index].revenue - prev) / prev) * 100;
}

function filterByYear(month: string, year: YearFilter) {
  if (year === "all") return true;
  return month.startsWith(year);
}

export function getMonthlyRows(analysis: Analysis, filters: PlanningFilters): TableRow[] {
  const growthByMonth = Object.fromEntries(
    analysis.growthComparison.map((item) => [`2026-${item.monthNumber}`, item])
  );

  if (filters.period === "month") {
    const planningByMonth = Object.fromEntries(
      (analysis.planningSummary.planningRealizedMonthly ?? []).map((row) => [row.month, row])
    );
    const months = analysis.monthly.filter((row) => filterByYear(row.month, filters.year));
    const mapped = months.map((row) => {
      const is2026 = row.month.startsWith("2026");
      const timeline = analysis.planningSummary.timeline2026.find((item) => item.month === row.month);
      const growth = growthByMonth[row.month];
      let kind: TableRow["kind"] = "actual";
      if (timeline?.kind === "partial") kind = "partial";
      if (timeline?.kind === "projected") kind = "projected";

      const realized = is2026 && kind !== "projected" ? planningByMonth[row.month] : null;
      const revenue = realized?.wonRevenue ?? row.wonRevenue;
      const wonDeals = realized?.wonDeals ?? row.wonDeals;

      return {
        key: row.month,
        label: monthLabel(row.month),
        month: row.month,
        createdDeals: row.createdDeals,
        wonDeals,
        revenue,
        averageTicket: wonDeals ? revenue / wonDeals : row.averageTicket,
        revenueMoMPct: is2026 ? (realized?.revenueGrowthPct ?? row.revenueGrowthPct) : null,
        revenueYoYPct: growth?.revenueYoYPct ?? null,
        kind,
        selectable: true
      };
    });

    if (filters.year === "2026" || filters.year === "all") {
      const projectedMonths = analysis.projection2026H2.months.map((row) => {
        const growth = growthByMonth[row.month];
        return {
          key: row.month,
          label: monthLabel(row.month),
          month: row.month,
          createdDeals: 0,
          wonDeals: Math.round(row.projectedWonDeals),
          revenue: row.projectedRevenue,
          averageTicket: row.projectedWonDeals ? row.projectedRevenue / row.projectedWonDeals : 0,
          revenueMoMPct: null,
          revenueYoYPct: growth?.revenueYoYPct ?? null,
          kind: "projected" as const,
          selectable: true
        };
      });
      const existing = new Set(mapped.map((row) => row.month));
      for (const row of projectedMonths) {
        if (!existing.has(row.month!)) mapped.push(row);
      }
    }

    mapped.sort((a, b) => (a.month ?? "").localeCompare(b.month ?? ""));

    return mapped.map((row, index, rows) => ({
      ...row,
      revenueMoMPct: row.revenueMoMPct ?? growthForRows(rows, index)
    }));
  }

  if (filters.period === "quarter") {
    const keys = Object.keys(analysis.planningSummary.quarters)
      .filter((key) => filters.year === "all" || key.startsWith(filters.year))
      .sort();
    const rows = keys.map((key) => {
      const agg = analysis.planningSummary.quarters[key];
      return {
        key,
        label: quarterLabel(key),
        createdDeals: agg.createdDeals,
        wonDeals: agg.wonDeals,
        revenue: agg.revenue,
        averageTicket: agg.averageTicket ?? 0,
        revenueMoMPct: null as number | null,
        revenueYoYPct: null as number | null,
        kind: agg.projected ? ("projected" as const) : ("aggregate" as const),
        selectable: false
      };
    });
    return rows.map((row, index) => ({
      ...row,
      revenueMoMPct: growthForRows(rows, index)
    }));
  }

  if (filters.period === "semester") {
    const keys = Object.keys(analysis.planningSummary.semesters)
      .filter((key) => {
        if (key.includes("projected")) return filters.year === "2026" || filters.year === "all";
        return filters.year === "all" || key.startsWith(filters.year);
      })
      .sort();
    const rows = keys.map((key) => {
      const agg = analysis.planningSummary.semesters[key];
      return {
        key,
        label: semesterLabel(key.replace("-projected", "")),
        createdDeals: agg.createdDeals,
        wonDeals: agg.wonDeals,
        revenue: agg.revenue,
        averageTicket: agg.averageTicket ?? 0,
        revenueMoMPct: null as number | null,
        revenueYoYPct: null as number | null,
        kind: agg.projected ? ("projected" as const) : ("aggregate" as const),
        selectable: false
      };
    });
    return rows.map((row, index) => ({
      ...row,
      revenueMoMPct: growthForRows(rows, index)
    }));
  }

  const years = filters.year === "all" ? ["2025", "2026"] : [filters.year];
  const rows = years.map((year) => {
    const agg = analysis.planningSummary.annual[year === "2026" ? "2026Ytd" : "2025"];
    const projection = getScenarioProjection(analysis, filters.scenario);
    const isProjectedYear = year === "2026";
    return {
      key: year,
      label: year,
      createdDeals: agg.createdDeals,
      wonDeals: isProjectedYear ? projection.wonDealsEstimated : agg.wonDeals,
      revenue: isProjectedYear ? projection.totalProjected : agg.revenue,
      averageTicket: agg.wonDeals ? agg.revenue / agg.wonDeals : 0,
      revenueMoMPct: null as number | null,
      revenueYoYPct: null as number | null,
      kind: isProjectedYear ? ("projected" as const) : ("aggregate" as const),
      selectable: false
    };
  });

  if (filters.year === "all" || filters.year === "2025") {
    rows.unshift({
      key: "2025-full",
      label: "2025 (realizado)",
      createdDeals: analysis.planningSummary.annual["2025"].createdDeals,
      wonDeals: analysis.planningSummary.annual["2025"].wonDeals,
      revenue: analysis.planningSummary.annual["2025"].revenue,
      averageTicket: analysis.planningSummary.annual["2025"].wonDeals
        ? analysis.planningSummary.annual["2025"].revenue / analysis.planningSummary.annual["2025"].wonDeals
        : 0,
      revenueMoMPct: null,
      revenueYoYPct: null,
      kind: "aggregate",
      selectable: false
    });
  }

  return rows.filter((row, index, arr) => arr.findIndex((item) => item.key === row.key) === index);
}

const PLANNING_REALIZED_PIPELINES = new Set(["[Exec] Laudos - Condo", "Obras"]);

export function getMonthDetail(analysis: Analysis, month: string): MonthDetail | null {
  const monthly = analysis.monthly.find((row) => row.month === month);
  const planningRow = analysis.planningSummary.planningRealizedMonthly?.find((row) => row.month === month);
  const timeline = analysis.planningSummary.timeline2026.find((item) => item.month === month);
  const projection = analysis.projection2026H2.months.find((row) => row.month === month);
  const growth = analysis.growthComparison.find((row) => month.endsWith(`-${row.monthNumber}`));

  if (!monthly && !projection) return null;

  const usePlanningRealized =
    month.startsWith("2026") && timeline?.kind !== "projected" && planningRow != null;
  const revenue = usePlanningRealized
    ? planningRow.wonRevenue
    : monthly?.wonRevenue ?? projection?.projectedRevenue ?? 0;
  const wonDeals = usePlanningRealized
    ? planningRow.wonDeals
    : monthly?.wonDeals ?? Math.round(projection?.projectedWonDeals ?? 0);
  const kind = timeline?.kind ?? (projection ? "projected" : "actual");

  const deals = analysis.wonDeals.filter((deal) => {
    if (deal.wonMonth !== month) return false;
    if (usePlanningRealized && deal.pipeline && !PLANNING_REALIZED_PIPELINES.has(deal.pipeline)) {
      return false;
    }
    return true;
  });

  return {
    month,
    label: monthLabel(month),
    revenue,
    wonDeals,
    createdDeals: monthly?.createdDeals ?? 0,
    averageTicket: monthly?.averageTicket ?? (wonDeals ? revenue / wonDeals : 0),
    revenueYoYPct: growth?.revenueYoYPct ?? null,
    revenueMoMPct: usePlanningRealized
      ? (planningRow.revenueGrowthPct ?? null)
      : (monthly?.revenueGrowthPct ?? null),
    kind,
    businessTypes: analysis.businessTypeMonthly.filter((row) => row.month === month),
    deals
  };
}

export function filterFunnel(analysis: Analysis, filters: PlanningFilters) {
  return analysis.commercialFunnel.filter((row) => {
    if (!filterByYear(row.month, filters.year)) return false;
    if (filters.selectedMonth) return row.month === filters.selectedMonth;
    return true;
  });
}

export function filterBusinessTypes(analysis: Analysis, filters: PlanningFilters) {
  return analysis.businessTypeMonthly.filter((row) => {
    if (!filterByYear(row.month, filters.year)) return false;
    if (filters.selectedMonth) return row.month === filters.selectedMonth;
    return true;
  });
}

export function filterWonDeals(analysis: Analysis, filters: PlanningFilters) {
  return analysis.wonDeals.filter((deal) => {
    if (!deal.wonMonth) return false;
    if (!filterByYear(deal.wonMonth, filters.year)) return false;
    if (filters.selectedMonth) return deal.wonMonth === filters.selectedMonth;
    return true;
  });
}
