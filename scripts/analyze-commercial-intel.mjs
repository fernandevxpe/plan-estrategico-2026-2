// Inteligência comercial mês a mês: canais de origem, motivos de perda, ciclo
// de vendas, atividades e metas — reproduzindo (e auditando) a análise que o
// diretor comercial monta manualmente.
import { readFile, writeFile } from 'node:fs/promises';

const rawDir = new URL('../data/raw/', import.meta.url);
const outDir = new URL('../data/processed/', import.meta.url);

const readJson = async (name, fallback = null) => {
  try {
    return JSON.parse(await readFile(new URL(name, rawDir), 'utf8'));
  } catch {
    return fallback;
  }
};
const unwrap = (payload) => (payload && 'data' in payload ? payload.data : payload);

const BUSINESS_TIMEZONE = 'America/Recife';
const CONSULTORIA_PIPELINE = 11;
const OBRAS_PIPELINE = 14;
const SELLER_LABELS = new Set(['GABRIEL', 'IGOR', 'JONILDO']);
const NO_CHANNEL = 'Sem tracking';
/** Canais que nascem de relacionamento/base própria, não de mídia paga. */
const RELATIONSHIP_CHANNELS = new Set([
  'Pós-Venda base XPE',
  'Sind. Profissional Base',
  'Administradora Cond.',
  'Sucesso do Cliente',
  'Indicação de Cliente XPE',
  'Indicação Avulsa',
  'Parceiro Comercial',
  'Evento',
  'Redrive',
  'Lista de Contato'
]);
/** Motivos oficiais do campo. Qualquer outro texto é entrada livre. */
const OFFICIAL_LOST_REASONS = new Set([
  'Caiu de Prioridade',
  'Tentativas Esgotadas (Final Cadência)',
  'Barrado em Assembleia',
  'Concorrente',
  'Fora do ICP'
]);

const dealsPayload = await readJson('pipedrive-deals.json');
const deals = unwrap(dealsPayload) ?? [];
const dealFields = unwrap(await readJson('pipedrive-deal-fields.json')) ?? [];
const stages = unwrap(await readJson('pipedrive-stages.json')) ?? [];
const pipelines = unwrap(await readJson('pipedrive-pipelines.json')) ?? [];
const activities = unwrap(await readJson('pipedrive-activities.json')) ?? [];
const activityTypes = unwrap(await readJson('pipedrive-activity-types.json')) ?? [];
const goals = unwrap(await readJson('pipedrive-goals.json')) ?? [];

const optionsOf = (key) => {
  const field = dealFields.find((f) => f.key === key);
  return Object.fromEntries((field?.options ?? []).map((o) => [String(o.id), o.label]));
};
const channelById = optionsOf('channel');
const labelById = optionsOf('label');
const stageById = Object.fromEntries(stages.map((s) => [String(s.id), s]));
const pipelineById = Object.fromEntries(pipelines.map((p) => [String(p.id), p.name]));
const activityTypeName = Object.fromEntries(activityTypes.map((t) => [t.key_string, t.name]));

function labelsOf(deal) {
  if (deal.label == null) return [];
  const raw = Array.isArray(deal.label) ? deal.label : String(deal.label).split(',');
  return raw.map((id) => labelById[String(id).trim()] ?? String(id).trim());
}

/** Data no fuso do negócio — evita jogar fechamentos da noite para o dia seguinte. */
const dayFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
function toLocalDay(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(date.getTime())) return null;
  return dayFormatter.format(date);
}
const monthOf = (value) => toLocalDay(value)?.slice(0, 7) ?? null;

const normalized = deals.map((deal) => {
  const labels = labelsOf(deal);
  const channelId = deal.channel == null || deal.channel === '' ? null : String(deal.channel);
  return {
    id: deal.id,
    title: deal.title ?? '',
    pipelineId: deal.pipeline_id ?? null,
    pipeline: pipelineById[String(deal.pipeline_id)] ?? 'Sem funil',
    stageId: deal.stage_id ?? null,
    stage: stageById[String(deal.stage_id)]?.name ?? 'Sem etapa',
    stageOrder: stageById[String(deal.stage_id)]?.order_nr ?? 999,
    status: String(deal.status ?? ''),
    value: Number(deal.value) || 0,
    channel: channelId ? channelById[channelId] ?? channelId : NO_CHANNEL,
    seller: labels.find((l) => SELLER_LABELS.has(l)) ?? null,
    lostReason: deal.lost_reason ? String(deal.lost_reason).trim() : null,
    createdMonth: monthOf(deal.add_time),
    wonMonth: monthOf(deal.won_time),
    lostMonth: monthOf(deal.lost_time),
    addDay: toLocalDay(deal.add_time),
    wonDay: toLocalDay(deal.won_time),
    lostDay: toLocalDay(deal.lost_time),
    addTime: deal.add_time ?? null,
    wonTime: deal.won_time ?? null,
    lostTime: deal.lost_time ?? null
  };
});

