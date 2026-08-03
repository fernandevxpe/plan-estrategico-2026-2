/**
 * Camada determinística do "Gestor IA".
 *
 * Tudo que é número sai daqui — Meta Ads Insights, coortes do Pipedrive e metas
 * reais da Goals API. O modelo de linguagem só recebe esses fatos já calculados
 * e escreve a leitura qualitativa em cima deles; ele nunca inventa métrica.
 *
 * O arquivo é isomórfico de propósito: a página calcula no cliente (o payload de
 * marketing já viaja inteiro) e a rota da IA recalcula no servidor a partir do
 * mesmo `MarketingDashboard`. Uma função, dois pontos de chamada, mesmo número.
 */

import type {
  MarketingDailyCreativeRow,
  MarketingDashboard,
  MarketingPerformanceRow,
  MarketingRevenueBaseline
} from "@/lib/areas/build-marketing-dashboard";

/* ─────────────────────────── tipos ─────────────────────────── */

/** Resultado que a campanha realmente busca — muda o denominador do custo. */
export type ResultKind = "conversation" | "landing" | "click";

export type CreativeVerdict = "escalar" | "manter" | "renovar" | "aposentar" | "observar";

export type FatigueLevel = "baixa" | "media" | "alta" | "critica";

export type CopyFeatures = {
  hook: string;
  chars: number;
  words: number;
  lines: number;
  emojis: number;
  questions: number;
  bullets: number;
  hasCta: boolean;
  hasRisk: boolean;
  hasAuthority: boolean;
  hasAudience: boolean;
  hasBenefit: boolean;
  hasNumbers: boolean;
  /** Rótulos legíveis, usados no card e no prompt. */
  tags: string[];
};

export type CreativeWindow = {
  days: number;
  spend: number;
  results: number;
  costPerResult: number | null;
  ctr: number | null;
  cpc: number | null;
};

export type CreativeFact = {
  adId: string;
  adName: string;
  campaignId: string | null;
  campaignName: string;
  adsetName: string | null;
  effectiveStatus: string | null;
  resultKind: ResultKind;
  resultLabel: string;
  conceptId: string;
  isVideo: boolean;
  thumbnailUrl: string | null;
  permalink: string | null;
  copy: CopyFeatures;
  firstDate: string | null;
  lastDate: string | null;
  activeDays: number;
  spanDays: number;
  daysSinceLastDelivery: number | null;
  spend: number;
  impressions: number;
  clicks: number;
  outboundClicks: number;
  landingPageViews: number;
  conversations: number;
  leads: number;
  videoViews: number;
  video25: number;
  video50: number;
  video75: number;
  video100: number;
  results: number;
  costPerResult: number | null;
  ctr: number | null;
  cpc: number | null;
  spendSharePct: number;
  /** Custo por resultado do anúncio ÷ mediana da mesma família de resultado. */
  costIndex: number | null;
  /** Qualidade do clique: quanto do clique sai do Meta e quanto vira conversa. */
  outboundSharePct: number | null;
  conversationPerClickPct: number | null;
  costPerOutboundClick: number | null;
  /** % de impressões que viraram view e % de views que seguraram cada quartil. */
  video: {
    viewRatePct: number | null;
    hold25Pct: number | null;
    hold50Pct: number | null;
    hold75Pct: number | null;
    hold100Pct: number | null;
    /** Queda entre 25% e 100% — mede se o miolo do vídeo segura. */
    dropFrom25To100Pct: number | null;
    retentionCurve: Array<{ point: string; viewers: number; pct: number | null }>;
  };
  /** Ganhos modelados (conversas × receita por conversa da coorte madura). */
  estimate: {
    wonDeals: number | null;
    revenue: number | null;
    roas: number | null;
    costPerWon: number | null;
  };
  firstHalf: CreativeWindow;
  lastHalf: CreativeWindow;
  costDeltaPct: number | null;
  ctrDeltaPct: number | null;
  fatigueScore: number;
  fatigueLevel: FatigueLevel;
  fatigueReasons: string[];
  verdict: CreativeVerdict;
  verdictReasons: string[];
  confidence: "alta" | "media" | "baixa";
};

export type ConceptFact = {
  conceptId: string;
  hook: string;
  body: string;
  tags: string[];
  ads: number;
  isVideo: boolean;
  firstDate: string | null;
  lastDate: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  outboundClicks: number;
  conversations: number;
  videoViews: number;
  results: number;
  resultKind: ResultKind;
  costPerResult: number | null;
  ctr: number | null;
  cpc: number | null;
  outboundSharePct: number | null;
  conversationPerClickPct: number | null;
  video100Pct: number | null;
  viewRatePct: number | null;
  retentionCurve: Array<{ point: string; viewers: number; pct: number | null }>;
  costIndex: number | null;
  /** Dias entre a primeira e a última entrega somando todos os anúncios do conceito. */
  spanDays: number;
  activeDays: number;
  estimate: { wonDeals: number | null; revenue: number | null; roas: number | null };
};

export type CopySignal = {
  feature: string;
  label: string;
  withAds: number;
  withoutAds: number;
  withCost: number | null;
  withoutCost: number | null;
  liftPct: number | null;
  sample: number;
};

export type PeakWindow = {
  key: string;
  label: string;
  start: string;
  end: string;
  spend: number;
  outboundClicks: number;
  conversations: number;
  landingPageViews: number;
  impressions: number;
  costPerConversation: number | null;
  cpc: number | null;
  ctr: number | null;
  /** Anúncios que entregaram na janela, do maior para o menor investimento. */
  drivers: Array<{ adId: string; adName: string; conceptId: string; spend: number; sharePct: number; conversations: number }>;
};

/**
 * A conta duplica o mesmo criativo em vários anúncios e conjuntos, então contar
 * `adId` infla qualquer política de renovação. Tudo aqui é medido por conceito
 * (texto de anúncio distinto), que é o que de fato precisa ser reescrito.
 */
