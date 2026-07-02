const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export const PIPELINE_CONSULTORIA = 11;
export const PIPELINE_OBRAS = 14;
export const DEFAULT_LAG_MATURITY_DAYS = 90;

const ANCHOR_STAGE_NAMES = {
  [PIPELINE_CONSULTORIA]: ['Diagnóstico', 'Negociação'],
  [PIPELINE_OBRAS]: ['Elaboração Proposta', 'Proposta Feita']
};

function monthKeyFromDate(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthEnd(monthKey) {
  const [year, rawMonth] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, rawMonth, 0, 23, 59, 59, 999));
}

function monthLabel(monthKey) {
  const [, raw] = monthKey.split('-');
  return MONTH_SHORT[Number(raw) - 1] ?? monthKey;
}

function daysBetween(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  return Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
}

function parseFlowStageChanges(flow) {
  if (!Array.isArray(flow)) return [];
  return flow
    .filter((item) => item?.data?.field_key === 'stage_id')
    .map((item) => ({
      at: new Date(item.data.log_time ?? item.timestamp),
      stageId: Number(item.data.new_value)
    }))
    .filter((item) => !Number.isNaN(item.at.getTime()) && !Number.isNaN(item.stageId))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function buildAnchorStageIds(stagesRaw) {
  const byPipeline = {
    [PIPELINE_CONSULTORIA]: new Set(),
    [PIPELINE_OBRAS]: new Set()
  };
  for (const stage of stagesRaw) {
    const names = ANCHOR_STAGE_NAMES[stage.pipeline_id];
    if (!names?.includes(stage.name)) continue;
    byPipeline[stage.pipeline_id]?.add(stage.id);
  }
  return byPipeline;
}

function firstAnchorEntryMonth(deal, flow, anchorStageIds) {
  const changes = parseFlowStageChanges(flow);
  for (const change of changes) {
    if (anchorStageIds.has(change.stageId)) {
      return monthKeyFromDate(change.at);
    }
  }
  if (deal.stageId && anchorStageIds.has(deal.stageId)) {
    return deal.createdMonth ?? monthKeyFromDate(new Date(deal.addTime));
  }
  return null;
}

function scopeDeals(deals, scope) {
  if (scope === 'consultoria') return deals.filter((deal) => deal.pipelineId === PIPELINE_CONSULTORIA);
  if (scope === 'obras') return deals.filter((deal) => deal.pipelineId === PIPELINE_OBRAS);
  return deals.filter(
    (deal) => deal.pipelineId === PIPELINE_CONSULTORIA || deal.pipelineId === PIPELINE_OBRAS
  );
}

function monthLag(createdMonth, wonMonth) {
  if (!createdMonth || !wonMonth || !/^\d{4}-\d{2}$/.test(createdMonth) || !/^\d{4}-\d{2}$/.test(wonMonth)) {
    return null;
  }
  const [cy, cm] = createdMonth.split('-').map(Number);
  const [wy, wm] = wonMonth.split('-').map(Number);
  return (wy - cy) * 12 + (wm - cm);
}

function buildWinLagBuckets(wonRows, wonMonth) {
  const rows = wonRows.filter((deal) => deal.wonMonth === wonMonth);
  const total = rows.length;
  const counts = { m0: 0, m1: 0, m2: 0, m3: 0, m4plus: 0, unknown: 0 };

  for (const deal of rows) {
    const lag = monthLag(deal.createdMonth, wonMonth);
    if (lag == null || lag < 0) {
      counts.unknown += 1;
      continue;
    }
    if (lag === 0) counts.m0 += 1;
    else if (lag === 1) counts.m1 += 1;
    else if (lag === 2) counts.m2 += 1;
    else if (lag === 3) counts.m3 += 1;
    else counts.m4plus += 1;
  }

  const pct = (n) => (total ? (n / total) * 100 : null);
  const winLagM0Pct = pct(counts.m0);
  const winLagM1Pct = pct(counts.m1);
  const winLagM2Pct = pct(counts.m2);
  const winLagM3Pct = pct(counts.m3);
  const winLagM4PlusPct = pct(counts.m4plus + counts.unknown);

  return {
    winLagM0Deals: counts.m0,
    winLagM1Deals: counts.m1,
    winLagM2Deals: counts.m2,
    winLagM3Deals: counts.m3,
    winLagM4PlusDeals: counts.m4plus + counts.unknown,
    winLagM0Pct,
    winLagM1Pct,
    winLagM2Pct,
    winLagM3Pct,
    winLagM4PlusPct,
    ganhosAntigosSharePct: winLagM0Pct != null ? 100 - winLagM0Pct : null
  };
}

function buildWinVintage(wonRows, wonMonth) {
  const rows = wonRows.filter((deal) => deal.wonMonth === wonMonth);
  const grouped = new Map();
  for (const deal of rows) {
    const origin = deal.createdMonth ?? 'sem-data';
    grouped.set(origin, (grouped.get(origin) ?? 0) + 1);
  }
  const total = rows.length;
  const winVintage = [...grouped.entries()]
    .map(([originMonth, deals]) => ({
      originMonth,
      deals,
      sharePct: total ? (deals / total) * 100 : null
    }))
    .sort((a, b) => a.originMonth.localeCompare(b.originMonth));
  return { winVintage };
}

function buildTimeToWinForMonth(wonRows, wonMonth) {
  const rows = wonRows.filter((deal) => deal.wonMonth === wonMonth);
  const cycles = rows
    .map((deal) => daysBetween(deal.addTime, deal.wonTime))
    .filter((value) => value != null && value >= 0);
  return {
    wonDeals: rows.length,
    averageDaysToWin: cycles.length ? cycles.reduce((sum, value) => sum + value, 0) / cycles.length : null
  };
}

function buildStageCohortForMonth(dealsWithAnchor, month) {
  const cohort = dealsWithAnchor.filter((deal) => deal.anchorEntryMonth === month);
  const won = cohort.filter((deal) => deal.status === 'won').length;
  const lost = cohort.filter((deal) => deal.status === 'lost').length;
  const open = cohort.filter((deal) => deal.status === 'open').length;
  const entered = cohort.length;
  return {
    stageCohortEntered: entered,
    stageCohortWon: won,
    stageCohortLost: lost,
    stageCohortOpen: open,
    stageCohortConversionPct: entered ? (won / entered) * 100 : null,
    stageCohortPendingPct: entered ? (open / entered) * 100 : null
  };
}

function buildScopeMonths({
  deals,
  flowsByDealId,
  anchorStageIdsByPipeline,
  monthly,
  commercialFunnelRows
}) {
  const wonRows = deals.filter((deal) => deal.status === 'won' && deal.wonMonth);
  const dealsWithAnchor = deals
    .map((deal) => {
      const pipelineAnchors = anchorStageIdsByPipeline[deal.pipelineId];
      if (!pipelineAnchors?.size) return null;
      const flow = flowsByDealId[String(deal.id)] ?? flowsByDealId[deal.id];
      const anchorEntryMonth = firstAnchorEntryMonth(deal, flow, pipelineAnchors);
      if (!anchorEntryMonth) return null;
      return { ...deal, anchorEntryMonth };
    })
    .filter(Boolean);

  const funnelByMonth = Object.fromEntries((commercialFunnelRows ?? []).map((row) => [row.month, row]));

  return monthly.map((row) => {
    const month = row.month;
    const funnel = funnelByMonth[month];
    const timeToWin = buildTimeToWinForMonth(wonRows, month);
    const vintage = buildWinVintage(wonRows, month);
    const winLag = buildWinLagBuckets(wonRows, month);
    const stageCohort = buildStageCohortForMonth(dealsWithAnchor, month);
    const createdDeals = funnel?.createdDeals ?? 0;
    const wonDeals = timeToWin.wonDeals;
    return {
      month,
      label: monthLabel(month),
      wonDeals,
      averageDaysToWin: timeToWin.averageDaysToWin,
      ...vintage,
      ...winLag,
      ...stageCohort,
      createdDeals,
      winToCreateRatio: createdDeals ? wonDeals / createdDeals : null,
      closedConversionPct: funnel?.closedConversionPct ?? null
    };
  });
}

/**
 * @param {object} config
 * @param {object[]} config.deals
 * @param {Record<string, object[]>} config.flowsByDealId
 * @param {object[]} config.stagesRaw
 * @param {object[]} config.monthly
 * @param {Record<string, object[]>} config.commercialFunnelByPipeline
 * @param {Date} config.generatedAt
 * @param {number} [config.lagMaturityDays]
 */
export function buildConversionAnalytics({
  deals,
  flowsByDealId,
  stagesRaw,
  monthly,
  commercialFunnelByPipeline,
  generatedAt,
  lagMaturityDays = DEFAULT_LAG_MATURITY_DAYS
}) {
  const anchorStageIdsByPipeline = buildAnchorStageIds(stagesRaw);
  const scopes = ['collective', 'consultoria', 'obras'];
  const byScope = {};

  for (const scope of scopes) {
    const scopedDeals = scopeDeals(deals, scope);
    const funnelRows =
      commercialFunnelByPipeline?.[scope] ?? commercialFunnelByPipeline?.collective ?? [];
    byScope[scope] = {
      months: buildScopeMonths({
        deals: scopedDeals,
        flowsByDealId,
        anchorStageIdsByPipeline,
        monthly,
        commercialFunnelRows: funnelRows
      })
    };
  }

  return {
    lagMaturityDays,
    anchorStages: {
      consultoria: ANCHOR_STAGE_NAMES[PIPELINE_CONSULTORIA],
      obras: ANCHOR_STAGE_NAMES[PIPELINE_OBRAS]
    },
    byScope
  };
}
