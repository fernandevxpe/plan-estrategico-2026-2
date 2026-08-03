import type { PresalesDashboard } from "@/lib/areas/build-presales-dashboard";

export type PresalesTimeRow = {
  key: string;
  label: string;
  conversations: number;
  replied: number;
  unanswered: number;
  replyCoveragePct: number | null;
  medianReplyMinutes: number | null;
};

export type PresalesAnalytics = {
  response: {
    eligible: number;
    replied: number;
    unanswered: number;
    coveragePct: number | null;
    medianMinutes: number | null;
    p90Minutes: number | null;
    averageMinutes: number | null;
    within5Pct: number | null;
    within15Pct: number | null;
    within60Pct: number | null;
  };
  backlog: {
    openContacts: number;
    resolvedContacts: number;
    openPct: number | null;
    medianResolutionProxyHours: number | null;
  };
  demand: {
    perCalendarDay: number;
    perActiveDay: number;
    weeklyRunRate: number;
    monthlyRunRate: number;
    forecast30Low: number;
    forecast30Base: number;
    peakDay: { date: string; conversations: number } | null;
  };
  hourly: PresalesTimeRow[];
  weekdays: PresalesTimeRow[];
};

const DAY_LABELS: Record<string, string> = {
  Sun: "Dom",
  Mon: "Seg",
  Tue: "Ter",
  Wed: "Qua",
  Thu: "Qui",
  Fri: "Sex",
  Sat: "Sáb"
};

function percentile(values: number[], position: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * position;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

const share = (part: number, total: number) => total ? part / total * 100 : null;

function recifeParts(value: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Recife",
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23"
    }).formatToParts(new Date(value)).map((part) => [part.type, part.value])
  );
}

function finalizeTimeRow(row: PresalesTimeRow & { replies: number[] }): PresalesTimeRow {
  return {
    key: row.key,
    label: row.label,
    conversations: row.conversations,
    replied: row.replied,
    unanswered: row.unanswered,
    replyCoveragePct: share(row.replied, row.conversations),
    medianReplyMinutes: percentile(row.replies, .5)
  };
}

export function buildPresalesAnalytics(data: PresalesDashboard): PresalesAnalytics {
  const contacts = data.conversations.filter((row) => row.initiatedBy === "contact");
  const replyMinutes = contacts.flatMap((row) => {
    if (!row.firstReplyAt) return [];
    const first = row.firstMessageAt ?? row.createdAt;
    const minutes = (new Date(row.firstReplyAt).getTime() - new Date(first).getTime()) / 60_000;
    return Number.isFinite(minutes) && minutes >= 0 ? [minutes] : [];
  });
  const resolutionProxyHours = contacts.flatMap((row) => {
    if (row.status !== "resolved") return [];
    const hours = (new Date(row.updatedAt).getTime() - new Date(row.createdAt).getTime()) / 3_600_000;
    return Number.isFinite(hours) && hours >= 0 ? [hours] : [];
  });

  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    key: String(hour),
    label: `${String(hour).padStart(2, "0")}h`,
    conversations: 0,
    replied: 0,
    unanswered: 0,
    replyCoveragePct: null,
    medianReplyMinutes: null,
    replies: [] as number[]
  }));
  const weekdayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekdayMap = new Map(weekdayOrder.map((key) => [key, {
    key,
    label: DAY_LABELS[key],
    conversations: 0,
    replied: 0,
    unanswered: 0,
    replyCoveragePct: null,
    medianReplyMinutes: null,
    replies: [] as number[]
  }]));

  for (const conversation of contacts) {
    const first = conversation.firstMessageAt ?? conversation.createdAt;
    const parts = recifeParts(first);
    const hourRow = hourly[Number(parts.hour)];
    const weekdayRow = weekdayMap.get(parts.weekday);
    if (!hourRow || !weekdayRow) continue;
    hourRow.conversations += 1;
    weekdayRow.conversations += 1;
    if (conversation.firstReplyAt) {
      const minutes = (new Date(conversation.firstReplyAt).getTime() - new Date(first).getTime()) / 60_000;
      hourRow.replied += 1;
      weekdayRow.replied += 1;
      if (Number.isFinite(minutes) && minutes >= 0) {
        hourRow.replies.push(minutes);
        weekdayRow.replies.push(minutes);
      }
    } else {
      hourRow.unanswered += 1;
      weekdayRow.unanswered += 1;
    }
  }

  const reliableDays = data.daily.filter((row) => !row.suspectedGap);
  const activeDays = reliableDays.filter((row) => row.contactInitiated > 0);
  const reliableContacts = reliableDays.reduce((sum, row) => sum + row.contactInitiated, 0);
  const perCalendarDay = reliableDays.length ? reliableContacts / reliableDays.length : 0;
  const perActiveDay = activeDays.length ? reliableContacts / activeDays.length : 0;
  const peak = [...reliableDays].sort((a, b) => b.contactInitiated - a.contactInitiated)[0];

  return {
    response: {
      eligible: contacts.length,
      replied: replyMinutes.length,
      unanswered: contacts.length - replyMinutes.length,
      coveragePct: share(replyMinutes.length, contacts.length),
      medianMinutes: percentile(replyMinutes, .5),
      p90Minutes: percentile(replyMinutes, .9),
      averageMinutes: replyMinutes.length ? replyMinutes.reduce((sum, value) => sum + value, 0) / replyMinutes.length : null,
      within5Pct: share(replyMinutes.filter((value) => value <= 5).length, replyMinutes.length),
      within15Pct: share(replyMinutes.filter((value) => value <= 15).length, replyMinutes.length),
      within60Pct: share(replyMinutes.filter((value) => value <= 60).length, replyMinutes.length)
    },
    backlog: {
      openContacts: contacts.filter((row) => row.status === "open").length,
      resolvedContacts: contacts.filter((row) => row.status === "resolved").length,
      openPct: share(contacts.filter((row) => row.status === "open").length, contacts.length),
      medianResolutionProxyHours: percentile(resolutionProxyHours, .5)
    },
    demand: {
      perCalendarDay,
      perActiveDay,
      weeklyRunRate: perCalendarDay * 7,
      monthlyRunRate: perCalendarDay * 30.44,
      forecast30Low: perCalendarDay * 30,
      forecast30Base: perActiveDay * 30,
      peakDay: peak ? { date: peak.date, conversations: peak.contactInitiated } : null
    },
    hourly: hourly.map(finalizeTimeRow),
    weekdays: weekdayOrder.map((key) => finalizeTimeRow(weekdayMap.get(key)!))
  };
}
