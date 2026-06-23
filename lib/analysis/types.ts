export type ScenarioName =
  | "Conservador"
  | "Ritmo atual"
  | "Realista recomendado";

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
  primaryBusinessType?: string;
  businessTypes?: string[];
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
  matureCohortMinAgeDays?: number;
  cohortAgeDays?: number;
  isMatureCohort?: boolean;
  matureConversionPct?: number | null;
  closedConversionPct?: number | null;
  closedDealsFromCohort?: number;
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

export type SameMonthMultiService = {
  key: string;
  month: string;
  confidence: "same_month_multi_service";
  organization: string | null;
  cnpj: string | null;
  wonDeals: number;
  revenue: number;
  types: string;
};

export type DataQualityAlert = {
  id: string;
  severity: "low" | "medium" | "high";
  title: string;
  message: string;
  count: number;
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
    aggressiveScenarios?: ProjectionScenario[];
    months: ProjectionMonth[];
  };
  planningSummary: PlanningSummary;
  indicatorHighlights: IndicatorHighlights;
  deepAnalysis: DeepAnalysis;
  growthGuides: GrowthGuides;
  businessTypeMonthly: BusinessTypeMonthly[];
  cnpjCoverage: {
    organizations: number;
    organizationsWithCnpj: number;
    wonDealsWithCnpj: number;
    wonDeals: number;
  };
  postSalesByCnpj: RepeatSale[];
  repeatSalesByAccount: RepeatSale[];
  repeatSalesByAccountName?: RepeatSale[];
  sameMonthMultiService?: SameMonthMultiService[];
  postSalesConfidence?: {
    cnpjExact: { accounts: number; repeatRevenue: number; confidence: string };
    accountName: { accounts: number; repeatRevenue: number; confidence: string };
    sameMonthMultiService: { accounts: number; revenue: number; confidence: string };
  };
  postSalesMonthly: PostSalesMonthly[];
  dataQualityAlerts?: DataQualityAlert[];
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

export type TimeToCloseMonth = {
  month: string;
  wonDeals: number;
  averageDays: number;
  medianDays: number | null;
  revenue: number;
};

export type RevenueOriginMonth = {
  month: string;
  totalRevenue: number;
  newRevenue: number;
  repeatRevenue: number;
  newDeals: number;
  repeatDeals: number;
  newSharePct: number | null;
  repeatSharePct: number | null;
};

export type StageFunnelRow = {
  pipelineId: number | null;
  pipeline: string;
  stageId: number | null;
  stage: string;
  stageOrder: number;
  deals: number;
  value: number;
  averageValue: number;
};

export type PerformanceAlert = {
  month: string;
  severity: "high" | "medium";
  declineCount: number;
  metrics: Array<{
    metric: string;
    metricLabel: string;
    currentValue: number;
    previousValue: number;
    changePct: number;
  }>;
  message: string;
};

export type DeepAnalysis = {
  timeToClose: {
    byMonth: TimeToCloseMonth[];
    overallAverageDays: number | null;
    fastestMonth: TimeToCloseMonth | null;
    slowestMonth: TimeToCloseMonth | null;
    peakRevenueMonth: string | null;
    peakRevenueCycleDays: number | null;
  };
  revenueOrigin: {
    byMonth: RevenueOriginMonth[];
    totals: {
      newRevenue: number;
      repeatRevenue: number;
      newSharePct: number | null;
    };
  };
  funnelByStage: {
    open: StageFunnelRow[];
    lost: StageFunnelRow[];
    won: StageFunnelRow[];
    summary: {
      openDeals: number;
      openValue: number;
      lostDeals: number;
      lostValue: number;
      topOpenStage: StageFunnelRow | null;
      topLostStage: StageFunnelRow | null;
    };
  };
  peakMix: {
    peaks: Array<{
      month: string;
      revenue: number;
      types: Array<{ type: string; revenue: number; wonDeals: number; sharePct: number }>;
      dominantType: string | null;
    }>;
    patterns: Array<{ month: string; headline: string; topTypes: string[]; insight: string }>;
    benchmarkTypes: Array<{ type: string; averageRevenue: number; monthsActive: number }>;
  };
  performanceAlerts: PerformanceAlert[];
  investigationNotes: IndicatorRecommendation[];
};

