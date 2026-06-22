export type ScenarioName =
  | "Conservador"
  | "Ritmo atual"
  | "Realista"
  | "Potencial sazonal 2025"
  | "Base recomendada";

export type YearFilter = "2025" | "2026" | "all";
export type PeriodFilter = "year" | "semester" | "quarter" | "month";
export type MonthKind = "actual" | "partial" | "projected";

export type Monthly = {
  month: string;
  createdDeals: number;
  wonDeals: number;
  wonRevenue: number;
  averageTicket: number;
  revenueGrowthPct: number | null;
};

export type ServiceSummary = {
  service: string;
  wonDeals: number;
  revenue: number;
  averageTicket: number;
  firstWonMonth: string;
  lastWonMonth: string;
};

export type WonDeal = {
  id: number;
  title: string;
  organization: string | null;
  service: string;
  wonMonth: string;
  value: number;
};

export type GrowthComparison = {
  monthNumber: string;
  label: string;
  revenue2025: number | null;
  revenue2026: number | null;
  created2025: number | null;
  created2026: number | null;
  wonDeals2025: number | null;
  wonDeals2026: number | null;
  averageTicket2025: number | null;
  averageTicket2026: number | null;
  revenueMoM2025Pct: number | null;
  revenueMoM2026Pct: number | null;
  revenueYoYPct: number | null;
  createdYoYPct: number | null;
  wonDealsYoYPct: number | null;
};

export type ProjectionScenario = {
  name: string;
  premise: string;
  revenue: number;
  wonDeals: number;
};

export type ProjectionMonth = {
  month: string;
  label: string;
  baselineRevenue2025: number;
  baselineWonDeals2025: number;
  runRateRevenue: number;
  seasonalRevenue: number;
  projectedRevenue: number;
  projectedWonDeals: number;
};

export type CommercialFunnel = {
  month: string;
  createdDeals: number;
  createdValue: number;
  createdWonDeals: number;
  createdLostDeals: number;
  createdStillOpenDeals: number;
  cohortConversionPct: number | null;
  cohortLossPct: number | null;
  wonDeals: number;
  wonValue: number;
  lostDeals: number;
  openBaseDealsEndOfMonth: number;
  openBaseValueEndOfMonth: number;
  averageWonTicket: number;
};

export type BusinessTypeMonthly = {
  month: string;
  type: string;
  wonDeals: number;
  revenue: number;
  averageTicket: number;
  revenueMoMPct: number | null;
  dealsMoMPct: number | null;
  revenueYoYPct: number | null;
  dealsYoYPct: number | null;
};

export type RepeatSale = {
  key: string;
  keyType: string;
  organization: string | null;
  cnpj: string | null;
  wonDeals: number;
  repeatDeals: number;
  totalRevenue: number;
  repeatRevenue: number;
  firstWonMonth: string | null;
  lastWonMonth: string | null;
  types: string;
};

export type PostSalesMonthly = {
  month: string;
  postSalesDealsByCnpj: number;
  postSalesRevenueByCnpj: number;
  repeatDealsByAccount: number;
  repeatRevenueByAccount: number;
  wonDeals: number;
  wonRevenue: number;
  repeatShareByAccountPct: number | null;
};

export type PeriodAggregate = {
  revenue: number;
  wonDeals: number;
  createdDeals: number;
  averageTicket?: number;
  year?: number;
  projected?: boolean;
  isPartial?: boolean;
};

export type Timeline2026Item = {
  month: string;
  label: string;
  kind: MonthKind;
  revenue: number;
  wonDeals: number;
  createdDeals: number;
  projectedRevenue: number | null;
  projectedWonDeals?: number;
};

export type YearProjection = {
  scenario: string;
  h1Projected: number;
  h2Projected: number;
  totalProjected: number;
  wonDealsEstimated: number;
};

export type PlanningInsight = {
  kind: string;
  title: string;
  body: string;
};

export type PlanningSummary = {
  generatedFromMonths: string;
  partialMonth: string;
  runRateMonthly: number;
  runRateWonMonthly: number;
  annual: Record<string, PeriodAggregate>;
  semesters: Record<string, PeriodAggregate>;
  quarters: Record<string, PeriodAggregate>;
  h1Projection: {
    janMayActual: number;
    juneActual: number;
    juneProjected: number;
    totalProjected: number;
    runRateMonthly: number;
  };
  yearProjectionByScenario: YearProjection[];
  timeline2026: Timeline2026Item[];
  insights: PlanningInsight[];
  defaultScenario: string;
  baseYearTotal2026: number;
};

