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

const PLANNING_REALIZED_PIPELINES = new Set(['[Exec] Laudos - Condo', 'Obras']);
const BUSINESS_TIMEZONE = 'America/Recife';

function monthKey(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) return null;
  return `${year}-${month}`;
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

const NEW_DEALS_CONVERSION_LABEL = 'Conversão dos novos negócios';
const NEW_DEALS_CONVERSION_SHORT = 'Conv. novos neg.';

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
const businessTypePriority = [
  'OBRA',
  'CDM',
  'Instalação de Carregador Eletrico',
  'PIE - Projeto infra.  Eletrocalha e Emergência',
  'LDC - Laudo de disponibilidade de carga',
  'LIE - Laudo de Instalações Elétricas',
  'LCC - Laudo Carregador Coletivo',
  'ICV - Inspeção de carregador veicular',
  'LSPDA',
  'PROJETOS'
];
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

function primaryBusinessTypeForDeal(types, fallbackService) {
  for (const priority of businessTypePriority) {
    if (types.includes(priority)) return priority;
  }
  return types[0] || fallbackService || 'Sem tipo comercial';
}

const deals = dealsRaw.map((deal) => {
  const pipeline = pipelineById[deal.pipeline_id];
  const stage = stageById[deal.stage_id];
  const orgId = dealOrgId(deal);
  const organization = organizationById[orgId];
  const service = inferService({ ...deal, stage_name: stage?.name, pipeline_name: pipeline?.name }, fieldsByKey);
  const cnpj = normalizeDocument(cnpjField ? organization?.[cnpjField.key] : null);
  const orgName = deal.org_name ?? deal.org_id?.name ?? organization?.name ?? null;
  const businessTypes = businessTypesForDeal(deal, service);
  return {
    id: deal.id,
    title: deal.title,
    status: deal.status,
    value: Number(deal.value || 0),
    currency: deal.currency,
    addTime: deal.add_time,
    updateTime: deal.update_time ?? deal.stage_change_time ?? null,
    wonTime: deal.won_time,
    closeTime: deal.close_time,
    createdMonth: monthKey(deal.add_time),
    wonMonth: monthKey(deal.won_time),
    lostMonth: monthKey(deal.lost_time),
    closedMonth: monthKey(deal.close_time),
    pipeline: pipeline?.name ?? null,
    pipelineId: deal.pipeline_id ?? null,
    stage: stage?.name ?? null,
    stageId: deal.stage_id ?? null,
    stageOrder: stage?.order_nr ?? 999,
    organizationId: orgId ?? null,
    organization: orgName,
    accountKey: cnpj ? `cnpj:${cnpj}` : `org:${normalizeAccountName(orgName || deal.title)}`,
    accountKeyType: cnpj ? 'cnpj' : 'organization_name',
    cnpj,
    channel: fieldValueLabel(deal.channel, fieldsByKey.channel) ?? deal.channel ?? null,
    origin: fieldValueLabel(deal.origin, fieldsByKey.origin) ?? deal.origin ?? null,
    labels: parseSetIds(deal.label).map((id) => labelById[id] ?? id),
    businessTypes,
    primaryBusinessType: primaryBusinessTypeForDeal(businessTypes, service),
    hasExplicitBusinessType: businessTypes.some((type) => businessTypeLabels.has(type)),
    isMultiBusinessType: businessTypes.length > 1,
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
  url: task.url,
  description: task.description ?? '',
  textContent: task.text_content ?? ''
}));

const analysisDeals = deals.filter((deal) =>
  [deal.createdMonth, deal.wonMonth, deal.lostMonth, deal.closedMonth].some((month) => [2025, 2026].includes(yearOfMonth(month)))
);
const wonDeals = analysisDeals.filter((deal) => deal.status === 'won' && deal.wonMonth);
const focus2026 = analysisDeals.filter((deal) => deal.createdMonth?.startsWith('2026') || deal.wonMonth?.startsWith('2026'));
const monthly = monthlyRows(analysisDeals).filter((row) => row.month >= '2025-01' && row.month <= '2026-12');
const planningRealizedDeals = analysisDeals.filter(
  (deal) =>
    deal.status === 'won' &&
    deal.wonMonth &&
    PLANNING_REALIZED_PIPELINES.has(deal.pipeline)
);
const planningRealizedMonthly = monthlyRows(planningRealizedDeals).filter(
  (row) => row.month >= '2025-01' && row.month <= '2026-12'
);
const planningMonthsByKey = Object.fromEntries(planningRealizedMonthly.map((row) => [row.month, row]));
const generatedAt = new Date();
const matureCohortMinAgeDays = 45;

function monthEnd(month) {
  const [year, rawMonth] = month.split('-').map(Number);
  return new Date(Date.UTC(year, rawMonth, 0, 23, 59, 59));
}

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
  const createdClosed = createdWon.length + createdLost.length;
  const wonInMonth = deals.filter((deal) => deal.wonMonth === row.month);
  const lostInMonth = deals.filter((deal) => deal.lostMonth === row.month);
  const cohortAgeDays = Math.max(0, daysBetween(monthEnd(row.month), generatedAt) ?? 0);
  const isMatureCohort = cohortAgeDays >= matureCohortMinAgeDays;
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
    matureCohortMinAgeDays,
    cohortAgeDays,
    isMatureCohort,
    matureConversionPct: isMatureCohort && created.length ? (createdWon.length / created.length) * 100 : null,
    closedConversionPct: createdClosed ? (createdWon.length / createdClosed) * 100 : null,
    closedDealsFromCohort: createdClosed,
    wonDeals: wonInMonth.length,
    wonValue,
    lostDeals: lostInMonth.length,
    openBaseDealsEndOfMonth: openAtEnd.length,
    openBaseValueEndOfMonth: openValue,
    averageWonTicket: wonInMonth.length ? wonValue / wonInMonth.length : 0
  };
});

const businessTypeDeals = [];
const businessTypeMultiDeals = [];
for (const deal of wonDeals) {
  businessTypeDeals.push({
    month: deal.wonMonth,
    type: deal.primaryBusinessType,
    dealId: deal.id,
    dealTitle: deal.title,
    organization: deal.organization,
    value: deal.value,
    labels: deal.businessTypes.join(', '),
    isMultiBusinessType: deal.isMultiBusinessType
  });

  for (const type of deal.businessTypes) {
    businessTypeMultiDeals.push({
      month: deal.wonMonth,
      type,
      dealId: deal.id,
      dealTitle: deal.title,
      organization: deal.organization,
      value: deal.value
    });
  }
}

const businessTypeSummary = groupBy(businessTypeDeals, (item) => `${item.month}|||${item.type}`)
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
const repeatSalesByAccountName = summarizeRepeatSales(
  wonDeals.filter((deal) => !deal.cnpj),
  (deal) => deal.accountKey,
  'account_name'
);
const sameMonthMultiService = groupBy(wonDeals, (deal) => `${deal.accountKey}|||${deal.wonMonth}`)
  .map(([key, rows]) => {
    const [accountKey, month] = key.split('|||');
    const types = [...new Set(rows.map((deal) => deal.primaryBusinessType))];
    return {
      key: accountKey,
      month,
      confidence: 'same_month_multi_service',
      organization: rows[0]?.organization ?? null,
      cnpj: rows.find((deal) => deal.cnpj)?.cnpj ?? null,
      wonDeals: rows.length,
      revenue: sum(rows, (deal) => deal.value),
      types: types.join(', '),
      deals: rows.map((deal) => ({ id: deal.id, title: deal.title, value: deal.value, primaryBusinessType: deal.primaryBusinessType }))
    };
  })
  .filter((row) => row.wonDeals > 1 && row.types.includes(','))
  .sort((a, b) => b.revenue - a.revenue);
