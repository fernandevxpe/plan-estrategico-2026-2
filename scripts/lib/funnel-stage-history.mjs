const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export const FUNNEL_PIPELINE_IDS = [11, 14];

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

function listMonths(fromKey, toKey) {
  const months = [];
  let [year, month] = fromKey.split('-').map(Number);
  const [endYear, endMonth] = toKey.split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function parseFlowStageChanges(flow) {
  if (!Array.isArray(flow)) return [];
  return flow
    .filter((item) => item?.data?.field_key === 'stage_id')
    .map((item) => ({
      at: new Date(item.data.log_time ?? item.timestamp),
      stageId: Number(item.data.new_value),
      fromStageId: item.data.old_value != null ? Number(item.data.old_value) : null
    }))
    .filter((item) => !Number.isNaN(item.at.getTime()) && !Number.isNaN(item.stageId))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function initialStageId(deal, changes) {
  if (changes.length && changes[0].fromStageId != null && !Number.isNaN(changes[0].fromStageId)) {
    return changes[0].fromStageId;
  }
  return Number(deal.stage_id);
}

function stageAtTime(changes, initialStage, createdAt, at) {
  const t = at.getTime();
  if (t < createdAt.getTime()) return null;
  let stage = initialStage;
  for (const change of changes) {
    if (change.at.getTime() > t) break;
    stage = change.stageId;
  }
  return stage;
}

function closedAt(deal) {
  const raw = deal.won_time ?? deal.lost_time ?? deal.close_time;
  return raw ? new Date(raw) : null;
}

function isActiveAtMonthEnd(deal, end) {
  const created = new Date(deal.add_time);
  if (Number.isNaN(created.getTime()) || created.getTime() > end.getTime()) return false;
  const closed = closedAt(deal);
  if (closed && !Number.isNaN(closed.getTime()) && closed.getTime() <= end.getTime()) return false;
  return true;
}

function bump(bucket, month, pipelineId, stageMeta, value) {
  const key = `${month}|${pipelineId}|${stageMeta.id}`;
  if (!bucket.has(key)) {
    bucket.set(key, {
      month,
      pipelineId,
      pipeline: stageMeta.pipeline,
      stageId: stageMeta.id,
      stage: stageMeta.name,
      stageOrder: stageMeta.order,
      deals: 0,
      value: 0
    });
  }
  const row = bucket.get(key);
  row.deals += 1;
  row.value += value;
}

/**
 * @param {object[]} dealsRaw
 * @param {Record<string, object[]>} flowsByDealId
 * @param {object[]} stagesRaw
 * @param {string} fromMonth
 * @param {string} toMonth
 */
export function buildFunnelStageHistory(dealsRaw, flowsByDealId, stagesRaw, fromMonth = '2025-01', toMonth) {
  const stageMetaById = new Map(
    stagesRaw
      .filter((stage) => FUNNEL_PIPELINE_IDS.includes(stage.pipeline_id))
      .map((stage) => [
        stage.id,
        {
          id: stage.id,
          name: stage.name,
          order: stage.order_nr,
          pipelineId: stage.pipeline_id,
          pipeline: stage.pipeline_name
        }
      ])
  );

  const pipelines = FUNNEL_PIPELINE_IDS.map((pipelineId) => {
    const stages = stagesRaw
      .filter((stage) => stage.pipeline_id === pipelineId)
      .sort((a, b) => a.order_nr - b.order_nr)
      .map((stage) => ({ id: stage.id, name: stage.name, order: stage.order_nr }));
    const name = stagesRaw.find((stage) => stage.pipeline_id === pipelineId)?.pipeline_name ?? String(pipelineId);
    return { id: pipelineId, name, stages };
  });

  const relevantDeals = dealsRaw.filter((deal) => FUNNEL_PIPELINE_IDS.includes(deal.pipeline_id));
  const months = listMonths(fromMonth, toMonth ?? monthKeyFromDate(new Date()) ?? fromMonth);

  const entriesBucket = new Map();
  const stockBucket = new Map();

  for (const deal of relevantDeals) {
    const createdAt = new Date(deal.add_time);
    if (Number.isNaN(createdAt.getTime())) continue;
    const createdMonth = monthKeyFromDate(createdAt);
    if (!createdMonth || createdMonth < fromMonth) continue;

    const changes = parseFlowStageChanges(flowsByDealId[String(deal.id)] ?? flowsByDealId[deal.id]);
    const initialStage = initialStageId(deal, changes);
    const initialMeta = stageMetaById.get(initialStage);
    const dealValue = Number(deal.value || 0);

    if (initialMeta && createdMonth <= (toMonth ?? createdMonth)) {
      bump(entriesBucket, createdMonth, deal.pipeline_id, initialMeta, dealValue);
    }

    for (const change of changes) {
      const changeMonth = monthKeyFromDate(change.at);
      const meta = stageMetaById.get(change.stageId);
      if (!meta || !changeMonth || changeMonth < fromMonth || changeMonth > (toMonth ?? changeMonth)) continue;
      bump(entriesBucket, changeMonth, deal.pipeline_id, meta, dealValue);
    }

    for (const month of months) {
      const end = monthEnd(month);
      if (!isActiveAtMonthEnd(deal, end)) continue;
      const stageId = stageAtTime(changes, initialStage, createdAt, end);
      const meta = stageMetaById.get(stageId);
      if (!meta) continue;
      bump(stockBucket, month, deal.pipeline_id, meta, dealValue);
    }
  }

  const sortRows = (rows) =>
    rows.sort(
      (a, b) =>
        a.month.localeCompare(b.month) ||
        a.pipelineId - b.pipelineId ||
        a.stageOrder - b.stageOrder
    );

  return {
    pipelines,
    months: months.map((month) => ({ month, label: monthLabel(month) })),
    entries: sortRows([...entriesBucket.values()]),
    stock: sortRows([...stockBucket.values()])
  };
}
