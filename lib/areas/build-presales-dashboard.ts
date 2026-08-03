import { readProcessed } from "@/lib/data/processed-store";

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
};

export function buildPresalesDashboard(): Promise<PresalesDashboard> {
  return readProcessed<PresalesDashboard>("presales.json");
}
