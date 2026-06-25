import type { ObraSubgroupDeal, ObraSubgroupSummary } from "@/lib/analysis/types";
import type { EditableObraDeal, ObraSubgroupOverride, ObraSubgroupOverridesFile } from "./constants";

export function applyObraOverrides(
  deals: ObraSubgroupDeal[],
  overrides: Record<string, ObraSubgroupOverride>
): EditableObraDeal[] {
  return deals.map((deal) => {
    const override = overrides[String(deal.id)];
    if (!override) return { ...deal };
    return {
      ...deal,
      subgroup: override.subgroup,
      confidence: override.confidence,
      note: override.note
    };
  });
}

export function computeObraSubgroupSummary(deals: EditableObraDeal[]): ObraSubgroupSummary[] {
  const map = new Map<string, EditableObraDeal[]>();
  for (const deal of deals) {
    const list = map.get(deal.subgroup) ?? [];
    list.push(deal);
    map.set(deal.subgroup, list);
  }

  return [...map.entries()]
    .map(([subgroup, items]) => ({
      subgroup,
      wonDeals: items.length,
      revenue: items.reduce((sum, item) => sum + item.value, 0),
      averageTicket: items.reduce((sum, item) => sum + item.value, 0) / items.length,
      confidenceBreakdown: {
        confirmed: items.filter((item) => item.confidence === "confirmed").length,
        high: items.filter((item) => item.confidence === "high").length,
        medium: items.filter((item) => item.confidence === "medium" || item.confidence === "probable").length,
        low: items.filter((item) => item.confidence === "low").length
      }
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

export function mergeOverrideFiles(
  base: ObraSubgroupOverridesFile,
  patch: ObraSubgroupOverridesFile
): ObraSubgroupOverridesFile {
  return {
    version: Math.max(base.version, patch.version),
    updatedAt: patch.updatedAt || base.updatedAt,
    overrides: { ...base.overrides, ...patch.overrides }
  };
}

export function dealsForSubgroup(deals: EditableObraDeal[], subgroup: string | null) {
  if (!subgroup) return deals;
  return deals.filter((deal) => deal.subgroup === subgroup);
}

export function clientsBreakdown(deals: EditableObraDeal[]) {
  return [...deals]
    .sort((a, b) => b.value - a.value)
    .map((deal) => ({
      id: deal.id,
      organization: deal.organization ?? deal.title,
      title: deal.title,
      month: deal.month,
      value: deal.value,
      confidence: deal.confidence,
      note: deal.note
    }));
}
