import "server-only";

import type { Analysis } from "@/lib/analysis/types";
import type { GestaoCatalog, GestaoOrigemDado, WeeklyRecord, WeeklyRecordsFile } from "@/lib/gestao-xpe/catalog-types";
import { buildCommercialCrmMetrics } from "@/lib/gestao-xpe/crm-commercial-metrics";
import { buildWeeklyMetasMap } from "@/lib/gestao-xpe/commercial-weekly-targets";
import { listCrmSellers } from "@/lib/gestao-xpe/crm-deals-server";
import { isSnapshotIndicator, shouldEnrichHistoricalWeek } from "@/lib/gestao-xpe/crm-indicator-policy";
import {
  buildCrmWeeklyVolumeMaps,
  weeklyVolumeValue,
  type CrmWeeklyVolumeMaps
} from "@/lib/gestao-xpe/crm-week-aggregates";
import {
  buildIndicatorHistory,
  buildIndicatorHistoryForWeeks,
  finalizeSeries,
  weekStubsFromKeys,
  type IndicatorHistoryPayload
} from "@/lib/gestao-xpe/indicator-history";
import { parseGestaoNumber } from "@/lib/gestao-xpe/metrics";
import { getISOWeekKey, weekKeyToIsoDates, weekKeysForCrmHistory } from "@/lib/gestao-xpe/week-utils";
import { buildWonAggregatesByWeek, wonValueForWeek } from "@/lib/gestao-xpe/won-week-aggregates";
import { readFile } from "node:fs/promises";
import path from "node:path";

const CRM_ORIGINS = new Set<GestaoOrigemDado>(["crm", "crm_parcial", "crm_snapshot", "analise"]);

const WEEKLY_VOLUME_IDS = new Set<keyof CrmWeeklyVolumeMaps>([
  "propostas-novas",
  "propostas-apresentadas",
  "assembleias",
  "followups",
  "visitas-total",
  "indicacoes"
]);

function isWeeklyVolumeId(id: string): id is keyof CrmWeeklyVolumeMaps {
  return WEEKLY_VOLUME_IDS.has(id as keyof CrmWeeklyVolumeMaps);
}

async function loadAnalysis(): Promise<Analysis> {
  const file = path.join(process.cwd(), "data/processed/analysis.json");
  return JSON.parse(await readFile(file, "utf8")) as Analysis;
}

function crmValueForIndicator(
  metrics: Awaited<ReturnType<typeof buildCommercialCrmMetrics>>,
  indicatorId: string
): number | null {
  const hit = metrics.available[indicatorId] ?? metrics.partial[indicatorId];
  if (!hit?.valor?.trim() || hit.valor === "—") return null;
  return parseGestaoNumber(hit.valor);
}

function resolveMetaString(
  indicatorId: string,
  weekKey: string,
  weeks: WeeklyRecord[],
  weeklyMetas: Record<string, string>,
  metaReferencia: string | null
): string | null {
  const week = weeks.find((w) => w.weekKey === weekKey);
  const fromWeek = week?.valores[indicatorId]?.meta;
  if (fromWeek?.trim()) return fromWeek;

  const fromTargets = weeklyMetas[indicatorId];
  if (fromTargets?.trim()) return fromTargets;

  return metaReferencia;
}

function needsCurrentWeekMetrics(catalog: GestaoCatalog, indicatorIds: string[]): boolean {
  return indicatorIds.some((id) => {
    const origem = catalog.indicators[id]?.origemDado;
    if (!CRM_ORIGINS.has(origem)) return false;
    if (id === "fechamentos-qtd" || id === "fechamentos-valor") return false;
    if (isWeeklyVolumeId(id)) return false;
    return true;
  });
}

