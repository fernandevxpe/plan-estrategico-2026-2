import focusJson from "@/data/areas/escala-focus.json";
import type { Analysis } from "@/lib/analysis/types";

export type EscalaMacroRegion = (typeof focusJson.macroRegions)[number];
export type EscalaStateRank = (typeof focusJson.stateRanking)[number];

export type SellerProductivityProfile = {
  id: string;
  label: string;
  source: string;
  closingsPerMonth: number;
  revenuePerMonth: number;
  averageTicket: number;
  dealsCreatedPerMonth: number;
  conversionPct: number;
  visitsPerMonth: number;
  meetingsPerMonth: number;
  budgetsPerMonth: number;
  proposalsPerMonth: number;
};

export type ServiceMixItem = {
  type: string;
  shortLabel: string;
  closingsYtd: number;
  revenueYtd: number;
  closingsPerSellerMonth: number;
  revenueSharePct: number;
  averageTicket: number;
};

export type NucleusCapacityRow = {
  id: string;
  label: string;
  sellers: number;
  technicians: number;
  profileId: string;
  closingsPerMonth: number;
  revenuePerMonth: number;
  visitsPerMonth: number;
  meetingsPerMonth: number;
  budgetsPerMonth: number;
  medidoresStock: number;
  monthlyFixedCost: number;
};

export type EscalaDashboard = {
  focus: typeof focusJson;
  rankedRegions: EscalaMacroRegion[];
  topStates: EscalaStateRank[];
  neTotalSellers: number;
  nationalPotentialSellers: number;
  nucleusUnit: {
    sellersCount: number;
    periodLabel: string;
    ytdMonths: number;
    profiles: SellerProductivityProfile[];
    serviceMix: ServiceMixItem[];
    nucleusCapacity: NucleusCapacityRow[];
    technicianNote: string;
  };
};

const SELLERS_BASELINE = 2;
const META_H2_CLOSINGS = 8.9;
const VISITS_ESTIMATE_PER_SELLER = 14;
const MEETINGS_ESTIMATE_PER_SELLER = 8;

function shortLabel(type: string) {
  if (type.startsWith("LDC")) return "LDC";
  if (type.startsWith("LIE")) return "LIE";
  if (type.startsWith("LCC")) return "LCC";
  if (type.startsWith("ICV")) return "ICV";
  if (type.startsWith("PIE")) return "PIE";
  if (type.startsWith("PROJETOS")) return "Projetos";
  if (type.startsWith("CDM")) return "CDM";
  if (type === "OBRA" || type.startsWith("Obras")) return "Obra";
  return type.slice(0, 12);
}

function aggregateJanMay2026(analysis: Analysis) {
  const months = analysis.commercialFunnel.filter(
    (row) => row.month >= "2026-01" && row.month <= "2026-05"
  );
  const monthCount = months.length || 1;
  const created = months.reduce((s, r) => s + r.createdDeals, 0);
  const won = months.reduce((s, r) => s + r.wonDeals, 0);
  const revenue = months.reduce((s, r) => s + r.wonValue, 0);
  return {
    monthCount,
    createdPerSeller: created / monthCount / SELLERS_BASELINE,
    wonPerSeller: won / monthCount / SELLERS_BASELINE,
    revenuePerSeller: revenue / monthCount / SELLERS_BASELINE,
    conversionPct: created ? (won / created) * 100 : 0,
    averageTicket: won ? revenue / won : 0
  };
}

function aggregateYtd2026(analysis: Analysis) {
  const rows = analysis.businessTypeMonthly.filter((r) => r.month.startsWith("2026"));
  const months = new Set(rows.map((r) => r.month));
  const monthCount = months.size || 1;
  const byType = new Map<string, { won: number; revenue: number }>();

  for (const row of rows) {
    const cur = byType.get(row.type) ?? { won: 0, revenue: 0 };
    cur.won += row.wonDeals;
    cur.revenue += row.revenue;
    byType.set(row.type, cur);
  }

  const totalRevenue = [...byType.values()].reduce((s, v) => s + v.revenue, 0);
  const serviceMix: ServiceMixItem[] = [...byType.entries()]
    .map(([type, v]) => ({
      type,
      shortLabel: shortLabel(type),
      closingsYtd: v.won,
      revenueYtd: v.revenue,
      closingsPerSellerMonth: v.won / monthCount / SELLERS_BASELINE,
      revenueSharePct: totalRevenue ? (v.revenue / totalRevenue) * 100 : 0,
      averageTicket: v.won ? v.revenue / v.won : 0
    }))
    .sort((a, b) => b.revenueYtd - a.revenueYtd);

  return { monthCount, serviceMix, totalRevenue };
}

