import type { Analysis, CommercialFunnel, GoalPlan, Planning2026 } from "./types";
import { getOrderedGoals, goalShortTitle } from "./metrics";

export type PlanningKpi = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: "neutral" | "good" | "warn" | "risk";
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

export function getPlanningKpis(planning: Planning2026, analysis: Analysis): PlanningKpi[] {
  const { highlights } = planning;
  const global = highlights.global;
  const potencial = highlights.potencial;
  const funnel = latestFunnelRow(analysis.commercialFunnel);
  const director = analysis.commercialDirector;
  const kpis: PlanningKpi[] = [];

  if (global) {
    const tone =
      (global.projectedAttainmentPct ?? 0) >= 100
        ? "good"
        : (global.attainmentPct ?? 0) >= 70
          ? "warn"
          : "risk";
    kpis.push({
      id: "global",
      label: "Meta global",
      value: fmtPct(global.attainmentPct),
      detail: `${fmtCurrency(global.totalRealized)} de ${fmtCurrency(global.totalTarget)} · projeção ${fmtPct(global.projectedAttainmentPct)}`,
      tone
    });
  }

  if (potencial) {
    kpis.push({
      id: "potencial",
      label: "Potencial criado",
      value: fmtPct(potencial.attainmentPct),
      detail: `${fmtCurrency(potencial.totalRealized)} de ${fmtCurrency(potencial.totalTarget)}`,
      tone: (potencial.attainmentPct ?? 0) >= 90 ? "good" : "neutral"
    });
  }

  if (funnel) {
    kpis.push({
      id: "pipeline",
      label: "Pipeline aberto",
      value: fmtCurrency(funnel.openBaseValueEndOfMonth),
      detail: `${fmtCount(funnel.openBaseDealsEndOfMonth)} negócios · ${monthLabel(funnel.month)}`,
      tone: "neutral"
    });
  }

  if (director) {
    kpis.push({
      id: "won30",
      label: "Ganhos 30 dias",
      value: fmtCount(director.rolling.won30d),
      detail: `${fmtCount(director.rolling.won7d)} na última semana`,
      tone: director.rolling.won30d >= 8 ? "good" : "warn"
    });
    kpis.push({
      id: "created30",
      label: "Criados 30 dias",
      value: fmtCount(director.rolling.created30d),
      detail: `${fmtCount(director.rolling.created7d)} na última semana`,
      tone: "neutral"
    });
    kpis.push({
      id: "sla",
      label: "SLA 48h (diagnóstico)",
      value: fmtCount(director.sla48h.breaches),
      detail: director.sla48h.breaches > 0 ? "Negócios parados >48h" : "Sem violações",
      tone: director.sla48h.breaches > 10 ? "risk" : director.sla48h.breaches > 0 ? "warn" : "good"
    });
  }

  return kpis;
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

export function getFunnel2026Rows(analysis: Analysis): FunnelMonthRow[] {
  return analysis.commercialFunnel
    .filter((row) => row.month.startsWith("2026"))
    .map((row) => ({
      label: monthLabel(row.month),
      month: row.month,
      createdValue: row.createdValue,
      wonValue: row.wonValue,
      openValue: row.openBaseValueEndOfMonth,
      conversionPct: row.matureConversionPct ?? row.cohortConversionPct
    }));
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
