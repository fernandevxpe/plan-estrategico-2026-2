import type { Analysis } from "@/lib/analysis/types";
import focusJson from "@/data/areas/consultoria-laudos-focus.json";

const focus = focusJson as typeof focusJson;

const LAUDO_TYPE_PATTERNS = [
  { key: "ldc", match: (t: string) => t.includes("LDC"), label: "LDC" },
  { key: "lie", match: (t: string) => t.includes("LIE"), label: "LIE" },
  { key: "lcc", match: (t: string) => t.includes("LCC"), label: "LCC" },
  { key: "lgr", match: (t: string) => t.includes("LGR"), label: "LGR" },
  { key: "lspda", match: (t: string) => t.includes("LSPDA"), label: "LSPDA" },
  { key: "icv", match: (t: string) => t.includes("ICV"), label: "ICV" }
];

export type LaudoTypeSummary = {
  key: string;
  label: string;
  deals: number;
  revenue: number;
  avgMonthly: number;
  avgTicket: number;
  sharePct: number;
};

export type LaudoMonthlyDelivery = {
  month: string;
  label: string;
  deals: number;
  revenue: number;
  ldcDeals: number;
  lieDeals: number;
};

export type ConsultoriaLaudosDashboard = {
  focus: typeof focusJson;
  team: {
    currentFte: number;
  };
  ytd2026: {
    totalDeals: number;
    totalRevenue: number;
    avgMonthlyDeals: number;
    avgTicket: number;
    ldcSharePct: number;
  };
  byType: LaudoTypeSummary[];
  monthly: LaudoMonthlyDelivery[];
  targets: {
    ldcPerMonth: string;
    liePerMonth: string;
    icvOutlook: string;
    scenario: string;
  };
  capacityNote: {
    headline: string;
    detail: string;
  };
};

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function monthLabel(month: string) {
  const mm = Number(month.slice(5, 7)) - 1;
  return MONTH_LABELS[mm] ?? month;
}

function isLaudoType(type: string) {
  return LAUDO_TYPE_PATTERNS.some((p) => p.match(type));
}

export function buildConsultoriaLaudosDashboard(analysis: Analysis): ConsultoriaLaudosDashboard {
  const delivery = analysis.growthGuides.projection2x.operationalCapacity.deliveryTeam;
  const rows2026 = analysis.businessTypeMonthly.filter((row) => row.month.startsWith("2026") && isLaudoType(row.type));

  const typeMap = new Map<string, LaudoTypeSummary & { months: Set<string> }>();
  for (const pattern of LAUDO_TYPE_PATTERNS) {
    typeMap.set(pattern.key, {
      key: pattern.key,
      label: pattern.label,
      deals: 0,
      revenue: 0,
      avgMonthly: 0,
      avgTicket: 0,
      sharePct: 0,
      months: new Set()
    });
  }

  const monthlyMap = new Map<string, LaudoMonthlyDelivery>();

  for (const row of rows2026) {
    const pattern = LAUDO_TYPE_PATTERNS.find((p) => p.match(row.type));
    if (!pattern) continue;

    const typeEntry = typeMap.get(pattern.key)!;
    typeEntry.deals += row.wonDeals;
    typeEntry.revenue += row.revenue;
    typeEntry.months.add(row.month);

    const monthEntry = monthlyMap.get(row.month) ?? {
      month: row.month,
      label: monthLabel(row.month),
      deals: 0,
      revenue: 0,
      ldcDeals: 0,
      lieDeals: 0
    };
    monthEntry.deals += row.wonDeals;
    monthEntry.revenue += row.revenue;
    if (pattern.key === "ldc") monthEntry.ldcDeals += row.wonDeals;
    if (pattern.key === "lie") monthEntry.lieDeals += row.wonDeals;
    monthlyMap.set(row.month, monthEntry);
  }

  const totalRevenue = rows2026.reduce((s, r) => s + r.revenue, 0);
  const totalDeals = rows2026.reduce((s, r) => s + r.wonDeals, 0);
  const ldcRevenue = typeMap.get("ldc")?.revenue ?? 0;

  const byType = [...typeMap.values()]
    .filter((t) => t.deals > 0)
    .map(({ months, ...rest }) => ({
      ...rest,
      avgMonthly: months.size ? Math.round((rest.deals / months.size) * 10) / 10 : 0,
      avgTicket: rest.deals ? Math.round(rest.revenue / rest.deals) : 0,
      sharePct: totalRevenue ? Math.round((rest.revenue / totalRevenue) * 1000) / 10 : 0
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const monthly = [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month));
  const completedMonths = monthly.filter((m) => m.month < "2026-07").length || monthly.length || 1;
  const avgMonthly = totalDeals / completedMonths;
  const ldcAvg = typeMap.get("ldc")?.deals ?? 0;
  const ldcMonths = typeMap.get("ldc")?.months.size ?? 1;
  const ldcMonthly = ldcAvg / ldcMonths;

  return {
    focus,
    team: { currentFte: delivery.projectistasCurrent },
    ytd2026: {
      totalDeals,
      totalRevenue,
      avgMonthlyDeals: Math.round(avgMonthly * 10) / 10,
      avgTicket: totalDeals ? Math.round(totalRevenue / totalDeals) : 0,
      ldcSharePct: totalRevenue ? Math.round((ldcRevenue / totalRevenue) * 1000) / 10 : 0
    },
    byType,
    monthly,
    targets: {
      ldcPerMonth: focus.capacityAssumptions.ldcPerMonth,
      liePerMonth: focus.capacityAssumptions.liePerMonth,
      icvOutlook: focus.capacityAssumptions.icvPerMonth,
      scenario: focus.capacityAssumptions.scenario
    },
    capacityNote: {
      headline: (() => {
        const icv = byType.find((t) => t.key === "icv");
        const icvLine = icv?.deals
          ? `ICV YTD ${icv.deals} fechamentos — rampa NP 17 no 2S. `
          : "ICV em rampa NP 17 no 2S. ";
        const ldcLine =
          ldcMonthly >= 6
            ? `LDC ${ldcMonthly.toFixed(1)}/mês dentro da meta ${focus.capacityAssumptions.ldcPerMonth}.`
            : `LDC ${ldcMonthly.toFixed(1)}/mês — meta ${focus.capacityAssumptions.ldcPerMonth}.`;
        return icvLine + ldcLine;
      })(),
      detail: focus.capacityAssumptions.gateNote
    }
  };
}
