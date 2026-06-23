import type { Analysis } from "@/lib/analysis/types";

export const COMPENSATION = {
  fixedMonthly: 5000,
  commissionPct: 10,
  label: "R$ 5.000 fixo + 10% sobre faturamento individual"
} as const;

export type SellerProductivityAssumptions = {
  label: string;
  createdPerSellerMonth: number;
  conversionPct: number;
  closingsPerSellerMonth: number;
  averageTicket: number;
  revenuePerSellerMonth: number;
  sourceNote: string;
};

export type SellerMonthPay = {
  id: string;
  label: string;
  rampFactor: number;
  attributedRevenue: number;
  fixedPay: number;
  commission: number;
  totalPay: number;
};

export type VendasScenarioMonth = {
  month: string;
  label: string;
  headcount: number;
  effectiveFte: number;
  createdDeals: number;
  wonDeals: number;
  revenue: number;
  revenueTarget: number;
  gapVsRevenueTarget: number;
  cumulativeH2Revenue: number;
  cumulativeH2Target: number;
  sellers: SellerMonthPay[];
  collective: {
    totalPayroll: number;
    payrollPctOfRevenue: number;
    avgPayPerSeller: number;
    avgRevenuePerSeller: number;
    avgRevenuePerFte: number;
  };
};

export type VendasScenario = {
  id: string;
  name: string;
  description: string;
  hireTimeline: string;
  months: VendasScenarioMonth[];
  h2Total: number;
  h2PayrollTotal: number;
  h2PayrollPctOfRevenue: number;
  annualTotal: number;
  gapVs3M: number;
  gapVs3MPct: number;
  h2GapVs2M: number;
  h2GapVs2MPct: number;
  avgMonthlyH2: number;
  avgRevenuePerSellerH2: number;
  avgPayPerSellerH2: number;
};

export type VendasScenariosDashboard = {
  compensation: typeof COMPENSATION;
  targets: {
    annual3M: number;
    h1: number;
    h2: number;
    h2MonthlyNeeded: number;
  };
  h1: {
    janMayActual: number;
    juneProjected: number;
    totalProjected: number;
  };
  historicalIndividual: SellerProductivityAssumptions;
  conservativeIndividual: SellerProductivityAssumptions;
  rampNote: string;
  scenarios: [VendasScenario, VendasScenario];
};

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const H2_MONTHS = ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];

const NEW_HIRE_RAMP = [0, 0.33, 0.66, 1] as const;

type HirePlan = { id: string; label: string; hireMonth: string; rampStartMonth: string };

function monthLabel(month: string) {
  const mm = Number(month.slice(5, 7)) - 1;
  return MONTH_LABELS[mm] ?? month;
}

function monthsBetween(start: string, end: string) {
  const sy = Number(start.slice(0, 4));
  const sm = Number(start.slice(5, 7));
  const ey = Number(end.slice(0, 4));
  const em = Number(end.slice(5, 7));
  return (ey - sy) * 12 + (em - sm);
}

function sumJanMay2026(analysis: Analysis) {
  const months = analysis.commercialFunnel.filter(
    (row) => row.month >= "2026-01" && row.month <= "2026-05"
  );
  const created = months.reduce((sum, row) => sum + row.createdDeals, 0);
  const won = months.reduce((sum, row) => sum + row.wonDeals, 0);
  const revenue = months.reduce((sum, row) => sum + row.wonValue, 0);
  const monthCount = months.length || 1;
  const sellers = 2;
  return {
    created,
    won,
    revenue,
    monthCount,
    sellers,
    createdPerSellerMonth: created / monthCount / sellers,
    wonPerSellerMonth: won / monthCount / sellers,
    conversionPct: created ? (won / created) * 100 : 0,
    revenuePerSellerMonth: revenue / monthCount / sellers,
    averageTicket: won ? revenue / won : 0
  };
}

