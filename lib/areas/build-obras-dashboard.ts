import type { Analysis, ObraSubgroupDeal, ObraSubgroupMonthly, ObraSubgroupSummary } from "@/lib/analysis/types";
import focusJson from "@/data/areas/obras-focus.json";

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function monthLabel(month: string) {
  const mm = Number(month.slice(5, 7)) - 1;
  return MONTH_LABELS[mm] ?? month;
}

export type ObrasMonthlyRow = {
  month: string;
  label: string;
  deals: number;
  revenue: number;
  note?: string;
};

export type ObrasDashboard = {
  focus: typeof focusJson;
  ytd2026: {
    wonDeals: number;
    revenue: number;
    avgTicket: number;
    sharePct: number;
  };
  monthly: ObrasMonthlyRow[];
  subgroups: ObraSubgroupSummary[];
  recentDeals: ObraSubgroupDeal[];
  gateStatus: "ok" | "warn" | "critical";
  targets: typeof focusJson.performance2026.targets;
};

export function buildObrasDashboard(analysis: Analysis): ObrasDashboard {
  const subgroups = analysis.obraSubgroups?.summary ?? [];
  const deals = analysis.obraSubgroups?.deals ?? [];
  const monthlyRaw = analysis.obraSubgroups?.monthly ?? [];

  const wonDeals = subgroups.reduce((s, r) => s + r.wonDeals, 0);
  const revenue = subgroups.reduce((s, r) => s + r.revenue, 0);
  const totalYtd = analysis.planningSummary.annual["2026Ytd"].revenue;
  const sharePct = totalYtd ? (revenue / totalYtd) * 100 : 0;

  const monthlyMap = new Map<string, ObrasMonthlyRow>();
  for (const row of monthlyRaw as ObraSubgroupMonthly[]) {
    const existing = monthlyMap.get(row.month) ?? {
      month: row.month,
      label: monthLabel(row.month),
      deals: 0,
      revenue: 0
    };
    existing.deals += row.wonDeals;
    existing.revenue += row.revenue;
    monthlyMap.set(row.month, existing);
  }

  const patternNotes = focusJson.performance2026.monthlyPattern;
  const monthly = [...monthlyMap.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => ({
      ...row,
      note: patternNotes.find((p) => p.month === row.month)?.note
    }));

  const lastTwo = monthly.filter((m) => m.month >= "2026-05");
  const gateStatus =
    lastTwo.every((m) => m.revenue < 20000) || (wonDeals > 0 && revenue / wonDeals < 15000)
      ? "critical"
      : monthly.some((m) => m.month === "2026-06" && m.revenue < 5000)
        ? "warn"
        : "ok";

  const recentDeals = [...deals]
    .filter((d) => d.month.startsWith("2026"))
    .sort((a, b) => b.month.localeCompare(a.month) || b.value - a.value)
    .slice(0, 8);

  return {
    focus: focusJson,
    ytd2026: {
      wonDeals,
      revenue,
      avgTicket: wonDeals ? revenue / wonDeals : 0,
      sharePct
    },
    monthly,
    subgroups,
    recentDeals,
    gateStatus,
    targets: focusJson.performance2026.targets
  };
}

/** Métricas deduplicadas para sidebar — evita somar OBRA + Obras eletricas duas vezes */
export function buildObrasAreaMetrics(analysis: Analysis) {
  const subgroups = analysis.obraSubgroups?.summary ?? [];
  const revenue = subgroups.reduce((s, r) => s + r.revenue, 0);
  const wonDeals = subgroups.reduce((s, r) => s + r.wonDeals, 0);
  const totalYtd = analysis.planningSummary.annual["2026Ytd"].revenue;
  const top = [...subgroups].sort((a, b) => b.revenue - a.revenue)[0];

  return {
    revenue2026Ytd: revenue || null,
    wonDeals2026Ytd: wonDeals || null,
    averageTicket: wonDeals ? revenue / wonDeals : null,
    revenueSharePct: totalYtd && revenue ? (revenue / totalYtd) * 100 : null,
    highlights: [
      top ? `Principal: ${top.subgroup.split("—")[0].trim()} (${top.revenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })})` : "",
      `${wonDeals} fechamentos · subgrupos deduplicados`,
      gateLabel(revenue, wonDeals)
    ].filter(Boolean)
  };
}

function gateLabel(revenue: number, deals: number) {
  const ticket = deals ? revenue / deals : 0;
  if (ticket >= 20000) return "Ticket médio acima do gate R$ 20k";
  return "Atenção: ticket médio abaixo do gate R$ 20k";
}
