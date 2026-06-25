import type { BusinessTypeMonthly, YearFilter } from "@/lib/analysis/types";
import { monthLabel, quarterLabel, semesterLabel } from "@/lib/analysis/format";

export type MixGranularity = "month" | "quarter" | "semester" | "year";

export type MixProductRow = {
  type: string;
  wonDeals: number;
  revenue: number;
  averageTicket: number;
  revenueSharePct: number;
  dealsSharePct: number;
  effortGapPct: number;
};

export type MixPeriodSummary = {
  key: string;
  label: string;
  totalRevenue: number;
  totalDeals: number;
  averageTicket: number;
  activeProducts: number;
  products: MixProductRow[];
};

export type MixEffortInsight = {
  type: "high_effort" | "high_yield" | "balanced";
  product: MixProductRow;
  message: string;
};

function quarterKey(month: string) {
  const [year, rawMonth] = month.split("-");
  const quarter = Math.ceil(Number(rawMonth) / 3);
  return `${year}-Q${quarter}`;
}

function semesterKey(month: string) {
  const [year, rawMonth] = month.split("-");
  const half = Number(rawMonth) <= 6 ? "H1" : "H2";
  return `${year}-${half}`;
}

function yearKey(month: string) {
  return month.slice(0, 4);
}

export function periodKeyForMonth(month: string, granularity: MixGranularity) {
  if (granularity === "month") return month;
  if (granularity === "quarter") return quarterKey(month);
  if (granularity === "semester") return semesterKey(month);
  return yearKey(month);
}

export function periodLabel(key: string, granularity: MixGranularity) {
  if (granularity === "month") return monthLabel(key);
  if (granularity === "quarter") return quarterLabel(key);
  if (granularity === "semester") return semesterLabel(key);
  return key;
}

function filterRowsByYear(rows: BusinessTypeMonthly[], year: YearFilter) {
  if (year === "all") return rows;
  return rows.filter((row) => row.month.startsWith(year));
}

function aggregateProducts(
  rows: BusinessTypeMonthly[],
  selectedTypes?: string[]
): MixProductRow[] {
  const map = new Map<string, { type: string; wonDeals: number; revenue: number }>();

  for (const row of rows) {
    if (selectedTypes?.length && !selectedTypes.includes(row.type)) continue;
    const current = map.get(row.type) ?? { type: row.type, wonDeals: 0, revenue: 0 };
    current.wonDeals += row.wonDeals;
    current.revenue += row.revenue;
    map.set(row.type, current);
  }

  const totalRevenue = [...map.values()].reduce((sum, item) => sum + item.revenue, 0);
  const totalDeals = [...map.values()].reduce((sum, item) => sum + item.wonDeals, 0);

  return [...map.values()]
    .map((item) => ({
      type: item.type,
      wonDeals: item.wonDeals,
      revenue: item.revenue,
      averageTicket: item.wonDeals ? item.revenue / item.wonDeals : 0,
      revenueSharePct: totalRevenue ? (item.revenue / totalRevenue) * 100 : 0,
      dealsSharePct: totalDeals ? (item.wonDeals / totalDeals) * 100 : 0,
      effortGapPct: totalDeals && totalRevenue
        ? (item.wonDeals / totalDeals) * 100 - (item.revenue / totalRevenue) * 100
        : 0
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

export function getMixPeriodKeys(
  rows: BusinessTypeMonthly[],
  granularity: MixGranularity,
  year: YearFilter
) {
  const filtered = filterRowsByYear(rows, year);
  const keys = [...new Set(filtered.map((row) => periodKeyForMonth(row.month, granularity)))].sort();
  return keys;
}

export function getMixPeriodSummary(
  rows: BusinessTypeMonthly[],
  periodKey: string,
  granularity: MixGranularity,
  selectedTypes?: string[]
): MixPeriodSummary {
  const periodRows = rows.filter((row) => periodKeyForMonth(row.month, granularity) === periodKey);
  const products = aggregateProducts(periodRows, selectedTypes);
  const totalRevenue = products.reduce((sum, item) => sum + item.revenue, 0);
  const totalDeals = products.reduce((sum, item) => sum + item.wonDeals, 0);

  return {
    key: periodKey,
    label: periodLabel(periodKey, granularity),
    totalRevenue,
    totalDeals,
    averageTicket: totalDeals ? totalRevenue / totalDeals : 0,
    activeProducts: products.length,
    products
  };
}

export function getMixPeriodSummaries(
  rows: BusinessTypeMonthly[],
  granularity: MixGranularity,
  year: YearFilter,
  selectedTypes?: string[]
): MixPeriodSummary[] {
  return getMixPeriodKeys(rows, granularity, year).map((key) =>
    getMixPeriodSummary(rows, key, granularity, selectedTypes)
  );
}

export function getMixTypeTotals(rows: BusinessTypeMonthly[], year: YearFilter) {
  return aggregateProducts(filterRowsByYear(rows, year));
}

export function getMixEffortInsights(summary: MixPeriodSummary): MixEffortInsight[] {
  const insights: MixEffortInsight[] = [];

  for (const product of summary.products) {
    if (product.wonDeals < 2 && product.revenueSharePct < 5) continue;

    if (product.effortGapPct >= 8) {
      insights.push({
        type: "high_effort",
        product,
        message: `${product.type} concentra ${product.dealsSharePct.toFixed(1)}% dos fechamentos, mas só ${product.revenueSharePct.toFixed(1)}% da receita — mais esforço operacional por real faturado.`
      });
    } else if (product.effortGapPct <= -8) {
      insights.push({
        type: "high_yield",
        product,
        message: `${product.type} responde por ${product.revenueSharePct.toFixed(1)}% da receita com apenas ${product.dealsSharePct.toFixed(1)}% dos fechamentos — alto retorno por negócio.`
      });
    }
  }

  return insights
    .sort((a, b) => Math.abs(b.product.effortGapPct) - Math.abs(a.product.effortGapPct))
    .slice(0, 4);
}

export function getMixTimelineChartData(
  summaries: MixPeriodSummary[],
  topTypes: string[]
) {
  return summaries.map((summary) => {
    const item: Record<string, string | number> = {
      key: summary.key,
      label: summary.label,
      totalRevenue: summary.totalRevenue,
      totalDeals: summary.totalDeals
    };
    for (const type of topTypes) item[type] = 0;
    for (const product of summary.products) {
      if (topTypes.includes(product.type)) item[product.type] = product.revenue;
    }
    return item;
  });
}
