import type {
  MarketingDailyCreativeRow,
  MarketingDashboard,
  MarketingPerformanceRow
} from "@/lib/areas/build-marketing-dashboard";

export type MarketingHistoryPoint = {
  date: string;
  label: string;
  spend: number;
  clicks: number;
  outboundClicks: number;
  conversations: number;
  impressions: number;
};

export type AdCampaignRef = {
  campaignId: string;
  campaignName: string;
};

/** Mapa adId → campanha a partir dos períodos já agregados (funciona sem re-sync). */
export function buildAdCampaignIndex(data: MarketingDashboard): Map<string, AdCampaignRef> {
  const map = new Map<string, AdCampaignRef>();
  for (const rows of Object.values(data.adPeriods)) {
    for (const row of rows) {
      if (!row.adId || !row.campaignId) continue;
      map.set(row.adId, {
        campaignId: row.campaignId,
        campaignName: row.campaignName ?? "Campanha"
      });
    }
  }
  for (const row of data.adDaily ?? []) {
    if (!row.adId || !row.campaignId || map.has(row.adId)) continue;
    map.set(row.adId, {
      campaignId: row.campaignId,
      campaignName: row.campaignName ?? "Campanha"
    });
  }
  return map;
}

function shortLabel(date: string) {
  return date.slice(5).replace("-", "/");
}

function emptyPoint(date: string): MarketingHistoryPoint {
  return {
    date,
    label: shortLabel(date),
    spend: 0,
    clicks: 0,
    outboundClicks: 0,
    conversations: 0,
    impressions: 0
  };
}

function mergePoint(target: MarketingHistoryPoint, row: MarketingDailyCreativeRow) {
  target.spend += row.spend;
  target.clicks += row.clicks;
  target.outboundClicks += row.outboundClicks;
  target.conversations += row.conversations;
  target.impressions += row.impressions;
}

/** Histórico completo do anúncio (lançamento → último dia com entrega). */
export function buildAdHistory(
  adDaily: MarketingDailyCreativeRow[],
  adId: string
): MarketingHistoryPoint[] {
  const map = new Map<string, MarketingHistoryPoint>();
  for (const row of adDaily) {
    if (row.adId !== adId) continue;
    if (!(row.spend > 0 || row.impressions > 0 || row.clicks > 0 || row.conversations > 0)) continue;
    const point = map.get(row.date) ?? emptyPoint(row.date);
    mergePoint(point, row);
    map.set(row.date, point);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Histórico da campanha somando todos os anúncios. */
export function buildCampaignHistory(
  adDaily: MarketingDailyCreativeRow[],
  adIndex: Map<string, AdCampaignRef>,
  campaignId: string
): MarketingHistoryPoint[] {
  const map = new Map<string, MarketingHistoryPoint>();
  for (const row of adDaily) {
    const campaign =
      row.campaignId === campaignId
        ? campaignId
        : adIndex.get(row.adId)?.campaignId;
    if (campaign !== campaignId) continue;
    if (!(row.spend > 0 || row.impressions > 0 || row.clicks > 0 || row.conversations > 0)) continue;
    const point = map.get(row.date) ?? emptyPoint(row.date);
    mergePoint(point, row);
    map.set(row.date, point);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function summarizeHistory(points: MarketingHistoryPoint[]) {
  const totals = points.reduce(
    (acc, row) => {
      acc.spend += row.spend;
      acc.clicks += row.clicks;
      acc.outboundClicks += row.outboundClicks;
      acc.conversations += row.conversations;
      acc.impressions += row.impressions;
      return acc;
    },
    { spend: 0, clicks: 0, outboundClicks: 0, conversations: 0, impressions: 0 }
  );
  return {
    ...totals,
    days: points.length,
    firstDate: points[0]?.date ?? null,
    lastDate: points.at(-1)?.date ?? null,
    cpc: totals.clicks ? totals.spend / totals.clicks : null,
    costPerConversation: totals.conversations ? totals.spend / totals.conversations : null
  };
}

export function adsForCampaign(
  rows: MarketingPerformanceRow[],
  campaignId: string
): MarketingPerformanceRow[] {
  return rows
    .filter((row) => row.campaignId === campaignId && row.spend > 0)
    .sort((a, b) => b.spend - a.spend);
}
