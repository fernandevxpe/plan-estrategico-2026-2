import marketingJson from '@/data/processed/marketing.json';
import type { Analysis } from '@/lib/analysis/types';

export type MarketingPeriodKey = 'last7d' | 'last30d' | 'month' | 'ytd' | `${number}-${number}`;

export type MarketingMetrics = {
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  linkClicks: number;
  outboundClicks: number;
  landingPageViews: number;
  conversations: number;
  leads: number;
  videoViews: number;
  video25: number;
  video50: number;
  video75: number;
  video100: number;
  cpc: number;
  cpm: number;
  ctr: number;
  costPerConversation: number | null;
  costPerLandingPageView: number | null;
  costPerLead: number | null;
};

export type MarketingPerformanceRow = MarketingMetrics & {
  campaignId?: string;
  campaignName?: string;
  objective?: string | null;
  adId?: string;
  adName?: string;
  adsetName?: string;
  effectiveStatus?: string | null;
  creative?: {
    title: string;
    body: string | null;
    thumbnailUrl: string | null;
    videoId: string | null;
    permalink: string | null;
  } | null;
};

export type MarketingDashboard = {
  generatedAt: string;
  syncedAt: string;
  source: string;
  account: { id: string; name: string; account_status: number; currency: string; timezone_name: string };
  dataQuality: { tokenReadOnly: boolean; pixelStatsAvailable: boolean; pixelStatsError: string | null; notes: string[] };
  totals: { campaigns: number; activeCampaigns: number; adsets: number; activeAdsets: number; ads: number; activeAds: number };
  periods: Record<MarketingPeriodKey, MarketingMetrics>;
  daily: Array<MarketingMetrics & { date: string }>;
  campaignPeriods: Record<MarketingPeriodKey, MarketingPerformanceRow[]>;
  adPeriods: Record<MarketingPeriodKey, MarketingPerformanceRow[]>;
  instagram: {
    profile: { id: string; username: string; name: string; followers_count: number; follows_count: number; media_count: number; profile_picture_url: string };
    media: Array<{
      id: string; caption: string; mediaType: string; mediaProductType: string; permalink: string; thumbnailUrl: string | null; timestamp: string;
      likes: number; comments: number; reach: number; views: number; saved: number; shares: number; interactions: number;
      engagementRatePct: number | null; averageWatchTimeMs: number; totalWatchTimeMs: number;
    }>;
  };
  pixel: { id: string; name: string; last_fired_time: string | null; statsAvailable: boolean; statsError: string | null; stats: unknown[] };
  attribution: {
    metaSpendYtd: number;
    paidTrafficWonDealsYtd: number;
    paidTrafficWonRevenueYtd: number;
    paidTrafficOpenDeals: number;
    paidTrafficOpenValue: number;
    paidTrafficLostDealsYtd: number;
    crmRevenueToSpend: number | null;
    note: string;
  };
};

export function buildMarketingDashboard(analysis: Analysis): MarketingDashboard {
  const data = structuredClone(marketingJson) as unknown as Omit<MarketingDashboard, 'attribution'>;
  const latest = [...(analysis.commercialMonthly ?? [])].sort((a, b) => b.month.localeCompare(a.month))[0];
  const paidWon = latest?.wonYtd.channels.find((row) => row.key === 'Tráfego Pago');
  const paidOpen = latest?.openPotential.channels.find((row) => row.key === 'Tráfego Pago');
  const paidLost = latest?.lostYtd.channels.find((row) => row.key === 'Tráfego Pago');
  const revenue = paidWon?.value ?? 0;
  const spend = data.periods.ytd.spend;

  return {
    ...data,
    attribution: {
      metaSpendYtd: spend,
      paidTrafficWonDealsYtd: paidWon?.deals ?? 0,
      paidTrafficWonRevenueYtd: revenue,
      paidTrafficOpenDeals: paidOpen?.deals ?? 0,
      paidTrafficOpenValue: paidOpen?.value ?? 0,
      paidTrafficLostDealsYtd: paidLost?.deals ?? 0,
      crmRevenueToSpend: spend ? revenue / spend : null,
      note: 'Cruzamento gerencial por origem “Tráfego Pago” no Pipedrive; não é atribuição individual de pessoa nem substitui UTMs/GCLID/Meta Click ID.'
    }
  };
}