export type Analysis = {
  generatedAt: string;
  totals: {
    pipedriveDealsAll: number;
    clickupTasksAll: number;
    analysisDeals: number;
    wonDeals: number;
    focus2026Deals: number;
  };
  monthly: Monthly[];
  commercialFunnel: CommercialFunnel[];
  growthComparison: GrowthComparison[];
  projection2026H2: {
    basis: {
      completedMonthsUsed: string;
      h1LikeRevenue2025: number;
      h1LikeRevenue2026: number;
      h2Revenue2025: number;
      h2WonDeals2025: number;
      h2CreatedDeals2025: number;
      yoyGrowthFactor: number;
      yoyGrowthPct: number;
      rawSeasonalityLiftPct?: number;
      realisticSeasonalityLiftPct?: number;
    };
    scenarios: ProjectionScenario[];
    months: ProjectionMonth[];
  };
  planningSummary: PlanningSummary;
  indicatorHighlights: IndicatorHighlights;
  businessTypeMonthly: BusinessTypeMonthly[];
  cnpjCoverage: {
    organizations: number;
    organizationsWithCnpj: number;
    wonDealsWithCnpj: number;
    wonDeals: number;
  };
  postSalesByCnpj: RepeatSale[];
  repeatSalesByAccount: RepeatSale[];
  postSalesMonthly: PostSalesMonthly[];
  serviceSummary: ServiceSummary[];
  wonDeals: WonDeal[];
  clickupProjectCandidates: unknown[];
};

export type PlanningFilters = {
  scenario: ScenarioName;
  year: YearFilter;
  period: PeriodFilter;
  selectedMonth: string | null;
};

export type ExecutiveKpis = {
  revenue2025: number;
  wonDeals2025: number;
  revenue2026Ytd: number;
  wonDeals2026Ytd: number;
  projected2026H1: number;
  projected2026H2: number;
  projected2026Total: number;
  growthVs2025Pct: number;
  scenarioName: string;
};

export type TableRow = {
  key: string;
  label: string;
  month?: string;
  createdDeals: number;
  wonDeals: number;
  revenue: number;
  averageTicket: number;
  revenueMoMPct: number | null;
  revenueYoYPct: number | null;
  kind: MonthKind | "aggregate";
  selectable: boolean;
};

export type MonthDetail = {
  month: string;
  label: string;
  revenue: number;
  wonDeals: number;
  createdDeals: number;
  averageTicket: number;
  revenueYoYPct: number | null;
  revenueMoMPct: number | null;
  kind: MonthKind;
  businessTypes: BusinessTypeMonthly[];
  deals: WonDeal[];
};

export type BridgeItem = {
  label: string;
  value: number;
  type: "base" | "increment" | "total";
};

export type QuarterlySeriesItem = {
  key: string;
  label: string;
  revenue2025: number;
  revenue2026: number;
  revenue2026Projected: number;
};

export type RecordEvent = {
  metric: string;
  metricLabel: string;
  month: string;
  value: number;
  previousBest: number | null;
  previousBestMonth: string | null;
  unit: string;
  isFirstRecord: boolean;
};

export type MetricRecord = {
  metric: string;
  metricLabel: string;
  unit: string;
  recordMonth: string | null;
  recordValue: number | null;
  events: RecordEvent[];
};

export type YoYImprovement = {
  month: string;
  label: string;
  metric: string;
  metricLabel: string;
  value2026: number | null;
  value2025: number | null;
  changePct: number;
};

export type TypePeak = {
  type: string;
  month: string;
  revenue: number;
  wonDeals: number;
  averageTicket: number;
};

export type IndicatorRecommendation = {
  kind: string;
  title: string;
  body: string;
};

export type IndicatorHighlights = {
  partialMonthExcludedFromRecords: string;
  metricRecords: MetricRecord[];
  recordTimeline: RecordEvent[];
  recordsBrokenIn2026: RecordEvent[];
  yoyImprovements: YoYImprovement[];
  typePeaks: TypePeak[];
  topMonthsByRevenue: Array<{
    month: string;
    revenue: number;
    wonDeals: number;
    createdDeals: number;
    averageTicket: number;
    cohortConversionPct: number | null;
  }>;
  recommendations: IndicatorRecommendation[];
  summary: {
    totalRecordEvents: number;
    recordsIn2026: number;
    bestRevenueMonth: string | null;
    bestRevenueValue: number | null;
    bestConversionMonth: string | null;
    bestConversionValue: number | null;
    bestCreatedMonth: string | null;
    bestCreatedValue: number | null;
  };
};