export async function buildIndicatorHistoryEnriched(
  catalog: GestaoCatalog,
  records: WeeklyRecordsFile,
  indicatorIds: string[],
  vendedor?: string | null
): Promise<IndicatorHistoryPayload> {
  const needsCrm = indicatorIds.some((id) => CRM_ORIGINS.has(catalog.indicators[id]?.origemDado));

  const expandedKeys = needsCrm ? weekKeysForCrmHistory(records) : [];
  const base = needsCrm
    ? buildIndicatorHistoryForWeeks(catalog, records, indicatorIds, weekStubsFromKeys(expandedKeys, records))
    : buildIndicatorHistory(catalog, records, indicatorIds);

  if (!needsCrm) return base;

  const weeks = weekStubsFromKeys(expandedKeys, records);
  if (!weeks.length) return base;

  const sellers = await listCrmSellers();
  const currentWeekKey = getISOWeekKey(new Date());
  const weeklyMetas = buildWeeklyMetasMap(indicatorIds, sellers.length, vendedor);

  const needsVolumes = indicatorIds.some(isWeeklyVolumeId);
  const needsWon = indicatorIds.some((id) => id === "fechamentos-qtd" || id === "fechamentos-valor");
  const needsSnapshot = needsCurrentWeekMetrics(catalog, indicatorIds);

  const [wonByWeek, weeklyVolumes, analysis] = await Promise.all([
    needsWon ? buildWonAggregatesByWeek(vendedor) : Promise.resolve(null),
    needsVolumes ? buildCrmWeeklyVolumeMaps(vendedor) : Promise.resolve(null),
    needsSnapshot ? loadAnalysis() : Promise.resolve(null)
  ]);

  let currentWeekCrm: Awaited<ReturnType<typeof buildCommercialCrmMetrics>> | undefined;
  if (needsSnapshot && analysis) {
    const { weekStart, weekEnd } = weekKeyToIsoDates(currentWeekKey);
    currentWeekCrm = await buildCommercialCrmMetrics(
      weekStart,
      weekEnd,
      currentWeekKey,
      vendedor,
      analysis
    );
  }

  const recordWeeks = Object.values(records.semanas);
  let usedCrm = false;
  let usedLancamento = false;

  const series = base.series.map((s) => {
    const def = catalog.indicators[s.id];
    const fromCrm = CRM_ORIGINS.has(def.origemDado);
    const points = s.points.map((point) => {
      const metaStr = resolveMetaString(s.id, point.weekKey, recordWeeks, weeklyMetas, def.metaReferencia);
      const meta = parseGestaoNumber(metaStr);

      let realizado = point.realizado;
      if (point.realizado !== null) {
        usedLancamento = true;
      } else if (fromCrm && shouldEnrichHistoricalWeek(s.id, def.origemDado, point.weekKey, currentWeekKey)) {
        if (s.id === "fechamentos-qtd" || s.id === "fechamentos-valor") {
          usedCrm = true;
          realizado = wonValueForWeek(wonByWeek!, point.weekKey, s.id);
        } else if (weeklyVolumes && isWeeklyVolumeId(s.id)) {
          usedCrm = true;
          realizado = weeklyVolumeValue(weeklyVolumes, s.id, point.weekKey);
        } else if (
          currentWeekCrm &&
          point.weekKey === currentWeekKey &&
          isSnapshotIndicator(s.id, def.origemDado)
        ) {
          const crmVal = crmValueForIndicator(currentWeekCrm, s.id);
          if (crmVal !== null) {
            usedCrm = true;
            realizado = crmVal;
          }
        }
      }

      return { ...point, realizado, meta };
    });

    return finalizeSeries({ ...s, points });
  });

  const fonte = usedLancamento && usedCrm ? "misto" : usedCrm ? "crm" : "lancamentos";
  const nota =
    fonte === "crm"
      ? `${weeks.length} semanas (${expandedKeys[0]} → ${expandedKeys.at(-1)}) · Pipedrive agregado por semana. Snapshot só na semana atual.`
      : fonte === "misto"
        ? "Combina lançamentos salvos com recálculo CRM nas semanas vazias."
        : base.nota;

  return {
    ...base,
    series,
    weekCount: weeks.length,
    fonte,
    nota
  };
}