// ---------------------------------------------------------------------------
// Helpers de distribuição
// ---------------------------------------------------------------------------
function distribution(rows, keyOf) {
  const byKey = new Map();
  let totalCount = 0;
  let totalValue = 0;
  for (const row of rows) {
    const key = keyOf(row) || NO_CHANNEL;
    const entry = byKey.get(key) ?? { key, deals: 0, value: 0 };
    entry.deals += 1;
    entry.value += row.value;
    byKey.set(key, entry);
    totalCount += 1;
    totalValue += row.value;
  }
  return [...byKey.values()]
    .map((entry) => ({
      ...entry,
      dealsPct: totalCount ? (entry.deals / totalCount) * 100 : 0,
      valuePct: totalValue ? (entry.value / totalValue) * 100 : 0
    }))
    .sort((a, b) => b.value - a.value || b.deals - a.deals);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

function daysBetween(start, end) {
  if (!start || !end) return null;
  const a = new Date(String(start).replace(' ', 'T') + 'Z');
  const b = new Date(String(end).replace(' ', 'T') + 'Z');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const diff = (b.getTime() - a.getTime()) / 86_400_000;
  return diff >= 0 ? diff : null;
}

function relationshipShare(rows) {
  if (!rows.length) return { dealsPct: 0, valuePct: 0, deals: 0 };
  const relationship = rows.filter((row) => RELATIONSHIP_CHANNELS.has(row.channel));
  const totalValue = rows.reduce((sum, row) => sum + row.value, 0);
  return {
    deals: relationship.length,
    dealsPct: (relationship.length / rows.length) * 100,
    valuePct: totalValue ? (relationship.reduce((s, r) => s + r.value, 0) / totalValue) * 100 : 0
  };
}

// ---------------------------------------------------------------------------
// Escopos analisados (o diretor fala de consultoria, mas obras muda a leitura)
// ---------------------------------------------------------------------------
const SCOPES = [
  { id: 'consultoria', label: 'Consultoria', pipelineIds: [CONSULTORIA_PIPELINE] },
  { id: 'obras', label: 'Obras', pipelineIds: [OBRAS_PIPELINE] },
  { id: 'consultoria-obras', label: 'Consultoria + Obras', pipelineIds: [CONSULTORIA_PIPELINE, OBRAS_PIPELINE] }
];

const focusYear = new Intl.DateTimeFormat('sv-SE', { timeZone: BUSINESS_TIMEZONE, year: 'numeric' }).format(new Date());
const currentMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: BUSINESS_TIMEZONE, year: 'numeric', month: '2-digit' })
  .format(new Date())
  .slice(0, 7);

const monthsInYear = Array.from({ length: 12 }, (_, i) => `${focusYear}-${String(i + 1).padStart(2, '0')}`);
const activeMonths = monthsInYear.filter((month) => month <= currentMonth);

// ---------------------------------------------------------------------------
// Atividades: reuniões por semana, o indicador que o diretor acompanha
// ---------------------------------------------------------------------------
const activityRows = activities.map((activity) => ({
  id: activity.id,
  type: activity.type,
  typeName: activityTypeName[activity.type] ?? activity.type,
  done: Boolean(activity.done),
  userId: activity.user_id ?? null,
  dealId: activity.deal_id ?? null,
  doneMonth: monthOf(activity.marked_as_done_time),
  doneDay: toLocalDay(activity.marked_as_done_time)
}));

const dealPipelineById = new Map(normalized.map((deal) => [deal.id, deal.pipelineId]));
const weeksInMonth = (month) => {
  const [year, mm] = month.split('-').map(Number);
  return new Date(year, mm, 0).getDate() / 7;
};

