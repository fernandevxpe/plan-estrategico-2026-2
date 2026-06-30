import type { GestaoIndicadorTipo } from "@/lib/gestao-xpe/types";

export type GestaoAgregacao = "soma" | "media" | "ultimo" | "max" | "min" | "texto";

/** Como o realizado é obtido */
export type GestaoOrigemDado = "manual" | "crm" | "crm_parcial" | "crm_snapshot" | "analise";

export type CatalogIndicator = {
  id: string;
  nome: string;
  escopoId: string;
  grupoId: string;
  tipo?: GestaoIndicadorTipo;
  unidade?: string;
  fonte?: string;
  origemDado: GestaoOrigemDado;
  calculado?: boolean;
  formula?: string;
  /** Meta de referência padrão (típica por semana) — editada na aba Referência */
  metaReferencia: string | null;
  agregacaoMensal: GestaoAgregacao;
  /** Destaque no cabeçalho do card do gargalo */
  destaque?: boolean;
};

export type CatalogGrupo = {
  id: string;
  titulo: string;
  descricao?: string;
  indicadorIds: string[];
};

export type CatalogEscopo = {
  id: string;
  tipo: "gargalo" | "motor" | "executivo";
  nome: string;
  grupos: CatalogGrupo[];
  definicaoNobre?: string;
  resumo?: string;
};

export type GestaoCatalog = {
  version: number;
  updatedAt: string;
  indicators: Record<string, CatalogIndicator>;
  escopos: CatalogEscopo[];
};

export type WeeklyIndicatorValue = {
  meta: string | null;
  realizado: string | null;
  notas?: string;
};

export type WeeklyRecord = {
  weekKey: string;
  weekStart: string;
  weekEnd: string;
  label: string;
  status: "rascunho" | "fechado";
  updatedAt: string;
  preenchidoPor?: string;
  notasSemana?: string;
  valores: Record<string, WeeklyIndicatorValue>;
};

export type WeeklyRecordsFile = {
  version: number;
  semanas: Record<string, WeeklyRecord>;
};

export type GestaoPeriodo = "semanal" | "mensal" | "trimestral" | "semestral" | "anual";

export type PeriodAnchor = {
  periodo: GestaoPeriodo;
  /** semanal: weekKey | mensal: 2026-06 | trimestral: 2026-Q2 | semestral: 2026-H1 | anual: 2026 */
  chave: string;
  label: string;
};

export type AggregatedIndicator = {
  indicatorId: string;
  meta: string | null;
  realizado: string | null;
  semanasIncluidas: number;
};
