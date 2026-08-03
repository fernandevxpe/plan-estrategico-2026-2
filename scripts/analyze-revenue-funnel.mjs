import { mkdir, readFile, writeFile } from 'node:fs/promises';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const unwrap = (payload) => payload?.data ?? payload;
const marketing = await readJson('../data/processed/marketing.json');
const presales = await readJson('../data/processed/presales.json');
const deals = unwrap(await readJson('../data/raw/pipedrive-deals.json')) ?? [];
const stages = unwrap(await readJson('../data/raw/pipedrive-stages.json')) ?? [];
const dealFields = unwrap(await readJson('../data/raw/pipedrive-deal-fields.json')) ?? [];
const activities = unwrap(await readJson('../data/raw/pipedrive-activities.json')) ?? [];
const flowPayload = unwrap(await readJson('../data/raw/pipedrive-deal-flows.json')) ?? {};
const flowsByDeal = flowPayload.flows ?? {};

const TIMEZONE = 'America/Recife';
const PIPELINES = { consulting: 11, works: 14 };
const generatedAt = new Date();
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: TIMEZONE }).format(generatedAt);
const currentYear = Number(today.slice(0, 4));
const currentMonth = Number(today.slice(5, 7));
const dayMs = 86_400_000;

const dateKey = (value) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat('sv-SE', { timeZone: TIMEZONE }).format(date);
};
const asDate = (value) => {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(String(value)) ? `${String(value).replace(' ', 'T')}Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};
const inRange = (value, start, end) => {
  const key = dateKey(value);
  return key != null && key >= start && key <= end;
};
const sum = (rows, selector) => rows.reduce((total, row) => total + Number(selector(row) ?? 0), 0);
const round = (value, precision = 4) => value == null || !Number.isFinite(value) ? null : Number(value.toFixed(precision));
const ratio = (numerator, denominator) => denominator ? round(numerator / denominator * 100) : null;
const cost = (spend, count) => count ? round(spend / count, 2) : null;
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const durationStats = (values) => ({
  sample: values.length,
  averageDays: values.length ? round(sum(values, (value) => value) / values.length, 2) : null,
  medianDays: round(median(values), 2)
});
const daysBetween = (start, end) => {
  if (!start || !end || end < start) return null;
  return (end.getTime() - start.getTime()) / dayMs;
};
const earliest = (...values) => values.filter(Boolean).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

const stageById = new Map(stages.map((stage) => [Number(stage.id), stage]));
const labelField = dealFields.find((field) => field.key === 'label');
const labelById = new Map((labelField?.options ?? []).map((option) => [String(option.id), String(option.label)]));
const activityByDeal = new Map();
for (const activity of activities) {
  if (!activity.deal_id) continue;
  const key = String(activity.deal_id);
  if (!activityByDeal.has(key)) activityByDeal.set(key, []);
  activityByDeal.get(key).push(activity);
}

function normalizeSeller(deal) {
  const labelNames = String(deal.label ?? '').split(',').map((id) => labelById.get(id.trim()) ?? id.trim());
  const name = `${labelNames.join(' ')} ${deal.owner_name ?? ''} ${deal.user_id?.name ?? ''}`.toUpperCase();
  if (name.includes('GABRIEL')) return 'GABRIEL';
  if (name.includes('IGOR')) return 'IGOR';
  return 'OUTROS';
}

function dealJourney(deal) {
  const pipelineId = Number(deal.pipeline_id);
  const flow = Array.isArray(flowsByDeal[String(deal.id)]) ? flowsByDeal[String(deal.id)] : [];
  const changes = flow
    .filter((event) => event?.data?.field_key === 'stage_id')
    .map((event) => ({
      at: asDate(event.data.log_time ?? event.timestamp),
      oldId: Number(event.data.old_value),
      newId: Number(event.data.new_value)
    }))
    .filter((event) => event.at)
    .sort((a, b) => a.at - b.at);
  const reached = new Set([Number(deal.stage_id)]);
  for (const change of changes) {
    if (Number.isFinite(change.oldId)) reached.add(change.oldId);
    if (Number.isFinite(change.newId)) reached.add(change.newId);
  }
  const dealActivities = activityByDeal.get(String(deal.id)) ?? [];
  const isVisit = (activity) => activity.type === 'visita_diagnostico' || /visita|diagn[oó]stico/i.test(activity.subject ?? '');
  const isProposal = (activity) => activity.type === 'elaborar_proposta' || /proposta/i.test(activity.subject ?? '');
  const visitActivities = dealActivities.filter(isVisit);
  const proposalActivities = dealActivities.filter(isProposal);
  const stageOrderReached = (minimum) => [...reached].some((id) => {
    const stage = stageById.get(id);
    return Number(stage?.pipeline_id) === pipelineId && Number(stage?.order_nr) >= minimum;
  });
  const firstStageAt = (minimum) => earliest(...changes
    .filter((change) => {
      const stage = stageById.get(change.newId);
      return Number(stage?.pipeline_id) === pipelineId && Number(stage?.order_nr) >= minimum;
    })
    .map((change) => change.at));
  const activityAt = (activity) => asDate(activity.due_date && activity.due_time ? `${activity.due_date} ${activity.due_time}:00` : activity.due_date ?? activity.add_time);
  const won = deal.status === 'won';
  const lost = deal.status === 'lost';
  const createdAt = asDate(deal.add_time);
  const visitAt = earliest(firstStageAt(2), ...visitActivities.map(activityAt));
  const proposalAt = earliest(firstStageAt(3), ...proposalActivities.map(activityAt));
  const presentedAt = firstStageAt(4);
  const closedAt = asDate(deal.won_time ?? deal.lost_time ?? deal.close_time);
  return {
    id: deal.id,
    pipelineId,
    scope: pipelineId === PIPELINES.consulting ? 'consulting' : 'works',
    seller: normalizeSeller(deal),
    createdAt,
    createdDate: dateKey(deal.add_time),
    value: Number(deal.value ?? 0),
    won,
    lost,
    open: deal.status === 'open',
    visitScheduled: won || visitActivities.length > 0 || stageOrderReached(2),
    visitCompleted: visitActivities.some((activity) => Boolean(activity.done)),
    proposalBuilt: won || proposalActivities.length > 0 || stageOrderReached(3),
    proposalPresented: won || stageOrderReached(4),
    createdToVisit: daysBetween(createdAt, visitAt),
    visitToProposal: daysBetween(visitAt, proposalAt),
    proposalToPresentation: daysBetween(proposalAt, presentedAt),
    presentationToClose: daysBetween(presentedAt, closedAt),
    totalToClose: daysBetween(createdAt, closedAt)
  };
}

const journeys = deals
  .filter((deal) => [PIPELINES.consulting, PIPELINES.works].includes(Number(deal.pipeline_id)))
  .map(dealJourney)
  .filter((deal) => deal.createdDate?.startsWith(String(currentYear)));

function naturalEnd(year, month) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
function period(kind, key, label, start, naturalEndDate) {
  return { kind, key, label, start, end: naturalEndDate > today ? today : naturalEndDate, partial: naturalEndDate > today };
}
const periodDefinitions = [];
for (let month = 1; month <= currentMonth; month += 1) {
  const key = `${currentYear}-${String(month).padStart(2, '0')}`;
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}-01T12:00:00Z`));
  periodDefinitions.push(period('month', key, label, `${key}-01`, naturalEnd(currentYear, month)));
}
for (let quarter = 1; quarter <= Math.ceil(currentMonth / 3); quarter += 1) {
  const first = (quarter - 1) * 3 + 1;
  const last = quarter * 3;
  periodDefinitions.push(period('quarter', `${currentYear}-Q${quarter}`, `${quarter}º trimestre de ${currentYear}`, `${currentYear}-${String(first).padStart(2, '0')}-01`, naturalEnd(currentYear, last)));
}
for (let half = 1; half <= Math.ceil(currentMonth / 6); half += 1) {
  const first = half === 1 ? 1 : 7;
  const last = half === 1 ? 6 : 12;
  periodDefinitions.push(period('semester', `${currentYear}-H${half}`, `${half}º semestre de ${currentYear}`, `${currentYear}-${String(first).padStart(2, '0')}-01`, naturalEnd(currentYear, last)));
}
periodDefinitions.push(period('year', String(currentYear), `Ano de ${currentYear}`, `${currentYear}-01-01`, `${currentYear}-12-31`));

