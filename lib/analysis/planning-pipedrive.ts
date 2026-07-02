import type {
  Analysis,
  CommercialFunnel,
  CommercialFunnelScope,
  ConversionMonthRow,
  GoalPlan,
  Planning2026
} from "./types";
import { getConversionMonths } from "./conversion-metrics";
import { getOrderedGoals, goalShortTitle } from "./metrics";

export type PlanningKpi = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: "neutral" | "good" | "warn" | "risk";
};

export type PlanningKpiGroup = {
  id: string;
  title: string;
  items: PlanningKpi[];
};

export type PipelineStageRow = {
  key: string;
  label: string;
  deals: number;
};

export type FunnelMonthRow = {
  label: string;
  month: string;
  createdValue: number;
  wonValue: number;
  openValue: number;
  conversionPct: number | null;
};

export type CommercialFunnelChartRow = {
  label: string;
  month: string;
  goalTarget: number | null;
  goalRealized: number | null;
  createdValue: number;
  createdDeals: number;
  wonValue: number;
  wonDeals: number;
  lostValue: number;
  lostDeals: number;
  openValue: number;
  openDeals: number;
  closedConversionPct: number | null;
  averageDaysToWin: number | null;
  stageCohortConversionPct: number | null;
  ganhosAntigosSharePct: number | null;
  winLagM0Pct: number | null;
  winLagM1Pct: number | null;
  winLagM2Pct: number | null;
  winLagM3Pct: number | null;
  winLagM4PlusPct: number | null;
};

export type GoalAttainmentRow = {
  id: string;
  label: string;
  attainmentPct: number;
  projectedPct: number;
  unit: GoalPlan["unit"];
};

const STAGE_LABELS: Record<string, string> = {
  reuniaoMarcada: "Reunião marcada",
  diagnostico: "Diagnóstico",
  negociacao: "Negociação",
  fechamento: "Fechamento",
  relacionamento: "Relacionamento"
};

const MONTH_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function monthLabel(monthKey: string) {
  const [, raw] = monthKey.split("-");
  return MONTH_SHORT[Number(raw) - 1] ?? monthKey;
}

function latestFunnelRow(funnel: CommercialFunnel[], yearPrefix = "2026") {
  const rows = funnel.filter((row) => row.month.startsWith(yearPrefix));
  return rows[rows.length - 1] ?? null;
}

function fmtCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(value);
}

