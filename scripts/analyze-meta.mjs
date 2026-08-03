import { mkdir, readFile, writeFile } from 'node:fs/promises';

const rawDir = new URL('../data/raw/', import.meta.url);
const processedDir = new URL('../data/processed/', import.meta.url);
await mkdir(processedDir, { recursive: true });

async function readRaw(name) {
  return JSON.parse(await readFile(new URL(name, rawDir), 'utf8'));
}

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function actionValue(actions, matcher) {
  return (actions ?? []).reduce((total, action) => matcher(action.action_type) ? total + number(action.value) : total, 0);
}

function normalizeInsight(row = {}) {
  row = row ?? {};
  const spend = number(row.spend);
  const conversations = actionValue(row.actions, (type) => type === 'onsite_conversion.messaging_conversation_started_7d');
  const landingPageViews = actionValue(row.actions, (type) => type === 'landing_page_view');
  const leads = actionValue(row.actions, (type) => /(^|\.)lead$|meta_leads|leadgen|contact/i.test(type));
  const linkClicks = number(row.inline_link_clicks) || actionValue(row.actions, (type) => type === 'link_click');
  const outboundClicks = actionValue(row.outbound_clicks, (type) => type === 'outbound_click');
  const videoViews = actionValue(row.video_play_actions, () => true) || actionValue(row.actions, (type) => type === 'video_view');
  const video25 = actionValue(row.video_p25_watched_actions, () => true);
  const video50 = actionValue(row.video_p50_watched_actions, () => true);
  const video75 = actionValue(row.video_p75_watched_actions, () => true);
  const video100 = actionValue(row.video_p100_watched_actions, () => true);
  return {
    spend,
    impressions: number(row.impressions),
    reach: number(row.reach),
    frequency: number(row.frequency),
    clicks: number(row.clicks),
    linkClicks,
    outboundClicks,
    landingPageViews,
    conversations,
    leads,
    videoViews,
    video25,
    video50,
    video75,
    video100,
    cpc: number(row.cpc),
    cpm: number(row.cpm),
    ctr: number(row.ctr),
    costPerConversation: conversations ? spend / conversations : null,
    costPerLandingPageView: landingPageViews ? spend / landingPageViews : null,
    costPerLead: leads ? spend / leads : null
  };
}

function mediaInsightValue(media, metric) {
  const row = (media.insights ?? []).find((item) => item.name === metric);
  return number(row?.values?.[0]?.value ?? row?.total_value?.value);
}

const [account, campaigns, adsets, ads, accountPeriods, accountDaily, campaignPeriods, adPeriods, instagramProfile, instagramMedia, instagramAccountInsights, pixel] = await Promise.all([
  readRaw('meta-account.json'),
  readRaw('meta-campaigns.json'),
  readRaw('meta-adsets.json'),
  readRaw('meta-ads.json'),
  readRaw('meta-account-periods.json'),
  readRaw('meta-account-daily.json'),
  readRaw('meta-campaign-periods.json'),
  readRaw('meta-ad-periods.json'),
  readRaw('meta-instagram-profile.json'),
  readRaw('meta-instagram-media.json'),
  readRaw('meta-instagram-account-insights.json'),
  readRaw('meta-pixel.json')
]);

const adsById = new Map(ads.data.map((item) => [item.id, item]));
const campaignsById = new Map(campaigns.data.map((item) => [item.id, item]));