function activitiesForMonth(month) {
  const done = activityRows.filter((row) => row.done && row.doneMonth === month);
  const commercial = done.filter((row) => {
    const pipelineId = dealPipelineById.get(row.dealId);
    return pipelineId === CONSULTORIA_PIPELINE || pipelineId === OBRAS_PIPELINE;
  });
  const byType = new Map();
  for (const row of done) byType.set(row.typeName, (byType.get(row.typeName) ?? 0) + 1);
  const meetings = done.filter((row) => row.type === 'meeting').length;
  const weeks = weeksInMonth(month);
  return {
    month,
    completed: done.length,
    completedCommercial: commercial.length,
    meetings,
    meetingsPerWeek: weeks ? meetings / weeks : 0,
    completedPerWeek: weeks ? done.length / weeks : 0,
    byType: [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count)
  };
}

// Meta semanal de reunião vinda do próprio Pipedrive.
const meetingGoal = goals.find(
  (goal) => goal.type?.name === 'activities_completed' && goal.interval === 'weekly'
);
const meetingGoalWeeks = (meetingGoal?.intervalResults ?? []).map((row) => ({
  start: row.start,
  end: row.end,
  month: row.start.slice(0, 7),
  target: row.target ?? 0,
  progress: row.progress ?? 0,
  attainmentPct: row.target ? ((row.progress ?? 0) / row.target) * 100 : null
}));

function meetingGoalForMonth(month) {
  const weeks = meetingGoalWeeks.filter((row) => row.month === month && row.target > 0);
  if (!weeks.length) return null;
  const target = average(weeks.map((row) => row.target));
  const actual = average(weeks.map((row) => row.progress));
  return {
    weeks: weeks.length,
    weeklyTarget: target,
    weeklyActual: actual,
    gapPerWeek: (actual ?? 0) - (target ?? 0),
    attainmentPct: target ? ((actual ?? 0) / target) * 100 : null
  };
}

// ---------------------------------------------------------------------------
// Metas financeiras por escopo
// ---------------------------------------------------------------------------
function goalSeries(matcher) {
  const goal = goals.find((g) => g.is_active && matcher.test(g.title ?? ''));
  if (!goal) return null;
  return {
    title: goal.title,
    intervals: (goal.intervalResults ?? []).map((row) => ({
      month: row.start.slice(0, 7),
      start: row.start,
      end: row.end,
      target: row.target ?? 0,
      progress: row.progress ?? 0,
      attainmentPct: row.target ? ((row.progress ?? 0) / row.target) * 100 : null
    }))
  };
}
const goalByScope = {
  consultoria: goalSeries(/Meta Consultoria \/ M[eê]s/i),
  obras: goalSeries(/Meta Obras \/ M[eê]s/i),
  'consultoria-obras': goalSeries(/Meta Global XPE \/ M[eê]s/i)
};
const createdPotentialGoal = goalSeries(/Meta\s+Potencial Criado/i);

