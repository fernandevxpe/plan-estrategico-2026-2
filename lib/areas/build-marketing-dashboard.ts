import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { dataPath, readProcessed } from "@/lib/data/processed-store";
import type { Analysis, GoalPlan } from '@/lib/analysis/types';
import type { RevenueFunnelDashboard } from '@/lib/areas/build-revenue-funnel-dashboard';

export type MarketingPeriodKey = 'last7d' | 'last30d' | 'month' | 'ytd' | `${number}-${number}`;

export type MarketingMetrics = {
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  linkClicks: number;
  outboundClicks: number;
  landingPageViews: number;
  conversations: number;
  leads: number;
  videoViews: number;
  video25: number;
  video50: number;
  video75: number;
  video100: number;
  cpc: number;
  cpm: number;
  ctr: number;
  costPerConversation: number | null;
  costPerLandingPageView: number | null;
  costPerLead: number | null;
};

export type MarketingPerformanceRow = MarketingMetrics & {
  campaignId?: string;
  campaignName?: string;
  objective?: string | null;
  adId?: string;
  adName?: string;
  adsetName?: string;
  effectiveStatus?: string | null;
  creative?: {
    title: string;
    body: string | null;
    thumbnailUrl: string | null;
    videoId: string | null;
    permalink: string | null;
  } | null;
};

export type MarketingDailyCreativeRow = Pick<MarketingMetrics, 'spend' | 'impressions' | 'clicks' | 'linkClicks' | 'outboundClicks' | 'landingPageViews' | 'conversations' | 'leads' | 'videoViews' | 'video100'> & {
  date: string;
  adId: string;
  campaignId?: string | null;
  campaignName?: string | null;
};

/** Um mês fechado do funil, do investimento em mídia ao contrato ganho. */
export type MarketingBaselineMonth = {
  month: string;
  partial: boolean;
  spend: number;
  impressions: number;
  clicks: number;
  outboundClicks: number;
  landingPageViews: number;
  conversations: number;
  cpc: number | null;
  costPerConversation: number | null;
  clickToConversationPct: number | null;
  opportunities: number;
  won: number;
  wonRevenue: number;
  averageTicket: number | null;
  paidWonDeals: number;
  paidWonRevenue: number;
  /** Coorte com tempo suficiente para maturar dado o ciclo de venda. */
  mature: boolean;
};

/** Par defasado: conversas do mês N × contratos pagos fechados em N + ciclo. */
export type MarketingLagPair = {
  conversationMonth: string;
  closeMonth: string;
  conversations: number;
  spend: number;
  paidWonDeals: number;
  paidWonRevenue: number;
  conversationToWonPct: number | null;
  mediaCostPerWon: number | null;
  revenuePerSpend: number | null;
};

export type MarketingGoalTarget = { month: string; target: number; realized: number; attainmentPct: number | null };

export type MarketingRevenueBaseline = {
  currentMonth: string;
  lastClosedMonth: string;
  goalId: string | null;
  goalTitle: string;
  goalOptions: Array<{ id: string; title: string; pipelines: string[]; totalTarget: number }>;
  targets: MarketingGoalTarget[];
  monthly: MarketingBaselineMonth[];
  lagPairs: MarketingLagPair[];
  /**
   * Negócios de tráfego pago já no funil. Ignorar isso era o erro que inflava o
   * plano: a projeção pedia que a mídia gerasse do zero uma receita que em boa
   * parte já está em negociação.
   */
  pipeline: {
    openDeals: number;
    openValue: number;
    wonDeals: number;
    lostDeals: number;
    /** Ganhos sobre decididos (ganhos + perdidos) no canal. */
    winRatePct: number | null;
    expectedValue: number;
  };
  rates: {
    lagMonths: number;
    leadTimeDays: number | null;
    cpc: number | null;
    costPerConversation: number | null;
    clickToConversationPct: number | null;
    conversationToPaidWonPct: number | null;
    paidRevenuePerConversation: number | null;
    paidTicket: number | null;
    paidShareOfWonRevenuePct: number | null;
    paidShareOfWonDealsPct: number | null;
    mediaCostPerPaidWon: number | null;
    roasOnMedia: number | null;
    /** Amostra que sustenta cada taxa — base da faixa de confiança. */
    matureMonths: number;
    matureConversations: number;
    maturePaidWonDeals: number;
  };
  /** Faixa observada mês a mês, usada nos cenários conservador/otimista. */
  bands: {
    cpc: { p25: number | null; p50: number | null; p75: number | null };
    clickToConversationPct: { p25: number | null; p50: number | null; p75: number | null };
    conversationToWonPct: { p25: number | null; p50: number | null; p75: number | null };
    paidTicket: { p25: number | null; p50: number | null; p75: number | null };
  };
  warnings: string[];
};

