import type { GestaoCatalog } from "@/lib/gestao-xpe/catalog-types";

export type CrmWeekMetrics = {
  weekKey: string;
  syncedAt: string;
  available: Record<string, { valor: string; nota?: string }>;
  partial: Record<string, { valor: string; nota?: string }>;
  /** Metas semanais sugeridas (dashboard diretor comercial × vendedores). */
  metas?: Record<string, string>;
  unavailable: string[];
};

export function applyCrmToWeekValues(
  valores: Record<string, { meta: string | null; realizado: string | null; notas?: string }>,
  catalog: GestaoCatalog,
  crm: CrmWeekMetrics,
  overwrite = false
) {
  const next = { ...valores };
  for (const id of Object.keys(catalog.indicators)) {
    const def = catalog.indicators[id];
    if (def.origemDado === "manual") continue;

    const hit = crm.available[id] ?? crm.partial[id];
    if (!hit) continue;

    const cur = next[id] ?? { meta: crm.metas?.[id] ?? def.metaReferencia, realizado: null };
    if (!overwrite && cur.realizado?.trim()) continue;

    next[id] = {
      ...cur,
      meta: crm.metas?.[id] ?? cur.meta ?? def.metaReferencia,
      realizado: hit.valor,
      notas: hit.nota
    };
  }

  for (const [id, meta] of Object.entries(crm.metas ?? {})) {
    if (!next[id]) continue;
    if (!next[id].meta?.trim()) next[id] = { ...next[id], meta };
  }
  return next;
}
