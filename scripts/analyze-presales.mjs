import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { rawDirUrl, processedDirUrl, ensureDataDirs } from './lib/paths.mjs';
ensureDataDirs();

const raw = JSON.parse(await readFile(new URL('chatwoot-conversations.json', rawDirUrl), 'utf8'));
const marketing = JSON.parse(await readFile(new URL('marketing.json', processedDirUrl), 'utf8'));
const processedDir = processedDirUrl;
await mkdir(processedDir, { recursive: true });

const dateInRecife = (value) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const byDate = new Map();
for (const conversation of raw.conversations) {
  const date = dateInRecife(conversation.createdAt);
  const row = byDate.get(date) ?? { date, conversations: 0, contactInitiated: 0, companyInitiated: 0, unknownInitiator: 0, replied: 0, contactReplied: 0, open: 0, resolved: 0 };
  row.conversations += 1;
  if (conversation.initiatedBy === 'contact') row.contactInitiated += 1;
  else if (conversation.initiatedBy === 'company') row.companyInitiated += 1;
  else row.unknownInitiator += 1;
  if (conversation.firstReplyAt) row.replied += 1;
  if (conversation.firstReplyAt && conversation.initiatedBy === 'contact') row.contactReplied += 1;
  if (conversation.status === 'open') row.open += 1;
  if (conversation.status === 'resolved') row.resolved += 1;
  byDate.set(date, row);
}

const dates = [...byDate.keys()].sort();
const marketingByDate = new Map(marketing.daily.map((row) => [row.date, row]));
const daily = [];
if (dates.length) {
  for (let cursor = new Date(`${dates[0]}T12:00:00-03:00`), end = new Date(`${dates.at(-1)}T12:00:00-03:00`); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = dateInRecife(cursor);
    const chatwoot = byDate.get(date) ?? { date, conversations: 0, contactInitiated: 0, companyInitiated: 0, unknownInitiator: 0, replied: 0, contactReplied: 0, open: 0, resolved: 0 };
    const meta = marketingByDate.get(date) ?? {};
    const linkClicks = Number(meta.linkClicks ?? 0);
    const outboundClicks = Number(meta.outboundClicks ?? 0);
    const metaConversations = Number(meta.conversations ?? 0);
    const suspectedGap = chatwoot.conversations === 0 && (metaConversations > 0 || outboundClicks >= 5);
    daily.push({
      ...chatwoot,
      metaSpend: Number(meta.spend ?? 0),
      metaClicks: Number(meta.clicks ?? 0),
      metaLinkClicks: linkClicks,
      metaOutboundClicks: outboundClicks,
      metaLandingPageViews: Number(meta.landingPageViews ?? 0),
      metaConversations,
      chatwootPerLinkClickPct: linkClicks ? chatwoot.contactInitiated / linkClicks * 100 : null,
      chatwootPerOutboundClickPct: outboundClicks ? chatwoot.contactInitiated / outboundClicks * 100 : null,
      suspectedGap
    });
  }
}

const totals = daily.reduce((total, row) => {
  for (const key of ['conversations', 'contactInitiated', 'companyInitiated', 'unknownInitiator', 'replied', 'contactReplied', 'open', 'resolved', 'metaSpend', 'metaClicks', 'metaLinkClicks', 'metaOutboundClicks', 'metaLandingPageViews', 'metaConversations']) total[key] += Number(row[key] ?? 0);
  return total;
}, { conversations: 0, contactInitiated: 0, companyInitiated: 0, unknownInitiator: 0, replied: 0, contactReplied: 0, open: 0, resolved: 0, metaSpend: 0, metaClicks: 0, metaLinkClicks: 0, metaOutboundClicks: 0, metaLandingPageViews: 0, metaConversations: 0 });

function pearson(rows, xKey, yKey) {
  if (rows.length < 3) return null;
  const xMean = rows.reduce((sum, row) => sum + row[xKey], 0) / rows.length;
  const yMean = rows.reduce((sum, row) => sum + row[yKey], 0) / rows.length;
  let numerator = 0;
  let xSquares = 0;
  let ySquares = 0;
  for (const row of rows) {
    const x = row[xKey] - xMean;
    const y = row[yKey] - yMean;
    numerator += x * y;
    xSquares += x * x;
    ySquares += y * y;
  }
  const denominator = Math.sqrt(xSquares * ySquares);
  return denominator ? numerator / denominator : null;
}

const reliableDays = daily.filter((row) => !row.suspectedGap);

const report = {
  generatedAt: new Date().toISOString(),
  syncedAt: raw.syncedAt,
  source: 'Chatwoot Application API + Meta Marketing API',
  account: raw.account,
  inboxes: raw.inboxes,
  coverage: {
    since: dates[0] ?? null,
    until: dates.at(-1) ?? null,
    calendarDays: daily.length,
    daysWithConversations: daily.filter((row) => row.conversations > 0).length,
    zeroDays: daily.filter((row) => row.conversations === 0).length,
    suspectedGapDates: daily.filter((row) => row.suspectedGap).map((row) => row.date),
    note: 'Dias suspeitos são marcados, não preenchidos: Chatwoot zerado enquanto a Meta registrou conversa atribuída ou ao menos 5 cliques externos.'
  },
  totals: {
    ...totals,
    chatwootPerLinkClickPct: totals.metaLinkClicks ? totals.contactInitiated / totals.metaLinkClicks * 100 : null,
    chatwootPerOutboundClickPct: totals.metaOutboundClicks ? totals.contactInitiated / totals.metaOutboundClicks * 100 : null,
    replyCoveragePct: totals.contactInitiated ? totals.contactReplied / totals.contactInitiated * 100 : null
  },
  relationship: {
    reliableDays: reliableDays.length,
    excludedGapDays: daily.length - reliableDays.length,
    linkClicksToChatwootCorrelation: pearson(reliableDays, 'metaLinkClicks', 'contactInitiated'),
    outboundClicksToChatwootCorrelation: pearson(reliableDays, 'metaOutboundClicks', 'contactInitiated'),
    metaAttributedToChatwootCorrelation: pearson(reliableDays, 'metaConversations', 'contactInitiated'),
    note: 'Correlação de Pearson nos dias não marcados como lacuna; indica movimento conjunto, não prova atribuição individual.'
  },
  daily,
  conversations: raw.conversations
};

await writeFile(new URL('presales.json', processedDir), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output: 'data/processed/presales.json', coverage: report.coverage, totals: report.totals }, null, 2));