/**
 * Registro de análises do Gestor IA.
 *
 * Cada edição é escrita em sessão sobre os fatos já calculados e versionada em
 * `data/ai/gestor-marketing/AAAA-MM-DD.json` — não há chamada de modelo em
 * runtime. Uma análise nova é um arquivo novo; as antigas ficam para comparar
 * o que foi dito com o que aconteceu depois.
 */
export type MarketingGestorTable = {
  colunas: string[];
  linhas: string[][];
  nota?: string;
};

export type MarketingGestorSection = {
  id: string;
  titulo: string;
  /** Ênfase visual da seção; `neutro` quando não é um alerta. */
  tom?: 'critico' | 'atencao' | 'oportunidade' | 'neutro';
  paragrafos: string[];
  lista?: string[];
  listaOrdenada?: boolean;
  tabela?: MarketingGestorTable;
  destaque?: string;
};

/**
 * Fotografia dos números no dia da análise.
 *
 * Os indicadores da página são sempre recalculados sobre o dado mais recente,
 * então sem este congelamento não haveria como comparar uma edição com a
 * anterior — o "antes" simplesmente deixaria de existir.
 */
export type MarketingGestorSnapshot = {
  investidoNoAno: number;
  conversas: number;
  custoPorConversa: number | null;
  conversaParaContratoPct: number | null;
  midiaPorContrato: number | null;
  retornoSobreMidia: number | null;
  criativosFatigados: number;
  conceitosAtivos: number;
  investimentoExigidoNoMes: number | null;
  investidoNoMes: number;
};

export type MarketingGestorEdition = {
  /** AAAA-MM-DD — também é o nome do arquivo. */
  date: string;
  titulo: string;
  model: string;
  /** `syncedAt` do marketing.json sobre o qual a análise foi escrita. */
  factsGeneratedAt: string;
  janela: string;
  base: string;
  resumo: string;
  indicadores?: MarketingGestorSnapshot;
  secoes: MarketingGestorSection[];
  conclusao: string;
};