export type RenewalPolicy = {
  /** Dias que uma execução sustenta entrega antes de ser trocada (nível anúncio). */
  usefulLifeDays: number | null;
  medianActiveDays: number | null;
  /** Há quanto tempo o mesmo conceito continua no ar (nível conceito). */
  conceptSpanDays: number | null;
  /** Verba que um conceito absorve por mês antes de saturar. */
  monthlySpendPerCreative: number | null;
  medianSpendPerCreative: number | null;
  medianResultsPerCreative: number | null;
  /** Anúncios e conceitos distintos que sustentaram 80% do investimento no ano. */
  adsFor80PctSpend: number;
  conceptsFor80PctSpend: number;
  totalConcepts: number;
  activeConcepts: number;
  fatiguedCreatives: number;
  /** Conceitos novos por mês para manter o pool girando na vida útil observada. */
  newCreativesPerMonth: number | null;
};

export type AccountStatus = {
  syncedAt: string;
  lastDeliveryDate: string | null;
  daysWithoutDelivery: number | null;
  activeCampaigns: number;
  activeAds: number;
  paused: boolean;
  currentMonthSpend: number;
};

export type CreativeIntelligence = {
  account: AccountStatus;
  totals: {
    spend: number;
    conversations: number;
    landingPageViews: number;
    outboundClicks: number;
    impressions: number;
    creativesWithSpend: number;
  };
  benchmarks: Record<ResultKind, { medianCostPerResult: number | null; ads: number; label: string }>;
  creatives: CreativeFact[];
  concepts: ConceptFact[];
  copySignals: CopySignal[];
  weekly: PeakWindow[];
  monthly: PeakWindow[];
  bestWindows: PeakWindow[];
  worstWindows: PeakWindow[];
  renewal: RenewalPolicy;
  buckets: Record<CreativeVerdict, CreativeFact[]>;
};

/* ─────────────────────── utilitários ─────────────────────── */

const safeDiv = (a: number, b: number) => (b > 0 ? a / b : null);
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

function median(values: number[]): number | null {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid]! : (list[mid - 1]! + list[mid]!) / 2;
}