const postSalesConfidence = {
  cnpjExact: {
    accounts: postSalesByCnpj.length,
    repeatRevenue: sum(postSalesByCnpj, (row) => row.repeatRevenue),
    confidence: 'high'
  },
  accountName: {
    accounts: repeatSalesByAccountName.length,
    repeatRevenue: sum(repeatSalesByAccountName, (row) => row.repeatRevenue),
    confidence: 'medium'
  },
  sameMonthMultiService: {
    accounts: sameMonthMultiService.length,
    revenue: sum(sameMonthMultiService, (row) => row.revenue),
    confidence: 'medium'
  }
};
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

const openDealsForQuality = analysisDeals.filter((deal) => deal.status === 'open');
const oldOpenDeals = openDealsForQuality.filter((deal) => {
  const age = daysBetween(deal.addTime, generatedAt);
  return age != null && age > 120;
});
const wonDealsWithoutExplicitType = wonDeals.filter((deal) => !deal.hasExplicitBusinessType);
const multiTypeWonDeals = wonDeals.filter((deal) => deal.isMultiBusinessType);
const dataQualityAlerts = [
  {
    id: 'cnpj_coverage',
    severity: cnpjCoverage.organizationsWithCnpj / Math.max(1, cnpjCoverage.organizations) < 0.25 ? 'high' : 'medium',
    title: 'Cobertura de CNPJ parcial',
    message: `${cnpjCoverage.organizationsWithCnpj}/${cnpjCoverage.organizations} organizações têm CNPJ preenchido. Pós-venda por CNPJ é confiável, mas incompleto.`,
    count: cnpjCoverage.organizations - cnpjCoverage.organizationsWithCnpj
  },
  {
    id: 'missing_business_type',
    severity: wonDealsWithoutExplicitType.length ? 'medium' : 'low',
    title: 'Negócios ganhos sem etiqueta comercial explícita',
    message: `${wonDealsWithoutExplicitType.length}/${wonDeals.length} ganhos usam fallback de serviço/funil como tipo principal.`,
    count: wonDealsWithoutExplicitType.length
  },
  {
    id: 'multi_business_type',
    severity: multiTypeWonDeals.length ? 'medium' : 'low',
    title: 'Negócios com múltiplas etiquetas',
    message: `${multiTypeWonDeals.length} ganhos têm mais de uma etiqueta. O painel executivo usa apenas tipo principal para não duplicar receita.`,
    count: multiTypeWonDeals.length
  },
  {
    id: 'old_open_deals',
    severity: oldOpenDeals.length > 100 ? 'high' : 'medium',
    title: 'Base aberta contém negócios antigos',
    message: `${oldOpenDeals.length} negócios abertos têm mais de 120 dias. Tratar pipeline aberto como bruto, não forecast.`,
    count: oldOpenDeals.length
  }
];

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

const projectCandidateTasks = tasks.filter((task) => {
  const text = normalizeText([task.space, task.folder, task.list, task.name].join(' '));
  const relevant = /projeto|implantacao|cliente|operacao|execucao|delivery|contrato|obra|laudo/.test(text);
  const noise = /teste|dev|copia|cópia|feedback form|pasta teste/.test(text);
  return relevant && !noise;
});
const projectCandidates = projectCandidateTasks.map(({ description, textContent, ...task }) => task);

const obraTypeLabels = new Set(['OBRA', 'CDM', 'Instalação de Carregador Eletrico']);
const manualObraSubgroups = new Map([
  [1436, { subgroup: 'Infraestrutura de carregamento veicular', confidence: 'confirmed', note: 'Confirmado: Reserva do Poço foi obra de infraestrutura de carregamento veicular.' }],
  [1609, { subgroup: 'CDM - obra/ampliação de centro de medição', confidence: 'probable', note: 'Madalena Colonial provavelmente foi ampliação de CDM.' }],
  [1331, { subgroup: 'ICV - inspeção de carregador veicular', confidence: 'confirmed', note: 'Confirmado: ICV é inspeção de carregador.' }],
  [1352, { subgroup: 'CDM - obra/ampliação de centro de medição', confidence: 'confirmed', note: 'Confirmado: OBRA + Ampliação de CDM deve entrar como CDM obra/ampliação.' }],
  [1337, { subgroup: 'CDM - obra/ampliação de centro de medição', confidence: 'high', note: 'ClickUp indica ampliação de CDM para Quinta do Algarve/Algarvia.' }],
  [1444, { subgroup: 'Infraestrutura de carregamento veicular', confidence: 'high', note: 'ClickUp indica controle de carga para 4 carregadores.' }],
  [1423, { subgroup: 'Obras elétricas gerais/indefinidas', confidence: 'low', note: 'Sem escopo confirmado para subgrupo de obra.' }],
  [1365, { subgroup: 'Obras elétricas gerais/indefinidas', confidence: 'low', note: 'Sem escopo confirmado para subgrupo de obra.' }]
]);

function tokenSet(value) {
  return new Set(
    normalizeAccountName(value)
      .split(' ')
      .filter((token) => token.length > 2)
  );
}

function taskSearchText(task) {
  return [task.name, task.list, task.folder, task.space, task.description, task.textContent].join(' ');
}

function taskDealScore(deal, task) {
  const dealTokens = tokenSet([deal.title, deal.organization].join(' '));
  const taskTokens = tokenSet(taskSearchText(task));
  let score = 0;
  for (const token of dealTokens) if (taskTokens.has(token)) score += 1;
  const taskName = normalizeAccountName(task.name);
  const org = normalizeAccountName(deal.organization);
  const title = normalizeAccountName(deal.title);
  if (org && taskName.includes(org.slice(0, Math.min(16, org.length)))) score += 4;
  if (title && taskName.includes(title.slice(0, Math.min(16, title.length)))) score += 3;
  return score;
}

