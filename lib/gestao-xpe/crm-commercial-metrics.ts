import "server-only";

import type { Analysis } from "@/lib/analysis/types";
import {
  activityCompletedAt,
  activityDoneInRange,
  isAssemblyMeetingActivity,
  isFollowupActivity,
  isPresentationMeetingActivity,
  isProposalElaborationActivity,
  isVisitActivity,
  loadPipedriveActivities,
  type PipedriveActivity
} from "@/lib/gestao-xpe/crm-activities-server";
import { buildWeeklyMetasMap } from "@/lib/gestao-xpe/commercial-weekly-targets";
import {
  countDealsStageChangeInRange,
  dealIdsForSeller,
  EXEC_STAGE_IDS,
  filterBySeller,
  isIndicacaoChannel,
  isNegotiationStage,
  loadPipelineDeals,
  loadWonDealRows,
  type PipelineDeal
} from "@/lib/gestao-xpe/crm-deals-server";
import { COMMERCIAL_VOLUME_IDS } from "@/lib/gestao-xpe/crm-indicator-policy";
import { pipedriveDateInRange } from "@/lib/gestao-xpe/pipedrive-datetime";
import type { CrmWeekMetrics } from "@/lib/gestao-xpe/crm-week-sync";
import { getISOWeekKey } from "@/lib/gestao-xpe/week-utils";