function fmtCount(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

function fmtPct(value: number | null | undefined) {
  if (value == null) return "—";
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)}%`;
}

function goalAttainmentTone(goal: GoalPlan | null | undefined): PlanningKpi["tone"] {
  if (!goal) return "neutral";
  if ((goal.projectedAttainmentPct ?? 0) >= 100) return "good";
  if ((goal.attainmentPct ?? 0) >= 70) return "warn";
  return "risk";
}

function goalKpi(id: string, label: string, goal: GoalPlan | null | undefined): PlanningKpi | null {
  if (!goal) return null;
  return {
    id,
    label,
    value: fmtPct(goal.attainmentPct),
    detail: `${fmtCurrency(goal.totalRealized)} de ${fmtCurrency(goal.totalTarget)} · projeção ${fmtPct(goal.projectedAttainmentPct)}`,
    tone: goalAttainmentTone(goal)
  };
}

function pipelineKpi(id: string, label: string, funnel: CommercialFunnel | null): PlanningKpi | null {
  if (!funnel) return null;
  return {
    id,
    label,
    value: fmtCurrency(funnel.openBaseValueEndOfMonth),
    detail: `${fmtCount(funnel.openBaseDealsEndOfMonth)} negócios · ${monthLabel(funnel.month)}`,
    tone: "neutral"
  };
}

function rollingKpi(
  id: string,
  label: string,
  rolling:
    | {
        won30d: number;
        won7d: number;
        created30d: number;
        created7d: number;
      }
    | undefined,
  kind: "won" | "created"
): PlanningKpi | null {
  if (!rolling) return null;
  const value = kind === "won" ? rolling.won30d : rolling.created30d;
  const week = kind === "won" ? rolling.won7d : rolling.created7d;
  return {
    id,
    label,
    value: fmtCount(value),
    detail: `${fmtCount(week)} na última semana`,
    tone: kind === "won" && value >= 8 ? "good" : kind === "won" ? "warn" : "neutral"
  };
}

export function getFunnelByScope(analysis: Analysis, scope: CommercialFunnelScope): CommercialFunnel[] {
  const byPipeline = analysis.commercialFunnelByPipeline;
  if (byPipeline?.[scope]?.length) return byPipeline[scope];
  if (scope === "collective") return analysis.commercialFunnel;
  return [];
}

export function getGoalForScope(planning: Planning2026, scope: CommercialFunnelScope): GoalPlan | null {
  const { highlights } = planning;
  if (scope === "consultoria") return highlights.consultoria;
  if (scope === "obras") return highlights.obras;
  return highlights.global;
}

export function getPlanningKpiGroups(planning: Planning2026, analysis: Analysis): PlanningKpiGroup[] {
  const { highlights } = planning;
  const funnelByScope = analysis.commercialFunnelByPipeline;
  const collectiveFunnel = latestFunnelRow(funnelByScope?.collective ?? analysis.commercialFunnel);
  const consultoriaFunnel = latestFunnelRow(funnelByScope?.consultoria ?? []);
  const obrasFunnel = latestFunnelRow(funnelByScope?.obras ?? []);
  const director = analysis.commercialDirector;
  const consultoriaDirector = director?.byPipeline?.consultoria ?? director;
  const obrasDirector = director?.byPipeline?.obras;

  const collectiveItems = [
    goalKpi("global", "Meta global", highlights.global),
    highlights.potencial
      ? {
          id: "potencial",
          label: "Potencial criado",
          value: fmtPct(highlights.potencial.attainmentPct),
          detail: `${fmtCurrency(highlights.potencial.totalRealized)} de ${fmtCurrency(highlights.potencial.totalTarget)}`,
          tone: (highlights.potencial.attainmentPct ?? 0) >= 90 ? ("good" as const) : ("neutral" as const)
        }
      : null,
    pipelineKpi("pipeline-collective", "Pipeline aberto", collectiveFunnel),
    rollingKpi("won30-collective", "Ganhos 30 dias", director?.rolling, "won"),
    director?.rolling
      ? {
          id: "created30-collective",
          label: "Criados 30 dias",
          value: fmtCount(director.rolling.created30d),
          detail: `${fmtCount(director.rolling.created7d)} na última semana`,
          tone: "neutral" as const
        }
      : null
  ].filter((item): item is PlanningKpi => Boolean(item));

  const consultoriaItems = [
    goalKpi("consultoria", "Meta consultoria", highlights.consultoria),
    pipelineKpi("pipeline-consultoria", "Pipeline aberto", consultoriaFunnel),
    rollingKpi("won30-consultoria", "Ganhos 30 dias", consultoriaDirector?.rolling, "won"),
    consultoriaDirector?.rolling
      ? {
          id: "created30-consultoria",
          label: "Criados 30 dias",
          value: fmtCount(consultoriaDirector.rolling.created30d),
          detail: `${fmtCount(consultoriaDirector.rolling.created7d)} na última semana`,
          tone: "neutral" as const
        }
      : null,
    consultoriaDirector?.sla48h
      ? {
          id: "sla-consultoria",
          label: "SLA 48h (diagnóstico)",
          value: fmtCount(consultoriaDirector.sla48h.breaches),
          detail:
            consultoriaDirector.sla48h.breaches > 0 ? "Negócios parados >48h" : "Sem violações",
          tone:
            consultoriaDirector.sla48h.breaches > 10
              ? ("risk" as const)
              : consultoriaDirector.sla48h.breaches > 0
                ? ("warn" as const)
                : ("good" as const)
        }
      : null
  ].filter((item): item is PlanningKpi => Boolean(item));

  const obrasItems = [
    goalKpi("obras", "Meta obras", highlights.obras),
    pipelineKpi("pipeline-obras", "Pipeline aberto", obrasFunnel),
    rollingKpi("won30-obras", "Ganhos 30 dias", obrasDirector?.rolling, "won"),
    obrasDirector?.rolling
      ? {
          id: "created30-obras",
          label: "Criados 30 dias",
          value: fmtCount(obrasDirector.rolling.created30d),
          detail: `${fmtCount(obrasDirector.rolling.created7d)} na última semana`,
          tone: "neutral" as const
        }
      : null
  ].filter((item): item is PlanningKpi => Boolean(item));

  return [
    { id: "collective", title: "Coletivo", items: collectiveItems },
    { id: "consultoria", title: "Consultoria", items: consultoriaItems },
    { id: "obras", title: "Obras", items: obrasItems }
  ].filter((group) => group.items.length > 0);
}

/** @deprecated Use getPlanningKpiGroups */
export function getPlanningKpis(planning: Planning2026, analysis: Analysis): PlanningKpi[] {
  return getPlanningKpiGroups(planning, analysis).flatMap((group) => group.items);
}

export function getPipelineStageRows(analysis: Analysis): PipelineStageRow[] {
  const snapshot = analysis.commercialDirector?.snapshot;
  if (!snapshot) return [];
  return Object.entries(snapshot).map(([key, deals]) => ({
    key,
    label: STAGE_LABELS[key] ?? key,
    deals
  }));
}

function goalIntervalForMonth(goal: GoalPlan | null, month: string) {
  if (!goal) return { target: null, realized: null };
  const interval = goal.intervals.find((item) => item.monthKey === month);
  return {
    target: interval?.target ?? null,
    realized: interval?.realized ?? null
  };
}

export function buildCommercialFunnelChartRows(
  planning: Planning2026,
  funnelRows: CommercialFunnel[],
  scope: CommercialFunnelScope,
  analysis?: Analysis
): CommercialFunnelChartRow[] {
  const goal = getGoalForScope(planning, scope);
  const conversionByMonth = Object.fromEntries(
    (analysis ? getConversionMonths(analysis, scope) : []).map((row) => [row.month, row])
  );

  return funnelRows
    .filter((row) => row.month.startsWith("2026"))
    .map((row) => {
      const { target, realized } = goalIntervalForMonth(goal, row.month);
      const conversion = conversionByMonth[row.month] as ConversionMonthRow | undefined;
      return {
        label: monthLabel(row.month),
        month: row.month,
        goalTarget: target,
        goalRealized: realized,
        createdValue: row.createdValue,
        createdDeals: row.createdDeals,
        wonValue: row.wonValue,
        wonDeals: row.wonDeals,
        lostValue: row.lostValue ?? 0,
        lostDeals: row.lostDeals,
        openValue: row.openBaseValueEndOfMonth,
        openDeals: row.openBaseDealsEndOfMonth,
        closedConversionPct: conversion?.closedConversionPct ?? row.closedConversionPct ?? null,
        averageDaysToWin: conversion?.averageDaysToWin ?? null,
        stageCohortConversionPct: conversion?.stageCohortConversionPct ?? null,
        ganhosAntigosSharePct: conversion?.ganhosAntigosSharePct ?? null,
        winLagM0Pct: conversion?.winLagM0Pct ?? null,
        winLagM1Pct: conversion?.winLagM1Pct ?? null,
        winLagM2Pct: conversion?.winLagM2Pct ?? null,
        winLagM3Pct: conversion?.winLagM3Pct ?? null,
        winLagM4PlusPct: conversion?.winLagM4PlusPct ?? null
      };
    });
}

export function getGoalsAttainmentRows(planning: Planning2026): GoalAttainmentRow[] {
  return getOrderedGoals(planning).map((goal) => ({
    id: goal.id,
    label: goalShortTitle(goal),
    attainmentPct: goal.attainmentPct ?? 0,
    projectedPct: goal.projectedAttainmentPct ?? 0,
    unit: goal.unit
  }));
}