export type GrowthGuideAction = {
  priority: "critical" | "high" | "medium";
  title: string;
  detail: string;
  metric?: string;
  target?: string;
};

export type GrowthGuidePillar = {
  id: string;
  title: string;
  subtitle: string;
  actions: GrowthGuideAction[];
};

export type GrowthGuideMonthTarget = {
  month: string;
  label: string;
  revenueTarget: number;
  wonDealsTarget: number;
  averageTicketTarget: number;
  createdDealsTarget: number;
  conversionTargetPct: number;
  baseline2025Revenue: number;
  baseProjectionRevenue: number;
  gapVsBase: number;
  cumulativeRevenue: number;
  adSpend: number;
  costPerClosing: number | null;
  perCommercial: {
    closings: number;
    revenue: number;
    newDeals: number;
  };
  perProjectista: {
    activeProjects: number;
  };
  workloadByType: Array<{
    type: string;
    projects: number;
    revenue: number;
  }>;
};

export type GrowthGuideTrafficMonth = {
  month: string;
  label: string;
  adSpend: number;
  wonDealsTarget: number;
  costPerClosing: number | null;
  semester: "H1" | "H2";
};

export type GrowthGuideOperationalCapacity = {
  commercialTeam: {
    currentHeadcount: number;
    recommendedHeadcount: number;
    hireTrigger: string;
    perPersonH1: {
      monthlyClosings: number;
      monthlyRevenue: number;
      monthlyNewDeals: number;
    };
    perPersonH2: {
      monthlyClosings: number;
      monthlyRevenue: number;
      monthlyNewDeals: number;
    };
  };
  deliveryTeam: {
    projectistasHistorical: number;
    projectistasCurrent: number;
    automationNote: string;
    historicalProjectsPerPerson: number;
    h2ProjectsPerPerson: number;
    capacityStatus: "ok" | "attention" | "critical";
    capacityNote: string;
  };
};

export type GrowthGuide = {
  id: "2x" | "3x";
  name: string;
  tagline: string;
  premise: string;
  annualTarget: number;
  h1Target: number;
  h2Target: number;
  annualGapVsBase: number;
  h1GapVsProjected: number;
  h2GapVsBase: number;
  h2MultiplierVs2025: number;
  recurrenceNote: string;
  baseline: {
    h1Projected: number;
    h2Base: number;
    annualBase: number;
    h2Revenue2025: number;
    h2WonDeals2025: number;
  };
  monthlyTargets: GrowthGuideMonthTarget[];
  h1MonthlyTargets: GrowthGuideMonthTarget[];
  fullYearPlan: GrowthGuideMonthTarget[];
  kpis: {
    h2AverageMonthlyRevenue: number;
    h2AverageWonDeals: number;
    h2AverageTicket: number;
    h2AverageCreatedDeals: number;
    h2AverageConversionPct: number;
    currentH1: {
      averageRevenue: number;
      averageWonDeals: number;
      averageTicket: number;
      averageCreatedDeals: number;
      averageConversionPct: number;
    };
    uplift: {
      revenuePct: number;
      wonDealsPct: number;
      ticketPct: number;
      createdDealsPct: number;
      conversionPts: number;
    };
  };
  typeMix: Array<{
    type: string;
    revenueSharePct: number;
    revenueTarget: number;
    wonDealsTarget: number;
    averageTicket: number;
    annualProjects: number;
  }>;
  typeMixAnnual: Array<{
    type: string;
    revenueSharePct: number;
    revenueTarget: number;
    wonDealsTarget: number;
    averageTicket: number;
  }>;
  operationalCapacity: GrowthGuideOperationalCapacity;
  trafficInvestment: {
    h1Total: number;
    h2Total: number;
    annualTotal: number;
    h1ScheduleNote: string;
    monthly: GrowthGuideTrafficMonth[];
    averageCostPerClosing: number | null;
    note: string;
  };
  pillars: GrowthGuidePillar[];
  milestones: Array<{
    month: string;
    label: string;
    cumulativeTarget: number;
    checkpoint: string;
  }>;
  risks: Array<{ title: string; mitigation: string }>;
};

export type GrowthGuides = {
  projection2x: GrowthGuide;
  projection3x: GrowthGuide;
};
