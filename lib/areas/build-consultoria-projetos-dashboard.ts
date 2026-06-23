import type { Analysis } from "@/lib/analysis/types";
import focusJson from "@/data/areas/consultoria-projetos-focus.json";

const focus = focusJson as typeof focusJson;

export type ConsultoriaMonthlyDelivery = {
  month: string;
  label: string;
  pieDeals: number;
  pieRevenue: number;
  projetosDeals: number;
  projetosRevenue: number;
  totalDeals: number;
  totalRevenue: number;
};

export type ConsultoriaProjetosDashboard = {
  focus: typeof focusJson;
  team: {
    currentFte: number;
    historicalFte: number;
  };
  ytd2026: {
    pieDeals: number;
    pieRevenue: number;
    projetosDeals: number;
    projetosRevenue: number;
    totalDeals: number;
    totalRevenue: number;
    avgMonthlyDeals: number;
    avgTicket: number;
  };
  laudosContext: {
    ldcDeals: number;
    lieDeals: number;
    ldcAvgMonthly: number;
    lieAvgMonthly: number;
  };
  monthly: ConsultoriaMonthlyDelivery[];
  targets: {
    piePerMonth: string;
    projectsTotalPerMonth: string;
    scenario: string;
  };
  capacityGap: {
    headline: string;
    detail: string;
  };
};

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function monthLabel(month: string) {
  const mm = Number(month.slice(5, 7)) - 1;
  return MONTH_LABELS[mm] ?? month;
}

function isPie(type: string) {
  return type.includes("PIE");
}

function isProjetos(type: string) {
  return type === "PROJETOS" || type.startsWith("PROJETOS ");
}

export function buildConsultoriaProjetosDashboard(analysis: Analysis): ConsultoriaProjetosDashboard {
  const delivery = analysis.growthGuides.projection2x.operationalCapacity.deliveryTeam;
  const rows2026 = analysis.businessTypeMonthly.filter((row) => row.month.startsWith("2026"));

  const monthlyMap = new Map<string, ConsultoriaMonthlyDelivery>();

  for (const row of rows2026) {
    if (!isPie(row.type) && !isProjetos(row.type)) continue;
    const existing = monthlyMap.get(row.month) ?? {
      month: row.month,
      label: monthLabel(row.month),
      pieDeals: 0,
      pieRevenue: 0,
      projetosDeals: 0,
      projetosRevenue: 0,
      totalDeals: 0,
      totalRevenue: 0
    };
    if (isPie(row.type)) {
      existing.pieDeals += row.wonDeals;
      existing.pieRevenue += row.revenue;
    } else {
      existing.projetosDeals += row.wonDeals;
      existing.projetosRevenue += row.revenue;
    }
    existing.totalDeals += row.wonDeals;
    existing.totalRevenue += row.revenue;
    monthlyMap.set(row.month, existing);
  }

  const monthly = [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month));
  const completedMonths = monthly.filter((m) => m.month < "2026-07").length || monthly.length || 1;

  const ytd = monthly.reduce(
    (acc, row) => ({
      pieDeals: acc.pieDeals + row.pieDeals,
      pieRevenue: acc.pieRevenue + row.pieRevenue,
      projetosDeals: acc.projetosDeals + row.projetosDeals,
      projetosRevenue: acc.projetosRevenue + row.projetosRevenue,
      totalDeals: acc.totalDeals + row.totalDeals,
      totalRevenue: acc.totalRevenue + row.totalRevenue
    }),
    { pieDeals: 0, pieRevenue: 0, projetosDeals: 0, projetosRevenue: 0, totalDeals: 0, totalRevenue: 0 }
  );

  const ldcRows = rows2026.filter((r) => r.type.includes("LDC"));
  const lieRows = rows2026.filter((r) => r.type.includes("LIE"));
  const ldcDeals = ldcRows.reduce((s, r) => s + r.wonDeals, 0);
  const lieDeals = lieRows.reduce((s, r) => s + r.wonDeals, 0);
  const laudoMonths = new Set([...ldcRows, ...lieRows].map((r) => r.month)).size || 1;

  const avgMonthly = ytd.totalDeals / completedMonths;
  const targetMid = 5;
  const pieCeiling = 10;

  return {
    focus,
    team: {
      currentFte: delivery.projectistasCurrent,
      historicalFte: delivery.projectistasHistorical
    },
    ytd2026: {
      ...ytd,
      avgMonthlyDeals: Math.round(avgMonthly * 10) / 10,
      avgTicket: ytd.totalDeals ? Math.round(ytd.totalRevenue / ytd.totalDeals) : 0
    },
    laudosContext: {
      ldcDeals: ldcDeals,
      lieDeals: lieDeals,
      ldcAvgMonthly: Math.round((ldcDeals / laudoMonths) * 10) / 10,
      lieAvgMonthly: Math.round((lieDeals / laudoMonths) * 10) / 10
    },
    monthly,
    targets: {
      piePerMonth: focus.capacityAssumptions.pieAutomatedPerMonth,
      projectsTotalPerMonth: focus.capacityAssumptions.projectsTotalTargetPerMonth,
      scenario: focus.capacityAssumptions.scenario
    },
    capacityGap: {
      headline:
        avgMonthly < targetMid
          ? `Entregas projetos YTD: ${avgMonthly.toFixed(1)}/mês — meta H2 ${targetMid}–6 com automação`
          : `Ritmo atual ${avgMonthly.toFixed(1)}/mês — validar se PROJETOS variados cabem no teto PIE ${pieCeiling}`,
      detail: focus.capacityAssumptions.gateNote
    }
  };
}
