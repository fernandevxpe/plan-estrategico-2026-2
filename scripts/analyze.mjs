import { mkdir, readFile, writeFile } from 'node:fs/promises';

const rawDir = new URL('../data/raw/', import.meta.url);
const processedDir = new URL('../data/processed/', import.meta.url);
const reportsDir = new URL('../reports/', import.meta.url);
await mkdir(processedDir, { recursive: true });
await mkdir(reportsDir, { recursive: true });

async function readJson(name) {
  const parsed = JSON.parse(await readFile(new URL(name, rawDir), 'utf8'));
  return parsed.data;
}

async function readOptionalJson(name, fallback = []) {
  try {
    return await readJson(name);
  } catch {
    return fallback;
  }
}

function monthKey(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 7);
}

function yearOfMonth(month) {
  return month ? Number(month.slice(0, 4)) : null;
}

function money(value) {
  const number = Number(value || 0);
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function pct(value) {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

async function writeCsv(name, rows) {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [
    keys.join(';'),
    ...rows.map((row) => keys.map((key) => csvEscape(row[key])).join(';'))
  ];
  await writeFile(new URL(name, processedDir), `${lines.join('\n')}\n`);
}

function sum(items, selector) {
  return items.reduce((total, item) => total + Number(selector(item) || 0), 0);
}

function groupBy(items, selector) {
  const map = new Map();
  for (const item of items) {
    const key = selector(item) ?? 'Sem classificacao';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.entries()];
}

function optionMap(field) {
  const map = new Map();
  for (const option of field.options ?? []) map.set(String(option.id), option.label);
  return map;
}

function fieldValueLabel(value, field) {
  if (value == null || value === '') return null;
  if (!field?.options?.length) return typeof value === 'object' ? JSON.stringify(value) : String(value);
  const options = optionMap(field);
  if (Array.isArray(value)) return value.map((item) => options.get(String(item)) ?? String(item)).join(', ');
  return options.get(String(value)) ?? String(value);
}

function normalizeText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeDocument(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

function normalizeAccountName(value) {
  return normalizeText(value)
    .replace(/\b(condominio|cond|edificio|edf|ed|residencial|empresarial|negocio|do|da|de|dos|das)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseSetIds(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.map(String);
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function inferService(deal, dealFieldsByKey) {
  const pipeline = normalizeText(deal.pipeline_name);
  if (pipeline.includes('obra')) return 'Obras eletricas';
  if (pipeline.includes('laudos') || pipeline.includes('condo')) return 'Laudos e consultoria condominial';

  const serviceFields = Object.entries(dealFieldsByKey)
    .filter(([, field]) => /servi|produto|solu|escopo|tipo/i.test(`${field.name} ${field.key}`));

  for (const [key, field] of serviceFields) {
    const label = fieldValueLabel(deal[key], field);
    if (label) return label;
  }

  const text = ` ${normalizeText([deal.title, deal.stage_name, deal.pipeline_name].join(' '))} `;
  const rules = [
    ['IA / Automacao', [' inteligencia artificial ', ' automacao ', ' chatbot ', ' agente ia ', ' consultor ia ']],
    ['Energia solar', [' fotovolta', ' usina solar ']],
    ['Carregadores / Mobilidade eletrica', ['carregador', 'recarga', 'veicular', 'eletromobilidade', 'wallbox']],
    ['Consultoria estrategica', ['consultoria', 'planejamento', 'estrategico']],
    ['Gestao de energia', ['gestao de energia', 'rateio', 'mercado livre', 'energia']],
    ['Projeto eletrico', ['projeto eletrico', 'subestacao', 'spda', 'laudo']]
  ];

  for (const [service, terms] of rules) {
    if (terms.some((term) => text.includes(term))) return service;
  }

  return 'Nao classificado';
}

function monthlyRows(deals) {
  const months = [...new Set(deals.flatMap((deal) => [deal.createdMonth, deal.wonMonth]).filter(Boolean))].sort();
  return months.map((month, index) => {
    const created = deals.filter((deal) => deal.createdMonth === month);
    const won = deals.filter((deal) => deal.wonMonth === month);
    const revenue = sum(won, (deal) => deal.value);
    const previousRevenue = index > 0
      ? sum(deals.filter((deal) => deal.wonMonth === months[index - 1]), (deal) => deal.value)
      : null;
    return {
      month,
      createdDeals: created.length,
      wonDeals: won.length,
      wonRevenue: revenue,
      averageTicket: won.length ? revenue / won.length : 0,
      revenueGrowthPct: previousRevenue ? ((revenue - previousRevenue) / previousRevenue) * 100 : null
    };
  });
}

const [dealsRaw, fieldsRaw, orgFieldsRaw, organizationsRaw, pipelinesRaw, stagesRaw, clickupTasksRaw] = await Promise.all([
  readJson('pipedrive-deals.json'),
  readJson('pipedrive-deal-fields.json'),
  readOptionalJson('pipedrive-organization-fields.json'),
  readOptionalJson('pipedrive-organizations.json'),
  readJson('pipedrive-pipelines.json'),
  readJson('pipedrive-stages.json'),
  readJson('clickup-tasks.json')
]);

const fieldsByKey = Object.fromEntries(fieldsRaw.map((field) => [field.key, field]));
const orgFieldsByKey = Object.fromEntries(orgFieldsRaw.map((field) => [field.key, field]));
const pipelineById = Object.fromEntries(pipelinesRaw.map((pipeline) => [pipeline.id, pipeline]));
const stageById = Object.fromEntries(stagesRaw.map((stage) => [stage.id, stage]));
const organizationById = Object.fromEntries(organizationsRaw.map((org) => [org.id, org]));
const labelField = fieldsByKey.label;
const labelById = Object.fromEntries((labelField?.options ?? []).map((option) => [String(option.id), option.label]));
const businessTypeLabels = new Set([
  'LIE - Laudo de Instalações Elétricas',
  'LGR - Laudo de Gerenciamento de Risco',
  'LDC - Laudo de disponibilidade de carga',
  'LCC - Laudo Carregador Coletivo',
  'ICV - Inspeção de carregador veicular',
  'PIE - Projeto infra.  Eletrocalha e Emergência',
  'OBRA',
  'PROJETOS',
  'LSPDA',
  'CDM',
  'Instalação de Carregador Eletrico'
]);
const cnpjField = orgFieldsRaw.find((field) => /cnpj/i.test(field.name));

function dealOrgId(deal) {
  return typeof deal.org_id === 'object' ? deal.org_id?.value : deal.org_id;
}

function businessTypesForDeal(deal, fallbackService) {
  const labels = parseSetIds(deal.label).map((id) => labelById[id] ?? id);
  const types = labels.filter((label) => businessTypeLabels.has(label));
  if (types.length) return types;
  return [fallbackService || 'Sem tipo comercial'];
}

const deals = dealsRaw.map((deal) => {
  const pipeline = pipelineById[deal.pipeline_id];
  const stage = stageById[deal.stage_id];
  const orgId = dealOrgId(deal);
  const organization = organizationById[orgId];
  const service = inferService({ ...deal, stage_name: stage?.name, pipeline_name: pipeline?.name }, fieldsByKey);
  const cnpj = normalizeDocument(cnpjField ? organization?.[cnpjField.key] : null);
  const orgName = deal.org_name ?? deal.org_id?.name ?? organization?.name ?? null;
  return {
    id: deal.id,
    title: deal.title,
    status: deal.status,
    value: Number(deal.value || 0),
    currency: deal.currency,
    addTime: deal.add_time,
    wonTime: deal.won_time,
    closeTime: deal.close_time,
    createdMonth: monthKey(deal.add_time),
    wonMonth: monthKey(deal.won_time),
    lostMonth: monthKey(deal.lost_time),
    closedMonth: monthKey(deal.close_time),
    pipeline: pipeline?.name ?? null,
    stage: stage?.name ?? null,
    organizationId: orgId ?? null,
    organization: orgName,
    accountKey: cnpj ? `cnpj:${cnpj}` : `org:${normalizeAccountName(orgName || deal.title)}`,
    accountKeyType: cnpj ? 'cnpj' : 'organization_name',
    cnpj,
    channel: fieldValueLabel(deal.channel, fieldsByKey.channel) ?? deal.channel ?? null,
    origin: fieldValueLabel(deal.origin, fieldsByKey.origin) ?? deal.origin ?? null,
    labels: parseSetIds(deal.label).map((id) => labelById[id] ?? id),
    businessTypes: businessTypesForDeal(deal, service),
    person: deal.person_name ?? deal.person_id?.name ?? null,
    service
  };
});

const tasks = clickupTasksRaw.map((task) => ({
  id: task.id,
  name: task.name,
  status: task.status?.status ?? task.status,
  createdMonth: monthKey(Number(task.date_created)),
  closedMonth: monthKey(Number(task.date_closed)),
  dueMonth: monthKey(Number(task.due_date)),
  list: task.list_name,
  folder: task.folder_name,
  space: task.space_name,
  url: task.url
}));

const analysisDeals = deals.filter((deal) =>
  [deal.createdMonth, deal.wonMonth, deal.lostMonth, deal.closedMonth].some((month) => [2025, 2026].includes(yearOfMonth(month)))
);
const wonDeals = analysisDeals.filter((deal) => deal.status === 'won' && deal.wonMonth);
const focus2026 = analysisDeals.filter((deal) => deal.createdMonth?.startsWith('2026') || deal.wonMonth?.startsWith('2026'));
const monthly = monthlyRows(analysisDeals).filter((row) => row.month >= '2025-01' && row.month <= '2026-12');

const allWonDeals = deals
  .filter((deal) => deal.status === 'won' && deal.wonMonth)
  .sort((a, b) => String(a.wonTime).localeCompare(String(b.wonTime)));
const accountSeen = new Map();
const cnpjSeen = new Map();
for (const deal of allWonDeals) {
  deal.isPostSaleByAccount = accountSeen.has(deal.accountKey);
  deal.previousAccountWonDeals = accountSeen.get(deal.accountKey) ?? 0;
  accountSeen.set(deal.accountKey, (accountSeen.get(deal.accountKey) ?? 0) + 1);
  if (deal.cnpj) {
    deal.isPostSaleByCnpj = cnpjSeen.has(deal.cnpj);
    deal.previousCnpjWonDeals = cnpjSeen.get(deal.cnpj) ?? 0;
    cnpjSeen.set(deal.cnpj, (cnpjSeen.get(deal.cnpj) ?? 0) + 1);
  } else {
    deal.isPostSaleByCnpj = false;
    deal.previousCnpjWonDeals = 0;
  }
}

const commercialFunnel = monthly.map((row) => {
  const created = deals.filter((deal) => deal.createdMonth === row.month);
  const createdWon = created.filter((deal) => deal.status === 'won');
  const createdLost = created.filter((deal) => deal.status === 'lost');
  const wonInMonth = deals.filter((deal) => deal.wonMonth === row.month);
  const lostInMonth = deals.filter((deal) => deal.lostMonth === row.month);
  const openAtEnd = deals.filter((deal) => {
    if (!deal.createdMonth || deal.createdMonth > row.month) return false;
    if (!deal.closedMonth) return deal.status === 'open';
    return deal.closedMonth > row.month;
  });
  const createdValue = sum(created, (deal) => deal.value);
  const wonValue = sum(wonInMonth, (deal) => deal.value);
  const openValue = sum(openAtEnd, (deal) => deal.value);
  return {
    month: row.month,
    createdDeals: created.length,
    createdValue,
    createdWonDeals: createdWon.length,
    createdLostDeals: createdLost.length,
    createdStillOpenDeals: created.filter((deal) => deal.status === 'open').length,
    cohortConversionPct: created.length ? (createdWon.length / created.length) * 100 : null,
    cohortLossPct: created.length ? (createdLost.length / created.length) * 100 : null,
    wonDeals: wonInMonth.length,
    wonValue,
    lostDeals: lostInMonth.length,
    openBaseDealsEndOfMonth: openAtEnd.length,
    openBaseValueEndOfMonth: openValue,
    averageWonTicket: wonInMonth.length ? wonValue / wonInMonth.length : 0
  };
});

const businessTypeMonthly = [];
for (const deal of wonDeals) {
  for (const type of deal.businessTypes) {
    businessTypeMonthly.push({
      month: deal.wonMonth,
      type,
      dealId: deal.id,
      dealTitle: deal.title,
      organization: deal.organization,
      value: deal.value
    });
  }
}

const businessTypeSummary = groupBy(businessTypeMonthly, (item) => `${item.month}|||${item.type}`)
  .map(([key, items]) => {
    const [month, type] = key.split('|||');
    return {
      month,
      type,
      wonDeals: items.length,
      revenue: sum(items, (item) => item.value),
      averageTicket: sum(items, (item) => item.value) / items.length
    };
  })
  .sort((a, b) => a.month.localeCompare(b.month) || b.revenue - a.revenue);

const businessTypeTrend = businessTypeSummary.map((row) => {
  const previousMonthDate = new Date(`${row.month}-01T00:00:00.000Z`);
  previousMonthDate.setUTCMonth(previousMonthDate.getUTCMonth() - 1);
  const previousMonth = previousMonthDate.toISOString().slice(0, 7);
  const previousYear = `${Number(row.month.slice(0, 4)) - 1}-${row.month.slice(5, 7)}`;
  const previous = businessTypeSummary.find((item) => item.month === previousMonth && item.type === row.type);
  const previousYearRow = businessTypeSummary.find((item) => item.month === previousYear && item.type === row.type);
  return {
    ...row,
    revenueMoMPct: previous?.revenue ? ((row.revenue - previous.revenue) / previous.revenue) * 100 : null,
    dealsMoMPct: previous?.wonDeals ? ((row.wonDeals - previous.wonDeals) / previous.wonDeals) * 100 : null,
    revenueYoYPct: previousYearRow?.revenue ? ((row.revenue - previousYearRow.revenue) / previousYearRow.revenue) * 100 : null,
    dealsYoYPct: previousYearRow?.wonDeals ? ((row.wonDeals - previousYearRow.wonDeals) / previousYearRow.wonDeals) * 100 : null
  };
});

function summarizeRepeatSales(items, keySelector, keyType) {
  return groupBy(items.filter((deal) => keySelector(deal)), keySelector)
    .map(([key, accountDeals]) => {
      const ordered = accountDeals.sort((a, b) => String(a.wonTime).localeCompare(String(b.wonTime)));
      const repeatDeals = ordered.slice(1);
      return {
        key,
        keyType,
        organization: ordered[0]?.organization ?? null,
        cnpj: keyType === 'cnpj' ? key : ordered.find((deal) => deal.cnpj)?.cnpj ?? null,
        wonDeals: ordered.length,
        repeatDeals: repeatDeals.length,
        totalRevenue: sum(ordered, (deal) => deal.value),
        repeatRevenue: sum(repeatDeals, (deal) => deal.value),
        firstWonMonth: ordered[0]?.wonMonth ?? null,
        lastWonMonth: ordered.at(-1)?.wonMonth ?? null,
        types: [...new Set(ordered.flatMap((deal) => deal.businessTypes))].join(', '),
        deals: ordered.map((deal) => ({ id: deal.id, title: deal.title, month: deal.wonMonth, value: deal.value, types: deal.businessTypes }))
      };
    })
    .filter((item) => item.wonDeals > 1)
    .sort((a, b) => b.repeatRevenue - a.repeatRevenue);
}

const cnpjCoverage = {
  organizations: organizationsRaw.length,
  organizationsWithCnpj: organizationsRaw.filter((org) => cnpjField && normalizeDocument(org[cnpjField.key])).length,
  wonDealsWithCnpj: wonDeals.filter((deal) => deal.cnpj).length,
  wonDeals: wonDeals.length
};
const postSalesByCnpj = summarizeRepeatSales(wonDeals, (deal) => deal.cnpj, 'cnpj');
const repeatSalesByAccount = summarizeRepeatSales(wonDeals, (deal) => deal.accountKey, 'organization_name');
const postSalesMonthly = monthly.map((row) => {
  const wonInMonth = wonDeals.filter((deal) => deal.wonMonth === row.month);
  const byCnpj = wonInMonth.filter((deal) => deal.isPostSaleByCnpj);
  const byAccount = wonInMonth.filter((deal) => deal.isPostSaleByAccount);
  return {
    month: row.month,
    postSalesDealsByCnpj: byCnpj.length,
    postSalesRevenueByCnpj: sum(byCnpj, (deal) => deal.value),
    repeatDealsByAccount: byAccount.length,
    repeatRevenueByAccount: sum(byAccount, (deal) => deal.value),
    wonDeals: wonInMonth.length,
    wonRevenue: sum(wonInMonth, (deal) => deal.value),
    repeatShareByAccountPct: wonInMonth.length ? (byAccount.length / wonInMonth.length) * 100 : null
  };
});

const serviceSummary = groupBy(wonDeals, (deal) => deal.service)
  .map(([service, items]) => ({
    service,
    wonDeals: items.length,
    revenue: sum(items, (deal) => deal.value),
    averageTicket: sum(items, (deal) => deal.value) / items.length,
    firstWonMonth: items.map((deal) => deal.wonMonth).sort()[0],
    lastWonMonth: items.map((deal) => deal.wonMonth).sort().at(-1)
  }))
  .sort((a, b) => b.revenue - a.revenue);

const serviceMonthly = groupBy(wonDeals, (deal) => deal.service)
  .map(([service, items]) => ({
    service,
    months: monthly
      .filter((row) => row.month.startsWith('2026'))
      .map((row) => ({
        month: row.month,
        wonDeals: items.filter((deal) => deal.wonMonth === row.month).length,
        revenue: sum(items.filter((deal) => deal.wonMonth === row.month), (deal) => deal.value)
      }))
  }));

const projectCandidates = tasks.filter((task) => {
  const text = normalizeText([task.space, task.folder, task.list, task.name].join(' '));
  const relevant = /projeto|implantacao|cliente|operacao|execucao|delivery|contrato|obra|laudo/.test(text);
  const noise = /teste|dev|copia|cópia|feedback form|pasta teste/.test(text);
  return relevant && !noise;
});

const maybeUnmatchedWon = wonDeals
  .filter((deal) => !projectCandidates.some((task) => normalizeText(task.name).includes(normalizeText(deal.organization || deal.title).slice(0, 12))))
  .map((deal) => ({ id: deal.id, title: deal.title, organization: deal.organization, wonMonth: deal.wonMonth, value: deal.value, service: deal.service }));

const monthsByKey = Object.fromEntries(monthly.map((row) => [row.month, row]));
const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const growthComparison = monthNames.map((label, index) => {
  const monthNumber = String(index + 1).padStart(2, '0');
  const current = monthsByKey[`2026-${monthNumber}`] ?? null;
  const previous = monthsByKey[`2025-${monthNumber}`] ?? null;
  const revenueYoYPct = previous?.wonRevenue ? (((current?.wonRevenue ?? 0) - previous.wonRevenue) / previous.wonRevenue) * 100 : null;
  const createdYoYPct = previous?.createdDeals ? (((current?.createdDeals ?? 0) - previous.createdDeals) / previous.createdDeals) * 100 : null;
  const wonDealsYoYPct = previous?.wonDeals ? (((current?.wonDeals ?? 0) - previous.wonDeals) / previous.wonDeals) * 100 : null;
  return {
    monthNumber,
    label,
    revenue2025: previous?.wonRevenue ?? null,
    revenue2026: current?.wonRevenue ?? null,
    created2025: previous?.createdDeals ?? null,
    created2026: current?.createdDeals ?? null,
    wonDeals2025: previous?.wonDeals ?? null,
    wonDeals2026: current?.wonDeals ?? null,
    averageTicket2025: previous?.averageTicket ?? null,
    averageTicket2026: current?.averageTicket ?? null,
    revenueMoM2025Pct: previous?.revenueGrowthPct ?? null,
    revenueMoM2026Pct: current?.revenueGrowthPct ?? null,
    revenueYoYPct,
    createdYoYPct,
    wonDealsYoYPct
  };
});

const completed2026Months = monthly.filter((row) => row.month >= '2026-01' && row.month <= '2026-05');
const completed2025Equivalent = monthly.filter((row) => row.month >= '2025-01' && row.month <= '2025-05');
const h1Like2025 = sum(completed2025Equivalent, (row) => row.wonRevenue);
const h1Like2026 = sum(completed2026Months, (row) => row.wonRevenue);
const h2Revenue2025 = sum(monthly.filter((row) => row.month >= '2025-07' && row.month <= '2025-12'), (row) => row.wonRevenue);
const h2WonDeals2025 = sum(monthly.filter((row) => row.month >= '2025-07' && row.month <= '2025-12'), (row) => row.wonDeals);
const h2CreatedDeals2025 = sum(monthly.filter((row) => row.month >= '2025-07' && row.month <= '2025-12'), (row) => row.createdDeals);
const h1Average2026 = completed2026Months.length ? h1Like2026 / completed2026Months.length : 0;
const h1WonAverage2026 = completed2026Months.length ? sum(completed2026Months, (row) => row.wonDeals) / completed2026Months.length : 0;
const yoyGrowthFactor = h1Like2025 ? h1Like2026 / h1Like2025 : 1;
const runRateRevenue = h1Average2026 * 6;
const runRateWonDeals = h1WonAverage2026 * 6;
const seasonalRevenue = h2Revenue2025 * yoyGrowthFactor;
const seasonalWonDeals = h2WonDeals2025 * yoyGrowthFactor;
const h1Average2025 = completed2025Equivalent.length ? h1Like2025 / completed2025Equivalent.length : 0;
const h2Average2025 = h2Revenue2025 / 6;
const rawSeasonalityLiftPct = h1Average2025 ? ((h2Average2025 - h1Average2025) / h1Average2025) * 100 : 0;
const realisticSeasonalityLiftPct = Math.min(35, Math.max(15, rawSeasonalityLiftPct * 0.12));
const realisticRevenue = runRateRevenue * (1 + realisticSeasonalityLiftPct / 100);
const realisticWonDeals = runRateWonDeals * (1 + realisticSeasonalityLiftPct / 100);
const weightedRevenue = realisticRevenue;
const weightedWonDeals = realisticWonDeals;
const projectionMonths = monthNames.slice(6).map((label, index) => {
  const monthNumber = String(index + 7).padStart(2, '0');
  const baseline2025 = monthsByKey[`2025-${monthNumber}`];
  const h2Share = h2Revenue2025 ? (baseline2025?.wonRevenue ?? 0) / h2Revenue2025 : 1 / 6;
  const runRateMonthRevenue = h1Average2026;
  const seasonalMonthRevenue = (baseline2025?.wonRevenue ?? 0) * yoyGrowthFactor;
  const projectedRevenue = realisticRevenue * h2Share;
  const runRateMonthWonDeals = h1WonAverage2026;
  const seasonalMonthWonDeals = (baseline2025?.wonDeals ?? 0) * yoyGrowthFactor;
  return {
    month: `2026-${monthNumber}`,
    label,
    baselineRevenue2025: baseline2025?.wonRevenue ?? 0,
    baselineWonDeals2025: baseline2025?.wonDeals ?? 0,
    runRateRevenue: runRateMonthRevenue,
    seasonalRevenue: seasonalMonthRevenue,
    projectedRevenue,
    projectedWonDeals: h2WonDeals2025 ? realisticWonDeals * ((baseline2025?.wonDeals ?? 0) / h2WonDeals2025) : runRateMonthWonDeals
  };
});

const projection2026H2 = {
  basis: {
    completedMonthsUsed: '2026-01 a 2026-05',
    h1LikeRevenue2025: h1Like2025,
    h1LikeRevenue2026: h1Like2026,
    h2Revenue2025,
    h2WonDeals2025,
    h2CreatedDeals2025,
    yoyGrowthFactor,
    yoyGrowthPct: (yoyGrowthFactor - 1) * 100,
    rawSeasonalityLiftPct,
    realisticSeasonalityLiftPct
  },
  scenarios: [
    {
      name: 'Conservador',
      premise: '85% do ritmo medio real de jan-mai/2026',
      revenue: runRateRevenue * 0.85,
      wonDeals: runRateWonDeals * 0.85
    },
    {
      name: 'Ritmo atual',
      premise: 'Media mensal real de jan-mai/2026 aplicada a jul-dez',
      revenue: runRateRevenue,
      wonDeals: runRateWonDeals
    },
    {
      name: 'Realista',
      premise: 'Ritmo atual com aceleracao sazonal moderada derivada de 2025',
      revenue: realisticRevenue,
      wonDeals: realisticWonDeals
    },
    {
      name: 'Potencial sazonal 2025',
      premise: 'Jul-dez/2025 multiplicado pelo crescimento jan-mai de 2026 vs 2025',
      revenue: seasonalRevenue,
      wonDeals: seasonalWonDeals
    },
    {
      name: 'Base recomendada',
      premise: 'Cenario realista recomendado para planejamento 2026.2',
      revenue: weightedRevenue,
      wonDeals: weightedWonDeals
    }
  ],
  months: projectionMonths
};

function aggregatePeriod(rows, predicate) {
  const filtered = rows.filter(predicate);
  return {
    revenue: sum(filtered, (row) => row.wonRevenue),
    wonDeals: sum(filtered, (row) => row.wonDeals),
    createdDeals: sum(filtered, (row) => row.createdDeals)
  };
}

function quarterKey(month) {
  const [year, rawMonth] = month.split('-');
  const qi = Math.ceil(Number(rawMonth) / 3);
  return `${year}-Q${qi}`;
}

function semesterKey(month) {
  const [year, rawMonth] = month.split('-');
  const half = Number(rawMonth) <= 6 ? 'H1' : 'H2';
  return `${year}-${half}`;
}

const monthly2025 = monthly.filter((row) => row.month.startsWith('2025'));
const monthly2026 = monthly.filter((row) => row.month.startsWith('2026'));
const janMay2026 = monthly2026.filter((row) => row.month >= '2026-01' && row.month <= '2026-05');
const june2026 = monthly2026.find((row) => row.month === '2026-06');
const runRateMonthly = janMay2026.length ? sum(janMay2026, (row) => row.wonRevenue) / janMay2026.length : 0;
const runRateWonMonthly = janMay2026.length ? sum(janMay2026, (row) => row.wonDeals) / janMay2026.length : 0;
const janMayActual = sum(janMay2026, (row) => row.wonRevenue);
const juneActual = june2026?.wonRevenue ?? 0;
const juneProjected = runRateMonthly;
const h1ProjectedTotal = janMayActual + juneProjected;

const quarterKeys = [...new Set(monthly.map((row) => quarterKey(row.month)))].sort();
const quarters = Object.fromEntries(
  quarterKeys.map((key) => {
    const [year] = key.split('-');
    const rows = monthly.filter((row) => quarterKey(row.month) === key);
    const agg = aggregatePeriod(rows, () => true);
    return [key, { ...agg, year: Number(year), averageTicket: agg.wonDeals ? agg.revenue / agg.wonDeals : 0 }];
  })
);

const semesterKeys = [...new Set(monthly.map((row) => semesterKey(row.month)))].sort();
const semesters = Object.fromEntries(
  semesterKeys.map((key) => {
    const rows = monthly.filter((row) => semesterKey(row.month) === key);
    const agg = aggregatePeriod(rows, () => true);
    return [key, { ...agg, averageTicket: agg.wonDeals ? agg.revenue / agg.wonDeals : 0 }];
  })
);

semesters['2026-H1-projected'] = {
  revenue: h1ProjectedTotal,
  wonDeals: sum(janMay2026, (row) => row.wonDeals) + Math.round(runRateWonMonthly),
  createdDeals: sum(janMay2026, (row) => row.createdDeals),
  averageTicket: 0,
  projected: true
};
semesters['2026-H1-projected'].averageTicket = semesters['2026-H1-projected'].wonDeals
  ? semesters['2026-H1-projected'].revenue / semesters['2026-H1-projected'].wonDeals
  : 0;

const yearProjectionByScenario = projection2026H2.scenarios.map((scenario) => ({
  scenario: scenario.name,
  h1Projected: h1ProjectedTotal,
  h2Projected: scenario.revenue,
  totalProjected: h1ProjectedTotal + scenario.revenue,
  wonDealsEstimated: Math.round(sum(janMay2026, (row) => row.wonDeals) + runRateWonMonthly + scenario.wonDeals)
}));

const baseScenario = projection2026H2.scenarios.find((item) => item.name === 'Base recomendada');
const projectedByMonth = Object.fromEntries(projectionMonths.map((row) => [row.month, row]));

const timeline2026 = monthNames.map((label, index) => {
  const monthNumber = String(index + 1).padStart(2, '0');
  const month = `2026-${monthNumber}`;
  const actual = monthsByKey[month];
  if (index <= 4) {
    return {
      month,
      label,
      kind: 'actual',
      revenue: actual?.wonRevenue ?? 0,
      wonDeals: actual?.wonDeals ?? 0,
      createdDeals: actual?.createdDeals ?? 0,
      projectedRevenue: null
    };
  }
  if (index === 5) {
    return {
      month,
      label,
      kind: 'partial',
      revenue: actual?.wonRevenue ?? 0,
      wonDeals: actual?.wonDeals ?? 0,
      createdDeals: actual?.createdDeals ?? 0,
      projectedRevenue: juneProjected
    };
  }
  const projection = projectedByMonth[month];
  return {
    month,
    label,
    kind: 'projected',
    revenue: 0,
    wonDeals: 0,
    createdDeals: 0,
    projectedRevenue: projection?.projectedRevenue ?? 0,
    projectedWonDeals: projection?.projectedWonDeals ?? 0
  };
});

const feb2026 = monthsByKey['2026-02'];
const decliningMonthsAfterPeak = monthly2026
  .filter((row) => row.month >= '2026-03' && row.month <= '2026-05' && row.revenueGrowthPct != null && row.revenueGrowthPct < 0)
  .map((row) => row.month);

const planningInsights = [
  feb2026
    ? {
        kind: 'decline',
        title: 'Ritmo caiu após fevereiro',
        body: `Depois do pico de ${money(feb2026.wonRevenue)}, ${decliningMonthsAfterPeak.length} meses completos recuaram em sequência.`
      }
    : null,
  {
    kind: 'seasonal',
    title: '2025 sugere aceleração no semestre',
    body: `Jul-dez/2025 realizou ${money(projection2026H2.basis.h2Revenue2025)}, acima do início daquele ano.`
  },
  {
    kind: 'data',
    title: 'Serviço precisa de padronização',
    body: 'O CRM não trouxe produtos por negócio; a granularidade fina depende de um campo obrigatório.'
  }
].filter(Boolean);

const planningSummary = {
  generatedFromMonths: '2026-01 a 2026-05',
  partialMonth: '2026-06',
  runRateMonthly,
  runRateWonMonthly,
  annual: {
    '2025': { ...aggregatePeriod(monthly2025, () => true), isPartial: false },
    '2026Ytd': { ...aggregatePeriod(monthly2026, () => true), isPartial: true }
  },
  semesters,
  quarters,
  h1Projection: {
    janMayActual,
    juneActual,
    juneProjected,
    totalProjected: h1ProjectedTotal,
    runRateMonthly
  },
  yearProjectionByScenario,
  timeline2026,
  insights: planningInsights,
  defaultScenario: 'Base recomendada',
  baseYearTotal2026: h1ProjectedTotal + (baseScenario?.revenue ?? 0)
};

function buildRecordTimeline(items, getValue, metricId, metricLabel, unit = 'number') {
  const sorted = [...items].sort((a, b) => a.month.localeCompare(b.month));
  let best = -Infinity;
  let bestMonth = null;
  const events = [];

  for (const item of sorted) {
    const value = getValue(item);
    if (value == null || !Number.isFinite(value)) continue;
    if (value > best) {
      events.push({
        metric: metricId,
        metricLabel,
        month: item.month,
        value,
        previousBest: best === -Infinity ? null : best,
        previousBestMonth: bestMonth,
        unit,
        isFirstRecord: best === -Infinity
      });
      best = value;
      bestMonth = item.month;
    }
  }

  return {
    metric: metricId,
    metricLabel,
    unit,
    recordMonth: bestMonth,
    recordValue: best === -Infinity ? null : best,
    events
  };
}

const funnelByMonth = Object.fromEntries(commercialFunnel.map((row) => [row.month, row]));
const enrichedMonthly = monthly.map((row) => ({
  ...row,
  ...funnelByMonth[row.month]
}));

const partialMonthKey = '2026-06';
const completeMonthly = enrichedMonthly.filter((row) => row.month !== partialMonthKey || row.wonDeals > 0);

const recordMetrics = [
  { id: 'wonRevenue', label: 'Receita ganha no mês', unit: 'currency', get: (row) => row.wonRevenue },
  { id: 'averageTicket', label: 'Ticket médio mensal', unit: 'currency', get: (row) => row.averageTicket },
  { id: 'wonDeals', label: 'Negócios fechados', unit: 'count', get: (row) => row.wonDeals },
  { id: 'createdDeals', label: 'Novos negócios criados', unit: 'count', get: (row) => row.createdDeals },
  { id: 'createdValue', label: 'Valor de propostas criadas', unit: 'currency', get: (row) => row.createdValue },
  {
    id: 'cohortConversionPct',
    label: 'Conversão da coorte do mês',
    unit: 'percent',
    get: (row) => (row.createdDeals >= 3 ? row.cohortConversionPct : null)
  },
  { id: 'averageWonTicket', label: 'Ticket médio dos ganhos', unit: 'currency', get: (row) => row.averageWonTicket },
  { id: 'openBaseValueEndOfMonth', label: 'Pipeline aberto (valor)', unit: 'currency', get: (row) => row.openBaseValueEndOfMonth }
];

const metricRecords = recordMetrics.map((metric) =>
  buildRecordTimeline(enrichedMonthly, metric.get, metric.id, metric.label, metric.unit)
);

const allRecordEvents = metricRecords
  .flatMap((record) => record.events)
  .sort((a, b) => a.month.localeCompare(b.month) || a.metricLabel.localeCompare(b.metricLabel));

const records2026 = allRecordEvents.filter((event) => event.month.startsWith('2026'));

const yoyImprovements = growthComparison
  .filter((row) => row.revenueYoYPct != null && row.revenue2026 != null)
  .flatMap((row) => {
    const month = `2026-${row.monthNumber}`;
    const improvements = [];
    if (row.revenueYoYPct != null && row.revenueYoYPct > 0) {
      improvements.push({
        month,
        label: row.label,
        metric: 'revenueYoY',
        metricLabel: 'Receita ganha YoY',
        value2026: row.revenue2026,
        value2025: row.revenue2025,
        changePct: row.revenueYoYPct
      });
    }
    if (row.wonDealsYoYPct != null && row.wonDealsYoYPct > 0) {
      improvements.push({
        month,
        label: row.label,
        metric: 'wonDealsYoY',
        metricLabel: 'Fechamentos YoY',
        value2026: row.wonDeals2026,
        value2025: row.wonDeals2025,
        changePct: row.wonDealsYoYPct
      });
    }
    if (row.createdYoYPct != null && row.createdYoYPct > 0) {
      improvements.push({
        month,
        label: row.label,
        metric: 'createdYoY',
        metricLabel: 'Novos negócios YoY',
        value2026: row.created2026,
        value2025: row.created2025,
        changePct: row.createdYoYPct
      });
    }
    return improvements;
  })
  .sort((a, b) => b.changePct - a.changePct);

const typePeaks = groupBy(businessTypeTrend, (row) => row.type)
  .map(([type, rows]) => {
    const best = rows.reduce((acc, row) => (row.revenue > acc.revenue ? row : acc), rows[0]);
    return {
      type,
      month: best.month,
      revenue: best.revenue,
      wonDeals: best.wonDeals,
      averageTicket: best.averageTicket
    };
  })
  .sort((a, b) => b.revenue - a.revenue);

const topMonthsByRevenue = [...enrichedMonthly]
  .sort((a, b) => b.wonRevenue - a.wonRevenue)
  .slice(0, 5)
  .map((row) => ({
    month: row.month,
    revenue: row.wonRevenue,
    wonDeals: row.wonDeals,
    createdDeals: row.createdDeals,
    averageTicket: row.averageTicket,
    cohortConversionPct: row.cohortConversionPct
  }));

const indicatorRecommendations = [];

const febRecord = metricRecords.find((item) => item.metric === 'wonRevenue');
if (febRecord?.recordMonth?.startsWith('2026')) {
  indicatorRecommendations.push({
    kind: 'repeat',
    title: 'Repetir ritmo comercial de receita',
    body: `O recorde de receita (${money(febRecord.recordValue)}) veio em ${febRecord.recordMonth}. Vale mapear origem dos negócios, tipos vendidos e tempo de fechamento desse mês.`
  });
}

const conversionRecord = metricRecords.find((item) => item.metric === 'cohortConversionPct');
if (conversionRecord?.recordMonth) {
  indicatorRecommendations.push({
    kind: 'repeat',
    title: 'Replicar conversão da coorte',
    body: `Melhor conversão da coorte: ${pct(conversionRecord.recordValue)} em ${conversionRecord.recordMonth}. Analisar qualidade das propostas criadas nesse mês.`
  });
}

const createdRecord = metricRecords.find((item) => item.metric === 'createdDeals');
if (createdRecord?.recordMonth?.startsWith('2026')) {
  indicatorRecommendations.push({
    kind: 'improve',
    title: 'Manter volume de novos negócios',
    body: `Recorde de novos negócios: ${createdRecord.recordValue} em ${createdRecord.recordMonth}. Pipeline forte sustenta fechamentos nos meses seguintes.`
  });
}

if (decliningMonthsAfterPeak.length >= 3) {
  indicatorRecommendations.push({
    kind: 'improve',
    title: 'Estabilizar após o pico de fevereiro',
    body: `${decliningMonthsAfterPeak.length} meses completos caíram em sequência depois do pico. Revisar follow-up e taxa de conversão pós-proposta.`
  });
}

const topType = typePeaks[0];
if (topType) {
  indicatorRecommendations.push({
    kind: 'repeat',
    title: 'Priorizar tipos que mais faturaram',
    body: `${topType.type} teve melhor mês em ${topType.month} (${money(topType.revenue)}). Considerar campanha focada nesse serviço.`
  });
}

const indicatorHighlights = {
  partialMonthExcludedFromRecords: partialMonthKey,
  metricRecords,
  recordTimeline: allRecordEvents,
  recordsBrokenIn2026: records2026,
  yoyImprovements,
  typePeaks,
  topMonthsByRevenue,
  recommendations: indicatorRecommendations,
  summary: {
    totalRecordEvents: allRecordEvents.length,
    recordsIn2026: records2026.length,
    bestRevenueMonth: febRecord?.recordMonth ?? null,
    bestRevenueValue: febRecord?.recordValue ?? null,
    bestConversionMonth: conversionRecord?.recordMonth ?? null,
    bestConversionValue: conversionRecord?.recordValue ?? null,
    bestCreatedMonth: createdRecord?.recordMonth ?? null,
    bestCreatedValue: createdRecord?.recordValue ?? null
  }
};

const report = {
  generatedAt: new Date().toISOString(),
  scope: 'Pipedrive deals and ClickUp project tasks for 2025 and 2026.1/2026 focus',
  totals: {
    pipedriveDealsAll: dealsRaw.length,
    clickupTasksAll: clickupTasksRaw.length,
    analysisDeals: analysisDeals.length,
    wonDeals: wonDeals.length,
    focus2026Deals: focus2026.length
  },
  monthly,
  commercialFunnel,
  growthComparison,
  projection2026H2,
  planningSummary,
  indicatorHighlights,
  businessTypeMonthly: businessTypeTrend,
  businessTypeDeals: businessTypeMonthly,
  cnpjCoverage,
  postSalesByCnpj,
  repeatSalesByAccount,
  postSalesMonthly,
  serviceSummary,
  serviceMonthly,
  wonDeals: wonDeals.sort((a, b) => (a.wonMonth || '').localeCompare(b.wonMonth || '')),
  clickupProjectCandidates: projectCandidates,
  maybeUnmatchedWon
};

await writeFile(new URL('analysis.json', processedDir), JSON.stringify(report, null, 2));
await writeCsv('monthly.csv', monthly);
await writeCsv('commercial-funnel.csv', commercialFunnel);
await writeCsv('growth-comparison.csv', growthComparison);
await writeCsv('projection-2026-h2.csv', projectionMonths);
await writeCsv(
  'indicator-records.csv',
  allRecordEvents.map((row) => ({
    month: row.month,
    metric: row.metric,
    metricLabel: row.metricLabel,
    value: row.value,
    previousBest: row.previousBest,
    previousBestMonth: row.previousBestMonth
  }))
);
await writeCsv(
  'planning-summary.csv',
  yearProjectionByScenario.map((row) => ({
    scenario: row.scenario,
    h1Projected: row.h1Projected,
    h2Projected: row.h2Projected,
    totalProjected: row.totalProjected,
    wonDealsEstimated: row.wonDealsEstimated
  }))
);
await writeCsv('business-type-monthly.csv', businessTypeTrend);
await writeCsv('business-type-deals.csv', businessTypeMonthly);
await writeCsv('post-sales-cnpj.csv', postSalesByCnpj.map(({ deals, ...row }) => row));
await writeCsv('account-repeat-sales.csv', repeatSalesByAccount.map(({ deals, ...row }) => row));
await writeCsv('post-sales-monthly.csv', postSalesMonthly);
await writeCsv('service-summary.csv', serviceSummary);
await writeCsv('won-deals.csv', wonDeals);
await writeCsv('clickup-project-candidates.csv', projectCandidates);

const focusMonths = monthly.filter((row) => row.month.startsWith('2026'));
const completedH1Months = focusMonths.filter((row) => row.month >= '2026-01' && row.month <= '2026-05');
const h1ClosedRevenue = sum(completedH1Months, (row) => row.wonRevenue);
const h1ClosedDeals = sum(completedH1Months, (row) => row.wonDeals);
const h1CreatedDeals = sum(completedH1Months, (row) => row.createdDeals);
const monthlyRevenueRunRate = completedH1Months.length ? h1ClosedRevenue / completedH1Months.length : 0;
const monthlyDealsRunRate = completedH1Months.length ? h1ClosedDeals / completedH1Months.length : 0;
const monthlyCreatedRunRate = completedH1Months.length ? h1CreatedDeals / completedH1Months.length : 0;
const h2BaseProjection = monthlyRevenueRunRate * 6;
const h2ConservativeProjection = h2BaseProjection * 0.85;
const h2RecoveryProjection = h2BaseProjection * 1.15;
const topServices = serviceSummary.slice(0, 12);
const newServices2026 = serviceSummary.filter((service) => service.firstWonMonth?.startsWith('2026'));
const decliningServices = serviceMonthly
  .map((service) => {
    const h1 = service.months.filter((month) => month.month >= '2026-01' && month.month <= '2026-06');
    const firstHalf = sum(h1.slice(0, 3), (month) => month.revenue);
    const secondHalf = sum(h1.slice(3, 6), (month) => month.revenue);
    return { service: service.service, firstQuarterRevenue: firstHalf, secondQuarterRevenue: secondHalf, delta: secondHalf - firstHalf };
  })
  .filter((service) => service.delta < 0)
  .sort((a, b) => a.delta - b.delta);

const md = `# Analise comercial e projetos - XPE Consultoria

Gerado em: ${new Date().toLocaleString('pt-BR')}

## Resumo executivo

- Negocios analisados no Pipedrive: ${analysisDeals.length} em 2025-2026.
- Negocios ganhos no periodo: ${wonDeals.length}, somando ${money(sum(wonDeals, (deal) => deal.value))}.
- Ticket medio geral dos negocios ganhos: ${money(wonDeals.length ? sum(wonDeals, (deal) => deal.value) / wonDeals.length : 0)}.
- Tarefas/projetos encontrados no ClickUp: ${clickupTasksRaw.length}; candidatos de producao ligados a projetos/operacao: ${projectCandidates.length}.
- Junho de 2026 deve ser lido como parcial, pois a base foi extraida em ${new Date().toLocaleDateString('pt-BR')}.
- O Pipedrive nao trouxe produtos por negocio; a classificacao inicial de servico usa principalmente funil/etapa e, quando necessario, termos explicitos no titulo.
- Para tipos de negocio, a fonte principal agora e a etiqueta comercial do Pipedrive: LIE, LDC, LCC, PIE, OBRA, PROJETOS, LSPDA, CDM, ICV e instalacao de carregador.
- Cobertura de CNPJ nas organizacoes: ${cnpjCoverage.organizationsWithCnpj}/${cnpjCoverage.organizations}; nos ganhos analisados: ${cnpjCoverage.wonDealsWithCnpj}/${cnpjCoverage.wonDeals}.
- Arquivos tabulares gerados em \`data/processed/*.csv\` para revisao e uso em planilhas.

## Funil comercial mensal

| Mes | Novos negocios | Valor criado | Ganhos no mes | Receita ganha | Perdidos no mes | Conversao da coorte | Base aberta fim do mes | Valor em aberto |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${commercialFunnel.filter((row) => row.month >= '2026-01' && row.month <= '2026-06').map((row) => `| ${row.month} | ${row.createdDeals} | ${money(row.createdValue)} | ${row.wonDeals} | ${money(row.wonValue)} | ${row.lostDeals} | ${pct(row.cohortConversionPct)} | ${row.openBaseDealsEndOfMonth} | ${money(row.openBaseValueEndOfMonth)} |`).join('\n')}

## 2026 mes a mes

| Mes | Novos negocios | Projetos fechados | Receita ganha | Ticket medio | Crescimento receita |
| --- | ---: | ---: | ---: | ---: | ---: |
${focusMonths.map((row) => `| ${row.month} | ${row.createdDeals} | ${row.wonDeals} | ${money(row.wonRevenue)} | ${money(row.averageTicket)} | ${pct(row.revenueGrowthPct)} |`).join('\n')}

## Leitura de crescimento em 2026

- De janeiro a maio, foram criados ${h1CreatedDeals} novos negocios, media de ${monthlyCreatedRunRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} por mes.
- No mesmo periodo, foram fechados ${h1ClosedDeals} negocios, media de ${monthlyDealsRunRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} por mes.
- Receita ganha de janeiro a maio: ${money(h1ClosedRevenue)}, media mensal de ${money(monthlyRevenueRunRate)}.
- No mesmo recorte de janeiro a maio, 2025 somou ${money(projection2026H2.basis.h1LikeRevenue2025)}; 2026 esta ${pct(projection2026H2.basis.yoyGrowthPct)} acima.
- O segundo semestre de 2025 somou ${money(projection2026H2.basis.h2Revenue2025)}, com ${projection2026H2.basis.h2WonDeals2025} fechamentos.
- A receita caiu por tres meses completos seguidos depois do pico de fevereiro: marco, abril e maio. Junho ainda e parcial.

## Crescimento mes a mes: 2025 vs 2026

| Mes | Receita 2025 | Receita 2026 | Cresc. YoY receita | Novos 2025 | Novos 2026 | Fechados 2025 | Fechados 2026 | Cresc. MoM 2026 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${growthComparison.slice(0, 6).map((row) => `| ${row.label} | ${money(row.revenue2025)} | ${row.revenue2026 == null ? '-' : money(row.revenue2026)} | ${pct(row.revenueYoYPct)} | ${row.created2025 ?? '-'} | ${row.created2026 ?? '-'} | ${row.wonDeals2025 ?? '-'} | ${row.wonDeals2026 ?? '-'} | ${pct(row.revenueMoM2026Pct)} |`).join('\n')}

## Projecao 2026.2 com base historica

| Cenario | Premissa | Receita projetada jul-dez | Projetos fechados estimados |
| --- | --- | ---: | ---: |
${projection2026H2.scenarios.map((scenario) => `| ${scenario.name} | ${scenario.premise} | ${money(scenario.revenue)} | ${Math.round(scenario.wonDeals)} |`).join('\n')}

> Recomendacao: usar o cenario "Base recomendada" como meta realista de planejamento, mantendo o potencial sazonal como teto agressivo e nao como compromisso operacional.

## Projecao mensal jul-dez/2026

| Mes | Receita 2025 base | Projecao ponderada 2026 | Fechamentos estimados |
| --- | ---: | ---: | ---: |
${projection2026H2.months.map((row) => `| ${row.month} | ${money(row.baselineRevenue2025)} | ${money(row.projectedRevenue)} | ${Math.round(row.projectedWonDeals)} |`).join('\n')}

## Tipos de negocios fechados por mes

| Mes | Tipo | Fechamentos | Receita | Ticket medio | Cresc. receita MoM | Cresc. receita YoY |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
${businessTypeTrend.filter((row) => row.month >= '2026-01' && row.month <= '2026-06').map((row) => `| ${row.month} | ${row.type} | ${row.wonDeals} | ${money(row.revenue)} | ${money(row.averageTicket)} | ${pct(row.revenueMoMPct)} | ${pct(row.revenueYoYPct)} |`).join('\n')}

## Pos-venda e recorrencia

- Contas com mais de um fechamento no mesmo CNPJ: ${postSalesByCnpj.length}.
- Contas com mais de um fechamento por organizacao normalizada: ${repeatSalesByAccount.length}.
- Receita de repeticao por organizacao no periodo: ${money(sum(repeatSalesByAccount, (row) => row.repeatRevenue))}.

| Conta/CNPJ | Cliente | Fechamentos | Receita total | Receita repetida | Primeiro ganho | Ultimo ganho | Tipos |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
${repeatSalesByAccount.slice(0, 20).map((row) => `| ${row.cnpj ?? row.key} | ${row.organization ?? '-'} | ${row.wonDeals} | ${money(row.totalRevenue)} | ${money(row.repeatRevenue)} | ${row.firstWonMonth ?? '-'} | ${row.lastWonMonth ?? '-'} | ${row.types || '-'} |`).join('\n')}

## Servicos mais fechados

| Servico | Projetos ganhos | Receita | Ticket medio | Primeiro fechamento | Ultimo fechamento |
| --- | ---: | ---: | ---: | --- | --- |
${topServices.map((service) => `| ${service.service} | ${service.wonDeals} | ${money(service.revenue)} | ${money(service.averageTicket)} | ${service.firstWonMonth ?? '-'} | ${service.lastWonMonth ?? '-'} |`).join('\n')}

## Servicos que apareceram em 2026

${newServices2026.length ? newServices2026.map((service) => `- ${service.service}: primeiro fechamento em ${service.firstWonMonth}, ${service.wonDeals} ganho(s), ${money(service.revenue)}.`).join('\n') : '- Nenhum servico novo identificado automaticamente em 2026 pelos campos/titulos atuais.'}

## Servicos com queda no 2o trimestre de 2026 vs 1o trimestre

${decliningServices.length ? decliningServices.map((service) => `- ${service.service}: ${money(service.firstQuarterRevenue)} no 1T para ${money(service.secondQuarterRevenue)} no 2T (${money(service.delta)}).`).join('\n') : '- Nenhuma queda detectada na receita ganha por servico entre 1T e 2T de 2026.'}

## Projetos fechados em 2026

| Mes | Negocio | Cliente | Servico | Valor |
| --- | --- | --- | --- | ---: |
${wonDeals.filter((deal) => deal.wonMonth?.startsWith('2026')).map((deal) => `| ${deal.wonMonth} | ${deal.title} | ${deal.organization ?? '-'} | ${deal.service} | ${money(deal.value)} |`).join('\n')}

## Pontos de atencao para cruzamento Pipedrive x ClickUp

- Ha ${maybeUnmatchedWon.length} negocio(s) ganhos sem correspondencia simples por nome em tarefas candidatas de producao do ClickUp.
- Listas de teste/dev/copia foram excluidas da contagem de projetos candidatos do ClickUp.
- Para granularidade fina de servicos, o ideal e padronizar um campo obrigatorio no Pipedrive ou preencher produtos por negocio; hoje o CRM separa com confianca principalmente "Laudos e consultoria condominial" vs "Obras eletricas".
`;

await writeFile(new URL('analise-xpe-2025-2026.md', reportsDir), md);
console.log('Analise gerada em reports/analise-xpe-2025-2026.md e data/processed/analysis.json');
