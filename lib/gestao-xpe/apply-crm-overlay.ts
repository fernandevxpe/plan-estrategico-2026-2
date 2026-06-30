import type { CrmWeekMetrics } from "@/lib/gestao-xpe/crm-week-sync";
import type { GestaoGargalo } from "@/lib/gestao-xpe/types";

const ANALISE_IDS = new Set([
  "conversao-real",
  "conversao-ritmo",
  "tempo-medio-conversao"
]);

export function applyCrmOverlayToGargalo(gargalo: GestaoGargalo, crm: CrmWeekMetrics | null): GestaoGargalo {
  if (!crm || !gargalo.painelSemanal) return gargalo;

  const grupos = gargalo.painelSemanal.grupos.map((grupo) => ({
    ...grupo,
    indicadores: grupo.indicadores.map((ind) => {
      if (!ind.id) return ind;
      if (ind.origemDado === "manual") return ind;

      const hit = crm.available[ind.id] ?? crm.partial[ind.id];
      const metaFromCrm = crm.metas?.[ind.id];

      if (ANALISE_IDS.has(ind.id) || ind.origemDado === "crm" || ind.origemDado === "crm_parcial" || ind.origemDado === "crm_snapshot" || ind.origemDado === "analise") {
        if (!hit && !metaFromCrm) return ind;
        return {
          ...ind,
          meta: metaFromCrm ?? ind.meta,
          valor: hit?.valor ?? ind.valor
        };
      }

      if (!hit) return ind;
      return {
        ...ind,
        meta: metaFromCrm ?? ind.meta,
        valor: hit.valor
      };
    })
  }));

  return {
    ...gargalo,
    painelSemanal: {
      ...gargalo.painelSemanal,
      grupos
    }
  };
}
