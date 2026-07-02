import type {
  Analysis,
  CommercialFunnelScope,
  ConversionAnalytics,
  ConversionMonthRow
} from "./types";
import type { PipelineFilter } from "./funnel-stage-metrics";

export function getConversionAnalytics(analysis: Analysis): ConversionAnalytics | null {
  return analysis.conversionAnalytics ?? null;
}

export function pipelineFilterToScope(filter: PipelineFilter): CommercialFunnelScope {
  if (filter === 11) return "consultoria";
  if (filter === 14) return "obras";
  return "collective";
}

export function getConversionMonths(analysis: Analysis, scope: CommercialFunnelScope): ConversionMonthRow[] {
  return analysis.conversionAnalytics?.byScope[scope]?.months ?? [];
}

export function getConversionMonth(
  analysis: Analysis,
  scope: CommercialFunnelScope,
  month: string
): ConversionMonthRow | null {
  return getConversionMonths(analysis, scope).find((row) => row.month === month) ?? null;
}

export function conversionMonthsForPipeline(
  analysis: Analysis,
  pipelineFilter: PipelineFilter
): ConversionMonthRow[] {
  return getConversionMonths(analysis, pipelineFilterToScope(pipelineFilter));
}

export type FunnelStageChartRow = {
  month: string;
  label: string;
  total: number;
  totalValue: number;
  averageDaysToWin: number | null;
  ganhosAntigosSharePct: number | null;
  [key: string]: string | number | null;
};

export function mergeFunnelRowsWithConversion(
  funnelRows: Array<{ month: string; label: string; total: number; totalValue: number; [key: string]: string | number }>,
  conversionMonths: ConversionMonthRow[]
): FunnelStageChartRow[] {
  const byMonth = Object.fromEntries(conversionMonths.map((row) => [row.month, row]));
  return funnelRows.map((row) => {
    const conversion = byMonth[row.month];
    return {
      ...row,
      averageDaysToWin: conversion?.averageDaysToWin ?? null,
      ganhosAntigosSharePct: conversion?.ganhosAntigosSharePct ?? null
    };
  });
}
