import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnv } from './lib/env.mjs';
import { rawDirUrl, ensureDataDirs } from './lib/paths.mjs';
ensureDataDirs();

loadEnv();

const outDir = rawDirUrl;
await mkdir(outDir, { recursive: true });

const token = process.env.META_ACCESS_TOKEN?.trim();
const businessId = process.env.META_BUSINESS_ID?.trim();
const adAccountId = process.env.META_AD_ACCOUNT_ID?.trim();
const pageId = process.env.META_PAGE_ID?.trim();
const instagramId = process.env.META_INSTAGRAM_ACCOUNT_ID?.trim();
const pixelId = process.env.META_PIXEL_ID?.trim();
const apiVersion = process.env.META_GRAPH_API_VERSION?.trim() || 'v24.0';
const apiBase = `https://graph.facebook.com/${apiVersion}`;
const syncedAt = new Date().toISOString();
const today = syncedAt.slice(0, 10);
const yearStart = `${today.slice(0, 4)}-01-01`;
const monthStart = `${today.slice(0, 7)}-01`;

const required = { META_ACCESS_TOKEN: token, META_BUSINESS_ID: businessId, META_AD_ACCOUNT_ID: adAccountId, META_PAGE_ID: pageId, META_INSTAGRAM_ACCOUNT_ID: instagramId, META_PIXEL_ID: pixelId };
const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
if (missing.length) throw new Error(`Variáveis Meta ausentes: ${missing.join(', ')}`);

async function writeJson(name, data) {
  await writeFile(new URL(name, outDir), JSON.stringify({ syncedAt, data }, null, 2));
}

