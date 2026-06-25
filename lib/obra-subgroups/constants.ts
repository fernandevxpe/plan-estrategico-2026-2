import type { ObraSubgroupDeal } from "@/lib/analysis/types";

export const OBRA_SUBGROUP_OPTIONS = [
  "Infraestrutura de carregamento veicular",
  "CDM - obra/ampliação de centro de medição",
  "CDM - projeto/planejamento de centro de medição",
  "ICV - inspeção de carregador veicular",
  "Infraestrutura/eletrocalha/PIE",
  "Adequação/correção elétrica geral",
  "Obras elétricas gerais/indefinidas"
] as const;

export const OBRA_CONFIDENCE_OPTIONS = [
  "confirmed",
  "probable",
  "high",
  "medium",
  "low"
] as const;

export type ObraConfidence = (typeof OBRA_CONFIDENCE_OPTIONS)[number];

export type ObraSubgroupOverride = {
  subgroup: string;
  confidence: ObraConfidence;
  note: string;
};

export type ObraSubgroupOverridesFile = {
  version: number;
  updatedAt: string;
  overrides: Record<string, ObraSubgroupOverride>;
};

export type EditableObraDeal = ObraSubgroupDeal & {
  isDirty?: boolean;
};

export const OBRA_OVERRIDES_STORAGE_KEY = "obra-subgroup-overrides-v1";