function taskMatchesForDeal(deal) {
  return projectCandidateTasks
    .map((task) => ({ task, score: taskDealScore(deal, task) }))
    .filter((item) => item.score >= 4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function isObraDeal(deal) {
  return deal.service === 'Obras eletricas' || deal.businessTypes.some((type) => obraTypeLabels.has(type));
}

function classifyObraDeal(deal, matches) {
  const manual = manualObraSubgroups.get(deal.id);
  if (manual) return manual;

  const text = normalizeText([
    deal.title,
    deal.organization,
    deal.service,
    deal.primaryBusinessType,
    deal.businessTypes.join(' '),
    ...matches.map(({ task }) => taskSearchText(task))
  ].join(' '));

  if (deal.primaryBusinessType === 'ICV - Inspeção de carregador veicular' || deal.businessTypes.includes('ICV - Inspeção de carregador veicular')) {
    return { subgroup: 'ICV - inspeção de carregador veicular', confidence: 'high', note: 'Classificado por etiqueta ICV.' };
  }
  if (/ampliacao de cdm|ampliacao.*cdm|cdm.*ampliacao|atualizacao de cdm|cdms/.test(text)) {
    return { subgroup: 'CDM - obra/ampliação de centro de medição', confidence: 'high', note: 'Sinal de ampliação/atualização de CDM no ClickUp ou etiquetas.' };
  }
  if (deal.businessTypes.includes('CDM')) {
    return { subgroup: 'CDM - obra/ampliação de centro de medição', confidence: 'medium', note: 'Etiqueta CDM sem escopo suficiente; mantido como obra/ampliação provável.' };
  }
  if (deal.businessTypes.includes('Instalação de Carregador Eletrico') || /carregador|wallbox|controle de carga|eletroposto|infraestrutura de carregamento/.test(text)) {
    return { subgroup: 'Infraestrutura de carregamento veicular', confidence: 'high', note: 'Sinal de carregador/controle de carga/instalação.' };
  }
  if (/pcdm|pcm|projeto de centro de medicao|projeto centro de medicao/.test(text)) {
    return { subgroup: 'CDM - projeto/planejamento de centro de medição', confidence: 'medium', note: 'Sinal de PCM/PCDM em contratos/tarefas.' };
  }
  if (/pie|eletrocalha|eletroduto/.test(text)) {
    return { subgroup: 'Infraestrutura/eletrocalha/PIE', confidence: 'medium', note: 'Sinal de PIE/eletrocalha/eletroduto.' };
  }
  if (/disjuntor|quadro|qdg|bep|aterramento|subestacao|barramento|alimentador|melhoria eletrica|correcao laudo|adequacao|retrofit/.test(text)) {
    return { subgroup: 'Adequação/correção elétrica geral', confidence: 'medium', note: 'Sinal de adequação/correção elétrica.' };
  }
  return { subgroup: 'Obras elétricas gerais/indefinidas', confidence: 'low', note: 'Sem escopo suficiente para subgrupo.' };
}

const obraSubgroupDeals = wonDeals
  .filter((deal) => deal.wonMonth?.startsWith('2026') && isObraDeal(deal))
  .map((deal) => {
    const matches = taskMatchesForDeal(deal);
    const classification = classifyObraDeal(deal, matches);
    return {
      id: deal.id,
      month: deal.wonMonth,
      title: deal.title,
      organization: deal.organization,
      value: deal.value,
      service: deal.service,
      primaryBusinessType: deal.primaryBusinessType,
      businessTypes: deal.businessTypes,
      subgroup: classification.subgroup,
      confidence: classification.confidence,
      note: classification.note,
      evidence: matches.slice(0, 3).map(({ task, score }) => ({
        score,
        name: task.name,
        status: task.status,
        space: task.space,
        folder: task.folder,
        list: task.list
      }))
    };
  })
  .sort((a, b) => a.month.localeCompare(b.month) || b.value - a.value);

const obraSubgroupSummary = groupBy(obraSubgroupDeals, (deal) => deal.subgroup)
  .map(([subgroup, items]) => ({
    subgroup,
    wonDeals: items.length,
    revenue: sum(items, (item) => item.value),
    averageTicket: sum(items, (item) => item.value) / items.length,
    confidenceBreakdown: {
      confirmed: items.filter((item) => item.confidence === 'confirmed').length,
      high: items.filter((item) => item.confidence === 'high').length,
      medium: items.filter((item) => item.confidence === 'medium' || item.confidence === 'probable').length,
      low: items.filter((item) => item.confidence === 'low').length
    }
  }))
  .sort((a, b) => b.revenue - a.revenue);

const obraSubgroupMonthly = groupBy(obraSubgroupDeals, (deal) => `${deal.month}|||${deal.subgroup}`)
  .map(([key, items]) => {
    const [month, subgroup] = key.split('|||');
    return {
      month,
      subgroup,
      wonDeals: items.length,
      revenue: sum(items, (item) => item.value),
      averageTicket: sum(items, (item) => item.value) / items.length
    };
  })
  .sort((a, b) => a.month.localeCompare(b.month) || b.revenue - a.revenue);

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
      name: 'Realista recomendado',
      premise: 'Ritmo atual com aceleracao sazonal moderada derivada de 2025',
      revenue: realisticRevenue,
      wonDeals: realisticWonDeals
    }
  ],
  aggressiveScenarios: [
    {
      name: 'Potencial sazonal 2025',
      premise: 'Jul-dez/2025 multiplicado pelo crescimento jan-mai de 2026 vs 2025',
      revenue: seasonalRevenue,
      wonDeals: seasonalWonDeals
    }
  ],
  months: projectionMonths
};

