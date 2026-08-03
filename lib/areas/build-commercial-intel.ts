import commercialIntelJson from "@/data/processed/commercial-intel.json";

export type IntelDistributionRow = {
  key: string;
  deals: number;
  value: number;
  dealsPct: number;
  valuePct: number;
};

export type IntelStageRow = IntelDistributionRow & { stageOrder: number };

export type IntelRelationshipShare = {
  deals: number;
  dealsPct: number;
  valuePct: number;
};

export type IntelGoalRow = {
  month: string;
  start: string;
  end: string;
  target: number;
  progress: number;
  attainmentPct: number | null;
};

export type IntelActivityMonth = {
  month: string;
  completed: number;
  completedCommercial: number;
  meetings: number;
  meetingsPerWeek: number;
  completedPerWeek: number;
  byType: Array<{ type: string; count: number }>;
};

export type IntelMeetingGoal = {
  weeks: number;
  weeklyTarget: number | null;
  weeklyActual: number | null;
  gapPerWeek: number;
  attainmentPct: number | null;
};

export type IntelMonth = {
  month: string;
  isPartial: boolean;
  won: {
    deals: number;
    value: number;
    averageTicket: number;
    byChannel: IntelDistributionRow[];
    bySeller: IntelDistributionRow[];
    relationshipShare: IntelRelationshipShare;
  };
  lost: {
    deals: number;
    value: number;
    byReason: IntelDistributionRow[];
    byChannel: IntelDistributionRow[];
    bySeller: IntelDistributionRow[];
    offCatalogReasons: number;
  };
  created: {
    deals: number;
    value: number;
    byChannel: IntelDistributionRow[];
  };
  cycle: { sample: number; averageDays: number | null; medianDays: number | null };
  winRatePct: number | null;
  goal: IntelGoalRow | null;
  createdGoal: IntelGoalRow | null;
  activities: IntelActivityMonth;
  meetingGoal: IntelMeetingGoal | null;
};

export type IntelOpenPipeline = {
  deals: number;
  value: number;
  zeroValueDeals: number;
  untrackedChannelDeals: number;
  byChannel: IntelDistributionRow[];
  byStage: IntelStageRow[];
  bySeller: IntelDistributionRow[];
  relationshipShare: IntelRelationshipShare;
  bySellerChannel: Array<{
    seller: string;
    deals: number;
    value: number;
    byChannel: IntelDistributionRow[];
    relationshipShare: IntelRelationshipShare;
  }>;
  topDeals: Array<{
    id: number;
    title: string;
    value: number;
    stage: string;
    seller: string | null;
    channel: string;
    ageDays: number | null;
  }>;
};

export type IntelScope = {
  id: string;
  label: string;
  sellers: string[];
  openPipeline: IntelOpenPipeline;
  year: {
    won: {
      deals: number;
      value: number;
      byChannel: IntelDistributionRow[];
      bySeller: IntelDistributionRow[];
      relationshipShare: IntelRelationshipShare;
    };
    lost: {
      deals: number;
      value: number;
      byReason: IntelDistributionRow[];
      byChannel: IntelDistributionRow[];
      offCatalogReasons: number;
    };
    cycle: { sample: number; averageDays: number | null; medianDays: number | null };
    winRatePct: number | null;
  };
  months: IntelMonth[];
};

export type IntelDataQuality = {
  severity: "alta" | "media" | "baixa";
  title: string;
  detail: string;
  metric: number;
};

export type CommercialIntelDashboard = {
  generatedAt: string;
  syncedAt: string | null;
  timezone: string;
  focusYear: string;
  currentMonth: string;
  months: string[];
  source: string;
  methodology: Record<string, string>;
  scopes: IntelScope[];
  meetingGoalWeeks: Array<{
    start: string;
    end: string;
    month: string;
    target: number;
    progress: number;
    attainmentPct: number | null;
  }>;
  dataQuality: IntelDataQuality[];
};

export function buildCommercialIntelDashboard(): CommercialIntelDashboard {
  return structuredClone(commercialIntelJson) as unknown as CommercialIntelDashboard;
}