function buildProfiles(analysis: Analysis): SellerProductivityProfile[] {
  const hist = aggregateJanMay2026(analysis);
  const conservativeCreated = Math.round(hist.createdPerSeller * 0.85);
  const conservativeConversion = 12;
  const conservativeClosings = conservativeCreated * (conservativeConversion / 100);
  const conservativeTicket = Math.round(hist.averageTicket * 0.94);
  const metaTicket = Math.round(hist.averageTicket);

  return [
    {
      id: "historical",
      label: "Real jan–mai/26",
      source: "CRM · 2 vendedores · média mensal",
      closingsPerMonth: Math.round(hist.wonPerSeller * 10) / 10,
      revenuePerMonth: Math.round(hist.revenuePerSeller),
      averageTicket: Math.round(hist.averageTicket),
      dealsCreatedPerMonth: Math.round(hist.createdPerSeller * 10) / 10,
      conversionPct: Math.round(hist.conversionPct * 10) / 10,
      visitsPerMonth: VISITS_ESTIMATE_PER_SELLER,
      meetingsPerMonth: MEETINGS_ESTIMATE_PER_SELLER,
      budgetsPerMonth: Math.round(hist.createdPerSeller * 10) / 10,
      proposalsPerMonth: Math.round(hist.createdPerSeller * 0.7 * 10) / 10
    },
    {
      id: "meta-h2",
      label: "Meta operacional H2",
      source: "Base estratégica · 8,9 fech./vendedor/mês",
      closingsPerMonth: META_H2_CLOSINGS,
      revenuePerMonth: Math.round(META_H2_CLOSINGS * metaTicket),
      averageTicket: metaTicket,
      dealsCreatedPerMonth: Math.round(META_H2_CLOSINGS / 0.15),
      conversionPct: 15,
      visitsPerMonth: 16,
      meetingsPerMonth: 10,
      budgetsPerMonth: Math.round(META_H2_CLOSINGS / 0.15),
      proposalsPerMonth: Math.round(META_H2_CLOSINGS / 0.12)
    },
    {
      id: "conservative",
      label: "Conservador (planejamento)",
      source: "Cenário vendas · 12% conv. · −15% criação",
      closingsPerMonth: Math.round(conservativeClosings * 10) / 10,
      revenuePerMonth: Math.round(conservativeClosings * conservativeTicket),
      averageTicket: conservativeTicket,
      dealsCreatedPerMonth: conservativeCreated,
      conversionPct: conservativeConversion,
      visitsPerMonth: 12,
      meetingsPerMonth: 6,
      budgetsPerMonth: conservativeCreated,
      proposalsPerMonth: Math.round(conservativeCreated * 0.65)
    }
  ];
}

function buildNucleusCapacity(
  profiles: SellerProductivityProfile[],
  costDefaults: (typeof focusJson.nucleusOperation)["costDefaults"]
): NucleusCapacityRow[] {
  const configs = [
    { id: "nucleo-piloto", label: "Piloto", sellers: 1, technicians: 1, profileId: "conservative" },
    { id: "nucleo-local", label: "Operação local", sellers: 2, technicians: 1, profileId: "historical" },
    { id: "nucleo-recife", label: "RM Recife (meta)", sellers: 4, technicians: 2, profileId: "meta-h2" },
    { id: "nucleo-hub", label: "Hub regional", sellers: 4, technicians: 2, profileId: "meta-h2" }
  ];

  return configs.map((cfg) => {
    const profile = profiles.find((p) => p.id === cfg.profileId) ?? profiles[0];
    return {
      ...cfg,
      closingsPerMonth: Math.round(profile.closingsPerMonth * cfg.sellers * 10) / 10,
      revenuePerMonth: Math.round(profile.revenuePerMonth * cfg.sellers),
      visitsPerMonth: profile.visitsPerMonth * cfg.sellers,
      meetingsPerMonth: profile.meetingsPerMonth * cfg.sellers,
      budgetsPerMonth: Math.round(profile.budgetsPerMonth * cfg.sellers),
      medidoresStock: cfg.sellers * costDefaults.metersPerSeller,
      monthlyFixedCost: costDefaults.monthlyFixed
    };
  });
}

export function buildEscalaDashboard(analysis: Analysis): EscalaDashboard {
  const rankedRegions = [...focusJson.macroRegions].sort(
    (a, b) => b.compositeIndex - a.compositeIndex
  );

  const neTotalSellers = focusJson.macroRegions
    .filter((r) => r.phase <= 4)
    .reduce((s, r) => s + r.recommendedSellers, 0);

  const nationalPotentialSellers = focusJson.macroRegions.reduce(
    (s, r) => s + r.recommendedSellers,
    0
  );

  const profiles = buildProfiles(analysis);
  const ytd = aggregateYtd2026(analysis);
  const nucleusCapacity = buildNucleusCapacity(
    profiles,
    focusJson.nucleusOperation.costDefaults
  );

  return {
    focus: focusJson,
    rankedRegions,
    topStates: focusJson.stateRanking,
    neTotalSellers,
    nationalPotentialSellers,
    nucleusUnit: {
      sellersCount: SELLERS_BASELINE,
      periodLabel: "2026 YTD",
      ytdMonths: ytd.monthCount,
      profiles,
      serviceMix: ytd.serviceMix.slice(0, 8),
      nucleusCapacity,
      technicianNote:
        "1 técnico de campo ≈ suporte a 2 vendedores (instalação SC, medidores, levantamento). Laudos e projetos permanecem na matriz Recife."
    }
  };
}