const report = {
  generatedAt: new Date().toISOString(),
  syncedAt: account.syncedAt,
  source: 'Meta Marketing API + Instagram Graph API',
  account: account.data,
  dataQuality: {
    tokenReadOnly: true,
    pixelStatsAvailable: pixel.data.statsAvailable,
    pixelStatsError: pixel.data.statsError,
    notes: [
      'Alcance e frequência agregados vêm diretamente da API para cada período; não devem ser somados entre dias.',
      'Cliques para WhatsApp são representados por conversas iniciadas atribuídas pela Meta.',
      'Pixel e bloqueadores de navegador podem produzir contagens diferentes das sessões do site.'
    ]
  },
  totals: {
    campaigns: campaigns.data.length,
    activeCampaigns: campaigns.data.filter((item) => item.effective_status === 'ACTIVE').length,
    adsets: adsets.data.length,
    activeAdsets: adsets.data.filter((item) => item.effective_status === 'ACTIVE').length,
    ads: ads.data.length,
    activeAds: ads.data.filter((item) => item.effective_status === 'ACTIVE').length
  },
  periods: Object.fromEntries(Object.entries(accountPeriods.data).map(([key, row]) => [key, normalizeInsight(row)])),
  daily: accountDaily.data.map((row) => ({ date: row.date_start, ...normalizeInsight(row) })),
  campaignPeriods: Object.fromEntries(Object.entries(campaignPeriods.data).map(([period, rows]) => [period, rows.map((row) => ({
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    objective: campaignsById.get(row.campaign_id)?.objective ?? null,
    effectiveStatus: campaignsById.get(row.campaign_id)?.effective_status ?? null,
    ...normalizeInsight(row)
  }))])),
  adPeriods: Object.fromEntries(Object.entries(adPeriods.data).map(([period, rows]) => [period, rows.map((row) => {
    const ad = adsById.get(row.ad_id);
    return {
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      adsetId: row.adset_id,
      adsetName: row.adset_name,
      adId: row.ad_id,
      adName: row.ad_name,
      effectiveStatus: ad?.effective_status ?? null,
      creative: ad?.creative ? {
        id: ad.creative.id,
        title: ad.creative.title ?? ad.creative.name ?? row.ad_name,
        body: ad.creative.body ?? null,
        thumbnailUrl: ad.creative.thumbnail_url ?? ad.creative.image_url ?? null,
        videoId: ad.creative.video_id ?? null,
        permalink: ad.creative.instagram_permalink_url ?? (ad.creative.effective_object_story_id ? `https://www.facebook.com/${ad.creative.effective_object_story_id.replace('_', '/posts/')}` : null)
      } : null,
      ...normalizeInsight(row)
    };
  })])),
  instagram: {
    profile: instagramProfile.data,
    accountInsights30d: {
      timeSeries: {
        ok: instagramAccountInsights.data.timeSeries.ok,
        error: instagramAccountInsights.data.timeSeries.error,
        data: instagramAccountInsights.data.timeSeries.payload?.data ?? []
      },
      totals: {
        ok: instagramAccountInsights.data.totals.ok,
        error: instagramAccountInsights.data.totals.error,
        data: instagramAccountInsights.data.totals.payload?.data ?? []
      }
    },
    media: instagramMedia.data.map((media) => {
      const reach = mediaInsightValue(media, 'reach');
      const interactions = mediaInsightValue(media, 'total_interactions') || number(media.like_count) + number(media.comments_count) + mediaInsightValue(media, 'saved') + mediaInsightValue(media, 'shares');
      return {
        id: media.id,
        caption: media.caption ?? '',
        mediaType: media.media_type,
        mediaProductType: media.media_product_type,
        permalink: media.permalink,
        thumbnailUrl: media.thumbnail_url ?? (media.media_type === 'IMAGE' ? media.media_url : null),
        timestamp: media.timestamp,
        likes: number(media.like_count),
        comments: number(media.comments_count),
        reach,
        views: mediaInsightValue(media, 'views'),
        saved: mediaInsightValue(media, 'saved'),
        shares: mediaInsightValue(media, 'shares'),
        interactions,
        engagementRatePct: reach ? interactions / reach * 100 : null,
        averageWatchTimeMs: mediaInsightValue(media, 'ig_reels_avg_watch_time'),
        totalWatchTimeMs: mediaInsightValue(media, 'ig_reels_video_view_total_time'),
        insightsError: media.insightsError
      };
    })
  },
  pixel: pixel.data
};

await writeFile(new URL('marketing.json', processedDir), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  output: 'data/processed/marketing.json',
  daily: report.daily.length,
  campaignRows: Object.values(report.campaignPeriods).reduce((total, rows) => total + rows.length, 0),
  adRows: Object.values(report.adPeriods).reduce((total, rows) => total + rows.length, 0),
  instagramMedia: report.instagram.media.length,
  pixelStatsAvailable: report.pixel.statsAvailable
}, null, 2));