function daysBetween(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  return Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function aggregateStageRows(items, stageMeta) {
  const grouped = groupBy(items, (deal) => `${deal.pipelineId ?? 'na'}|||${deal.stageId ?? 'na'}`);
  return grouped
    .map(([key, rows]) => {
      const [pipelineId, stageId] = key.split('|||');
      const meta = stageMeta.get(Number(stageId)) ?? {};
      return {
        pipelineId: Number(pipelineId) || null,
        pipeline: rows[0]?.pipeline ?? meta.pipeline ?? 'Sem funil',
        stageId: Number(stageId) || null,
        stage: rows[0]?.stage ?? meta.name ?? 'Sem etapa',
        stageOrder: meta.order ?? 999,
        deals: rows.length,
        value: sum(rows, (deal) => deal.value),
        averageValue: rows.length ? sum(rows, (deal) => deal.value) / rows.length : 0
      };
    })
    .sort((a, b) => a.pipeline.localeCompare(b.pipeline) || a.stageOrder - b.stageOrder);
}

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

const baseScenario = projection2026H2.scenarios.find((item) => item.name === 'Realista recomendado');
const projectedByMonth = Object.fromEntries(projectionMonths.map((row) => [row.month, row]));

const timeline2026 = monthNames.map((label, index) => {
  const monthNumber = String(index + 1).padStart(2, '0');
  const month = `2026-${monthNumber}`;
  const actual = planningMonthsByKey[month];
  const createdInMonth = analysisDeals.filter((deal) => deal.createdMonth === month);
  if (index <= 4) {
    return {
      month,
      label,
      kind: 'actual',
      revenue: actual?.wonRevenue ?? 0,
      wonDeals: actual?.wonDeals ?? 0,
      createdDeals: createdInMonth.length,
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
      createdDeals: createdInMonth.length,
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
  realizedRevenuePipelines: [...PLANNING_REALIZED_PIPELINES],
  realizedRevenueTimezone: BUSINESS_TIMEZONE,
  planningRealizedMonthly,
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
  defaultScenario: 'Realista recomendado',
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
    label: NEW_DEALS_CONVERSION_LABEL,
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
    title: 'Replicar conversão dos novos negócios',
    body: `Melhor conversão dos novos negócios: ${pct(conversionRecord.recordValue)} em ${conversionRecord.recordMonth}. Analisar qualidade das propostas criadas nesse mês.`
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

const stageMeta = new Map(
  stagesRaw.map((stage) => [
    stage.id,
    { name: stage.name, order: stage.order_nr, pipeline: stage.pipeline_name ?? pipelineById[stage.pipeline_id]?.name }
  ])
);

for (const deal of wonDeals) {
  deal.salesCycleDays = daysBetween(deal.addTime, deal.wonTime);
}

const timeToCloseByMonth = groupBy(
  wonDeals.filter((deal) => deal.salesCycleDays != null && deal.salesCycleDays >= 0),
  (deal) => deal.wonMonth
)
  .map(([month, rows]) => {
    const cycles = rows.map((deal) => deal.salesCycleDays);
    return {
      month,
      wonDeals: rows.length,
      averageDays: cycles.reduce((total, value) => total + value, 0) / cycles.length,
      medianDays: median(cycles),
      revenue: sum(rows, (deal) => deal.value)
    };
  })
  .sort((a, b) => a.month.localeCompare(b.month));

const fastestCloseMonth = [...timeToCloseByMonth]
  .filter((row) => row.wonDeals >= 3)
  .sort((a, b) => a.averageDays - b.averageDays)[0] ?? null;
const slowestCloseMonth = [...timeToCloseByMonth]
  .filter((row) => row.wonDeals >= 3)
  .sort((a, b) => b.averageDays - a.averageDays)[0] ?? null;

const revenueOriginByMonth = groupBy(wonDeals, (deal) => deal.wonMonth)
  .map(([month, rows]) => {
    const repeatRows = rows.filter((deal) => deal.isPostSaleByAccount);
    const newRows = rows.filter((deal) => !deal.isPostSaleByAccount);
    const totalRevenue = sum(rows, (deal) => deal.value);
    const repeatRevenue = sum(repeatRows, (deal) => deal.value);
    const newRevenue = sum(newRows, (deal) => deal.value);
    return {
      month,
      totalRevenue,
      newRevenue,
      repeatRevenue,
      newDeals: newRows.length,
      repeatDeals: repeatRows.length,
      newSharePct: totalRevenue ? (newRevenue / totalRevenue) * 100 : null,
      repeatSharePct: totalRevenue ? (repeatRevenue / totalRevenue) * 100 : null
    };
  })
  .sort((a, b) => a.month.localeCompare(b.month));

const openDeals = analysisDeals.filter((deal) => deal.status === 'open');
const lostDeals = analysisDeals.filter((deal) => deal.status === 'lost');
const funnelByStage = {
  open: aggregateStageRows(openDeals, stageMeta),
  lost: aggregateStageRows(lostDeals, stageMeta),
  won: aggregateStageRows(wonDeals, stageMeta).slice(0, 12),
  summary: {
    openDeals: openDeals.length,
    openValue: sum(openDeals, (deal) => deal.value),
    lostDeals: lostDeals.length,
    lostValue: sum(lostDeals, (deal) => deal.value),
    topOpenStage: [...aggregateStageRows(openDeals, stageMeta)].sort((a, b) => b.deals - a.deals)[0] ?? null,
    topLostStage: [...aggregateStageRows(lostDeals, stageMeta)].sort((a, b) => b.deals - a.deals)[0] ?? null
  }
};

const peakMonthsForMix = topMonthsByRevenue.slice(0, 3);
const peakMix = peakMonthsForMix.map((peak) => {
  const rows = businessTypeTrend.filter((row) => row.month === peak.month);
  const totalRevenue = sum(rows, (row) => row.revenue);
  return {
    month: peak.month,
    revenue: peak.revenue,
    types: rows
      .sort((a, b) => b.revenue - a.revenue)
      .map((row) => ({
        type: row.type,
        revenue: row.revenue,
        wonDeals: row.wonDeals,
        sharePct: totalRevenue ? (row.revenue / totalRevenue) * 100 : 0
      })),
    dominantType: rows.sort((a, b) => b.revenue - a.revenue)[0]?.type ?? null
  };
});

const averageTypeShares = groupBy(businessTypeTrend, (row) => row.type)
  .map(([type, rows]) => ({
    type,
    averageRevenue: sum(rows, (row) => row.revenue) / Math.max(1, rows.length),
    monthsActive: rows.length
  }))
  .sort((a, b) => b.averageRevenue - a.averageRevenue);

const peakMixPatterns = peakMix.map((peak) => {
  const topTypes = peak.types.slice(0, 3).map((item) => item.type);
  return {
    month: peak.month,
    headline: `${topTypes.slice(0, 2).join(' + ') || peak.dominantType || 'Mix diverso'}`,
    topTypes,
    insight: peak.dominantType
      ? `${peak.dominantType} concentrou ${pct(peak.types[0]?.sharePct ?? 0).replace('+', '')} da receita do mês.`
      : 'Mix equilibrado entre tipos comerciais.'
  };
});

const alertMetrics = [
  { key: 'wonRevenue', label: 'Receita ganha', get: (row) => row.wonRevenue },
  { key: 'wonDeals', label: 'Fechamentos', get: (row) => row.wonDeals },
  { key: 'createdDeals', label: 'Novos negócios', get: (row) => row.createdDeals },
  { key: 'averageTicket', label: 'Ticket médio', get: (row) => row.averageTicket },
  {
    key: 'newDealsConversionPct',
    label: NEW_DEALS_CONVERSION_LABEL,
    get: (row) => row.cohortConversionPct
  }
];

const performanceAlerts = [];
for (let index = 1; index < enrichedMonthly.length; index += 1) {
  const current = enrichedMonthly[index];
  const previous = enrichedMonthly[index - 1];
  const declines = alertMetrics
    .map((metric) => {
      const currentValue = metric.get(current);
      const previousValue = metric.get(previous);
      if (currentValue == null || previousValue == null || previousValue === 0) return null;
      const changePct = ((currentValue - previousValue) / previousValue) * 100;
      if (changePct >= 0) return null;
      return {
        metric: metric.key,
        metricLabel: metric.label,
        currentValue,
        previousValue,
        changePct
      };
    })
    .filter(Boolean);

  if (declines.length >= 2) {
    performanceAlerts.push({
      month: current.month,
      severity: declines.length >= 3 ? 'high' : 'medium',
      declineCount: declines.length,
      metrics: declines,
      message:
        declines.length >= 3
          ? `${declines.length} indicadores caíram vs ${previous.month}. Revisar follow-up, propostas e conversão.`
          : `${declines.length} indicadores recuaram vs ${previous.month}.`
    });
  }
}

const deepAnalysis = {
  timeToClose: {
    byMonth: timeToCloseByMonth,
    overallAverageDays:
      timeToCloseByMonth.length
        ? sum(timeToCloseByMonth, (row) => row.averageDays * row.wonDeals) /
          Math.max(1, sum(timeToCloseByMonth, (row) => row.wonDeals))
        : null,
    fastestMonth: fastestCloseMonth,
    slowestMonth: slowestCloseMonth,
    peakRevenueMonth: febRecord?.recordMonth ?? null,
    peakRevenueCycleDays:
      timeToCloseByMonth.find((row) => row.month === febRecord?.recordMonth)?.averageDays ?? null
  },
  revenueOrigin: {
    byMonth: revenueOriginByMonth,
    totals: {
      newRevenue: sum(revenueOriginByMonth, (row) => row.newRevenue),
      repeatRevenue: sum(revenueOriginByMonth, (row) => row.repeatRevenue),
      newSharePct: (() => {
        const total = sum(revenueOriginByMonth, (row) => row.totalRevenue);
        return total ? (sum(revenueOriginByMonth, (row) => row.newRevenue) / total) * 100 : null;
      })()
    }
  },
  funnelByStage,
  peakMix: {
    peaks: peakMix,
    patterns: peakMixPatterns,
    benchmarkTypes: averageTypeShares.slice(0, 8)
  },
  performanceAlerts,
  investigationNotes: [
    fastestCloseMonth
      ? {
          kind: 'speed',
          title: 'Fechamento mais rápido',
          body: `${fastestCloseMonth.month} fechou em média ${Math.round(fastestCloseMonth.averageDays)} dias.`
        }
      : null,
    revenueOriginByMonth.find((row) => row.month.startsWith('2026') && (row.repeatSharePct ?? 0) > 35)
      ? {
          kind: 'origin',
          title: 'Recorrência puxando receita',
          body: 'Meses com alta participação de clientes repetidos indicam base madura para pós-venda.'
        }
      : null,
    funnelByStage.summary.topOpenStage
      ? {
          kind: 'funnel',
          title: 'Gargalo atual do funil',
          body: `Maior volume aberto em "${funnelByStage.summary.topOpenStage.stage}" (${funnelByStage.summary.topOpenStage.deals} negócios).`
        }
      : null
  ].filter(Boolean)
};

function fmtNum(value) {
  return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

function monthLabel(month) {
  const [year, rawMonth] = month.split('-');
  const label = monthNames[Number(rawMonth) - 1] ?? rawMonth;
  return `${label}/${year.slice(2)}`;
}

function pctChange(next, base) {
  if (!base) return next ? 100 : 0;
  return ((next - base) / base) * 100;
}

const OPERATIONS = {
  commercialHeadcount: 2,
  projectistasHistorical: 3,
  projectistasCurrent: 5,
  h1RevenueTarget: 1_000_000,
  commercialClosingsPerPersonComfort: 8,
  trafficQ1Monthly: 2_000,
  trafficQ2Monthly: 2_500,
  automationNote:
    'Equipe ampliada de 3 para 5 projetistas com automação — absorve mais laudos sem crescer na mesma proporção.'
};

function adSpendForMonth(month, h2Scale = 1) {
  const monthNumber = Number(month.split('-')[1]);
  if (monthNumber <= 3) return OPERATIONS.trafficQ1Monthly;
  if (monthNumber <= 6) return OPERATIONS.trafficQ2Monthly;
  return Math.round(OPERATIONS.trafficQ2Monthly * h2Scale);
}

function distributeTypeWorkload(wonDealsTarget, revenueTarget, typeShares) {
  return typeShares.map((row) => ({
    type: row.type,
    projects: Math.max(0, wonDealsTarget * (row.share / 100)),
    revenue: revenueTarget * (row.share / 100)
  }));
}

function buildMonthTargetRow(config) {
  const {
    month,
    label,
    revenueTarget,
    wonDealsTarget,
    createdDealsTarget,
    conversionTargetPct,
    baseline2025Revenue,
    baseProjectionRevenue,
    cumulativeRevenue,
    typeShares,
    h2Scale
  } = config;

  const averageTicketTarget = wonDealsTarget ? revenueTarget / wonDealsTarget : 0;
  const adSpend = adSpendForMonth(month, h2Scale);
  const commercialHeadcount = OPERATIONS.commercialHeadcount;

  return {
    month,
    label,
    revenueTarget,
    wonDealsTarget,
    averageTicketTarget,
    createdDealsTarget,
    conversionTargetPct,
    baseline2025Revenue: baseline2025Revenue ?? 0,
    baseProjectionRevenue: baseProjectionRevenue ?? 0,
    gapVsBase: revenueTarget - (baseProjectionRevenue ?? 0),
    cumulativeRevenue,
    adSpend,
    costPerClosing: wonDealsTarget ? adSpend / wonDealsTarget : null,
    perCommercial: {
      closings: wonDealsTarget / commercialHeadcount,
      revenue: revenueTarget / commercialHeadcount,
      newDeals: createdDealsTarget / commercialHeadcount
    },
    perProjectista: {
      activeProjects: wonDealsTarget / OPERATIONS.projectistasCurrent
    },
    workloadByType: distributeTypeWorkload(wonDealsTarget, revenueTarget, typeShares)
  };
}

function buildGrowthGuide(config) {
  const {
    id,
    name,
    tagline,
    premise,
    annualFloor,
    h2Floor,
    h2ScaleMode
  } = config;

  const h1Projected = h1ProjectedTotal;
  const h2Base = baseScenario?.revenue ?? realisticRevenue;
  const annualBase = h1Projected + h2Base;
  const h1Target = OPERATIONS.h1RevenueTarget;
  const h1GapVsProjected = h1Target - h1Projected;

  let h2Target;
  if (h2ScaleMode === 'historical') {
    h2Target = h2Floor;
  } else {
    h2Target = Math.max(h2Floor, h2Revenue2025 * 2, h2Base);
  }

  const annualTarget = Math.max(annualFloor, h1Target + h2Target);
  const h2GapVsBase = h2Target - h2Base;
  const annualGapVsBase = annualTarget - annualBase;
  const h2Scale = h2Base ? h2Target / h2Base : 1;

  const h1Funnel = commercialFunnel.filter((row) => row.month >= '2026-01' && row.month <= '2026-05');
  const h1ConversionValues = h1Funnel.map((row) => row.cohortConversionPct).filter((value) => value != null);
  const h1AverageConversion = h1ConversionValues.length
    ? h1ConversionValues.reduce((sum, value) => sum + value, 0) / h1ConversionValues.length
    : 15;
  const h1AverageCreated = completed2026Months.length
    ? sum(completed2026Months, (row) => row.createdDeals) / completed2026Months.length
    : 0;
  const h1AverageWon = h1WonAverage2026;
  const h1AverageTicket = h1AverageWon ? h1Average2026 / h1AverageWon : 9866;

  const h2AverageMonthlyRevenue = h2Target / 6;
  const h2AverageWonDeals = h1AverageTicket ? h2AverageMonthlyRevenue / h1AverageTicket : h1AverageWon * h2Scale;
  const h2AverageCreatedDeals = h1AverageConversion
    ? h2AverageWonDeals / (h1AverageConversion / 100)
    : h1AverageCreated * h2Scale;
  const h2AverageTicket = h2AverageWonDeals ? h2AverageMonthlyRevenue / h2AverageWonDeals : h1AverageTicket;
  const h2AverageConversionPct = h2AverageCreatedDeals
    ? (h2AverageWonDeals / h2AverageCreatedDeals) * 100
    : h1AverageConversion;

  const topTypes2026 = businessTypeTrend
    .filter((row) => row.month.startsWith('2026') && row.month <= '2026-05')
    .reduce((acc, row) => {
      acc[row.type] = (acc[row.type] ?? 0) + row.revenue;
      return acc;
    }, {});
  const typeEntries = Object.entries(topTypes2026).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const typeTotal = typeEntries.reduce((sum, [, revenue]) => sum + revenue, 0) || 1;
  const typeShares = typeEntries.map(([type, revenue]) => ({
    type,
    share: (revenue / typeTotal) * 100,
    averageTicket: (() => {
      const deals = businessTypeTrend
        .filter((row) => row.type === type && row.month.startsWith('2026') && row.month <= '2026-05')
        .reduce((sum, row) => sum + row.wonDeals, 0);
      return deals ? revenue / deals : h1AverageTicket;
    })()
  }));

  const typeMix = typeShares.map((row) => {
    const revenueTarget = h2Target * (row.share / 100);
    return {
      type: row.type,
      revenueSharePct: row.share,
      revenueTarget,
      wonDealsTarget: row.averageTicket ? revenueTarget / row.averageTicket : 0,
      averageTicket: row.averageTicket,
      annualProjects: 0
    };
  });

  const h1Timeline = timeline2026.filter((row) => row.month <= '2026-06');
  const h1BaseRevenue = h1Timeline.reduce(
    (sum, row) => sum + (row.kind === 'partial' ? row.projectedRevenue ?? row.revenue : row.revenue),
    0
  );
  const h1Scale = h1BaseRevenue ? h1Target / h1BaseRevenue : 1;

  let h1Cumulative = 0;
  const h1MonthlyTargets = h1Timeline.map((row) => {
    const baseRevenue =
      row.kind === 'partial' ? row.projectedRevenue ?? row.revenue : row.revenue;
    const revenueTarget = baseRevenue * h1Scale;
    const wonDealsTarget = h1AverageTicket ? revenueTarget / h1AverageTicket : row.wonDeals * h1Scale;
    const createdDealsTarget = h1AverageConversion
      ? wonDealsTarget / (h1AverageConversion / 100)
      : (row.createdDeals || h1AverageCreated) * h1Scale;
    h1Cumulative += revenueTarget;
    const funnel = commercialFunnel.find((item) => item.month === row.month);
    return buildMonthTargetRow({
      month: row.month,
      label: row.label,
      revenueTarget,
      wonDealsTarget,
      createdDealsTarget,
      conversionTargetPct: funnel?.cohortConversionPct ?? h1AverageConversion,
      baseline2025Revenue: monthsByKey[row.month.replace('2026', '2025')]?.wonRevenue ?? 0,
      baseProjectionRevenue: baseRevenue,
      cumulativeRevenue: h1Cumulative,
      typeShares,
      h2Scale: 1
    });
  });

  let cumulative = 0;
  const monthlyTargets = projectionMonths.map((row) => {
    const share = h2Revenue2025 ? row.baselineRevenue2025 / h2Revenue2025 : 1 / 6;
    const revenueTarget = h2ScaleMode === 'historical'
      ? row.projectedRevenue * h2Scale
      : h2Target * share;
    const wonDealsTarget = h1AverageTicket
      ? revenueTarget / h1AverageTicket
      : row.projectedWonDeals * h2Scale;
    const createdDealsTarget = h2AverageConversionPct
      ? wonDealsTarget / (h2AverageConversionPct / 100)
      : h2AverageCreatedDeals * share * 6;
    cumulative += revenueTarget;
    return buildMonthTargetRow({
      month: row.month,
      label: row.label,
      revenueTarget,
      wonDealsTarget,
      createdDealsTarget,
      conversionTargetPct: h2AverageConversionPct,
      baseline2025Revenue: row.baselineRevenue2025,
      baseProjectionRevenue: row.projectedRevenue,
      cumulativeRevenue: cumulative,
      typeShares,
      h2Scale
    });
  });

  const fullYearPlan = [...h1MonthlyTargets, ...monthlyTargets].map((row, index, rows) => ({
    ...row,
    cumulativeRevenue: rows.slice(0, index + 1).reduce((sum, item) => sum + item.revenueTarget, 0)
  }));

  const annualRevenueTarget = annualTarget;
  const typeMixAnnual = typeShares.map((row) => {
    const revenueTarget = annualRevenueTarget * (row.share / 100);
    return {
      type: row.type,
      revenueSharePct: row.share,
      revenueTarget,
      wonDealsTarget: row.averageTicket ? revenueTarget / row.averageTicket : 0,
      averageTicket: row.averageTicket
    };
  });

  typeMix.forEach((row) => {
    const annual = typeMixAnnual.find((item) => item.type === row.type);
    row.annualProjects = annual ? Math.ceil(annual.wonDealsTarget) : Math.ceil(row.wonDealsTarget);
  });

  const h1WonTotal = h1MonthlyTargets.reduce((sum, row) => sum + row.wonDealsTarget, 0);
  const h2WonTotal = monthlyTargets.reduce((sum, row) => sum + row.wonDealsTarget, 0);
  const h1AdTotal = h1MonthlyTargets.reduce((sum, row) => sum + row.adSpend, 0);
  const h2AdTotal = monthlyTargets.reduce((sum, row) => sum + row.adSpend, 0);
  const annualAdTotal = h1AdTotal + h2AdTotal;
  const annualWonTotal = h1WonTotal + h2WonTotal;

  const perPersonH2Closings = h2AverageWonDeals / OPERATIONS.commercialHeadcount;
  const recommendedCommercial = Math.max(
    OPERATIONS.commercialHeadcount,
    Math.ceil(h2AverageWonDeals / OPERATIONS.commercialClosingsPerPersonComfort)
  );
  const hireTrigger =
    recommendedCommercial > OPERATIONS.commercialHeadcount
      ? `Contratar ${recommendedCommercial - OPERATIONS.commercialHeadcount}º comercial quando fechamentos sustentarem acima de ${OPERATIONS.commercialClosingsPerPersonComfort}/pessoa por 2 meses seguidos.`
      : '2 comerciais sustentam o cenário — priorizar conversão e automação antes de contratar.';

  const h2ProjectsPerPerson = h2AverageWonDeals / OPERATIONS.projectistasCurrent;
  const historicalProjectsPerPerson = h1AverageWon / OPERATIONS.projectistasHistorical;
  let capacityStatus = 'ok';
  let capacityNote = `Com 5 projetistas e automação, ${fmtNum(h2ProjectsPerPerson)} projetos/pessoa/mês é absorvível (histórico com 3: ${fmtNum(historicalProjectsPerPerson)}/pessoa).`;
  if (h2ProjectsPerPerson > historicalProjectsPerPerson * 1.35) {
    capacityStatus = 'attention';
    capacityNote = `Volume H2 (${fmtNum(h2ProjectsPerPerson)}/projetista/mês) exige priorizar laudos padronizados e fila de automação.`;
  }
  if (h2ProjectsPerPerson > historicalProjectsPerPerson * 1.7) {
    capacityStatus = 'critical';
    capacityNote = 'Operação no limite — considerar 6º projetista ou parceiro para obras.';
  }

  const topOpenStage = funnelByStage.summary.topOpenStage;
  const openPipelineValue = funnelByStage.summary.openValue;
  const peakMonth = deepAnalysis.peakMix.patterns[0];
  const avgCycleDays = deepAnalysis.timeToClose.overallAverageDays ?? 30;
  const targetCycleDays = Math.max(14, Math.round(avgCycleDays * 0.75));

  const revenueUplift = pctChange(h2AverageMonthlyRevenue, h1Average2026);
  const wonUplift = pctChange(h2AverageWonDeals, h1AverageWon);
  const ticketUplift = pctChange(h2AverageTicket, h1AverageTicket);
  const createdUplift = pctChange(h2AverageCreatedDeals, h1AverageCreated);
  const conversionUplift = h2AverageConversionPct - h1AverageConversion;

  const extraWonDeals = Math.ceil(Math.max(0, h2AverageWonDeals - h1AverageWon));
  const extraCreated = Math.ceil(Math.max(0, h2AverageCreatedDeals - h1AverageCreated));
  const recurrenceNote =
    'Recorrência e novas fontes de receita serão acompanhadas à parte — não entram nesta meta de contratos fechados.';

  const trafficNote =
    id === '3x'
      ? `Tráfego H2 escalado ${fmtNum((h2Scale - 1) * 100)}% acima do Q2 para sustentar ${Math.round(h2WonTotal)} fechamentos no semestre.`
      : 'Tráfego H2 mantém R$ 2.500/mês (ritmo Q2) alinhado ao cenário base.';

  const pillars = [
    {
      id: 'comercial',
      title: 'Comercial (2 pessoas)',
      subtitle: 'Resultado por vendedor e gatilho de contratação',
      actions: [
        {
          priority: recommendedCommercial > 2 ? 'critical' : 'high',
          title: 'Meta por comercial no H2',
          detail: `${Math.round(h2AverageWonDeals)} fechamentos/mês na equipe → ${fmtNum(perPersonH2Closings)}/pessoa (${money(h2AverageMonthlyRevenue / OPERATIONS.commercialHeadcount)}/pessoa).`,
          metric: 'Fechamentos/pessoa',
          target: `${fmtNum(perPersonH2Closings)}/mês`
        },
        {
          priority: recommendedCommercial > 2 ? 'critical' : 'medium',
          title: hireTrigger.split('.')[0],
          detail: hireTrigger,
          metric: 'Equipe comercial',
          target: `${OPERATIONS.commercialHeadcount} hoje → ${recommendedCommercial} recomendado`
        },
        {
          priority: conversionUplift > 3 ? 'critical' : 'high',
          title: 'Recuperar conversão dos novos negócios',
          detail: `${NEW_DEALS_CONVERSION_LABEL} em maio/2026: 6,5%. Meta H2: ${fmtNum(h2AverageConversionPct)}%.`,
          metric: NEW_DEALS_CONVERSION_SHORT,
          target: `${fmtNum(h2AverageConversionPct)}%`
        },
        {
          priority: 'high',
          title: 'Desbloquear pipeline em negociação',
          detail: topOpenStage
            ? `${topOpenStage.deals} negócios em "${topOpenStage.stage}" (${money(topOpenStage.value)}).`
            : 'Revisar etapas com maior valor parado.',
          metric: 'Pipeline aberto',
          target: money(Math.min(openPipelineValue, h2Target * 0.35))
        }
      ]
    },
    {
      id: 'aquisicao',
      title: 'Tráfego e aquisição',
      subtitle: 'Investimento alinhado ao funil',
      actions: [
        {
          priority: 'high',
          title: 'Manter ritmo Q1/Q2 em tráfego',
          detail: `Jan–mar: ${money(OPERATIONS.trafficQ1Monthly)}/mês · Abr–jun: ${money(OPERATIONS.trafficQ2Monthly)}/mês · Total H1: ${money(h1AdTotal)}.`,
          metric: 'Investimento H1',
          target: money(h1AdTotal)
        },
        {
          priority: id === '3x' ? 'critical' : 'high',
          title: 'Orçamento de tráfego no H2',
          detail: trafficNote,
          metric: 'Investimento H2',
          target: money(h2AdTotal)
        },
        {
          priority: 'high',
          title: 'Custo por fechamento via tráfego',
          detail: `Investimento anual ${money(annualAdTotal)} para ~${Math.round(annualWonTotal)} contratos.`,
          metric: 'CPA médio',
          target: annualWonTotal ? money(annualAdTotal / annualWonTotal) : 'n/a'
        },
        {
          priority: createdUplift > 15 ? 'critical' : 'high',
          title: 'Novos negócios qualificados',
          detail: `${Math.round(h2AverageCreatedDeals)} novos/mês (${fmtNum(h2AverageCreatedDeals / OPERATIONS.commercialHeadcount)}/comercial).`,
          metric: 'Novos negócios/mês',
          target: `${Math.round(h2AverageCreatedDeals)}${extraCreated > 0 ? ` (+${extraCreated})` : ''}`
        }
      ]
    },
    {
      id: 'operacao',
      title: 'Operação (5 projetistas)',
      subtitle: 'Volume de trabalhos e tipos de projeto',
      actions: [
        {
          priority: capacityStatus === 'critical' ? 'critical' : 'high',
          title: 'Capacidade de entrega no H2',
          detail: capacityNote,
          metric: 'Projetos/projetista',
          target: `${fmtNum(h2ProjectsPerPerson)}/mês`
        },
        {
          priority: 'high',
          title: 'Histórico vs capacidade atual',
          detail: `${OPERATIONS.automationNote} Histórico: ${fmtNum(historicalProjectsPerPerson)} proj./pessoa/mês com 3.`,
          metric: 'Projetistas',
          target: `${OPERATIONS.projectistasHistorical} → ${OPERATIONS.projectistasCurrent}`
        },
        ...typeMix.slice(0, 3).map((row, index) => ({
          priority: index === 0 ? 'critical' : 'high',
          title: `Fila de ${row.type.split(' - ')[0] ?? row.type}`,
          detail: `H2: ${Math.ceil(row.wonDealsTarget)} trabalhos · Ano: ${row.annualProjects} contratos · ${money(row.revenueTarget)}.`,
          metric: 'Contratos no semestre',
          target: `${Math.ceil(row.wonDealsTarget)} fechamentos`
        }))
      ]
    },
    {
      id: 'mix',
      title: 'Mix proporcional (histórico real)',
      subtitle: id === '3x' ? 'Escala do cenário Realista mantendo sazonalidade 2025' : 'Mix jan–mai/2026',
      actions: typeMix.slice(0, 4).map((row, index) => ({
        priority: index === 0 ? 'critical' : index === 1 ? 'high' : 'medium',
        title: `${row.type.split(' - ')[0] ?? row.type}`,
        detail: `Share histórico ${fmtNum(row.revenueSharePct)}% · H2 ${money(row.revenueTarget)} · ticket ${money(row.averageTicket)}.`,
        metric: 'Receita H2',
        target: `${Math.ceil(row.wonDealsTarget)} contratos`
      }))
    },
    {
      id: 'gestao',
      title: 'Gestão e ritmo',
      subtitle: 'H1 em R$ 1M + checkpoints H2',
      actions: [
        {
          priority: 'critical',
          title: 'Meta H1: R$ 1 milhão',
          detail: `Distribuição ajustada: ${money(h1Target)} no semestre (gap ${h1GapVsProjected >= 0 ? '+' : ''}${money(h1GapVsProjected)} vs projeção automática).`,
          metric: 'Receita H1',
          target: money(h1Target)
        },
        {
          priority: 'critical',
          title: 'Ritual semanal de pipeline',
          detail: 'Segunda: negócios parados >15 dias, propostas sem retorno, CPA do tráfego vs meta.',
          metric: 'Cadência',
          target: 'Semanal'
        },
        {
          priority: id === '3x' ? 'critical' : 'medium',
          title: 'Recorrência à parte',
          detail: recurrenceNote,
          metric: 'Nova receita',
          target: 'Contabilizar separado'
        }
      ]
    }
  ];

  const milestones = monthlyTargets.map((row, index) => ({
    month: row.month,
    label: row.label,
    cumulativeTarget: h1Target + row.cumulativeRevenue,
    checkpoint:
      index === 0
        ? 'Primeiro mês H2 — validar CPA e fechamentos/pessoa'
        : index === 2
          ? 'Meio do H2 — revisar capacidade dos 5 projetistas'
          : index === 5
            ? 'Fechamento do ano'
            : `Acumulado H2: ${money(row.cumulativeRevenue)}`
  }));

  const risks = [
    {
      title: 'H1 abaixo de R$ 1M se junho não recuperar',
      mitigation: `Foco em ${money(h1MonthlyTargets.find((row) => row.month === '2026-06')?.revenueTarget ?? 0)} em jun/2026 e pipeline quente em jul.`
    },
    {
      title: 'Queda de conversão após fevereiro',
      mitigation: `Manter ${NEW_DEALS_CONVERSION_SHORT} acima de ${fmtNum(Math.max(h1AverageConversion, 18))}%.`
    },
    perPersonH2Closings > OPERATIONS.commercialClosingsPerPersonComfort
      ? {
          title: '2 comerciais no limite de capacidade',
          mitigation: hireTrigger
        }
      : null,
    capacityStatus !== 'ok'
      ? {
          title: 'Operação pode saturar no H2',
          mitigation: capacityNote
        }
      : null,
    {
      title: 'Recorrência ainda em construção',
      mitigation: 'Não contar com recorrência nesta meta — tratar upsell como receita adicional.'
    }
  ].filter(Boolean);

  return {
    id,
    name,
    tagline,
    premise,
    annualTarget,
    h1Target,
    h2Target,
    annualGapVsBase,
    h1GapVsProjected,
    h2GapVsBase,
    h2MultiplierVs2025: h2Revenue2025 ? h2Target / h2Revenue2025 : 1,
    recurrenceNote,
    baseline: {
      h1Projected,
      h2Base,
      annualBase,
      h2Revenue2025,
      h2WonDeals2025
    },
    monthlyTargets,
    h1MonthlyTargets,
    fullYearPlan,
    kpis: {
      h2AverageMonthlyRevenue,
      h2AverageWonDeals,
      h2AverageTicket,
      h2AverageCreatedDeals,
      h2AverageConversionPct,
      currentH1: {
        averageRevenue: h1Average2026,
        averageWonDeals: h1AverageWon,
        averageTicket: h1AverageTicket,
        averageCreatedDeals: h1AverageCreated,
        averageConversionPct: h1AverageConversion
      },
      uplift: {
        revenuePct: revenueUplift,
        wonDealsPct: wonUplift,
        ticketPct: ticketUplift,
        createdDealsPct: createdUplift,
        conversionPts: conversionUplift
      }
    },
    typeMix,
    typeMixAnnual,
    operationalCapacity: {
      commercialTeam: {
        currentHeadcount: OPERATIONS.commercialHeadcount,
        recommendedHeadcount: recommendedCommercial,
        hireTrigger,
        perPersonH1: {
          monthlyClosings: h1AverageWon / OPERATIONS.commercialHeadcount,
          monthlyRevenue: h1Average2026 / OPERATIONS.commercialHeadcount,
          monthlyNewDeals: h1AverageCreated / OPERATIONS.commercialHeadcount
        },
        perPersonH2: {
          monthlyClosings: perPersonH2Closings,
          monthlyRevenue: h2AverageMonthlyRevenue / OPERATIONS.commercialHeadcount,
          monthlyNewDeals: h2AverageCreatedDeals / OPERATIONS.commercialHeadcount
        }
      },
      deliveryTeam: {
        projectistasHistorical: OPERATIONS.projectistasHistorical,
        projectistasCurrent: OPERATIONS.projectistasCurrent,
        automationNote: OPERATIONS.automationNote,
        historicalProjectsPerPerson,
        h2ProjectsPerPerson,
        capacityStatus,
        capacityNote
      }
    },
    trafficInvestment: {
      h1Total: h1AdTotal,
      h2Total: h2AdTotal,
      annualTotal: annualAdTotal,
      h1ScheduleNote:
        'Jan, fev e mar: R$ 2.000/mês · Abr, mai e jun: R$ 2.500/mês (valores mensais investidos).',
      monthly: fullYearPlan.map((row) => ({
        month: row.month,
        label: row.label,
        adSpend: row.adSpend,
        wonDealsTarget: row.wonDealsTarget,
        costPerClosing: row.costPerClosing,
        semester: row.month <= '2026-06' ? 'H1' : 'H2'
      })),
      averageCostPerClosing: annualWonTotal ? annualAdTotal / annualWonTotal : null,
      note: trafficNote
    },
    pillars,
    milestones,
    risks
  };
}

const growthGuides = {
  projection2x: buildGrowthGuide({
    id: '2x',
    name: 'Projeção 2x',
    tagline: 'R$ 1M no H1 · 2× H2/2025 · superar R$ 2M no ano',
    premise:
      'Executar cenário Realista com H1 ajustado para R$ 1M, 2 comerciais e 5 projetistas — recorrência contabilizada à parte.',
    annualFloor: 2_000_000,
    h2Floor: Math.max(h2Revenue2025 * 2, baseScenario?.revenue ?? 0),
    h2ScaleMode: 'base'
  }),
  projection3x: buildGrowthGuide({
    id: '3x',
    name: 'Projeção 3x',
    tagline: 'R$ 1M no H1 · R$ 2M no H2 · superar R$ 3M no ano',
    premise:
      'Escala proporcional ao cenário Realista histórico (sazonalidade 2025 + mix real) — operação ajustada para absorver o volume.',
    annualFloor: 3_000_000,
    h2Floor: 2_000_000,
    h2ScaleMode: 'historical'
  })
};

const MAIN_EXEC_PIPELINE = '[Exec] Laudos - Condo';

function parseDealTimestamp(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
}

function countDealsInDays(dealList, timeField, days) {
  return dealList.filter((deal) => {
    const age = daysBetween(deal[timeField], generatedAt);
    return age != null && age >= 0 && age <= days;
  }).length;
}

const directorMainOpen = openDeals.filter((deal) => deal.pipeline === MAIN_EXEC_PIPELINE);
const directorSnapshot = {
  reuniaoMarcada: directorMainOpen.filter((deal) => deal.stage === 'Reunião Marcada').length,
  diagnostico: directorMainOpen.filter((deal) => deal.stage === 'Diagnóstico').length,
  negociacao: directorMainOpen.filter((deal) => deal.stage === 'Negociação').length,
  fechamento: directorMainOpen.filter((deal) => deal.stage === 'Fechamento').length,
  relacionamento: directorMainOpen.filter((deal) => deal.stage === 'Relacionamento').length
};

const commercialDirector = {
  mainPipeline: MAIN_EXEC_PIPELINE,
  snapshot: directorSnapshot,
  sla48h: {
    breaches: directorMainOpen.filter((deal) => {
      if (deal.stage !== 'Diagnóstico') return false;
      const ref = deal.updateTime ?? deal.addTime;
      const age = daysBetween(ref, generatedAt);
      return age != null && age > 2;
    }).length,
    gateTarget: 0,
    note:
      'Negócios em Diagnóstico sem avanço há >48h (update_time ou add_time). App registrará visita → proposta com SLA auditável.'
  },
  rolling: {
    won7d: countDealsInDays(wonDeals, 'wonTime', 7),
    won30d: countDealsInDays(wonDeals, 'wonTime', 30),
    created7d: countDealsInDays(analysisDeals, 'addTime', 7),
    created30d: countDealsInDays(analysisDeals, 'addTime', 30)
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
  deepAnalysis,
  commercialDirector,
  growthGuides,
  businessTypeMonthly: businessTypeTrend,
  businessTypeDeals,
  businessTypeMultiDeals,
  obraSubgroups: {
    summary: obraSubgroupSummary,
    monthly: obraSubgroupMonthly,
    deals: obraSubgroupDeals
  },
  cnpjCoverage,
  postSalesByCnpj,
  repeatSalesByAccount,
  repeatSalesByAccountName,
  sameMonthMultiService,
  postSalesConfidence,
  postSalesMonthly,
  dataQualityAlerts,
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
await writeCsv('business-type-deals.csv', businessTypeDeals);
await writeCsv('business-type-multi-deals.csv', businessTypeMultiDeals);
await writeCsv('obra-subgroup-monthly.csv', obraSubgroupMonthly);
await writeCsv('obra-subgroup-deals.csv', obraSubgroupDeals.map((deal) => ({
  ...deal,
  businessTypes: deal.businessTypes.join(', '),
  evidence: deal.evidence.map((item) => `${item.name} (${item.status ?? 'sem status'})`).join(' | ')
})));
await writeCsv('post-sales-cnpj.csv', postSalesByCnpj.map(({ deals, ...row }) => row));
await writeCsv('account-repeat-sales.csv', repeatSalesByAccount.map(({ deals, ...row }) => row));
await writeCsv('account-name-repeat-sales.csv', repeatSalesByAccountName.map(({ deals, ...row }) => row));
await writeCsv('same-month-multi-service.csv', sameMonthMultiService.map(({ deals, ...row }) => row));
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

| Mes | Novos negocios | Valor criado | Ganhos no mes | Receita ganha | Perdidos no mes | Conversao novos neg. | Base aberta fim do mes | Valor em aberto |
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

> Recomendacao: usar o cenario "Realista recomendado" como forecast de planejamento, mantendo o potencial sazonal como teto agressivo e nao como compromisso operacional.

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

await import('./export-chat-context.mjs');
