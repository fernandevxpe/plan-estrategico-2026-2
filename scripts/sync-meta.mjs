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

const TENTATIVAS = 6;
const ESPERA_MAX_MS = 5 * 60_000; // teto: além disso é melhor falhar e tentar amanhã
const uso = { ultimo: 0, pico: 0 };

async function graph(pathOrUrl, params = {}) {
  const url = pathOrUrl.startsWith('http') ? new URL(pathOrUrl) : new URL(`${apiBase}/${pathOrUrl.replace(/^\//, '')}`);
  if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', token);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  for (let attempt = 1; attempt <= TENTATIVAS; attempt += 1) {
    const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && !payload.error) {
      registraUso(response);
      return payload;
    }
    const code = payload.error?.code;
    const retryable = response.status === 429 || response.status >= 500 || code === 1 || code === 2 || code === 4 || code === 17 || code === 32;
    if (!retryable || attempt === TENTATIVAS) {
      throw new Error(`Meta API ${pathOrUrl.startsWith('http') ? 'paginação' : pathOrUrl}: ${payload.error?.message || response.statusText}`);
    }

    // A Meta DIZ quanto falta para a cota voltar, em minutos, no cabeçalho
    // `x-business-use-case-usage`. Ignorar isso e esperar 700 ms é o que fazia
    // o sync morrer sempre no mesmo ponto: o backoff antigo somava ~5 s de
    // espera contra um bloqueio que dura minutos.
    const regaste = minutosParaLiberar(response);
    // Piso de 60s para os códigos 1 e 2. A Meta responde
    // `estimated_time_to_regain_access: 0` mesmo enquanto recusa a consulta —
    // ela não admite estar limitando. Confiar nesse zero produzia backoff de
    // 11 segundos contra uma recusa que dura minutos, e as seis tentativas
    // queimavam em meio minuto sem chance nenhuma de sucesso.
    const piso = code === 1 || code === 2 ? 60_000 : 700;
    const espera = Math.max(piso * 2 ** (attempt - 1), regaste * 60_000);
    const limitada = Math.min(espera, ESPERA_MAX_MS);
    console.log(
      `  Meta: cota estourada (código ${code ?? response.status}), tentativa ${attempt}/${TENTATIVAS}` +
        ` — aguardando ${Math.round(limitada / 1000)}s${regaste ? ` (a Meta pediu ${regaste} min)` : ''}`
    );
    await new Promise((resolve) => setTimeout(resolve, limitada));
  }
}

/**
 * Quantos minutos a Meta pede antes de aceitar chamadas de novo.
 *
 * O cabeçalho traz um objeto por conta de negócio, cada um com
 * `estimated_time_to_regain_access`. Zero significa "não estou bloqueando" —
 * nesse caso o backoff exponencial normal decide.
 */
function minutosParaLiberar(response) {
  try {
    const bruto = response.headers.get('x-business-use-case-usage');
    if (!bruto) return 0;
    return Math.max(
      0,
      ...Object.values(JSON.parse(bruto))
        .flat()
        .map((u) => Number(u?.estimated_time_to_regain_access) || 0)
    );
  } catch {
    return 0;
  }
}

/**
 * Freia ANTES de levar o bloqueio.
 *
 * Reagir ao erro custa uma pausa de minutos; chegar perto do teto e desacelerar
 * custa segundos. A conta está no nível `development_access` do Ads Insights,
 * cuja cota é pequena — o histórico diário por criativo sozinho a consome. Sem
 * este freio o sync alterna entre correr e ficar de castigo.
 */
function registraUso(response) {
  try {
    const bruto = response.headers.get('x-fb-ads-insights-throttle');
    if (!bruto) return;
    const t = JSON.parse(bruto);
    const pico = Math.max(Number(t.app_id_util_pct) || 0, Number(t.acc_id_util_pct) || 0);
    if (pico > uso.pico) uso.pico = pico;
    uso.ultimo = pico;
  } catch {
    /* cabeçalho ausente não é erro: nem toda rota do Graph o envia */
  }
}

/** Pausa proporcional ao quanto da cota já foi gasto. */
async function respiraSePreciso() {
  if (uso.ultimo >= 90) {
    console.log(`  Meta: cota em ${uso.ultimo.toFixed(0)}% — pausando 60s antes de continuar`);
    await new Promise((r) => setTimeout(r, 60_000));
  } else if (uso.ultimo >= 70) {
    await new Promise((r) => setTimeout(r, 5_000));
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
  await respiraSePreciso();
  console.log(`  Meta Ads: consolidando ${key}...`);
  campaignPeriods[key] = await fetchAll(`${adAccountId}/insights`, { level: 'campaign', fields: `campaign_id,campaign_name,${insightFields}`, time_range: timeRange });
  adPeriods[key] = await fetchAll(`${adAccountId}/insights`, { level: 'ad', fields: `campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,${insightFields}`, time_range: timeRange });
}
// O histórico diário por criativo é a consulta mais cara do sync: nível de
// anúncio, dia a dia, um mês por vez. É também a MENOS essencial — campanhas,
// adsets, anúncios e os consolidados mensais já foram coletados acima.
//
// Antes, um mês que falhasse derrubava o processo inteiro e nada era gravado:
// perdiam-se todos os dados já obtidos por causa da fatia mais opcional. Agora
// cada mês é tentado por si, e o que falhar vira lacuna DECLARADA em
// `meta-ad-daily-gaps` — visível para quem lê, em vez de um silêncio que se
// confunde com "não houve anúncio nesse mês".
const adDailyGaps = [];
for (const [key, timeRange] of Object.entries(monthPeriods)) {
  await respiraSePreciso();
  console.log(`  Meta Ads: histórico diário dos criativos em ${key}...`);
  try {
    adDaily.push(...await fetchAll(`${adAccountId}/insights`, { level: 'ad', fields: `campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,${insightFields}`, time_range: timeRange, time_increment: 1, limit: 500 }));
  } catch (error) {
    adDailyGaps.push({ periodo: key, motivo: error.message });
    console.log(`  Meta Ads: ${key} ficou de fora — ${error.message}`);
  }
}
if (adDailyGaps.length) {
  console.log(`  Meta Ads: ${adDailyGaps.length} mês(es) sem histórico diário; o resto do sync segue.`);
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
  writeJson('meta-ad-daily-gaps.json', adDailyGaps),
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
