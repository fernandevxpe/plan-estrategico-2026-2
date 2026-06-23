import type { Analysis } from "@/lib/analysis/types";
import type { VendasScenario } from "@/lib/areas/build-vendas-scenarios";

export const UNIT_ECONOMICS = {
  taxPct: 15,
  sdr: 2500,
  visitTechnician: 3000,
  trafficManager: 1500,
  contentProduction: 1000,
  trafficByMonth: {
    "2026-01": 2000,
    "2026-02": 2000,
    "2026-03": 2000,
    "2026-04": 2500,
    "2026-05": 2500,
    "2026-06": 2500,
    "2026-07": 2500,
    "2026-08": 3000,
    "2026-09": 3500,
    "2026-10": 4000,
    "2026-11": 4500,
    "2026-12": 4500
  } as Record<string, number>,
  fixedAcquisitionExclTraffic: 2500 + 3000 + 1500 + 1000
} as const;

export type AcquisitionBreakdown = {
  sdr: number;
  visitTechnician: number;
  traffic: number;
  trafficManager: number;
  contentProduction: number;
  total: number;
};

export type UnitEconomicsMonth = {
  month: string;
  label: string;
  period: "h1_actual" | "h2_projected";
  revenue: number;
  wonDeals: number;
  tax: number;
  payroll: number;
  payrollFixed: number;
  payrollCommission: number;
  acquisition: AcquisitionBreakdown;
  totalCosts: number;
  grossMargin: number;
  grossMarginPct: number;
  acquisitionPctOfRevenue: number;
  cacPerClosing: number | null;
  cumulativeRevenue: number;
  cumulativeGrossMargin: number;
  cumulativeAcquisition: number;
};

export type UnitEconomicsAnnual = {
  revenue: number;
  tax: number;
  payroll: number;
  acquisition: AcquisitionBreakdown;
  totalCosts: number;
  grossMargin: number;
  grossMarginPct: number;
  acquisitionPctOfRevenue: number;
  avgCacPerClosing: number | null;
  h1: {
    revenue: number;
    grossMargin: number;
    grossMarginPct: number;
    acquisitionPctOfRevenue: number;
  };
  h2: {
    revenue: number;
    grossMargin: number;
    grossMarginPct: number;
    acquisitionPctOfRevenue: number;
  };
};

export type ScenarioUnitEconomics = {
  scenarioId: string;
  scenarioName: string;
  months: UnitEconomicsMonth[];
  annual: UnitEconomicsAnnual;
};

export type VendasUnitEconomicsDashboard = {
  assumptions: typeof UNIT_ECONOMICS;
  scenarios: [ScenarioUnitEconomics, ScenarioUnitEconomics];
};

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const YEAR_MONTHS = [
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
  "2026-10",
  "2026-11",
  "2026-12"
];

function monthLabel(month: string) {
  return MONTH_LABELS[Number(month.slice(5, 7)) - 1] ?? month;
}

function acquisitionForMonth(month: string): AcquisitionBreakdown {
  const traffic = UNIT_ECONOMICS.trafficByMonth[month] ?? 2500;
  return {
    sdr: UNIT_ECONOMICS.sdr,
    visitTechnician: UNIT_ECONOMICS.visitTechnician,
    traffic,
    trafficManager: UNIT_ECONOMICS.trafficManager,
    contentProduction: UNIT_ECONOMICS.contentProduction,
    total:
      UNIT_ECONOMICS.sdr +
      UNIT_ECONOMICS.visitTechnician +
      traffic +
      UNIT_ECONOMICS.trafficManager +
      UNIT_ECONOMICS.contentProduction
  };
}

function sumAcquisition(months: UnitEconomicsMonth[]): AcquisitionBreakdown {
  return months.reduce(
    (acc, row) => ({
      sdr: acc.sdr + row.acquisition.sdr,
      visitTechnician: acc.visitTechnician + row.acquisition.visitTechnician,
      traffic: acc.traffic + row.acquisition.traffic,
      trafficManager: acc.trafficManager + row.acquisition.trafficManager,
      contentProduction: acc.contentProduction + row.acquisition.contentProduction,
      total: acc.total + row.acquisition.total
    }),
    { sdr: 0, visitTechnician: 0, traffic: 0, trafficManager: 0, contentProduction: 0, total: 0 }
  );
}

function buildAnnualSlice(months: UnitEconomicsMonth[]) {
  const revenue = months.reduce((sum, row) => sum + row.revenue, 0);
  const grossMargin = months.reduce((sum, row) => sum + row.grossMargin, 0);
  const acquisition = sumAcquisition(months);
  return {
    revenue,
    grossMargin,
    grossMarginPct: revenue ? (grossMargin / revenue) * 100 : 0,
    acquisitionPctOfRevenue: revenue ? (acquisition.total / revenue) * 100 : 0
  };
}