export type MarketingDashboard = {
  generatedAt: string;
  syncedAt: string;
  source: string;
  account: { id: string; name: string; account_status: number; currency: string; timezone_name: string };
  dataQuality: { tokenReadOnly: boolean; pixelStatsAvailable: boolean; pixelStatsError: string | null; notes: string[] };
  totals: { campaigns: number; activeCampaigns: number; adsets: number; activeAdsets: number; ads: number; activeAds: number };
  periods: Record<MarketingPeriodKey, MarketingMetrics>;
  daily: Array<MarketingMetrics & { date: string }>;
  campaignPeriods: Record<MarketingPeriodKey, MarketingPerformanceRow[]>;
  adPeriods: Record<MarketingPeriodKey, MarketingPerformanceRow[]>;
  adDaily: MarketingDailyCreativeRow[];
  /**
   * Os meses que o histórico diário por criativo não cobre, declarados pelo
   * sync com o motivo que a Meta devolveu.
   *
   * Existe porque a série de `adDaily` não sabe se um mês vazio significa "não
   * anunciamos" ou "a API recusou". A resposta está aqui, e a tela precisa dela
   * para não desenhar um buraco como se fosse zero.
   */
  adDailyGaps: {
    /** Acervo anterior à declaração de lacunas: não se sabe se houve. */
    desconhecido: boolean;
    syncedAt: string | null;
    periodos: Array<{ periodo: string; motivo: string }>;
    mesesComDado: string[];
  };
  instagram: {
    profile: { id: string; username: string; name: string; followers_count: number; follows_count: number; media_count: number; profile_picture_url: string };
    media: Array<{
      id: string; caption: string; mediaType: string; mediaProductType: string; permalink: string; thumbnailUrl: string | null; timestamp: string;
      likes: number; comments: number; reach: number; views: number; saved: number; shares: number; interactions: number;
      engagementRatePct: number | null; averageWatchTimeMs: number; totalWatchTimeMs: number;
    }>;
  };
  pixel: { id: string; name: string; last_fired_time: string | null; statsAvailable: boolean; statsError: string | null; stats: unknown[] };
  attribution: {
    metaSpendYtd: number;
    paidTrafficWonDealsYtd: number;
    paidTrafficWonRevenueYtd: number;
    paidTrafficOpenDeals: number;
    paidTrafficOpenValue: number;
    paidTrafficLostDealsYtd: number;
    crmRevenueToSpend: number | null;
    note: string;
  };
  revenueBaseline: MarketingRevenueBaseline | null;
  /** Edições da análise, da mais recente para a mais antiga. */
  gestorEditions: MarketingGestorEdition[];
};

const GESTOR_DIR = 'gestor-marketing';

/**
 * Lê o registro de análises. Volume primeiro, repositório como reserva — mesmo
 * contrato dos artefatos processados. Uma edição corrompida não derruba as
 * outras: o arquivo é ignorado e o resto do histórico continua servindo.
 */
async function readGestorEditions(): Promise<MarketingGestorEdition[]> {
  const roots = [dataPath('ai', GESTOR_DIR), path.join(process.cwd(), 'data', 'ai', GESTOR_DIR)];
  for (const root of roots) {
    let files: string[];
    try {
      files = (await readdir(root)).filter((name) => name.endsWith('.json'));
    } catch {
      continue;
    }
    if (!files.length) continue;

    const editions: MarketingGestorEdition[] = [];
    for (const name of files.sort()) {
      try {
        editions.push(JSON.parse(await readFile(path.join(root, name), 'utf8')) as MarketingGestorEdition);
      } catch (error) {
        console.error(`Edição do Gestor IA ignorada (${name}):`, error);
      }
    }
    if (editions.length) return editions.sort((a, b) => b.date.localeCompare(a.date));
  }
  return [];
}

const PAID_CHANNEL = 'Tráfego Pago';

const div = (a: number, b: number) => (b > 0 ? a / b : null);
const share = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

function quantile(values: Array<number | null>, q: number): number | null {
  const list = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const position = (list.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return list[low]!;
  return list[low]! + (list[high]! - list[low]!) * (position - low);
}

function band(values: Array<number | null>) {
  return { p25: quantile(values, 0.25), p50: quantile(values, 0.5), p75: quantile(values, 0.75) };
}

function addMonths(month: string, delta: number) {
  const [year, index] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, index - 1 + delta, 1)).toISOString().slice(0, 7);
}

/**
 * Reconstrói o funil mês a mês, do investimento no Meta ao contrato ganho com
 * origem "Tráfego Pago" no Pipedrive.
 *
 * Duas decisões importam para o número não mentir:
 *
 * 1. `commercialMonthly` guarda ganhos **acumulados no ano**; o valor do mês sai
 *    da diferença entre meses consecutivos.
 * 2. Conversa e contrato não acontecem no mesmo mês. O par usa a defasagem do
 *    ciclo mediano observado (criação → ganho), e coortes que ainda não
 *    completaram esse ciclo ficam de fora das taxas — senão o mês recente
 *    aparece com conversão artificialmente baixa só por ainda estar maturando.
 */
