import { readProcessed } from "@/lib/data/processed-store";

export type RevenuePeriodKind = "month" | "quarter" | "semester" | "year";
export type RevenueScope = "all" | "consulting" | "works";
export type RevenueSeller = "TEAM" | "GABRIEL" | "IGOR";

export type DurationMetric = { sample: number; averageDays: number | null; medianDays: number | null };
export type RevenueSegment = {
  scope: RevenueScope;
  seller: RevenueSeller;
  opportunities: number;
  visitsScheduled: number;
  visitsCompleted: number;
  proposalsBuilt: number;
  proposalsPresented: number;
  won: number;
  lost: number;
  open: number;
  wonValue: number;
  averageWonTicket: number | null;
  rates: {
    opportunityToVisitPct: number | null;
    visitToProposalPct: number | null;
    proposalToPresentationPct: number | null;
    presentationToWinPct: number | null;
    cohortWinPct: number | null;
    cohortLossPct: number | null;
    closedWinPct: number | null;
  };
  stageTimes: Record<"opportunityToVisit" | "visitToProposal" | "proposalToPresentation" | "presentationToClose" | "totalToClose", DurationMetric>;
};

export type RevenueFunnelPeriod = {
  kind: RevenuePeriodKind;
  key: string;
  label: string;
  start: string;
  end: string;
  partial: boolean;
  media: {
    spend: number;
    adsDelivered: number;
    impressions: number;
    clicks: number;
    linkClicks: number;
    outboundClicks: number;
    metaAttributedConversations: number;
  };
  chatwoot: {
    contactInitiated: number;
    companyInitiated: number;
    suspectedGapDays: number;
    coverageDays: number;
    totalDays: number;
    coveragePct: number | null;
    complete: boolean;
  };
  observedRates: { outboundToChatwootPct: number | null; chatwootToOpportunityPct: number | null };
  segments: RevenueSegment[];
};

export type RevenueFunnelDashboard = {
  generatedAt: string;
  timezone: string;
  source: string;
  methodology: {
    acquisitionMatch: string;
    crmCohort: string;
    mediaCac: string;
    fullCacAvailable: boolean;
    chatwootSince: string | null;
    warnings: string[];
  };
  periodKinds: RevenuePeriodKind[];
  periods: RevenueFunnelPeriod[];
};

export function buildRevenueFunnelDashboard(): Promise<RevenueFunnelDashboard> {
  return readProcessed<RevenueFunnelDashboard>("revenue-funnel.json");
}
