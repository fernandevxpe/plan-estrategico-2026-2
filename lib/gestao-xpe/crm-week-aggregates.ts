import "server-only";

import {
  isAssemblyMeetingActivity,
  isFollowupActivity,
  isPresentationMeetingActivity,
  isProposalElaborationActivity,
  isVisitActivity,
  loadPipedriveActivities,
  type PipedriveActivity
} from "@/lib/gestao-xpe/crm-activities-server";
import {
  dealIdsForSeller,
  EXEC_STAGE_IDS,
  filterBySeller,
  isIndicacaoChannel,
  isNegotiationStage,
  loadPipelineDeals,
  type PipelineDeal
} from "@/lib/gestao-xpe/crm-deals-server";
import { pipedriveDateKey, weekKeyFromPipedriveDate, activityCompletedDateKey } from "@/lib/gestao-xpe/pipedrive-datetime";

export type WeeklyCountMap = Map<string, number>;

export type CrmWeeklyVolumeMaps = {
  "propostas-novas": WeeklyCountMap;
  "propostas-apresentadas": WeeklyCountMap;
  assembleias: WeeklyCountMap;
  followups: WeeklyCountMap;
  "visitas-total": WeeklyCountMap;
  indicacoes: WeeklyCountMap;
};

function bump(map: WeeklyCountMap, weekKey: string, delta = 1) {
  map.set(weekKey, (map.get(weekKey) ?? 0) + delta);
}

function emptyMaps(): CrmWeeklyVolumeMaps {
  return {
    "propostas-novas": new Map(),
    "propostas-apresentadas": new Map(),
    assembleias: new Map(),
    followups: new Map(),
    "visitas-total": new Map(),
    indicacoes: new Map()
  };
}

function activityWeekKey(a: PipedriveActivity): string | null {
  const dateKey = activityCompletedDateKey(a);
  if (!dateKey) return null;
  return weekKeyFromPipedriveDate(dateKey);
}

function activityInDealScope(
  a: PipedriveActivity,
  dealById: Map<number, PipelineDeal>,
  allowedDealIds: Set<number> | null
) {
  if (!a.deal_id) return false;
  if (!dealById.has(a.deal_id)) return false;
  if (allowedDealIds && !allowedDealIds.has(a.deal_id)) return false;
  return true;
}

function activityInFollowupScope(
  a: PipedriveActivity,
  dealById: Map<number, PipelineDeal>,
  allowedDealIds: Set<number> | null
) {
  if (!activityInDealScope(a, dealById, allowedDealIds)) return false;
  return isNegotiationStage(dealById.get(a.deal_id!)?.stageId);
}

/** Contagens semanais CRM em uma passagem (histórico de gráficos). */
export async function buildCrmWeeklyVolumeMaps(
  vendedor?: string | null
): Promise<CrmWeeklyVolumeMaps> {
  const [pipelineDeals, activities] = await Promise.all([loadPipelineDeals(), loadPipedriveActivities()]);
  const dealById = new Map(pipelineDeals.map((d) => [d.id, d]));
  const allowedDealIds = dealIdsForSeller(pipelineDeals, vendedor);
  const scopedPipeline = filterBySeller(pipelineDeals, vendedor);
  const maps = emptyMaps();
  const visitActivities = new Map<string, number>();
  const visitPipeline = new Map<string, number>();

  for (const a of activities) {
    if (!a.done || !activityInDealScope(a, dealById, allowedDealIds)) continue;
    const weekKey = activityWeekKey(a);
    if (!weekKey) continue;

    if (isProposalElaborationActivity(a)) bump(maps["propostas-novas"], weekKey);
    if (isPresentationMeetingActivity(a)) bump(maps["propostas-apresentadas"], weekKey);
    if (isAssemblyMeetingActivity(a)) bump(maps.assembleias, weekKey);
    if (isVisitActivity(a)) bump(visitActivities, weekKey);
    if (isFollowupActivity(a) && activityInFollowupScope(a, dealById, allowedDealIds)) {
      bump(maps.followups, weekKey);
    }
  }

  for (const deal of scopedPipeline) {
    const createdKey = pipedriveDateKey(deal.addTime);
    if (createdKey && isIndicacaoChannel(deal.channel)) {
      const wk = weekKeyFromPipedriveDate(createdKey);
      if (wk) bump(maps.indicacoes, wk);
    }

    if (deal.stageId === EXEC_STAGE_IDS.diagnostico) {
      const changedKey = pipedriveDateKey(deal.stageChangeTime);
      if (changedKey) {
        const wk = weekKeyFromPipedriveDate(changedKey);
        if (wk) bump(visitPipeline, wk);
      }
    }
  }

  for (const [weekKey, actCount] of visitActivities) {
    const pipeCount = visitPipeline.get(weekKey) ?? 0;
    maps["visitas-total"].set(weekKey, Math.max(actCount, pipeCount));
  }
  for (const [weekKey, pipeCount] of visitPipeline) {
    if (!maps["visitas-total"].has(weekKey)) {
      maps["visitas-total"].set(weekKey, pipeCount);
    }
  }

  return maps;
}

export function weeklyVolumeValue(
  maps: CrmWeeklyVolumeMaps,
  indicatorId: keyof CrmWeeklyVolumeMaps,
  weekKey: string
): number {
  return maps[indicatorId].get(weekKey) ?? 0;
}