function buildConservativeAssumptions(historical: ReturnType<typeof sumJanMay2026>): SellerProductivityAssumptions {
  const createdPerSellerMonth = Math.round(historical.createdPerSellerMonth * 0.85);
  const conversionPct = 12;
  const closingsPerSellerMonth = createdPerSellerMonth * (conversionPct / 100);
  const averageTicket = Math.round(historical.averageTicket * 0.94);
  return {
    label: "Conservador individual (H2)",
    createdPerSellerMonth,
    conversionPct,
    closingsPerSellerMonth,
    averageTicket,
    revenuePerSellerMonth: closingsPerSellerMonth * averageTicket,
    sourceNote: `12% conv. (jan–mai/26 real: ${historical.conversionPct.toFixed(1)}%; meta área: 15%). Criação −15% vs média jan–mai. Ticket −6% vs YTD.`
  };
}

function hiresForVariant(variant: "one-hire" | "two-hires"): HirePlan[] {
  const first: HirePlan = {
    id: "hire-1",
    label: "Vendedor 3 (jul)",
    hireMonth: "2026-07",
    rampStartMonth: "2026-08"
  };
  if (variant === "one-hire") return [first];
  return [
    first,
    {
      id: "hire-2",
      label: "Vendedor 4 (set)",
      hireMonth: "2026-09",
      rampStartMonth: "2026-10"
    }
  ];
}

function sellerPay(
  id: string,
  label: string,
  month: string,
  hireMonth: string | null,
  rampStartMonth: string | null,
  revenuePerSellerMonth: number
): SellerMonthPay {
  const onPayroll = hireMonth ? month >= hireMonth : true;
  let rampFactor = 1;
  if (hireMonth && month >= hireMonth) {
    if (!rampStartMonth || month < rampStartMonth) {
      rampFactor = 0;
    } else {
      const rampIndex = monthsBetween(rampStartMonth, month);
      rampFactor = NEW_HIRE_RAMP[Math.min(rampIndex, NEW_HIRE_RAMP.length - 1)];
    }
  }

  const attributedRevenue = Math.round(revenuePerSellerMonth * rampFactor);
  const fixedPay = onPayroll ? COMPENSATION.fixedMonthly : 0;
  const commission = Math.round(attributedRevenue * (COMPENSATION.commissionPct / 100));
  const totalPay = fixedPay + commission;

  return { id, label, rampFactor, attributedRevenue, fixedPay, commission, totalPay };
}

function buildMonthRow(
  month: string,
  variant: "one-hire" | "two-hires",
  conservative: SellerProductivityAssumptions,
  revenueTarget: number,
  cumulative: { revenue: number; target: number }
): VendasScenarioMonth {
  const hires = hiresForVariant(variant);
  const baseSellers = [
    sellerPay("seller-1", "Vendedor 1", month, null, null, conservative.revenuePerSellerMonth),
    sellerPay("seller-2", "Vendedor 2", month, null, null, conservative.revenuePerSellerMonth)
  ];
  const hiredSellers = hires.map((hire) =>
    sellerPay(hire.id, hire.label, month, hire.hireMonth, hire.rampStartMonth, conservative.revenuePerSellerMonth)
  );
  const sellers = [...baseSellers, ...hiredSellers];

  const revenue = sellers.reduce((sum, seller) => sum + seller.attributedRevenue, 0);
  const totalPayroll = sellers.reduce((sum, seller) => sum + seller.totalPay, 0);
  const headcount = sellers.filter((seller) => seller.fixedPay > 0).length;
  const effectiveFte = sellers.reduce((sum, seller) => sum + seller.rampFactor, 0);
  const createdDeals = Math.round(conservative.createdPerSellerMonth * effectiveFte);
  const wonDeals = conservative.closingsPerSellerMonth * effectiveFte;

  cumulative.revenue += revenue;
  cumulative.target += revenueTarget;

  return {
    month,
    label: monthLabel(month),
    headcount,
    effectiveFte: Math.round(effectiveFte * 10) / 10,
    createdDeals,
    wonDeals: Math.round(wonDeals * 10) / 10,
    revenue,
    revenueTarget,
    gapVsRevenueTarget: revenue - revenueTarget,
    cumulativeH2Revenue: Math.round(cumulative.revenue),
    cumulativeH2Target: Math.round(cumulative.target),
    sellers,
    collective: {
      totalPayroll,
      payrollPctOfRevenue: revenue ? (totalPayroll / revenue) * 100 : 0,
      avgPayPerSeller: headcount ? totalPayroll / headcount : 0,
      avgRevenuePerSeller: headcount ? revenue / headcount : 0,
      avgRevenuePerFte: effectiveFte ? revenue / effectiveFte : 0
    }
  };
}