const marketingDaily = marketing.daily ?? [];
const adDaily = marketing.adDaily ?? [];
const presalesDaily = presales.daily ?? [];
const chatwootSince = presales.coverage?.since ?? null;

function mediaForPeriod(definition) {
  const daily = marketingDaily.filter((row) => inRange(row.date, definition.start, definition.end));
  const ads = new Set(adDaily.filter((row) => inRange(row.date, definition.start, definition.end) && (Number(row.spend) > 0 || Number(row.impressions) > 0)).map((row) => String(row.adId)));
  return {
    spend: round(sum(daily, (row) => row.spend), 2),
    adsDelivered: ads.size,
    impressions: sum(daily, (row) => row.impressions),
    clicks: sum(daily, (row) => row.clicks),
    linkClicks: sum(daily, (row) => row.linkClicks),
    outboundClicks: sum(daily, (row) => row.outboundClicks),
    metaAttributedConversations: sum(daily, (row) => row.conversations)
  };
}

function chatForPeriod(definition) {
  const daily = presalesDaily.filter((row) => inRange(row.date, definition.start, definition.end));
  const coverageStart = chatwootSince && definition.start < chatwootSince ? chatwootSince : definition.start;
  const totalDays = Math.floor((new Date(`${definition.end}T12:00:00Z`) - new Date(`${definition.start}T12:00:00Z`)) / dayMs) + 1;
  const coveredDays = chatwootSince && definition.end >= chatwootSince
    ? Math.max(0, Math.floor((new Date(`${definition.end}T12:00:00Z`) - new Date(`${coverageStart}T12:00:00Z`)) / dayMs) + 1)
    : 0;
  return {
    contactInitiated: sum(daily, (row) => row.contactInitiated),
    companyInitiated: sum(daily, (row) => row.companyInitiated),
    suspectedGapDays: daily.filter((row) => row.suspectedGap).length,
    coverageDays: coveredDays,
    totalDays,
    coveragePct: ratio(coveredDays, totalDays),
    complete: coveredDays === totalDays && daily.every((row) => !row.suspectedGap)
  };
}