function daysBetween(from: string, to: string) {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/** Hash estável e isomórfico (djb2) — agrupa criativos pelo texto do anúncio. */
function hashText(text: string) {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

const CTA_RE = /\b(clique|fale|solicite|agende|chame|garanta|pe[çc]a|envie|acesse|saiba|converse|receba|baixe)\b/i;
const RISK_RE = /(risco|perigo|multa|responsabilidade|sobrecarga|apag[ãa]o|preju[íi]zo|acidente|inc[êe]ndio|processo|responde|falha|escuro)/i;
const AUTHORITY_RE = /(laudo|norma|nbr|t[ée]cnic|engenheir|respaldo|obrigat|vistoria|legal|per[íi]cia|abnt)/i;
const AUDIENCE_RE = /(s[íi]ndic|condom[íi]nio|administradora|morador|pr[ée]dio)/i;
const BENEFIT_RE = /(seguran[çc]a|planejamento|economia|valoriza|preparado|tranquil|previsib|prote[çc])/i;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;

function describeCopy(title: string | null | undefined, body: string | null | undefined): CopyFeatures {
  const raw = (body || title || "").trim();
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const emojis = raw.match(EMOJI_RE)?.length ?? 0;
  const questions = (raw.match(/\?/g) ?? []).length;
  const bullets = lines.filter((line) => EMOJI_RE.test(line.slice(0, 3)) || /^[-•✓✅]/.test(line)).length;
  const features = {
    hook: lines[0]?.slice(0, 160) ?? "Sem texto informado pela Meta",
    chars: raw.length,
    words: raw ? raw.split(/\s+/).length : 0,
    lines: lines.length,
    emojis,
    questions,
    bullets,
    hasCta: CTA_RE.test(raw),
    hasRisk: RISK_RE.test(raw),
    hasAuthority: AUTHORITY_RE.test(raw),
    hasAudience: AUDIENCE_RE.test(raw),
    hasBenefit: BENEFIT_RE.test(raw),
    hasNumbers: /\d/.test(raw)
  };

  const tags: string[] = [];
  if (features.questions > 0) tags.push("abre com pergunta");
  if (features.hasRisk) tags.push("gatilho de risco");
  if (features.hasAuthority) tags.push("prova técnica");
  if (features.hasAudience) tags.push("público nomeado");
  if (features.hasBenefit) tags.push("promessa de benefício");
  if (features.bullets >= 2) tags.push("lista escaneável");
  if (features.hasCta) tags.push("CTA explícito");
  if (features.chars > 700) tags.push("texto longo");
  else if (features.chars && features.chars < 220) tags.push("texto curto");

  return { ...features, tags };
}

const COPY_SIGNAL_DEFS: Array<{ feature: keyof CopyFeatures; label: string }> = [
  { feature: "hasRisk", label: "Gatilho de risco / consequência" },
  { feature: "hasAuthority", label: "Prova técnica (laudo, norma, NBR)" },
  { feature: "hasAudience", label: "Público nomeado (síndico, condomínio)" },
  { feature: "hasBenefit", label: "Promessa de benefício" },
  { feature: "hasCta", label: "CTA explícito no texto" }
];

/* ───────────────── agregação diária por anúncio ───────────────── */

type DailyBucket = {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  outboundClicks: number;
  landingPageViews: number;
  conversations: number;
};

function dailyByAd(rows: MarketingDailyCreativeRow[]) {
  const map = new Map<string, Map<string, DailyBucket>>();
  for (const row of rows) {
    if (!row.adId) continue;
    if (!(row.spend > 0 || row.impressions > 0 || row.clicks > 0 || row.conversations > 0)) continue;
    const byDate = map.get(row.adId) ?? new Map<string, DailyBucket>();
    const bucket = byDate.get(row.date) ?? {
      date: row.date,
      spend: 0,
      impressions: 0,
      clicks: 0,
      outboundClicks: 0,
      landingPageViews: 0,
      conversations: 0
    };
    bucket.spend += row.spend;
    bucket.impressions += row.impressions;
    bucket.clicks += row.clicks;
    bucket.outboundClicks += row.outboundClicks;
    bucket.landingPageViews += row.landingPageViews;
    bucket.conversations += row.conversations;
    byDate.set(row.date, bucket);
    map.set(row.adId, byDate);
  }
  const out = new Map<string, DailyBucket[]>();
  for (const [adId, byDate] of map) {
    out.set(adId, [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)));
  }
  return out;
}

function windowFrom(points: DailyBucket[], resultKind: ResultKind): CreativeWindow {
  const totals = points.reduce(
    (acc, point) => {
      acc.spend += point.spend;
      acc.impressions += point.impressions;
      acc.clicks += point.clicks;
      acc.outboundClicks += point.outboundClicks;
      acc.landingPageViews += point.landingPageViews;
      acc.conversations += point.conversations;
      return acc;
    },
    { spend: 0, impressions: 0, clicks: 0, outboundClicks: 0, landingPageViews: 0, conversations: 0 }
  );
  const results =
    resultKind === "conversation"
      ? totals.conversations
      : resultKind === "landing"
        ? totals.landingPageViews
        : totals.outboundClicks;
  return {
    days: points.length,
    spend: totals.spend,
    results,
    costPerResult: safeDiv(totals.spend, results),
    ctr: pct(totals.clicks, totals.impressions),
    cpc: safeDiv(totals.spend, totals.outboundClicks || totals.clicks)
  };
}

/** Divide a entrega em duas metades de investimento igual (não de dias). */
function splitBySpend(points: DailyBucket[]) {
  const total = points.reduce((sum, point) => sum + point.spend, 0);
  if (!total || points.length < 4) return null;
  let running = 0;
  let cut = 0;
  for (let index = 0; index < points.length; index += 1) {
    running += points[index]!.spend;
    if (running >= total / 2) {
      cut = index + 1;
      break;
    }
  }
  if (cut < 2 || cut > points.length - 2) return null;
  return { first: points.slice(0, cut), last: points.slice(cut) };
}

/* ───────────────── inteligência de criativos ───────────────── */

function campaignResultKinds(rows: MarketingPerformanceRow[]) {
  const totals = new Map<string, { conversations: number; landingPageViews: number }>();
  for (const row of rows) {
    const key = row.campaignId ?? row.campaignName ?? "sem-campanha";
    const bucket = totals.get(key) ?? { conversations: 0, landingPageViews: 0 };
    bucket.conversations += row.conversations;
    bucket.landingPageViews += row.landingPageViews;
    totals.set(key, bucket);
  }
  const kinds = new Map<string, ResultKind>();
  for (const [key, bucket] of totals) {
    if (bucket.conversations >= bucket.landingPageViews && bucket.conversations > 0) kinds.set(key, "conversation");
    else if (bucket.landingPageViews > 0) kinds.set(key, "landing");
    else kinds.set(key, "click");
  }
  return kinds;
}

const RESULT_LABEL: Record<ResultKind, string> = {
  conversation: "conversa iniciada",
  landing: "página carregada",
  click: "clique externo"
};

export function buildCreativeIntelligence(data: MarketingDashboard): CreativeIntelligence {
  const syncedDay = data.syncedAt.slice(0, 10);
  const adRows = (data.adPeriods.ytd ?? []).filter((row) => row.adId && row.spend > 0);
  const daily = dailyByAd(data.adDaily ?? []);
  const kinds = campaignResultKinds(adRows);
  const totalSpend = adRows.reduce((sum, row) => sum + row.spend, 0);

  const creatives: CreativeFact[] = adRows.map((row) => {
    const adId = row.adId!;
    const campaignKey = row.campaignId ?? row.campaignName ?? "sem-campanha";
    const resultKind = kinds.get(campaignKey) ?? "click";
    const points = daily.get(adId) ?? [];
    const firstDate = points[0]?.date ?? null;
    const lastDate = points.at(-1)?.date ?? null;
    const copy = describeCopy(row.creative?.title, row.creative?.body);
    const results =
      resultKind === "conversation"
        ? row.conversations
        : resultKind === "landing"
          ? row.landingPageViews
          : row.outboundClicks;

    const halves = splitBySpend(points);
    const firstHalf = halves ? windowFrom(halves.first, resultKind) : windowFrom([], resultKind);
    const lastHalf = halves ? windowFrom(halves.last, resultKind) : windowFrom([], resultKind);
    const costDeltaPct =
      firstHalf.costPerResult && lastHalf.costPerResult
        ? (lastHalf.costPerResult / firstHalf.costPerResult - 1) * 100
        : null;
    const ctrDeltaPct =
      firstHalf.ctr && lastHalf.ctr ? (lastHalf.ctr / firstHalf.ctr - 1) * 100 : null;

    return {
      adId,
      adName: row.adName ?? "Anúncio",
      campaignId: row.campaignId ?? null,
      campaignName: row.campaignName ?? "Campanha",
      adsetName: row.adsetName ?? null,
      effectiveStatus: row.effectiveStatus ?? null,
      resultKind,
      resultLabel: RESULT_LABEL[resultKind],
      conceptId: hashText(((row.creative?.body || row.creative?.title || row.adName || adId) as string)
        .toLocaleLowerCase("pt-BR")
        .replace(/\s+/g, " ")
        .slice(0, 400)),
      isVideo: Boolean(row.creative?.videoId),
      thumbnailUrl: row.creative?.thumbnailUrl ?? null,
      permalink: row.creative?.permalink ?? null,
      copy,
      firstDate,
      lastDate,
      activeDays: points.length,
      spanDays: firstDate && lastDate ? daysBetween(firstDate, lastDate) + 1 : points.length,
      daysSinceLastDelivery: lastDate ? daysBetween(lastDate, syncedDay) : null,
      spend: row.spend,
      impressions: row.impressions,
      clicks: row.clicks,
      outboundClicks: row.outboundClicks,
      landingPageViews: row.landingPageViews,
      conversations: row.conversations,
      leads: row.leads,
      videoViews: row.videoViews,
      video25: row.video25,
      video50: row.video50,
      video75: row.video75,
      video100: row.video100,
      results,
      costPerResult: safeDiv(row.spend, results),
      ctr: pct(row.clicks, row.impressions),
      cpc: safeDiv(row.spend, row.outboundClicks || row.clicks),
      spendSharePct: pct(row.spend, totalSpend) ?? 0,
      costIndex: null,
      outboundSharePct: pct(row.outboundClicks, row.clicks),
      conversationPerClickPct: pct(row.conversations, row.outboundClicks || row.clicks),
      costPerOutboundClick: safeDiv(row.spend, row.outboundClicks),
      video: {
        viewRatePct: pct(row.videoViews, row.impressions),
        hold25Pct: pct(row.video25, row.videoViews),
        hold50Pct: pct(row.video50, row.videoViews),
        hold75Pct: pct(row.video75, row.videoViews),
        hold100Pct: pct(row.video100, row.videoViews),
        dropFrom25To100Pct: row.video25 > 0 ? (1 - row.video100 / row.video25) * 100 : null,
        retentionCurve: [
          { point: "View", viewers: row.videoViews, pct: row.videoViews ? 100 : null },
          { point: "25%", viewers: row.video25, pct: pct(row.video25, row.videoViews) },
          { point: "50%", viewers: row.video50, pct: pct(row.video50, row.videoViews) },
          { point: "75%", viewers: row.video75, pct: pct(row.video75, row.videoViews) },
          { point: "100%", viewers: row.video100, pct: pct(row.video100, row.videoViews) }
        ]
      },
      estimate: { wonDeals: null, revenue: null, roas: null, costPerWon: null },
      firstHalf,
      lastHalf,
      costDeltaPct,
      ctrDeltaPct,
      fatigueScore: 0,
      fatigueLevel: "baixa",
      fatigueReasons: [],
      verdict: "observar",
      verdictReasons: [],
      confidence: "baixa"
    };
  });

  /* Benchmarks por família de resultado — comparar conversa com página carregada
     é o erro clássico que faz o gestor matar o criativo certo. */
  const benchmarks = {} as CreativeIntelligence["benchmarks"];
  for (const kind of ["conversation", "landing", "click"] as ResultKind[]) {
    const group = creatives.filter((item) => item.resultKind === kind && item.results >= 3);
    benchmarks[kind] = {
      medianCostPerResult: median(group.map((item) => item.costPerResult!).filter(Boolean)),
      ads: group.length,
      label: RESULT_LABEL[kind]
    };
  }

  const lifeSample = creatives.filter((item) => item.results >= 5 && item.spanDays >= 3);
  const usefulLifeDays = median(lifeSample.map((item) => item.spanDays));

  for (const item of creatives) {
    const benchmark = benchmarks[item.resultKind].medianCostPerResult;
    item.costIndex = benchmark && item.costPerResult ? item.costPerResult / benchmark : null;

    /* Fadiga: encarecimento na segunda metade da verba + queda de CTR + idade. */
    const reasons: string[] = [];
    let score = 0;
    if (item.costDeltaPct != null) {
      if (item.costDeltaPct >= 60) {
        score += 40;
        reasons.push(`custo por ${item.resultLabel} subiu ${item.costDeltaPct.toFixed(0)}% na 2ª metade da verba`);
      } else if (item.costDeltaPct >= 25) {
        score += 24;
        reasons.push(`custo por ${item.resultLabel} subiu ${item.costDeltaPct.toFixed(0)}% na 2ª metade da verba`);
      } else if (item.costDeltaPct <= -20) {
        reasons.push(`custo por ${item.resultLabel} caiu ${Math.abs(item.costDeltaPct).toFixed(0)}% ao longo da veiculação`);
      }
    }
    if (item.ctrDeltaPct != null && item.ctrDeltaPct <= -35) {
      score += 22;
      reasons.push(`CTR caiu ${Math.abs(item.ctrDeltaPct).toFixed(0)}% entre as metades`);
    }
    if (usefulLifeDays && item.spanDays > usefulLifeDays * 1.6 && item.results >= 5) {
      score += 14;
      reasons.push(`${item.spanDays} dias no ar contra ${usefulLifeDays.toFixed(0)} de vida útil mediana`);
    }
    if (item.costIndex != null && item.costIndex >= 1.5) {
      score += 20;
      reasons.push(`custo ${((item.costIndex - 1) * 100).toFixed(0)}% acima da mediana da conta`);
    }
    item.fatigueScore = Math.min(100, score);
    item.fatigueLevel = score >= 60 ? "critica" : score >= 38 ? "alta" : score >= 18 ? "media" : "baixa";
    item.fatigueReasons = reasons;

    item.confidence = item.results >= 20 ? "alta" : item.results >= 6 ? "media" : "baixa";

    /* Veredito. A ordem importa: primeiro descarta o que não performou, depois
       separa o que ainda rende do que rende mas está cansando. */
    const verdictReasons: string[] = [];
    let verdict: CreativeVerdict = "observar";
    const index = item.costIndex;

    if (item.results === 0 && item.spend >= 60) {
      verdict = "aposentar";
      verdictReasons.push(`R$ ${item.spend.toFixed(0)} investidos sem nenhuma ${item.resultLabel}`);
    } else if (item.confidence === "baixa") {
      verdict = "observar";
      verdictReasons.push(`apenas ${item.results} ${item.resultLabel}(s) — amostra insuficiente para decidir`);
    } else if (index != null && index >= 1.4) {
      verdict = "aposentar";
      verdictReasons.push(`custo ${((index - 1) * 100).toFixed(0)}% acima da mediana com amostra ${item.confidence}`);
    } else if (item.fatigueScore >= 38 && index != null && index <= 1.2) {
      verdict = "renovar";
      verdictReasons.push("conceito válido, execução desgastada — refazer variação mantendo a promessa");
      verdictReasons.push(...item.fatigueReasons.slice(0, 2));
    } else if (index != null && index <= 0.8 && item.fatigueScore < 38) {
      verdict = "escalar";
      verdictReasons.push(`custo ${((1 - index) * 100).toFixed(0)}% abaixo da mediana e sem sinal de desgaste`);
    } else if (index != null && index <= 1.15) {
      verdict = "manter";
      verdictReasons.push("dentro da faixa de eficiência da conta");
    } else {
      verdict = "renovar";
      verdictReasons.push("eficiência acima da mediana da conta, sem folga para escalar");
    }

    if (item.daysSinceLastDelivery != null && item.daysSinceLastDelivery > 45 && verdict === "escalar") {
      verdictReasons.push(`parado há ${item.daysSinceLastDelivery} dias — reativar exige nova fase de aprendizado`);
    }

    item.verdict = verdict;
    item.verdictReasons = verdictReasons;
  }

  /* Conceitos = mesmo texto de anúncio rodando em vários adIds/conjuntos. */
  const conceptMap = new Map<string, ConceptFact>();
  for (const item of creatives) {
    const current = conceptMap.get(item.conceptId) ?? {
      conceptId: item.conceptId,
      hook: item.copy.hook,
      body: "",
      tags: item.copy.tags,
      ads: 0,
      isVideo: item.isVideo,
      firstDate: item.firstDate,
      lastDate: item.lastDate,
      spend: 0,
      impressions: 0,
      clicks: 0,
      outboundClicks: 0,
      conversations: 0,
      videoViews: 0,
      results: 0,
      resultKind: item.resultKind,
      costPerResult: null,
      ctr: null,
      cpc: null,
      outboundSharePct: null,
      conversationPerClickPct: null,
      video100Pct: null,
      viewRatePct: null,
      retentionCurve: [],
      costIndex: null,
      spanDays: 0,
      activeDays: 0,
      estimate: { wonDeals: null, revenue: null, roas: null }
    };
    current.ads += 1;
    current.spend += item.spend;
    current.impressions += item.impressions;
    current.clicks += item.clicks;
    current.outboundClicks += item.outboundClicks;
    current.conversations += item.conversations;
    current.videoViews += item.videoViews;
    current.results += item.results;
    current.isVideo = current.isVideo || item.isVideo;
    if (item.firstDate && (!current.firstDate || item.firstDate < current.firstDate)) current.firstDate = item.firstDate;
    if (item.lastDate && (!current.lastDate || item.lastDate > current.lastDate)) current.lastDate = item.lastDate;
    conceptMap.set(item.conceptId, current);
  }
  const videoByConcept = new Map<string, { v25: number; v50: number; v75: number; v100: number }>();
  for (const item of creatives) {
    const bucket = videoByConcept.get(item.conceptId) ?? { v25: 0, v50: 0, v75: 0, v100: 0 };
    bucket.v25 += item.video25;
    bucket.v50 += item.video50;
    bucket.v75 += item.video75;
    bucket.v100 += item.video100;
    videoByConcept.set(item.conceptId, bucket);
  }
  /* Dias distintos com entrega por conceito — dois anúncios no ar no mesmo dia
     contam como um dia de vida útil, não dois. */
  const conceptDays = new Map<string, Set<string>>();
  const adToConcept = new Map(creatives.map((item) => [item.adId, item.conceptId]));
  for (const [adId, points] of daily) {
    const conceptId = adToConcept.get(adId);
    if (!conceptId) continue;
    const set = conceptDays.get(conceptId) ?? new Set<string>();
    for (const point of points) set.add(point.date);
    conceptDays.set(conceptId, set);
  }

  const concepts = [...conceptMap.values()]
    .map((concept) => {
      const video = videoByConcept.get(concept.conceptId) ?? { v25: 0, v50: 0, v75: 0, v100: 0 };
      const benchmark = benchmarks[concept.resultKind].medianCostPerResult;
      const costPerResult = safeDiv(concept.spend, concept.results);
      return {
        ...concept,
        activeDays: conceptDays.get(concept.conceptId)?.size ?? 0,
        spanDays:
          concept.firstDate && concept.lastDate ? daysBetween(concept.firstDate, concept.lastDate) + 1 : 0,
        costPerResult,
        ctr: pct(concept.clicks, concept.impressions),
        cpc: safeDiv(concept.spend, concept.outboundClicks || concept.clicks),
        outboundSharePct: pct(concept.outboundClicks, concept.clicks),
        conversationPerClickPct: pct(concept.conversations, concept.outboundClicks || concept.clicks),
        video100Pct: pct(video.v100, concept.videoViews),
        viewRatePct: pct(concept.videoViews, concept.impressions),
        retentionCurve: [
          { point: "View", viewers: concept.videoViews, pct: concept.videoViews ? 100 : null },
          { point: "25%", viewers: video.v25, pct: pct(video.v25, concept.videoViews) },
          { point: "50%", viewers: video.v50, pct: pct(video.v50, concept.videoViews) },
          { point: "75%", viewers: video.v75, pct: pct(video.v75, concept.videoViews) },
          { point: "100%", viewers: video.v100, pct: pct(video.v100, concept.videoViews) }
        ],
        costIndex: benchmark && costPerResult ? costPerResult / benchmark : null
      };
    })
    .sort((a, b) => b.spend - a.spend);

  /* Sinais de copy: custo médio ponderado dos criativos com e sem cada elemento. */
  const copySignals: CopySignal[] = COPY_SIGNAL_DEFS.map(({ feature, label }) => {
    const pool = creatives.filter((item) => item.results >= 5 && item.costPerResult != null && item.resultKind === "conversation");
    const withFeature = pool.filter((item) => Boolean(item.copy[feature]));
    const withoutFeature = pool.filter((item) => !item.copy[feature]);
    const weighted = (group: CreativeFact[]) => {
      const spend = group.reduce((sum, item) => sum + item.spend, 0);
      const results = group.reduce((sum, item) => sum + item.results, 0);
      return safeDiv(spend, results);
    };
    const withCost = weighted(withFeature);
    const withoutCost = weighted(withoutFeature);
    return {
      feature: String(feature),
      label,
      withAds: withFeature.length,
      withoutAds: withoutFeature.length,
      withCost,
      withoutCost,
      liftPct: withCost && withoutCost ? (withoutCost / withCost - 1) * 100 : null,
      sample: pool.length
    };
  }).filter((signal) => signal.withAds >= 2 && signal.withoutAds >= 2);

  /* Janelas temporais — de onde saem os picos e as quedas. */
  const buildWindows = (granularity: "week" | "month"): PeakWindow[] => {
    const groups = new Map<string, PeakWindow>();
    for (const row of data.daily) {
      const key = granularity === "month" ? row.date.slice(0, 7) : weekKey(row.date);
      const window = groups.get(key) ?? {
        key,
        label: granularity === "month" ? monthLabel(key) : `Semana de ${shortDate(key)}`,
        start: row.date,
        end: row.date,
        spend: 0,
        outboundClicks: 0,
        conversations: 0,
        landingPageViews: 0,
        impressions: 0,
        costPerConversation: null,
        cpc: null,
        ctr: null,
        drivers: []
      };
      if (row.date < window.start) window.start = row.date;
      if (row.date > window.end) window.end = row.date;
      window.spend += row.spend;
      window.outboundClicks += row.outboundClicks;
      window.conversations += row.conversations;
      window.landingPageViews += row.landingPageViews;
      window.impressions += row.impressions;
      groups.set(key, window);
    }

    const clicksByWindow = new Map<string, number>();
    for (const row of data.daily) {
      const key = granularity === "month" ? row.date.slice(0, 7) : weekKey(row.date);
      clicksByWindow.set(key, (clicksByWindow.get(key) ?? 0) + row.clicks);
    }

    const drivers = new Map<string, Map<string, { spend: number; conversations: number }>>();
    for (const row of data.adDaily ?? []) {
      if (!row.adId || row.spend <= 0) continue;
      const key = granularity === "month" ? row.date.slice(0, 7) : weekKey(row.date);
      const byAd = drivers.get(key) ?? new Map<string, { spend: number; conversations: number }>();
      const bucket = byAd.get(row.adId) ?? { spend: 0, conversations: 0 };
      bucket.spend += row.spend;
      bucket.conversations += row.conversations;
      byAd.set(row.adId, bucket);
      drivers.set(key, byAd);
    }

    const byId = new Map(creatives.map((item) => [item.adId, item]));
    return [...groups.values()]
      .map((window) => {
        const byAd = drivers.get(window.key);
        const list = byAd
          ? [...byAd.entries()]
              .sort((a, b) => b[1].spend - a[1].spend)
              .slice(0, 5)
              .map(([adId, bucket]) => ({
                adId,
                adName: byId.get(adId)?.adName ?? adId,
                conceptId: byId.get(adId)?.conceptId ?? "",
                spend: bucket.spend,
                sharePct: pct(bucket.spend, window.spend) ?? 0,
                conversations: bucket.conversations
              }))
          : [];
        return {
          ...window,
          costPerConversation: safeDiv(window.spend, window.conversations),
          cpc: safeDiv(window.spend, window.outboundClicks),
          ctr: pct(clicksByWindow.get(window.key) ?? 0, window.impressions),
          drivers: list
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  };

  const weekly = buildWindows("week");
  const monthly = buildWindows("month");
  const rankable = weekly.filter((window) => window.spend >= 100 && window.conversations >= 5);
  const bestWindows = [...rankable].sort((a, b) => (a.costPerConversation ?? 1e9) - (b.costPerConversation ?? 1e9)).slice(0, 4);
  const worstWindows = [...rankable].sort((a, b) => (b.costPerConversation ?? 0) - (a.costPerConversation ?? 0)).slice(0, 3);

  /* Política de renovação, medida em conceitos: é o texto/vídeo que cansa, não o
     adId. A conta replica o mesmo criativo em dezenas de anúncios — contar por
     adId inflaria a cadência de renovação em uma ordem de grandeza. */
  const countTo80 = (values: number[]) => {
    let running = 0;
    let count = 0;
    for (const value of [...values].sort((a, b) => b - a)) {
      running += value;
      count += 1;
      if (running >= totalSpend * 0.8) break;
    }
    return count;
  };

  const conceptLifeSample = concepts.filter((concept) => concept.results >= 10 && concept.spanDays >= 3);

  /* Absorção mensal de verba: mediana entre conceitos é enganosa aqui, porque a
     cauda de conceitos pequenos com span longo puxa o número para dezenas de
     reais. O que interessa é quanto um conceito que carrega a conta aguenta por
     mês, então isso é ponderado pela verba dos que sustentam 80% do gasto. */
  const carrying = [...concepts]
    .sort((a, b) => b.spend - a.spend)
    .reduce<{ list: ConceptFact[]; running: number }>(
      (acc, concept) => {
        if (acc.running < totalSpend * 0.8) {
          acc.list.push(concept);
          acc.running += concept.spend;
        }
        return acc;
      },
      { list: [], running: 0 }
    ).list;
  const carryingMonths = carrying.reduce((sum, concept) => sum + Math.max(concept.spanDays, 1) / 30, 0);
  const carryingSpend = carrying.reduce((sum, concept) => sum + concept.spend, 0);
  const monthlySpendPerCreative = safeDiv(carryingSpend, carryingMonths);
  const conceptUsefulLife = median(conceptLifeSample.map((concept) => concept.spanDays));
  const activeConcepts = concepts.filter(
    (concept) => concept.lastDate != null && daysBetween(concept.lastDate, syncedDay) <= 30
  ).length;
  const poolForRenewal = Math.max(activeConcepts, countTo80(concepts.map((concept) => concept.spend)));

  const renewal: RenewalPolicy = {
    /* Vida útil = quanto uma execução aguenta antes de ser trocada, medida no
       anúncio. O span do conceito é outra coisa: mede há quanto tempo a conta
       insiste na mesma ideia — 169 dias no mesmo conceito é estagnação, não
       vida útil, e misturar os dois inverteria a leitura de renovação. */
    usefulLifeDays,
    medianActiveDays: median(lifeSample.map((item) => item.activeDays)),
    conceptSpanDays: conceptUsefulLife,
    monthlySpendPerCreative,
    medianSpendPerCreative: median(conceptLifeSample.map((concept) => concept.spend)),
    medianResultsPerCreative: median(conceptLifeSample.map((concept) => concept.results)),
    adsFor80PctSpend: countTo80(creatives.map((item) => item.spend)),
    conceptsFor80PctSpend: countTo80(concepts.map((concept) => concept.spend)),
    totalConcepts: concepts.length,
    activeConcepts,
    fatiguedCreatives: creatives.filter((item) => item.fatigueScore >= 38).length,
    newCreativesPerMonth:
      conceptUsefulLife && poolForRenewal > 0
        ? Math.max(1, Math.ceil((poolForRenewal * 30) / conceptUsefulLife))
        : null
  };

  const lastDeliveryDate = data.daily
    .filter((row) => row.spend > 0 || row.impressions > 0)
    .map((row) => row.date)
    .sort()
    .at(-1) ?? null;

  const buckets = {
    escalar: [] as CreativeFact[],
    manter: [] as CreativeFact[],
    renovar: [] as CreativeFact[],
    aposentar: [] as CreativeFact[],
    observar: [] as CreativeFact[]
  };
  for (const item of creatives) buckets[item.verdict].push(item);
  for (const key of Object.keys(buckets) as CreativeVerdict[]) {
    buckets[key].sort((a, b) => b.spend - a.spend);
  }

  return {
    account: {
      syncedAt: data.syncedAt,
      lastDeliveryDate,
      daysWithoutDelivery: lastDeliveryDate ? daysBetween(lastDeliveryDate, syncedDay) : null,
      activeCampaigns: data.totals.activeCampaigns,
      activeAds: data.totals.activeAds,
      paused: data.totals.activeAds === 0,
      currentMonthSpend: data.periods.month?.spend ?? 0
    },
    totals: {
      spend: totalSpend,
      conversations: creatives.reduce((sum, item) => sum + item.conversations, 0),
      landingPageViews: creatives.reduce((sum, item) => sum + item.landingPageViews, 0),
      outboundClicks: creatives.reduce((sum, item) => sum + item.outboundClicks, 0),
      impressions: creatives.reduce((sum, item) => sum + item.impressions, 0),
      creativesWithSpend: creatives.length
    },
    benchmarks,
    creatives: creatives.sort((a, b) => b.spend - a.spend),
    concepts,
    copySignals,
    weekly,
    monthly,
    bestWindows,
    worstWindows,
    renewal,
    buckets
  };
}

/**
 * Traduz conversas em receita **estimada** por criativo.
 *
 * Não existe UTM ligando anúncio a negócio no Pipedrive, então isto é um rateio
 * pela taxa observada da coorte madura — serve para ranquear criativos entre si,
 * não para fechar caixa. Todo consumidor precisa rotular como estimativa.
 */
export function applyRevenueEstimates(
  intelligence: CreativeIntelligence,
  baseline: MarketingRevenueBaseline | null
): CreativeIntelligence {
  const revenuePerConversation = baseline?.rates.paidRevenuePerConversation ?? null;
  const wonPerConversation = baseline?.rates.conversationToPaidWonPct ?? null;
  if (revenuePerConversation == null && wonPerConversation == null) return intelligence;

  const estimateFor = (conversations: number, spend: number) => {
    const revenue = revenuePerConversation != null ? conversations * revenuePerConversation : null;
    const wonDeals = wonPerConversation != null ? (conversations * wonPerConversation) / 100 : null;
    return {
      wonDeals,
      revenue,
      roas: revenue != null && spend > 0 ? revenue / spend : null,
      costPerWon: wonDeals && wonDeals > 0 ? spend / wonDeals : null
    };
  };

  for (const item of intelligence.creatives) {
    item.estimate = estimateFor(item.conversations, item.spend);
  }
  for (const concept of intelligence.concepts) {
    const { wonDeals, revenue, roas } = estimateFor(concept.conversations, concept.spend);
    concept.estimate = { wonDeals, revenue, roas };
  }
  return intelligence;
}

function weekKey(date: string) {
  const current = new Date(`${date}T12:00:00Z`);
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() - day + 1);
  return current.toISOString().slice(0, 10);
}

function shortDate(date: string) {
  return date.slice(5).split("-").reverse().join("/");
}

function monthLabel(month: string) {
  return new Date(`${month}-15T12:00:00Z`)
    .toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
    .replace(" de ", "/");
}

/* ─────────────────── calculadora de previsão ─────────────────── */

export type ForecastAssumptions = {
  /** Fatia da meta que o tráfego pago deve entregar (%). */
  paidSharePct: number;
  /** Ticket médio dos negócios ganhos com origem tráfego pago (R$). */
  paidTicket: number;
  /** Conversas iniciadas que viram negócio ganho (%). */
  conversationToWonPct: number;
  /** Cliques externos que viram conversa (%). */
  clickToConversationPct: number;
  /** Custo por clique externo (R$). */
  cpc: number;
  /** Defasagem entre o investimento e o fechamento, em dias. */
  leadTimeDays: number;
  /** Verba mensal que um criativo absorve antes de saturar (R$). */
  spendPerCreative: number;
  /** Dias que uma execução sustenta entrega antes de ser trocada. */
  creativeLifeDays: number;
};

export type ForecastMonth = {
  month: string;
  label: string;
  status: "realizado" | "projetado" | "parcial";
  target: number;
  realizedRevenue: number | null;
  /** Receita de tráfego pago exigida no mês. */
  paidRevenueTarget: number;
  paidRevenueRealized: number | null;
  wonNeeded: number;
  conversationsNeeded: number;
  clicksNeeded: number;
  spendNeeded: number;
  /** Mês em que o investimento precisa acontecer, dado o ciclo de venda. */
  investMonth: string;
  investMonthLabel: string;
  creativesNeeded: number;
  spendRealized: number | null;
  conversationsRealized: number | null;
  gapPct: number | null;
};

export type ForecastResult = {
  assumptions: ForecastAssumptions;
  months: ForecastMonth[];
  /** Investimento redistribuído para o mês em que precisa ser feito. */
  investmentByMonth: Array<{
    month: string;
    label: string;
    required: number;
    realized: number | null;
    status: "passado" | "atual" | "futuro";
    creativesNeeded: number;
  }>;
  totals: {
    targetRemaining: number;
    paidRevenueRemaining: number;
    spendRemaining: number;
    conversationsRemaining: number;
    wonRemaining: number;
    newCreativesRemaining: number;
    impliedRoas: number | null;
  };
  chain: Array<{ step: string; value: number; unit: string; detail: string }>;
};

/* Valores pequenos (CPC) precisam dos centavos; um CPC de R$ 0,78 exibido como
   "R$ 1" muda a leitura do plano inteiro. */
const money = (value: number) =>
  `R$ ${value.toLocaleString("pt-BR", { maximumFractionDigits: value < 100 ? 2 : 0 })}`;
const number = (value: number, digits: number) =>
  value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function buildForecast(
  baseline: MarketingRevenueBaseline,
  assumptions: ForecastAssumptions,
  intelligence?: CreativeIntelligence
): ForecastResult {
  const lagMonths = Math.max(0, Math.round(assumptions.leadTimeDays / 30));
  const monthlySpend = new Map(baseline.monthly.map((row) => [row.month, row.spend]));
  const monthlyConversations = new Map(baseline.monthly.map((row) => [row.month, row.conversations]));
  const monthlyPaidRevenue = new Map(baseline.monthly.map((row) => [row.month, row.paidWonRevenue]));
  const monthlyRevenue = new Map(baseline.monthly.map((row) => [row.month, row.wonRevenue]));

  const months: ForecastMonth[] = baseline.targets.map((target) => {
    const isClosed = target.month <= baseline.lastClosedMonth;
    const isCurrent = target.month === baseline.currentMonth;
    const paidRevenueTarget = (target.target * assumptions.paidSharePct) / 100;
    const wonNeeded = assumptions.paidTicket > 0 ? paidRevenueTarget / assumptions.paidTicket : 0;
    const conversationsNeeded =
      assumptions.conversationToWonPct > 0 ? (wonNeeded / assumptions.conversationToWonPct) * 100 : 0;
    const clicksNeeded =
      assumptions.clickToConversationPct > 0 ? (conversationsNeeded / assumptions.clickToConversationPct) * 100 : 0;
    const spendNeeded = clicksNeeded * assumptions.cpc;
    const investMonth = shiftMonth(target.month, -lagMonths);
    const creativesNeeded =
      assumptions.spendPerCreative > 0 ? Math.max(1, Math.ceil(spendNeeded / assumptions.spendPerCreative)) : 0;
    const paidRevenueRealized = monthlyPaidRevenue.get(target.month) ?? null;

    return {
      month: target.month,
      label: monthLabel(target.month),
      status: isClosed ? "realizado" : isCurrent ? "parcial" : "projetado",
      target: target.target,
      realizedRevenue: monthlyRevenue.get(target.month) ?? (isClosed ? 0 : null),
      paidRevenueTarget,
      paidRevenueRealized,
      wonNeeded,
      conversationsNeeded,
      clicksNeeded,
      spendNeeded,
      investMonth,
      investMonthLabel: monthLabel(investMonth),
      creativesNeeded,
      spendRealized: monthlySpend.get(target.month) ?? null,
      conversationsRealized: monthlyConversations.get(target.month) ?? null,
      gapPct:
        paidRevenueTarget > 0 && paidRevenueRealized != null
          ? (paidRevenueRealized / paidRevenueTarget - 1) * 100
          : null
    };
  });

  /* O investimento de um mês só vira receita depois do ciclo — a curva de verba
     precisa andar para trás, senão o plano nasce atrasado. */
  const investment = new Map<string, { required: number; creativesNeeded: number }>();
  for (const item of months) {
    if (item.status === "realizado") continue;
    const bucket = investment.get(item.investMonth) ?? { required: 0, creativesNeeded: 0 };
    bucket.required += item.spendNeeded;
    bucket.creativesNeeded = Math.max(bucket.creativesNeeded, item.creativesNeeded);
    investment.set(item.investMonth, bucket);
  }

  const investmentMonths = [...new Set([...investment.keys(), ...baseline.monthly.map((row) => row.month)])]
    .filter((month) => month >= baseline.monthly[0]!.month)
    .sort();

  const investmentByMonth = investmentMonths.map((month) => ({
    month,
    label: monthLabel(month),
    required: investment.get(month)?.required ?? 0,
    realized: monthlySpend.get(month) ?? null,
    status: (month < baseline.currentMonth ? "passado" : month === baseline.currentMonth ? "atual" : "futuro") as
      | "passado"
      | "atual"
      | "futuro",
    creativesNeeded: investment.get(month)?.creativesNeeded ?? 0
  }));

  const pending = months.filter((item) => item.status !== "realizado");
  const targetRemaining = pending.reduce((sum, item) => sum + item.target, 0);
  const paidRevenueRemaining = pending.reduce((sum, item) => sum + item.paidRevenueTarget, 0);
  const spendRemaining = pending.reduce((sum, item) => sum + item.spendNeeded, 0);
  const conversationsRemaining = pending.reduce((sum, item) => sum + item.conversationsNeeded, 0);
  const wonRemaining = pending.reduce((sum, item) => sum + item.wonNeeded, 0);

  const poolSize = intelligence?.renewal.conceptsFor80PctSpend ?? 0;
  const cycles = assumptions.creativeLifeDays > 0 ? (pending.length * 30) / assumptions.creativeLifeDays : 0;
  const newCreativesRemaining = Math.max(
    pending.reduce((sum, item) => sum + item.creativesNeeded, 0),
    Math.ceil(Math.max(poolSize, 3) * cycles)
  );

  const chain = [
    {
      step: "Meta de receita no período",
      value: targetRemaining,
      unit: "R$",
      detail: `${pending.length} meses em aberto, meta da Goals API do Pipedrive`
    },
    {
      step: "Receita a vir de tráfego pago",
      value: paidRevenueRemaining,
      unit: "R$",
      detail: `${number(assumptions.paidSharePct, 1)}% da meta`
    },
    {
      step: "Contratos a fechar",
      value: wonRemaining,
      unit: "contratos",
      detail: `ticket médio pago de ${money(assumptions.paidTicket)}`
    },
    {
      step: "Conversas iniciadas",
      value: conversationsRemaining,
      unit: "conversas",
      detail: `${number(assumptions.conversationToWonPct, 2)}% das conversas fecham`
    },
    {
      step: "Cliques externos",
      value: conversationsRemaining / (assumptions.clickToConversationPct / 100 || 1),
      unit: "cliques",
      detail: `${number(assumptions.clickToConversationPct, 1)}% dos cliques viram conversa`
    },
    {
      step: "Investimento em tráfego",
      value: spendRemaining,
      unit: "R$",
      detail: `CPC externo de ${money(assumptions.cpc)}`
    }
  ];

  return {
    assumptions,
    months,
    investmentByMonth,
    totals: {
      targetRemaining,
      paidRevenueRemaining,
      spendRemaining,
      conversationsRemaining,
      wonRemaining,
      newCreativesRemaining,
      impliedRoas: spendRemaining > 0 ? paidRevenueRemaining / spendRemaining : null
    },
    chain
  };
}

export function defaultAssumptions(
  baseline: MarketingRevenueBaseline,
  intelligence?: CreativeIntelligence
): ForecastAssumptions {
  return {
    paidSharePct: baseline.rates.paidShareOfWonRevenuePct ?? 20,
    paidTicket: baseline.rates.paidTicket ?? 9500,
    conversationToWonPct: baseline.rates.conversationToPaidWonPct ?? 2,
    clickToConversationPct: baseline.rates.clickToConversationPct ?? 25,
    cpc: baseline.rates.cpc ?? 1,
    leadTimeDays: baseline.rates.leadTimeDays ?? 51,
    spendPerCreative: intelligence?.renewal.monthlySpendPerCreative ?? 800,
    creativeLifeDays: intelligence?.renewal.usefulLifeDays ?? 30
  };
}

export function shiftMonth(month: string, delta: number) {
  const [year, index] = month.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, index - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}