// ---------------------------------------------------------------------------
// Montagem por escopo e por mês
// ---------------------------------------------------------------------------
function buildScope(scope) {
  const inScope = normalized.filter((deal) => scope.pipelineIds.includes(deal.pipelineId));
  const open = inScope.filter((deal) => deal.status === 'open');
  const sellers = [...new Set(inScope.map((deal) => deal.seller).filter(Boolean))].sort();

  const openByStage = distribution(open, (deal) => deal.stage).map((row) => {
    const sample = open.find((deal) => deal.stage === row.key);
    return { ...row, stageOrder: sample?.stageOrder ?? 999 };
  }).sort((a, b) => a.stageOrder - b.stageOrder);

  const months = activeMonths.map((month) => {
    const won = inScope.filter((deal) => deal.status === 'won' && deal.wonMonth === month);
    const lost = inScope.filter((deal) => deal.status === 'lost' && deal.lostMonth === month);
    const created = inScope.filter((deal) => deal.createdMonth === month);
    const cycleDays = won.map((deal) => daysBetween(deal.addTime, deal.wonTime)).filter((n) => n != null);
    const goalRow = goalByScope[scope.id]?.intervals.find((row) => row.month === month) ?? null;
    const createdGoalRow = createdPotentialGoal?.intervals.find((row) => row.month === month) ?? null;

    return {
      month,
      isPartial: month === currentMonth,
      won: {
        deals: won.length,
        value: won.reduce((sum, deal) => sum + deal.value, 0),
        averageTicket: won.length ? won.reduce((sum, deal) => sum + deal.value, 0) / won.length : 0,
        byChannel: distribution(won, (deal) => deal.channel),
        bySeller: distribution(won, (deal) => deal.seller ?? 'Sem vendedor'),
        relationshipShare: relationshipShare(won)
      },
      lost: {
        deals: lost.length,
        value: lost.reduce((sum, deal) => sum + deal.value, 0),
        byReason: distribution(lost, (deal) => deal.lostReason ?? 'Sem motivo'),
        byChannel: distribution(lost, (deal) => deal.channel),
        bySeller: distribution(lost, (deal) => deal.seller ?? 'Sem vendedor'),
        offCatalogReasons: lost.filter(
          (deal) => deal.lostReason && !OFFICIAL_LOST_REASONS.has(deal.lostReason)
        ).length
      },
      created: {
        deals: created.length,
        value: created.reduce((sum, deal) => sum + deal.value, 0),
        byChannel: distribution(created, (deal) => deal.channel)
      },
      cycle: {
        sample: cycleDays.length,
        averageDays: average(cycleDays),
        medianDays: median(cycleDays)
      },
      winRatePct: won.length + lost.length ? (won.length / (won.length + lost.length)) * 100 : null,
      goal: goalRow,
      createdGoal: createdGoalRow,
      activities: activitiesForMonth(month),
      meetingGoal: meetingGoalForMonth(month)
    };
  });

  const yearWon = inScope.filter((deal) => deal.status === 'won' && deal.wonMonth?.startsWith(focusYear));
  const yearLost = inScope.filter((deal) => deal.status === 'lost' && deal.lostMonth?.startsWith(focusYear));
  const yearCycle = yearWon.map((deal) => daysBetween(deal.addTime, deal.wonTime)).filter((n) => n != null);

  return {
    id: scope.id,
    label: scope.label,
    sellers,
    openPipeline: {
      deals: open.length,
      value: open.reduce((sum, deal) => sum + deal.value, 0),
      zeroValueDeals: open.filter((deal) => deal.value === 0).length,
      untrackedChannelDeals: open.filter((deal) => deal.channel === NO_CHANNEL).length,
      byChannel: distribution(open, (deal) => deal.channel),
      byStage: openByStage,
      bySeller: distribution(open, (deal) => deal.seller ?? 'Sem vendedor'),
      relationshipShare: relationshipShare(open),
      bySellerChannel: sellers.map((seller) => {
        const rows = open.filter((deal) => deal.seller === seller);
        return {
          seller,
          deals: rows.length,
          value: rows.reduce((sum, deal) => sum + deal.value, 0),
          byChannel: distribution(rows, (deal) => deal.channel),
          relationshipShare: relationshipShare(rows)
        };
      }),
      topDeals: [...open]
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
        .map((deal) => ({
          id: deal.id,
          title: deal.title,
          value: deal.value,
          stage: deal.stage,
          seller: deal.seller,
          channel: deal.channel,
          ageDays: daysBetween(deal.addTime, new Date().toISOString())
        }))
    },
    year: {
      won: {
        deals: yearWon.length,
        value: yearWon.reduce((sum, deal) => sum + deal.value, 0),
        byChannel: distribution(yearWon, (deal) => deal.channel),
        bySeller: distribution(yearWon, (deal) => deal.seller ?? 'Sem vendedor'),
        relationshipShare: relationshipShare(yearWon)
      },
      lost: {
        deals: yearLost.length,
        value: yearLost.reduce((sum, deal) => sum + deal.value, 0),
        byReason: distribution(yearLost, (deal) => deal.lostReason ?? 'Sem motivo'),
        byChannel: distribution(yearLost, (deal) => deal.channel),
        offCatalogReasons: yearLost.filter(
          (deal) => deal.lostReason && !OFFICIAL_LOST_REASONS.has(deal.lostReason)
        ).length
      },
      cycle: {
        sample: yearCycle.length,
        averageDays: average(yearCycle),
        medianDays: median(yearCycle)
      },
      winRatePct: yearWon.length + yearLost.length ? (yearWon.length / (yearWon.length + yearLost.length)) * 100 : null
    },
    months
  };
}

const scopes = SCOPES.map(buildScope);

// ---------------------------------------------------------------------------
// Alertas de qualidade de dado — o que impede a análise de ser confiável
// ---------------------------------------------------------------------------
const consultoria = scopes.find((s) => s.id === 'consultoria');
const dataQuality = [];