function parseDate(s: string | null | undefined): Date | null {
  if (!s?.trim()) return null;
  const key = s.trim().slice(0, 10);
  const d = new Date(`${key}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inRangeDateKey(value: string | null | undefined, start: string, end: string) {
  return pipedriveDateInRange(value, start, end);
}

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function avg(nums: number[]) {
  if (!nums.length) return null;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

function activityInDealScope(
  a: PipedriveActivity,
  dealById: Map<number, PipelineDeal>,
  allowedDealIds: Set<number> | null
) {
  if (!a.deal_id) return false;
  const deal = dealById.get(a.deal_id);
  if (!deal) return false;
  if (allowedDealIds && !allowedDealIds.has(a.deal_id)) return false;
  return true;
}

function activityInFollowupScope(
  a: PipedriveActivity,
  dealById: Map<number, PipelineDeal>,
  allowedDealIds: Set<number> | null
) {
  if (!activityInDealScope(a, dealById, allowedDealIds)) return false;
  const deal = dealById.get(a.deal_id!);
  return isNegotiationStage(deal?.stageId);
}

function firstProposalDoneByDeal(activities: PipedriveActivity[]) {
  const map = new Map<number, PipedriveActivity>();
  for (const a of activities) {
    if (!a.done || !a.deal_id || !isProposalElaborationActivity(a)) continue;
    const doneAt = parseDate(a.marked_as_done_time) ?? activityCompletedAt(a);
    if (!doneAt) continue;
    const prev = map.get(a.deal_id);
    if (!prev) {
      map.set(a.deal_id, a);
      continue;
    }
    const prevDone = parseDate(prev.marked_as_done_time) ?? activityCompletedAt(prev);
    if (prevDone && doneAt < prevDone) map.set(a.deal_id, a);
  }
  return map;
}

export async function buildCommercialCrmMetrics(
  rangeStart: string,
  rangeEnd: string,
  contextKey: string,
  vendedor: string | null | undefined,
  analysis: Analysis
): Promise<CrmWeekMetrics> {
  const [wonRows, pipelineDeals, activities, sellers] = await Promise.all([
    loadWonDealRows(),
    loadPipelineDeals(),
    loadPipedriveActivities(),
    import("@/lib/gestao-xpe/crm-deals-server").then((m) => m.listCrmSellers())
  ]);

  const dealById = new Map(pipelineDeals.map((d) => [d.id, d]));
  const allowedDealIds = dealIdsForSeller(pipelineDeals, vendedor);
  const sellerNote =
    vendedor && vendedor !== "todos"
      ? `Filtrado por vendedor: ${vendedor.charAt(0) + vendedor.slice(1).toLowerCase()}.`
      : undefined;

  const scopedWon = filterBySeller(wonRows, vendedor).filter((r) =>
    inRangeDateKey(r.wonTime, rangeStart, rangeEnd)
  );

  const scopedPipeline = filterBySeller(pipelineDeals, vendedor);

  const scopedActivities = activities.filter((a) => activityInDealScope(a, dealById, allowedDealIds));

  const proposalActs = scopedActivities.filter(isProposalElaborationActivity);
  const proposalsDoneInRange = proposalActs.filter((a) => activityDoneInRange(a, rangeStart, rangeEnd));

  const proposalsDoneDealIds = new Set(
    proposalsDoneInRange.map((a) => a.deal_id!).filter(Boolean)
  );

  const proposalsPending = proposalActs.filter((a) => {
    if (a.done || !a.deal_id) return false;
    const deal = dealById.get(a.deal_id);
    return deal?.status === "open";
  });

  const elaborationDays = proposalsDoneInRange
    .map((a) => {
      const start = parseDate(a.add_time);
      const end = parseDate(a.marked_as_done_time) ?? activityCompletedAt(a);
      if (!start || !end) return null;
      const days = daysBetween(start, end);
      return days >= 0 && days < 120 ? days : null;
    })
    .filter((d): d is number => d !== null);

  const visitsDone = scopedActivities.filter(
    (a) => isVisitActivity(a) && activityDoneInRange(a, rangeStart, rangeEnd)
  );

  const visitsPipeline = countDealsStageChangeInRange(
    scopedPipeline,
    EXEC_STAGE_IDS.diagnostico,
    rangeStart,
    rangeEnd,
    allowedDealIds
  );

  const visitasCount = Math.max(visitsDone.length, visitsPipeline);
  const visitasNota =
    visitsDone.length >= visitsPipeline
      ? "Atividades de visita/diagnóstico concluídas no período."
      : visitsPipeline > 0
        ? "Proxy pipeline: negócios que entraram em Diagnóstico no período (atividades não registradas)."
        : "Pesquisa/qualificação e visitas de diagnóstico concluídas no período.";

  const presentationsDone = scopedActivities.filter(
    (a) => isPresentationMeetingActivity(a) && activityDoneInRange(a, rangeStart, rangeEnd)
  );

  const assembliesDone = scopedActivities.filter(
    (a) => isAssemblyMeetingActivity(a) && activityDoneInRange(a, rangeStart, rangeEnd)
  );

  const followupsDone = scopedActivities.filter((a) => {
    if (!isFollowupActivity(a) || !activityDoneInRange(a, rangeStart, rangeEnd)) return false;
    return activityInFollowupScope(a, dealById, allowedDealIds);
  });

  const indicacoesInRange = scopedPipeline.filter(
    (d) => inRangeDateKey(d.addTime, rangeStart, rangeEnd) && isIndicacaoChannel(d.channel)
  ).length;

  const firstDoneMap = firstProposalDoneByDeal(proposalActs);
  const cohortWonDeals = [...proposalsDoneDealIds].filter((dealId) => {
    const deal = dealById.get(dealId);
    return deal?.status === "won" && deal.wonTime;
  });

  const conversionToWinDays: number[] = [];
  for (const dealId of cohortWonDeals) {
    const deal = dealById.get(dealId)!;
    const prop = firstDoneMap.get(dealId);
    const won = parseDate(deal.wonTime);
    const propDone = prop ? (parseDate(prop.marked_as_done_time) ?? activityCompletedAt(prop)) : null;
    if (won && propDone && proposalsDoneDealIds.has(dealId)) {
      const days = daysBetween(propDone, won);
      if (days >= 0 && days < 365) conversionToWinDays.push(days);
    }
  }

  const conversaoCohort =
    proposalsDoneDealIds.size > 0
      ? Math.round((cohortWonDeals.length / proposalsDoneDealIds.size) * 100)
      : null;

  const conversaoRitmo =
    proposalsDoneInRange.length > 0
      ? Math.round((scopedWon.length / proposalsDoneInRange.length) * 100)
      : null;

  const available: CrmWeekMetrics["available"] = {
    "fechamentos-qtd": { valor: String(scopedWon.length), nota: sellerNote },
    "fechamentos-valor": {
      valor: String(Math.round(scopedWon.reduce((s, r) => s + r.value, 0))),
      nota: sellerNote
    },
    "propostas-novas": {
      valor: String(proposalsDoneInRange.length),
      nota: "Atividades Elaborar/Solicito proposta concluídas no período."
    },
    "propostas-pendentes": {
      valor: String(proposalsPending.length),
      nota: "Atividades de proposta em aberto em negócios ativos."
    },
    "visitas-total": {
      valor: String(visitasCount),
      nota: visitasNota
    },
    "propostas-apresentadas": {
      valor: String(presentationsDone.length),
      nota: 'Reuniões concluídas no período (tipo Reunião). Exclui agendamentos ("Agendar entre…") e visitas de diagnóstico.'
    },
    "assembleias": {
      valor: String(assembliesDone.length),
      nota: 'Subconjunto das reuniões: assunto contém "assembleia".'
    },
    "followups": {
      valor: String(followupsDone.length),
      nota: "Ligações/e-mails e Chamada (social point) em negócios em Negociação, Fechamento ou Relacionamento."
    },
    "tempo-elaborar-proposta": {
      valor: elaborationDays.length ? String(avg(elaborationDays)!) : "—",
      nota: "Média em dias: criação → conclusão da atividade de proposta."
    },
    "conversao-real": {
      valor: conversaoCohort !== null ? String(conversaoCohort) : "—",
      nota: "Cohort: ganhos dos negócios com proposta elaborada no período ÷ propostas elaboradas."
    },
    "conversao-ritmo": {
      valor: conversaoRitmo !== null ? String(conversaoRitmo) : "—",
      nota: "Ritmo: ganhos no período ÷ propostas elaboradas no período."
    },
    "tempo-medio-conversao": {
      valor: conversionToWinDays.length ? String(avg(conversionToWinDays)!) : "—",
      nota: "Média em dias: proposta elaborada → ganho (negócios da cohort)."
    },
    indicacoes: {
      valor: String(indicacoesInRange),
      nota: sellerNote ?? "Negócios criados no período com canal indicação."
    }
  };

  const partial: CrmWeekMetrics["partial"] = {};

  if ((!vendedor || vendedor === "todos") && analysis.commercialDirector?.sla48h) {
    partial["propostas-paradas"] = {
      valor: String(analysis.commercialDirector.sla48h.breaches),
      nota: "Snapshot: Diagnóstico sem avanço >48h."
    };
  }

  const isCurrentWeek = contextKey.includes("W") && contextKey === getISOWeekKey(new Date());
  if (
    isCurrentWeek &&
    (!vendedor || vendedor === "todos") &&
    analysis.commercialDirector?.rolling &&
    scopedWon.length === 0
  ) {
    const r = analysis.commercialDirector.rolling;
    if (r.won7d > 0) {
      available["fechamentos-qtd"] = {
        valor: String(r.won7d),
        nota: "Rolling 7d (fallback semana corrente)."
      };
    }
  }

  const indicatorIds = [...COMMERCIAL_VOLUME_IDS];

  const metas = buildWeeklyMetasMap(indicatorIds, sellers.length, vendedor);

  return {
    weekKey: contextKey,
    syncedAt: analysis.generatedAt,
    available,
    partial,
    metas,
    unavailable: ["visitas-sindico", "tempo-visita-apresentacao"]
  };
}
