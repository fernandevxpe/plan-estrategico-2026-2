import type { AggregatedIndicator, GestaoCatalog, WeeklyRecord } from "@/lib/gestao-xpe/catalog-types";
import type { GestaoGargalo, GestaoIndicador, GestaoIndicadorGrupo } from "@/lib/gestao-xpe/types";

const ANALISE_IDS = ["conversao-real", "conversao-ritmo", "tempo-medio-conversao"] as const;

function computedRealizado(
  id: string,
  valores: WeeklyRecord["valores"]
): string | null {
  if (ANALISE_IDS.includes(id as (typeof ANALISE_IDS)[number])) {
    return valores[id]?.realizado ?? null;
  }
  return null;
}

function toIndicador(
  catalog: GestaoCatalog,
  indicatorId: string,
  meta: string | null,
  realizado: string | null
): GestaoIndicador {
  const def = catalog.indicators[indicatorId];
  return {
    id: indicatorId,
    nome: def.nome,
    meta,
    valor: realizado,
    unidade: def.unidade,
    fonte: def.fonte,
    origemDado: def.origemDado,
    tipo: def.tipo,
    calculado: def.calculado,
    formula: def.formula
  };
}

export function mergeGargaloWithWeek(
  gargalo: GestaoGargalo,
  catalog: GestaoCatalog,
  week: WeeklyRecord | null,
  periodLabel?: string
): GestaoGargalo {
  if (!gargalo.painelSemanal) return gargalo;

  const escopo = catalog.escopos.find((e) => e.id === gargalo.id);
  if (!escopo) return gargalo;

  const grupos: GestaoIndicadorGrupo[] = escopo.grupos.map((grupo) => ({
    id: grupo.id,
    titulo: grupo.titulo,
    descricao: grupo.descricao,
    indicadores: grupo.indicadorIds.map((indId) => {
      const def = catalog.indicators[indId];
      const entry = week?.valores[indId];
      const meta = entry?.meta ?? def.metaReferencia;
      let realizado = entry?.realizado ?? null;
      if (def.calculado && !realizado?.trim()) {
        realizado = week ? computedRealizado(indId, week.valores) : null;
      }
      return toIndicador(catalog, indId, meta, realizado);
    })
  }));

  return {
    ...gargalo,
    painelSemanal: {
      ...gargalo.painelSemanal,
      semana: periodLabel ?? week?.label ?? gargalo.painelSemanal.semana,
      definicaoNobre: escopo.definicaoNobre ?? gargalo.painelSemanal.definicaoNobre,
      resumo: escopo.resumo ?? gargalo.painelSemanal.resumo,
      grupos,
      guiaColeta: gargalo.painelSemanal.guiaColeta
    }
  };
}

export function mergeGargaloWithAggregated(
  gargalo: GestaoGargalo,
  catalog: GestaoCatalog,
  aggregated: Record<string, AggregatedIndicator>,
  periodLabel: string,
  semanasIncluidas: number
): GestaoGargalo {
  if (!gargalo.painelSemanal) return gargalo;

  const escopo = catalog.escopos.find((e) => e.id === gargalo.id);
  if (!escopo) return gargalo;

  const grupos: GestaoIndicadorGrupo[] = escopo.grupos.map((grupo) => ({
    id: grupo.id,
    titulo: grupo.titulo,
    descricao: grupo.descricao,
    indicadores: grupo.indicadorIds.map((indId) => {
      const def = catalog.indicators[indId];
      const agg = aggregated[indId];
      let realizado = agg?.realizado ?? null;
      if (def.calculado && ANALISE_IDS.includes(indId as (typeof ANALISE_IDS)[number])) {
        realizado = agg?.realizado ?? null;
      }
      return toIndicador(catalog, indId, agg?.meta ?? def.metaReferencia, realizado);
    })
  }));

  return {
    ...gargalo,
    painelSemanal: {
      ...gargalo.painelSemanal,
      semana: `${periodLabel} (${semanasIncluidas} sem.)`,
      resumo: `Visão agregada do período. Totais/médias calculados a partir dos lançamentos semanais.`,
      grupos,
      guiaColeta: gargalo.painelSemanal.guiaColeta
    }
  };
}
