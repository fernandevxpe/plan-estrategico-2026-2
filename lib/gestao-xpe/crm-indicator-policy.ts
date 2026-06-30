import type { GestaoOrigemDado } from "@/lib/gestao-xpe/catalog-types";

/** Estoque atual no CRM — não replicar em semanas passadas no histórico. */
export const SNAPSHOT_INDICATOR_IDS = new Set(["propostas-pendentes", "propostas-paradas"]);

export function isSnapshotIndicator(id: string, origem?: GestaoOrigemDado): boolean {
  return origem === "crm_snapshot" || SNAPSHOT_INDICATOR_IDS.has(id);
}

export function shouldEnrichHistoricalWeek(
  indicatorId: string,
  origem: GestaoOrigemDado,
  weekKey: string,
  currentWeekKey: string
): boolean {
  if (!isSnapshotIndicator(indicatorId, origem)) return true;
  return weekKey === currentWeekKey;
}

export const COMMERCIAL_VOLUME_IDS = [
  "indicacoes",
  "visitas-total",
  "visitas-sindico",
  "propostas-novas",
  "propostas-pendentes",
  "propostas-apresentadas",
  "assembleias",
  "followups",
  "fechamentos-qtd",
  "fechamentos-valor",
  "tempo-elaborar-proposta",
  "propostas-paradas",
  "conversao-real",
  "conversao-ritmo",
  "tempo-medio-conversao"
] as const;