if (consultoria) {
  const open = consultoria.openPipeline;
  if (open.untrackedChannelDeals > 0) {
    dataQuality.push({
      severity: open.untrackedChannelDeals / Math.max(open.deals, 1) > 0.1 ? 'alta' : 'media',
      title: 'Negócios abertos sem canal de origem',
      detail: `${open.untrackedChannelDeals} de ${open.deals} negócios abertos em consultoria estão sem "Canal de origem". Toda leitura de origem herda esse ponto cego.`,
      metric: open.untrackedChannelDeals
    });
  }
  if (open.zeroValueDeals > 0) {
    dataQuality.push({
      severity: open.zeroValueDeals / Math.max(open.deals, 1) > 0.2 ? 'alta' : 'media',
      title: 'Negócios abertos sem valor preenchido',
      detail: `${open.zeroValueDeals} de ${open.deals} negócios abertos estão com valor zero. O potencial em aberto está subestimado e o forecast fica cego nessa fatia.`,
      metric: open.zeroValueDeals
    });
  }
  if (consultoria.year.lost.offCatalogReasons > 0) {
    dataQuality.push({
      severity: 'media',
      title: 'Motivos de perda fora do catálogo',
      detail: `${consultoria.year.lost.offCatalogReasons} negócios perdidos em ${focusYear} usam motivo digitado à mão em vez das 5 opções oficiais. Eles somem de qualquer agrupamento.`,
      metric: consultoria.year.lost.offCatalogReasons
    });
  }
}

const usersWithActivities = new Set(activityRows.map((row) => row.userId)).size;
if (usersWithActivities <= 1) {
  dataQuality.push({
    severity: 'alta',
    title: 'Atividades de um único usuário',
    detail: 'A base de atividades tem apenas um usuário. O sync do Pipedrive precisa de user_id=0 para trazer a agenda de todo o time.',
    metric: usersWithActivities
  });
}

const intel = {
  generatedAt: new Date().toISOString(),
  syncedAt: dealsPayload?.syncedAt ?? null,
  timezone: BUSINESS_TIMEZONE,
  focusYear,
  currentMonth,
  months: activeMonths,
  source: 'Pipedrive API (negócios, atividades, metas)',
  methodology: {
    openPipeline: 'Negócios com status aberto no funil, medidos por valor (R$) e por quantidade.',
    channel: 'Campo "Canal de origem" do negócio. Vazio aparece como "Sem tracking", nunca redistribuído.',
    seller: 'Etiqueta do negócio (GABRIEL/IGOR/JONILDO). O Pipedrive tem só 2 usuários, então o vendedor vem da etiqueta.',
    cycle: 'Dias entre criação e ganho. A mediana é a referência: a média é puxada por negócios muito antigos.',
    relationship: 'Canais de base e indicação, tudo que não é tráfego pago nem site. "Sem tracking" fica de fora.',
    lostReasons: 'Campo "Motivo da perda". Texto livre fora das 5 opções oficiais é contado à parte.',
    meetings: 'Atividades do tipo Reunião concluídas, e a meta semanal configurada no próprio Pipedrive.'
  },
  scopes,
  meetingGoalWeeks,
  goals: {
    consultoria: goalByScope.consultoria,
    obras: goalByScope.obras,
    global: goalByScope['consultoria-obras'],
    createdPotential: createdPotentialGoal,
    meetingsWeekly: meetingGoal
      ? { title: meetingGoal.title, weeks: meetingGoalWeeks }
      : null
  },
  dataQuality
};

await writeFile(new URL('commercial-intel.json', outDir), JSON.stringify(intel, null, 2));

const cons = scopes.find((s) => s.id === 'consultoria');
console.log('Inteligência comercial gerada: data/processed/commercial-intel.json');
console.log(
  `  consultoria — aberto ${cons.openPipeline.deals} negócios / R$ ${Math.round(cons.openPipeline.value).toLocaleString('pt-BR')}` +
    ` | ganhos ${focusYear}: ${cons.year.won.deals} | perdidos ${focusYear}: ${cons.year.lost.deals}` +
    ` | ciclo mediano ${cons.year.cycle.medianDays?.toFixed(1) ?? '—'}d`
);
console.log(`  alertas de qualidade de dado: ${dataQuality.length}`);
