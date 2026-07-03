import type {
  Analysis,
  BusinessTypeMonthlyByScope,
  GoalPlan,
  MixGoalScope,
  Planning2026
} from "./types";
import { getGoalForScope } from "./planning-pipedrive";

const MONTH_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MONTHS_2026 = Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, "0")}`);

export type MixGoalMetric = "revenue" | "deals";
export type MixGoalViewMode = "monthly" | "accumulated";

export type ScopeMixShare = {
  type: string;
  revenueShare: number;
  dealsShare: number;
  averageTicket: number;
  revenue: number;
  wonDeals: number;
};

export type CompositionTypeValue = {
  type: string;
  realizedRevenue: number;
  realizedDeals: number;
  projectedRevenue: number;
  projectedDeals: number;
};

export type ScopeCompositionMonth = {
  month: string;
  label: string;
  isProjected: boolean;
  metaTarget: number | null;
  metaRealized: number | null;
  types: CompositionTypeValue[];
  totalRealizedRevenue: number;
  totalRealizedDeals: number;
  totalProjectedRevenue: number;
  totalProjectedDeals: number;
  totalRevenue: number;
  totalDeals: number;
};

export type ScopeCompositionSummary = {
  annualTarget: number;
  realizedYtd: number;
  projectedYearEnd: number;
  gapToTarget: number;
  baselineUntilMonth: string | null;
};

export type CompositionChartRow = {
  month: string;
  label: string;
  isProjected: boolean;
  meta: number;
  total: number;
  [type: string]: string | number | boolean;
};

function monthLabel(monthKey: string) {
  const [, raw] = monthKey.split("-");
  return MONTH_SHORT[Number(raw) - 1] ?? monthKey;
}

function goalIntervalForMonth(goal: GoalPlan | null, month: string) {
  if (!goal) return { target: null, realized: null };
  const interval = goal.intervals.find((item) => item.monthKey === month);
  return {
    target: interval?.target ?? null,
    realized: interval?.realized ?? null
  };
}

function scopedRowsForScopes(analysis: Analysis, scopes: MixGoalScope[]) {
  const scopeSet = new Set(scopes);
  return (analysis.businessTypeMonthlyByScope ?? []).filter((row) => scopeSet.has(row.scope));
}

export function getScopeMixShares(
  rows: BusinessTypeMonthlyByScope[],
  scope: MixGoalScope,
  untilMonth: string
): ScopeMixShare[] {
  return getScopesMixShares(rows, [scope], untilMonth);
}

export function getScopesMixShares(
  rows: BusinessTypeMonthlyByScope[],
  scopes: MixGoalScope[],
  untilMonth: string
): ScopeMixShare[] {
  const scopeSet = new Set(scopes);
  const filtered = rows.filter(
    (row) => scopeSet.has(row.scope) && row.month.startsWith("2026") && row.month < untilMonth
  );
  const totalRevenue = filtered.reduce((acc, row) => acc + row.revenue, 0);
  const totalDeals = filtered.reduce((acc, row) => acc + row.wonDeals, 0);
  const byType = new Map<string, { revenue: number; wonDeals: number }>();

  for (const row of filtered) {
    const current = byType.get(row.type) ?? { revenue: 0, wonDeals: 0 };
    current.revenue += row.revenue;
    current.wonDeals += row.wonDeals;
    byType.set(row.type, current);
  }

  const scopeTicket = totalDeals ? totalRevenue / totalDeals : 0;

  return [...byType.entries()]
    .map(([type, values]) => ({
      type,
      revenue: values.revenue,
      wonDeals: values.wonDeals,
      revenueShare: totalRevenue ? values.revenue / totalRevenue : 0,
      dealsShare: totalDeals ? values.wonDeals / totalDeals : 0,
      averageTicket: values.wonDeals ? values.revenue / values.wonDeals : scopeTicket
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

function realizedForMonth(rows: BusinessTypeMonthlyByScope[], month: string) {
  const map = new Map<string, { revenue: number; wonDeals: number }>();
  for (const row of rows.filter((item) => item.month === month)) {
    const current = map.get(row.type) ?? { revenue: 0, wonDeals: 0 };
    current.revenue += row.revenue;
    current.wonDeals += row.wonDeals;
    map.set(row.type, current);
  }
  return map;
}

function mergeCompositionMonths(monthRows: ScopeCompositionMonth[]): ScopeCompositionMonth {
  const typesMap = new Map<string, CompositionTypeValue>();

  for (const row of monthRows) {
    for (const item of row.types) {
      const current = typesMap.get(item.type) ?? {
        type: item.type,
        realizedRevenue: 0,
        realizedDeals: 0,
        projectedRevenue: 0,
        projectedDeals: 0
      };
      current.realizedRevenue += item.realizedRevenue;
      current.realizedDeals += item.realizedDeals;
      current.projectedRevenue += item.projectedRevenue;
      current.projectedDeals += item.projectedDeals;
      typesMap.set(item.type, current);
    }
  }

  const types = [...typesMap.values()];
  const totalRealizedRevenue = types.reduce((acc, item) => acc + item.realizedRevenue, 0);
  const totalRealizedDeals = types.reduce((acc, item) => acc + item.realizedDeals, 0);
  const totalProjectedRevenue = types.reduce((acc, item) => acc + item.projectedRevenue, 0);
  const totalProjectedDeals = types.reduce((acc, item) => acc + item.projectedDeals, 0);
  const base = monthRows[0];

  return {
    month: base.month,
    label: base.label,
    isProjected: base.isProjected,
    metaTarget: monthRows.reduce((acc, row) => acc + (row.metaTarget ?? 0), 0) || null,
    metaRealized: monthRows.reduce((acc, row) => acc + (row.metaRealized ?? 0), 0) || null,
    types,
    totalRealizedRevenue,
    totalRealizedDeals,
    totalProjectedRevenue,
    totalProjectedDeals,
    totalRevenue: totalRealizedRevenue + totalProjectedRevenue,
    totalDeals: totalRealizedDeals + totalProjectedDeals
  };
}

function goalsForScopes(planning: Planning2026, scopes: MixGoalScope[]) {
  return scopes
    .map((scope) => getGoalForScope(planning, scope))
    .filter((goal): goal is GoalPlan => Boolean(goal));
}

/** Escala meses projetados pelo restante da projeção anual do Pipedrive (ritmo real). */
function alignProjectedRowsWithPipedrive(
  rows: ScopeCompositionMonth[],
  planning: Planning2026,
  scopes: MixGoalScope[]
): ScopeCompositionMonth[] {
  const goals = goalsForScopes(planning, scopes);
  if (!goals.length) return rows;

  const pipedriveProjected = goals.reduce((acc, goal) => acc + goal.projectedYearEnd, 0);
  const pipedriveRealized = goals.reduce((acc, goal) => acc + goal.totalRealized, 0);
  const remainingPipedrive = Math.max(0, pipedriveProjected - pipedriveRealized);

  const projectedRows = rows.filter((row) => row.isProjected);
  const remainingTargetSum = projectedRows.reduce((acc, row) => acc + (row.metaTarget ?? 0), 0);
  if (!remainingTargetSum || remainingPipedrive <= 0) return rows;

  return rows.map((row) => {
    if (!row.isProjected) return row;

    const monthWeight = (row.metaTarget ?? 0) / remainingTargetSum;
    const monthProjectedTotal = remainingPipedrive * monthWeight;
    const scale = row.totalProjectedRevenue ? monthProjectedTotal / row.totalProjectedRevenue : 1;

    const types = row.types.map((item) => ({
      ...item,
      projectedRevenue: item.projectedRevenue * scale,
      projectedDeals: item.projectedDeals * scale
    }));
    const totalProjectedRevenue = types.reduce((acc, item) => acc + item.projectedRevenue, 0);
    const totalProjectedDeals = types.reduce((acc, item) => acc + item.projectedDeals, 0);

    return {
      ...row,
      types,
      totalProjectedRevenue,
      totalProjectedDeals,
      totalRevenue: row.totalRealizedRevenue + totalProjectedRevenue,
      totalDeals: row.totalRealizedDeals + totalProjectedDeals
    };
  });
}

export function buildScopesCompositionRows(
  analysis: Analysis,
  scopes: MixGoalScope[]
): ScopeCompositionMonth[] {
  if (!scopes.length) return [];

  let rows: ScopeCompositionMonth[];
  if (scopes.length === 1) {
    rows = buildScopeCompositionRows(analysis, scopes[0]);
  } else {
    const perScope = scopes.map((scope) => buildScopeCompositionRows(analysis, scope));
    rows = MONTHS_2026.map((_, index) => mergeCompositionMonths(perScope.map((item) => item[index])));
  }

  if (analysis.planning2026) {
    return alignProjectedRowsWithPipedrive(rows, analysis.planning2026, scopes);
  }
  return rows;
}

export function buildScopeCompositionRows(analysis: Analysis, scope: MixGoalScope): ScopeCompositionMonth[] {
  const planning = analysis.planning2026;
  const currentMonth = planning?.currentMonth ?? "2026-12";
  const goal = planning ? getGoalForScope(planning, scope) : null;
  const rows = scopedRowsForScopes(analysis, [scope]);
  const shares = getScopeMixShares(rows, scope, currentMonth);
  const shareByType = new Map(shares.map((item) => [item.type, item]));
  const allTypes = [...new Set([...shares.map((item) => item.type), ...rows.map((item) => item.type)])];

  return MONTHS_2026.map((month) => {
    const { target, realized: metaRealized } = goalIntervalForMonth(goal, month);
    const isProjected = month >= currentMonth;
    const realizedMap = realizedForMonth(rows, month);

    const types: CompositionTypeValue[] = allTypes.map((type) => {
      const realized = realizedMap.get(type) ?? { revenue: 0, wonDeals: 0 };
      const share = shareByType.get(type);
      let projectedRevenue = 0;
      let projectedDeals = 0;

      if (isProjected && target != null && share) {
        projectedRevenue = target * share.revenueShare;
        projectedDeals = share.averageTicket
          ? projectedRevenue / share.averageTicket
          : target * share.dealsShare;
      }

      return {
        type,
        realizedRevenue: isProjected ? 0 : realized.revenue,
        realizedDeals: isProjected ? 0 : realized.wonDeals,
        projectedRevenue: isProjected ? projectedRevenue : 0,
        projectedDeals: isProjected ? projectedDeals : 0
      };
    });

    const totalRealizedRevenue = types.reduce((acc, item) => acc + item.realizedRevenue, 0);
    const totalRealizedDeals = types.reduce((acc, item) => acc + item.realizedDeals, 0);
    const totalProjectedRevenue = types.reduce((acc, item) => acc + item.projectedRevenue, 0);
    const totalProjectedDeals = types.reduce((acc, item) => acc + item.projectedDeals, 0);

    return {
      month,
      label: monthLabel(month),
      isProjected,
      metaTarget: target,
      metaRealized,
      types,
      totalRealizedRevenue,
      totalRealizedDeals,
      totalProjectedRevenue,
      totalProjectedDeals,
      totalRevenue: totalRealizedRevenue + totalProjectedRevenue,
      totalDeals: totalRealizedDeals + totalProjectedDeals
    };
  });
}

export function getScopesCompositionSummary(
  planning: Analysis["planning2026"],
  scopes: MixGoalScope[],
  rows: ScopeCompositionMonth[]
): ScopeCompositionSummary {
  const goals = planning ? goalsForScopes(planning, scopes) : [];

  if (goals.length) {
    const annualTarget = goals.reduce((acc, goal) => acc + goal.totalTarget, 0);
    const realizedYtd = goals.reduce((acc, goal) => acc + goal.totalRealized, 0);
    const projectedYearEnd = goals.reduce((acc, goal) => acc + goal.projectedYearEnd, 0);

    return {
      annualTarget,
      realizedYtd,
      projectedYearEnd,
      gapToTarget: annualTarget - projectedYearEnd,
      baselineUntilMonth: rows.find((row) => row.isProjected)?.month ?? null
    };
  }

  const annualTarget = rows.reduce((acc, row) => acc + (row.metaTarget ?? 0), 0);
  const realizedYtd = rows
    .filter((row) => !row.isProjected)
    .reduce((acc, row) => acc + row.totalRealizedRevenue, 0);
  const projectedYearEnd = rows.reduce((acc, row) => acc + row.totalRevenue, 0);

  return {
    annualTarget,
    realizedYtd,
    projectedYearEnd,
    gapToTarget: annualTarget - projectedYearEnd,
    baselineUntilMonth: rows.find((row) => row.isProjected)?.month ?? null
  };
}

export function getScopeCompositionSummary(
  goal: GoalPlan | null,
  rows: ScopeCompositionMonth[]
): ScopeCompositionSummary {
  if (goal) {
    return {
      annualTarget: goal.totalTarget,
      realizedYtd: goal.totalRealized,
      projectedYearEnd: goal.projectedYearEnd,
      gapToTarget: goal.totalTarget - goal.projectedYearEnd,
      baselineUntilMonth: rows.find((row) => row.isProjected)?.month ?? null
    };
  }

  const annualTarget = rows.reduce((acc, row) => acc + (row.metaTarget ?? 0), 0);
  const realizedYtd = rows
    .filter((row) => !row.isProjected)
    .reduce((acc, row) => acc + row.totalRealizedRevenue, 0);
  const projectedYearEnd = rows.reduce((acc, row) => acc + row.totalRevenue, 0);

  return {
    annualTarget,
    realizedYtd,
    projectedYearEnd,
    gapToTarget: annualTarget - projectedYearEnd,
    baselineUntilMonth: rows.find((row) => row.isProjected)?.month ?? null
  };
}

function typeValue(item: CompositionTypeValue, metric: MixGoalMetric, projected: boolean) {
  if (metric === "revenue") {
    return projected ? item.projectedRevenue : item.realizedRevenue;
  }
  return projected ? item.projectedDeals : item.realizedDeals;
}

export function getScopeCompositionTypes(rows: ScopeCompositionMonth[]) {
  const types = new Set<string>();
  for (const row of rows) {
    for (const item of row.types) {
      if (
        item.realizedRevenue ||
        item.realizedDeals ||
        item.projectedRevenue ||
        item.projectedDeals
      ) {
        types.add(item.type);
      }
    }
  }
  return [...types].sort((a, b) => {
    const totalA = rows.reduce((acc, row) => {
      const item = row.types.find((entry) => entry.type === a);
      return acc + (item?.realizedRevenue ?? 0) + (item?.projectedRevenue ?? 0);
    }, 0);
    const totalB = rows.reduce((acc, row) => {
      const item = row.types.find((entry) => entry.type === b);
      return acc + (item?.realizedRevenue ?? 0) + (item?.projectedRevenue ?? 0);
    }, 0);
    return totalB - totalA;
  });
}

export function buildScopeCompositionChartData(
  rows: ScopeCompositionMonth[],
  metric: MixGoalMetric,
  mode: MixGoalViewMode,
  scopeAvgTicket = 0
): CompositionChartRow[] {
  const types = getScopeCompositionTypes(rows);
  const runningMeta: Record<string, number> = Object.fromEntries(types.map((type) => [type, 0]));
  let cumulativeMeta = 0;

  const monthMetaValue = (row: ScopeCompositionMonth) => {
    if (metric === "revenue") return row.metaTarget ?? 0;
    if (!row.metaTarget || !scopeAvgTicket) return row.totalDeals;
    return row.metaTarget / scopeAvgTicket;
  };

  return rows.map((row) => {
    const chartRow: CompositionChartRow = {
      month: row.month,
      label: row.label,
      isProjected: row.isProjected,
      meta: 0,
      total: 0
    };

    let monthTotal = 0;
    for (const type of types) {
      const item = row.types.find((entry) => entry.type === type);
      const realized = item ? typeValue(item, metric, false) : 0;
      const projected = item ? typeValue(item, metric, true) : 0;
      const value = row.isProjected ? projected : realized;

      if (mode === "accumulated") {
        runningMeta[type] = (runningMeta[type] ?? 0) + value;
        chartRow[type] = runningMeta[type];
      } else {
        chartRow[type] = value;
      }

      monthTotal += value;
    }

    const monthMeta = monthMetaValue(row);

    if (mode === "accumulated") {
      cumulativeMeta += monthMeta;
      chartRow.meta = cumulativeMeta;
      chartRow.total = Object.values(runningMeta).reduce((acc, value) => acc + value, 0);
    } else {
      chartRow.meta = monthMeta;
      chartRow.total = monthTotal;
    }

    return chartRow;
  });
}

export function buildScopeCompositionTable(rows: ScopeCompositionMonth[]) {
  const types = getScopeCompositionTypes(rows);
  return rows.map((row) => ({
    month: row.month,
    label: row.label,
    isProjected: row.isProjected,
    metaTarget: row.metaTarget,
    metaRealized: row.metaRealized,
    totalRevenue: row.totalRevenue,
    totalDeals: row.totalDeals,
    products: types.map((type) => {
      const item = row.types.find((entry) => entry.type === type);
      const revenue = row.isProjected ? (item?.projectedRevenue ?? 0) : (item?.realizedRevenue ?? 0);
      const deals = row.isProjected ? (item?.projectedDeals ?? 0) : (item?.realizedDeals ?? 0);
      const mixPct = row.totalRevenue ? (revenue / row.totalRevenue) * 100 : 0;
      return { type, revenue, deals, mixPct };
    })
  }));
}

export function getMixGoalScopeLabel(scopes: MixGoalScope[]) {
  if (scopes.length === 2) return "Consultoria + Obras";
  if (scopes[0] === "consultoria") return "Consultoria";
  return "Obras";
}

export function getMixGoalBaselineLabel(analysis: Analysis, scopes?: MixGoalScope[]) {
  const currentMonth = analysis.planning2026?.currentMonth;
  if (!currentMonth) return "histórico 2026";
  const previous = new Date(`${currentMonth}-01T00:00:00.000Z`);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const until = previous.toISOString().slice(0, 7);
  if (!until.startsWith("2026")) return "histórico 2026";
  return `realizado 2026 até ${monthLabel(until)}`;
}