async function graph(pathOrUrl, params = {}) {
  const url = pathOrUrl.startsWith('http') ? new URL(pathOrUrl) : new URL(`${apiBase}/${pathOrUrl.replace(/^\//, '')}`);
  if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', token);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && !payload.error) return payload;
    const code = payload.error?.code;
    const retryable = response.status === 429 || response.status >= 500 || code === 1 || code === 2 || code === 4 || code === 17 || code === 32;
    if (!retryable || attempt === 4) {
      throw new Error(`Meta API ${pathOrUrl.startsWith('http') ? 'paginação' : pathOrUrl}: ${payload.error?.message || response.statusText}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 700 * (2 ** (attempt - 1))));
  }
}

async function graphOptional(path, params = {}) {
  try {
    return { ok: true, payload: await graph(path, params), error: null };
  } catch (error) {
    return { ok: false, payload: { data: [] }, error: error.message };
  }
}

async function fetchAll(path, params = {}) {
  const rows = [];
  const visited = new Set();
  let pages = 0;
  let payload = await graph(path, { ...params, limit: params.limit ?? 100 });
  for (;;) {
    pages += 1;
    rows.push(...(payload.data ?? []));
    if (!payload.paging?.next) break;
    const cursor = payload.paging?.cursors?.after ?? payload.paging.next;
    if (visited.has(cursor)) throw new Error(`Paginação repetida da Meta em ${path}`);
    if (pages >= 250) throw new Error(`Limite seguro de paginação atingido em ${path}`);
    visited.add(cursor);
    payload = await graph(payload.paging.next);
  }
  return rows;
}

const insightFields = [
  'spend', 'impressions', 'reach', 'frequency', 'clicks', 'inline_link_clicks', 'outbound_clicks',
  'cpc', 'cpm', 'ctr', 'actions', 'cost_per_action_type', 'video_play_actions',
  'video_p25_watched_actions', 'video_p50_watched_actions', 'video_p75_watched_actions', 'video_p100_watched_actions'
].join(',');

const monthPeriods = {};
for (let cursor = new Date(`${yearStart}T12:00:00Z`); cursor <= new Date(`${today}T12:00:00Z`); cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth();
  const key = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthEnd = new Date(Date.UTC(year, month + 1, 0, 12)).toISOString().slice(0, 10);
  monthPeriods[key] = { since: `${key}-01`, until: monthEnd < today ? monthEnd : today };
}

const periods = {
  last7d: { since: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), until: today },
  last30d: { since: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), until: today },
  month: { since: monthStart, until: today },
  ytd: { since: yearStart, until: today },
  ...monthPeriods
};

console.log('Meta: validando ativos e coletando anúncios...');
const account = await graph(adAccountId, { fields: 'id,name,account_status,currency,timezone_name,amount_spent,balance,business' });
const campaigns = await fetchAll(`${adAccountId}/campaigns`, { fields: 'id,name,status,effective_status,objective,buying_type,created_time,start_time,stop_time,daily_budget,lifetime_budget,updated_time' });
const adsets = await fetchAll(`${adAccountId}/adsets`, { fields: 'id,name,campaign_id,status,effective_status,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,start_time,end_time,created_time,updated_time' });
const ads = await fetchAll(`${adAccountId}/ads`, { fields: 'id,name,status,effective_status,campaign_id,adset_id,created_time,updated_time,creative{id,name,title,body,thumbnail_url,image_url,video_id,object_story_id,instagram_permalink_url,effective_instagram_story_id,effective_object_story_id}' });

const accountPeriods = {};
for (const [key, timeRange] of Object.entries(periods)) {
  const rows = await fetchAll(`${adAccountId}/insights`, { level: 'account', fields: insightFields, time_range: timeRange });
  accountPeriods[key] = rows[0] ?? null;
}

const accountDaily = await fetchAll(`${adAccountId}/insights`, { level: 'account', fields: insightFields, time_range: periods.ytd, time_increment: 1 });
const campaignPeriods = {};
const adPeriods = {};
const adDaily = [];
for (const [key, timeRange] of Object.entries(periods)) {
  console.log(`  Meta Ads: consolidando ${key}...`);
  campaignPeriods[key] = await fetchAll(`${adAccountId}/insights`, { level: 'campaign', fields: `campaign_id,campaign_name,${insightFields}`, time_range: timeRange });
  adPeriods[key] = await fetchAll(`${adAccountId}/insights`, { level: 'ad', fields: `campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,${insightFields}`, time_range: timeRange });
}
for (const [key, timeRange] of Object.entries(monthPeriods)) {
  console.log(`  Meta Ads: histórico diário dos criativos em ${key}...`);
  adDaily.push(...await fetchAll(`${adAccountId}/insights`, { level: 'ad', fields: `campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,${insightFields}`, time_range: timeRange, time_increment: 1, limit: 500 }));
}

console.log('Meta: coletando perfil e publicações do Instagram...');
const instagramProfile = await graph(instagramId, { fields: 'id,username,name,followers_count,follows_count,media_count,profile_picture_url' });
const instagramMedia = await fetchAll(`${instagramId}/media`, { fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count' });
const mediaWithInsights = [];
for (const [index, media] of instagramMedia.entries()) {
  const baseMetrics = 'reach,saved,shares,total_interactions,views';
  const reelMetrics = `${baseMetrics},ig_reels_video_view_total_time,ig_reels_avg_watch_time`;
  let result = await graphOptional(`${media.id}/insights`, { metric: media.media_product_type === 'REELS' ? reelMetrics : baseMetrics });
  if (!result.ok) result = await graphOptional(`${media.id}/insights`, { metric: 'reach,saved,shares,total_interactions' });
  mediaWithInsights.push({ ...media, insights: result.payload.data ?? [], insightsError: result.error });
  if ((index + 1) % 25 === 0) console.log(`  Instagram ${index + 1}/${instagramMedia.length}`);
  await new Promise((resolve) => setTimeout(resolve, 35));
}

const instagramAccountTimeSeries = await graphOptional(`${instagramId}/insights`, {
  metric: 'reach,follower_count', period: 'day', metric_type: 'time_series', since: periods.last30d.since, until: today
});
const instagramAccountTotals = await graphOptional(`${instagramId}/insights`, {
  metric: 'profile_views,website_clicks', period: 'day', metric_type: 'total_value', since: periods.last30d.since, until: today
});

console.log('Meta: consultando saúde do Pixel...');
const pixel = await graph(pixelId, { fields: 'id,name,last_fired_time' });
const pixelStats = await graphOptional(`${pixelId}/stats`, {
  aggregation: 'event', start_time: Math.floor(new Date(`${periods.last30d.since}T00:00:00Z`).getTime() / 1000), end_time: Math.floor(Date.now() / 1000)
});

await Promise.all([
  writeJson('meta-account.json', account),
  writeJson('meta-campaigns.json', campaigns),
  writeJson('meta-adsets.json', adsets),
  writeJson('meta-ads.json', ads),
  writeJson('meta-account-periods.json', accountPeriods),
  writeJson('meta-account-daily.json', accountDaily),
  writeJson('meta-campaign-periods.json', campaignPeriods),
  writeJson('meta-ad-periods.json', adPeriods),
  writeJson('meta-ad-daily.json', adDaily),
  writeJson('meta-instagram-profile.json', instagramProfile),
  writeJson('meta-instagram-media.json', mediaWithInsights),
  writeJson('meta-instagram-account-insights.json', { timeSeries: instagramAccountTimeSeries, totals: instagramAccountTotals }),
  writeJson('meta-pixel.json', { ...pixel, stats: pixelStats.payload.data ?? [], statsAvailable: pixelStats.ok, statsError: pixelStats.error })
]);

console.log(JSON.stringify({
  account: account.name,
  campaigns: campaigns.length,
  activeCampaigns: campaigns.filter((item) => item.effective_status === 'ACTIVE').length,
  adsets: adsets.length,
  ads: ads.length,
  dailyRows: accountDaily.length,
  adDailyRows: adDaily.length,
  instagramMedia: mediaWithInsights.length,
  pixelStatsAvailable: pixelStats.ok
}, null, 2));