function buildScenarioEconomics(analysis: Analysis, scenario: VendasScenario): ScenarioUnitEconomics {
  const h2ByMonth = Object.fromEntries(scenario.months.map((row) => [row.month, row]));
  const monthlyActual = Object.fromEntries(
    analysis.monthly.filter((row) => row.month.startsWith("2026")).map((row) => [row.month, row])
  );
  const juneProjected = analysis.planningSummary.h1Projection.juneProjected;

  let cumulativeRevenue = 0;
  let cumulativeGrossMargin = 0;
  let cumulativeAcquisition = 0;

  const months: UnitEconomicsMonth[] = YEAR_MONTHS.map((month) => {
    const isH2 = month >= "2026-07";
    const acquisition = acquisitionForMonth(month);

    let revenue: number;
    let wonDeals: number;
    let payroll: number;
    let payrollFixed: number;
    let payrollCommission: number;

    if (isH2) {
      const row = h2ByMonth[month]!;
      revenue = row.revenue;
      wonDeals = row.wonDeals;
      payroll = row.collective.totalPayroll;
      payrollFixed = row.sellers.reduce((sum, seller) => sum + seller.fixedPay, 0);
      payrollCommission = row.sellers.reduce((sum, seller) => sum + seller.commission, 0);
    } else {
      const actual = monthlyActual[month];
      revenue = month === "2026-06" && actual && actual.wonRevenue < juneProjected * 0.15
        ? Math.round(juneProjected)
        : Math.round(actual?.wonRevenue ?? 0);
      wonDeals = actual?.wonDeals ?? 0;
      payrollFixed = 2 * 5000;
      payrollCommission = Math.round(revenue * 0.1);
      payroll = payrollFixed + payrollCommission;
    }

    const tax = Math.round(revenue * (UNIT_ECONOMICS.taxPct / 100));
    const totalCosts = tax + payroll + acquisition.total;
    const grossMargin = revenue - totalCosts;

    cumulativeRevenue += revenue;
    cumulativeGrossMargin += grossMargin;
    cumulativeAcquisition += acquisition.total;

    return {
      month,
      label: monthLabel(month),
      period: isH2 ? "h2_projected" : "h1_actual",
      revenue,
      wonDeals,
      tax,
      payroll,
      payrollFixed,
      payrollCommission,
      acquisition,
      totalCosts,
      grossMargin,
      grossMarginPct: revenue ? (grossMargin / revenue) * 100 : 0,
      acquisitionPctOfRevenue: revenue ? (acquisition.total / revenue) * 100 : 0,
      cacPerClosing: wonDeals > 0 ? acquisition.total / wonDeals : null,
      cumulativeRevenue,
      cumulativeGrossMargin,
      cumulativeAcquisition
    };
  });

  const h1Months = months.filter((row) => row.period === "h1_actual");
  const h2Months = months.filter((row) => row.period === "h2_projected");
  const revenue = months.reduce((sum, row) => sum + row.revenue, 0);
  const tax = months.reduce((sum, row) => sum + row.tax, 0);
  const payroll = months.reduce((sum, row) => sum + row.payroll, 0);
  const acquisition = sumAcquisition(months);
  const totalCosts = months.reduce((sum, row) => sum + row.totalCosts, 0);
  const grossMargin = months.reduce((sum, row) => sum + row.grossMargin, 0);
  const totalWonDeals = months.reduce((sum, row) => sum + row.wonDeals, 0);

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    months,
    annual: {
      revenue,
      tax,
      payroll,
      acquisition,
      totalCosts,
      grossMargin,
      grossMarginPct: revenue ? (grossMargin / revenue) * 100 : 0,
      acquisitionPctOfRevenue: revenue ? (acquisition.total / revenue) * 100 : 0,
      avgCacPerClosing: totalWonDeals > 0 ? acquisition.total / totalWonDeals : null,
      h1: buildAnnualSlice(h1Months),
      h2: buildAnnualSlice(h2Months)
    }
  };
}

export function buildVendasUnitEconomics(
  analysis: Analysis,
  scenarios: [VendasScenario, VendasScenario]
): VendasUnitEconomicsDashboard {
  return {
    assumptions: UNIT_ECONOMICS,
    scenarios: [
      buildScenarioEconomics(analysis, scenarios[0]),
      buildScenarioEconomics(analysis, scenarios[1])
    ]
  };
}

export function toStackedMarginChartData(economics: ScenarioUnitEconomics) {
  return economics.months.map((row) => ({
    month: row.month,
    label: row.label,
    Impostos: row.tax,
    Folha: row.payroll,
    SDR: row.acquisition.sdr,
    "Técnico visitas": row.acquisition.visitTechnician,
    Tráfego: row.acquisition.traffic,
    "Gestor tráfego": row.acquisition.trafficManager,
    Conteúdo: row.acquisition.contentProduction,
    "Margem bruta": Math.max(0, row.grossMargin)
  }));
}

export function toPayrollStackData(economics: ScenarioUnitEconomics) {
  return economics.months.map((row) => ({
    label: row.label,
    Fixo: row.payrollFixed,
    Comissão: row.payrollCommission
  }));
}

export const MARGIN_STACK_KEYS = [
  { key: "Impostos", color: "#94a3b8" },
  { key: "Folha", color: "#f59e0b" },
  { key: "SDR", color: "#60a5fa" },
  { key: "Técnico visitas", color: "#818cf8" },
  { key: "Tráfego", color: "#a78bfa" },
  { key: "Gestor tráfego", color: "#c084fc" },
  { key: "Conteúdo", color: "#e879f9" },
  { key: "Margem bruta", color: "#21a67a" }
] as const;