function buildRevenueBaseline(
  analysis: Analysis,
  funnel: RevenueFunnelDashboard | null,
  marketing: Omit<MarketingDashboard, 'attribution' | 'revenueBaseline' | 'gestorEditions'>
): MarketingRevenueBaseline | null {
  const planning = analysis.planning2026;
  const commercial = [...(analysis.commercialMonthly ?? [])].sort((a, b) => a.month.localeCompare(b.month));
  if (!planning || !commercial.length) return null;

  const goal: GoalPlan | null =
    planning.highlights.consultoria ??
    planning.goals.find((item) => item.id === planning.primaryGoalId) ??
    planning.goals.find((item) => item.interval === 'monthly' && item.unit === 'currency') ??
    null;
  if (!goal) return null;

  const currentMonth = analysis.planningSummary?.partialMonth ?? planning.currentMonth;
  const lastClosedMonth = analysis.planningSummary?.lastClosedMonth ?? addMonths(currentMonth, -1);

  const funnelMonths = new Map(
    (funnel?.periods ?? [])
      .filter((period) => period.kind === 'month')
      .map((period) => [period.key, period])
  );

  /* Ciclo de venda: mediana das medianas mensais, ponderada pela amostra. */
  const cycleSamples: Array<{ days: number; weight: number }> = [];
  for (const period of funnelMonths.values()) {
    const segment = period.segments.find((item) => item.scope === 'all' && item.seller === 'TEAM');
    const metric = segment?.stageTimes.totalToClose;
    if (metric?.medianDays != null && metric.sample > 0) {
      cycleSamples.push({ days: metric.medianDays, weight: metric.sample });
    }
  }
  const totalWeight = cycleSamples.reduce((sum, item) => sum + item.weight, 0);
  const leadTimeDays = totalWeight
    ? cycleSamples.reduce((sum, item) => sum + item.days * item.weight, 0) / totalWeight
    : null;
  const lagMonths = Math.max(1, Math.min(3, Math.round((leadTimeDays ?? 51) / 30)));

  const monthly: MarketingBaselineMonth[] = [];
  let previousPaidDeals = 0;
  let previousPaidRevenue = 0;
  let previousWonRevenue = 0;

  for (const row of commercial) {
    const paid = row.wonYtd.channels.find((channel) => channel.key === PAID_CHANNEL);
    const paidDeals = (paid?.deals ?? 0) - previousPaidDeals;
    const paidRevenue = (paid?.value ?? 0) - previousPaidRevenue;
    const wonRevenue = row.wonYtd.value - previousWonRevenue;
    previousPaidDeals = paid?.deals ?? 0;
    previousPaidRevenue = paid?.value ?? 0;
    previousWonRevenue = row.wonYtd.value;

    const media = marketing.periods[row.month as keyof typeof marketing.periods];
    const funnelMonth = funnelMonths.get(row.month);
    const segment = funnelMonth?.segments.find((item) => item.scope === 'all' && item.seller === 'TEAM');

    monthly.push({
      month: row.month,
      partial: row.isPartial,
      spend: media?.spend ?? 0,
      impressions: media?.impressions ?? 0,
      clicks: media?.clicks ?? 0,
      outboundClicks: media?.outboundClicks ?? 0,
      landingPageViews: media?.landingPageViews ?? 0,
      conversations: media?.conversations ?? 0,
      cpc: div(media?.spend ?? 0, media?.outboundClicks ?? 0),
      costPerConversation: div(media?.spend ?? 0, media?.conversations ?? 0),
      clickToConversationPct: share(media?.conversations ?? 0, media?.outboundClicks ?? 0),
      opportunities: segment?.opportunities ?? 0,
      won: segment?.won ?? 0,
      wonRevenue: Math.max(0, wonRevenue),
      averageTicket: segment?.averageWonTicket ?? null,
      paidWonDeals: Math.max(0, paidDeals),
      paidWonRevenue: Math.max(0, paidRevenue),
      mature: addMonths(row.month, lagMonths) <= lastClosedMonth
    });
  }

  const byMonth = new Map(monthly.map((row) => [row.month, row]));
  const lagPairs: MarketingLagPair[] = monthly
    .filter((row) => !row.partial && row.month <= lastClosedMonth)
    .map((closeRow) => {
      const conversationMonth = addMonths(closeRow.month, -lagMonths);
      const source = byMonth.get(conversationMonth);
      if (!source) return null;
      return {
        conversationMonth,
        closeMonth: closeRow.month,
        conversations: source.conversations,
        spend: source.spend,
        paidWonDeals: closeRow.paidWonDeals,
        paidWonRevenue: closeRow.paidWonRevenue,
        conversationToWonPct: share(closeRow.paidWonDeals, source.conversations),
        mediaCostPerWon: div(source.spend, closeRow.paidWonDeals),
        revenuePerSpend: div(closeRow.paidWonRevenue, source.spend)
      } satisfies MarketingLagPair;
    })
    .filter((row): row is MarketingLagPair => row != null && row.conversations > 0);

  const matureMonths = monthly.filter((row) => row.mature && !row.partial);
  const matureSpend = matureMonths.reduce((sum, row) => sum + row.spend, 0);
  const matureClicks = matureMonths.reduce((sum, row) => sum + row.outboundClicks, 0);
  const matureConversations = matureMonths.reduce((sum, row) => sum + row.conversations, 0);
  const pairConversations = lagPairs.reduce((sum, row) => sum + row.conversations, 0);
  const pairSpend = lagPairs.reduce((sum, row) => sum + row.spend, 0);
  const pairWonDeals = lagPairs.reduce((sum, row) => sum + row.paidWonDeals, 0);
  const pairWonRevenue = lagPairs.reduce((sum, row) => sum + row.paidWonRevenue, 0);

  const latest = commercial.at(-1)!;
  const paidYtd = latest.wonYtd.channels.find((channel) => channel.key === PAID_CHANNEL);
  const paidOpen = latest.openPotential.channels.find((channel) => channel.key === PAID_CHANNEL);
  const paidLost = latest.lostYtd.channels.find((channel) => channel.key === PAID_CHANNEL);
  const decidedDeals = (paidYtd?.deals ?? 0) + (paidLost?.deals ?? 0);
  const pipelineWinRate = share(paidYtd?.deals ?? 0, decidedDeals);

  const warnings: string[] = [
    'A origem "Tráfego Pago" é preenchida manualmente no Pipedrive; não existe UTM/GCLID ligando o clique ao negócio.',
    `As taxas usam apenas coortes com ${lagMonths} mês(es) de maturação — conversas de ${addMonths(lastClosedMonth, -lagMonths + 1)} em diante ainda estão fechando.`,
    'Conversas iniciadas seguem a janela de atribuição do Meta e não são pessoas únicas.'
  ];
  if (funnel?.methodology.chatwootSince) {
    warnings.push(`Chatwoot só cobre a partir de ${funnel.methodology.chatwootSince}; meses anteriores não têm o volume real de atendimento.`);
  }
  if (marketing.totals.activeAds === 0) {
    warnings.push('Nenhum anúncio ativo na conta no momento da sincronização — a projeção parte de uma operação parada.');
  }

  return {
    currentMonth,
    lastClosedMonth,
    goalId: goal.id,
    goalTitle: goal.title,
    goalOptions: planning.goals
      .filter((item) => item.interval === 'monthly' && item.unit === 'currency' && item.metric === 'deals_won')
      .map((item) => ({ id: item.id, title: item.title, pipelines: item.pipelines ?? [], totalTarget: item.totalTarget })),
    targets: goal.intervals
      .filter((interval) => Boolean(interval.monthKey))
      .map((interval) => ({
        month: interval.monthKey!,
        target: interval.target,
        realized: interval.realized ?? 0,
        attainmentPct: interval.attainmentPct
      })),
    monthly,
    lagPairs,
    pipeline: {
      openDeals: paidOpen?.deals ?? 0,
      openValue: paidOpen?.value ?? 0,
      wonDeals: paidYtd?.deals ?? 0,
      lostDeals: paidLost?.deals ?? 0,
      winRatePct: pipelineWinRate,
      expectedValue: ((paidOpen?.value ?? 0) * (pipelineWinRate ?? 0)) / 100
    },
    rates: {
      lagMonths,
      leadTimeDays,
      cpc: div(matureSpend, matureClicks),
      costPerConversation: div(matureSpend, matureConversations),
      clickToConversationPct: share(matureConversations, matureClicks),
      conversationToPaidWonPct: share(pairWonDeals, pairConversations),
      paidRevenuePerConversation: div(pairWonRevenue, pairConversations),
      paidTicket: div(paidYtd?.value ?? 0, paidYtd?.deals ?? 0),
      paidShareOfWonRevenuePct: share(paidYtd?.value ?? 0, latest.wonYtd.value),
      paidShareOfWonDealsPct: share(paidYtd?.deals ?? 0, latest.wonYtd.deals),
      mediaCostPerPaidWon: div(pairSpend, pairWonDeals),
      roasOnMedia: div(pairWonRevenue, pairSpend),
      matureMonths: matureMonths.length,
      matureConversations,
      maturePaidWonDeals: pairWonDeals
    },
    bands: {
      cpc: band(monthly.filter((row) => row.spend > 0).map((row) => row.cpc)),
      clickToConversationPct: band(monthly.filter((row) => row.outboundClicks > 0).map((row) => row.clickToConversationPct)),
      conversationToWonPct: band(lagPairs.map((row) => row.conversationToWonPct)),
      paidTicket: band(lagPairs.filter((row) => row.paidWonDeals > 0).map((row) => row.paidWonRevenue / row.paidWonDeals))
    },
    warnings
  };
}