function buildScenario(
  id: string,
  name: string,
  description: string,
  hireTimeline: string,
  variant: "one-hire" | "two-hires",
  conservative: SellerProductivityAssumptions,
  h1Total: number,
  targets: VendasScenariosDashboard["targets"]
): VendasScenario {
  const cumulative = { revenue: 0, target: 0 };
  const months = H2_MONTHS.map((month) =>
    buildMonthRow(month, variant, conservative, targets.h2MonthlyNeeded, cumulative)
  );

  const h2Total = months.reduce((sum, row) => sum + row.revenue, 0);
  const h2PayrollTotal = months.reduce((sum, row) => sum + row.collective.totalPayroll, 0);
  const annualTotal = Math.round(h1Total + h2Total);
  const h2MonthCount = months.length;
  const totalHeadcountMonths = months.reduce((sum, row) => sum + row.headcount, 0);

  return {
    id,
    name,
    description,
    hireTimeline,
    months,
    h2Total,
    h2PayrollTotal,
    h2PayrollPctOfRevenue: h2Total ? (h2PayrollTotal / h2Total) * 100 : 0,
    annualTotal,
    gapVs3M: annualTotal - targets.annual3M,
    gapVs3MPct: ((annualTotal - targets.annual3M) / targets.annual3M) * 100,
    h2GapVs2M: h2Total - targets.h2,
    h2GapVs2MPct: ((h2Total - targets.h2) / targets.h2) * 100,
    avgMonthlyH2: h2Total / h2MonthCount,
    avgRevenuePerSellerH2: h2Total / h2MonthCount / (months.reduce((s, m) => s + m.effectiveFte, 0) / h2MonthCount),
    avgPayPerSellerH2: h2PayrollTotal / totalHeadcountMonths
  };
}

export function buildVendasScenarios(analysis: Analysis): VendasScenariosDashboard {
  const ps = analysis.planningSummary;
  const guide3x = analysis.growthGuides.projection3x;
  const historical = sumJanMay2026(analysis);
  const conservative = buildConservativeAssumptions(historical);

  const h1 = {
    janMayActual: ps.h1Projection.janMayActual,
    juneProjected: ps.h1Projection.juneProjected,
    totalProjected: ps.h1Projection.totalProjected
  };

  const targets = {
    annual3M: guide3x.annualTarget,
    h1: guide3x.h1Target,
    h2: guide3x.h2Target,
    h2MonthlyNeeded: guide3x.h2Target / 6
  };

  const scenarioA = buildScenario(
    "one-hire",
    "Cenário A — 1 vendedor (jul)",
    "PSEL em julho; 3º FTE operando a partir de setembro.",
    "Contratação em jul/26 → ramp 0% ago → 33% set → 66% out → 100% nov",
    "one-hire",
    conservative,
    h1.totalProjected,
    targets
  );

  const scenarioB = buildScenario(
    "two-hires",
    "Cenário B — +1 vendedor em set",
    "Mesmo 1º vendedor de julho + 2ª contratação em setembro.",
    "1º jul/26 (3 FTE set) + 2º set/26 (4 FTE nov) → ramp 0/33/66/100%",
    "two-hires",
    conservative,
    h1.totalProjected,
    targets
  );

  return {
    compensation: COMPENSATION,
    targets,
    h1,
    historicalIndividual: {
      label: "Real jan–mai/26 por vendedor",
      createdPerSellerMonth: Math.round(historical.createdPerSellerMonth * 10) / 10,
      conversionPct: Math.round(historical.conversionPct * 10) / 10,
      closingsPerSellerMonth: Math.round(historical.wonPerSellerMonth * 10) / 10,
      averageTicket: Math.round(historical.averageTicket),
      revenuePerSellerMonth: Math.round(historical.revenuePerSellerMonth),
      sourceNote: "Média com 2 vendedores, jan–mai/2026 (exclui jun parcial)."
    },
    conservativeIndividual: conservative,
    rampNote:
      "Novo vendedor: mês da contratação 0% faturamento (só fixo); 1º mês útil 33%; 2º 66%; 3º em diante 100%. Comissão 10% sobre faturamento individual.",
    scenarios: [scenarioA, scenarioB]
  };
}
