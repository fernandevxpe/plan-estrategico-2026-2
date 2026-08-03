import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readProcessed, resolveDataFile } from "@/lib/data/processed-store";

export type PresalesDailyRow = {
  date: string;
  conversations: number;
  contactInitiated: number;
  companyInitiated: number;
  unknownInitiator: number;
  replied: number;
  contactReplied: number;
  open: number;
  resolved: number;
  metaSpend: number;
  metaClicks: number;
  metaLinkClicks: number;
  metaOutboundClicks: number;
  metaLandingPageViews: number;
  metaConversations: number;
  chatwootPerLinkClickPct: number | null;
  chatwootPerOutboundClickPct: number | null;
  suspectedGap: boolean;
};

export type PresalesTotals = Omit<PresalesDailyRow, 'date' | 'suspectedGap' | 'chatwootPerLinkClickPct' | 'chatwootPerOutboundClickPct'> & {
  chatwootPerLinkClickPct: number | null;
  chatwootPerOutboundClickPct: number | null;
  replyCoveragePct: number | null;
};

export type PresalesDashboard = {
  generatedAt: string;
  syncedAt: string;
  source: string;
  account: { id: number; name: string };
  inboxes: Array<{ id: number; name: string; channelType: string }>;
  coverage: { since: string | null; until: string | null; calendarDays: number; daysWithConversations: number; zeroDays: number; suspectedGapDates: string[]; note: string };
  totals: PresalesTotals;
  relationship: { reliableDays: number; excludedGapDays: number; linkClicksToChatwootCorrelation: number | null; outboundClicksToChatwootCorrelation: number | null; metaAttributedToChatwootCorrelation: number | null; note: string };
  daily: PresalesDailyRow[];
  conversations: Array<{ id: number; inboxId: number; createdAt: string; updatedAt: string; firstReplyAt: string | null; status: string; initiatedBy: 'contact' | 'company' | 'unknown'; firstMessageAt: string | null }>;
  gestorEditions: PresalesGestorEdition[];
  botAnalytics: PresalesBotAnalytics | null;
};

export type PresalesBotListItem = { label: string; count: number; sessionsPct: number | null };

export type PresalesBotAnalytics = {
  generatedAt: string;
  source: string;
  scopeNote: string;
  methodNote: string;
  totals: { sessions: number; messages: number; humanMessages: number; botMessages: number };
  conversationShape: {
    medianHumanTurns: number | null;
    p75HumanTurns: number | null;
    singleHumanTurn: number;
    singleHumanTurnPct: number | null;
    endsAwaitingAnswer: number;
    endsAwaitingAnswerPct: number | null;
    oneTurnAwaitingAnswer: number;
    oneTurnAwaitingAnswerPct: number | null;
  };
  objectives: PresalesBotListItem[];
  objections: PresalesBotListItem[];
  profiles: PresalesBotListItem[];
  outcomeSignals: PresalesBotListItem[];
};

export type PresalesGestorSection = {
  id: string;
  titulo: string;
  tom?: "critico" | "atencao" | "oportunidade" | "neutro";
  paragrafos: string[];
  lista?: string[];
  listaOrdenada?: boolean;
  destaque?: string;
};

export type PresalesGestorEdition = {
  date: string;
  titulo: string;
  model: string;
  factsGeneratedAt: string;
  janela: string;
  base: string;
  resumo: string;
  secoes: PresalesGestorSection[];
  conclusao: string;
};

async function readGestorEditions() {
  const directory = await resolveDataFile("ai", "gestor-presales");
  try {
    const files = (await readdir(directory)).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file));
    const editions = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(directory, file), "utf8")) as PresalesGestorEdition));
    return editions.sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

export async function buildPresalesDashboard(): Promise<PresalesDashboard> {
  const data = await readProcessed<Omit<PresalesDashboard, "gestorEditions" | "botAnalytics">>("presales.json");
  let botAnalytics = await readProcessed<PresalesBotAnalytics | null>("presales-bot.json", null);
  if (!botAnalytics) {
    try {
      const snapshot = await resolveDataFile("ai", "gestor-presales", "bot-analytics.json");
      botAnalytics = JSON.parse(await readFile(snapshot, "utf8")) as PresalesBotAnalytics;
    } catch {
      botAnalytics = null;
    }
  }
  return { ...data, gestorEditions: await readGestorEditions(), botAnalytics };
}