export async function buildMarketingDashboard(analysis: Analysis): Promise<MarketingDashboard> {
  const data = await readProcessed<Omit<MarketingDashboard, 'attribution' | 'revenueBaseline' | 'gestorEditions'>>('marketing.json');
  const funnel = await readProcessed<RevenueFunnelDashboard>('revenue-funnel.json').catch(() => null);
  const gestorEditions = await readGestorEditions();
  const latest = [...(analysis.commercialMonthly ?? [])].sort((a, b) => b.month.localeCompare(a.month))[0];
  const paidWon = latest?.wonYtd.channels.find((row) => row.key === 'Tráfego Pago');
  const paidOpen = latest?.openPotential.channels.find((row) => row.key === 'Tráfego Pago');
  const paidLost = latest?.lostYtd.channels.find((row) => row.key === 'Tráfego Pago');
  const revenue = paidWon?.value ?? 0;
  const spend = data.periods.ytd.spend;

  /* Um marketing.json gerado antes desta mudança não tem o campo. Ausente vira
     `desconhecido`, nunca lista vazia: "o sync não achou lacuna" e "este acervo
     não sabe dizer" são afirmações diferentes, e só a primeira autoriza ler os
     gráficos como completos. */
  const adDailyGaps = data.adDailyGaps ?? {
    desconhecido: true,
    syncedAt: null,
    periodos: [],
    mesesComDado: []
  };

  return {
    ...data,
    adDailyGaps,
    gestorEditions,
    revenueBaseline: buildRevenueBaseline(analysis, funnel, data),
    attribution: {
      metaSpendYtd: spend,
      paidTrafficWonDealsYtd: paidWon?.deals ?? 0,
      paidTrafficWonRevenueYtd: revenue,
      paidTrafficOpenDeals: paidOpen?.deals ?? 0,
      paidTrafficOpenValue: paidOpen?.value ?? 0,
      paidTrafficLostDealsYtd: paidLost?.deals ?? 0,
      crmRevenueToSpend: spend ? revenue / spend : null,
      note: 'Cruzamento gerencial por origem “Tráfego Pago” no Pipedrive; não é atribuição individual de pessoa nem substitui UTMs/GCLID/Meta Click ID.'
    }
  };
}