function crmForPeriod(definition, scope, seller) {
  const cohort = journeys.filter((deal) =>
    deal.createdDate >= definition.start && deal.createdDate <= definition.end &&
    (scope === 'all' || deal.scope === scope) &&
    (seller === 'TEAM' || deal.seller === seller)
  );
  const opportunities = cohort.length;
  const visitsScheduled = cohort.filter((deal) => deal.visitScheduled).length;
  const visitsCompleted = cohort.filter((deal) => deal.visitCompleted).length;
  const proposalsBuilt = cohort.filter((deal) => deal.proposalBuilt).length;
  const proposalsPresented = cohort.filter((deal) => deal.proposalPresented).length;
  const won = cohort.filter((deal) => deal.won).length;
  const lost = cohort.filter((deal) => deal.lost).length;
  const open = cohort.filter((deal) => deal.open).length;
  const wonValue = sum(cohort.filter((deal) => deal.won), (deal) => deal.value);
  const stageTimes = {
    opportunityToVisit: durationStats(cohort.map((deal) => deal.createdToVisit).filter((value) => value != null)),
    visitToProposal: durationStats(cohort.map((deal) => deal.visitToProposal).filter((value) => value != null)),
    proposalToPresentation: durationStats(cohort.map((deal) => deal.proposalToPresentation).filter((value) => value != null)),
    presentationToClose: durationStats(cohort.map((deal) => deal.presentationToClose).filter((value) => value != null)),
    totalToClose: durationStats(cohort.map((deal) => deal.totalToClose).filter((value) => value != null))
  };
  return {
    scope,
    seller,
    opportunities,
    visitsScheduled,
    visitsCompleted,
    proposalsBuilt,
    proposalsPresented,
    won,
    lost,
    open,
    wonValue: round(wonValue, 2),
    averageWonTicket: won ? round(wonValue / won, 2) : null,
    rates: {
      opportunityToVisitPct: ratio(visitsScheduled, opportunities),
      visitToProposalPct: ratio(proposalsBuilt, visitsScheduled),
      proposalToPresentationPct: ratio(proposalsPresented, proposalsBuilt),
      presentationToWinPct: ratio(won, proposalsPresented),
      cohortWinPct: ratio(won, opportunities),
      cohortLossPct: ratio(lost, opportunities),
      closedWinPct: ratio(won, won + lost)
    },
    stageTimes
  };
}

const scopes = ['all', 'consulting', 'works'];
const sellers = ['TEAM', 'GABRIEL', 'IGOR'];
const periods = periodDefinitions.map((definition) => {
  const media = mediaForPeriod(definition);
  const chatwoot = chatForPeriod(definition);
  const segments = scopes.flatMap((scope) => sellers.map((seller) => crmForPeriod(definition, scope, seller)));
  const team = segments.find((row) => row.scope === 'all' && row.seller === 'TEAM');
  return {
    ...definition,
    media,
    chatwoot,
    observedRates: {
      outboundToChatwootPct: ratio(chatwoot.contactInitiated, media.outboundClicks),
      chatwootToOpportunityPct: ratio(team.opportunities, chatwoot.contactInitiated)
    },
    segments
  };
});

const output = {
  generatedAt: generatedAt.toISOString(),
  timezone: TIMEZONE,
  source: 'Meta Marketing API + Chatwoot Application API + Pipedrive API',
  methodology: {
    acquisitionMatch: 'Agregado por período; ainda não existe identificador determinístico Meta → Chatwoot → Pipedrive.',
    crmCohort: 'Negócios criados no período e avanço acumulado observado até a última sincronização.',
    mediaCac: 'Investimento em tráfego dividido pelos ganhos da coorte; não inclui salários, ferramentas ou mídia orgânica.',
    fullCacAvailable: false,
    chatwootSince,
    warnings: [
      'Taxas até a oportunidade são observadas e não representam atribuição individual.',
      'Períodos anteriores ao início do Chatwoot ou com desconexões permanecem marcados como cobertura parcial.',
      'CAC completo exige custos comerciais, ferramentas, pessoas e atribuição da origem do negócio.'
    ]
  },
  periodKinds: ['month', 'quarter', 'semester', 'year'],
  periods
};

await mkdir(new URL('../data/processed/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/processed/revenue-funnel.json', import.meta.url), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ output: 'data/processed/revenue-funnel.json', periods: periods.length, journeys: journeys.length, latest: periods.filter((row) => row.kind === 'year').at(-1) }, null, 2));
