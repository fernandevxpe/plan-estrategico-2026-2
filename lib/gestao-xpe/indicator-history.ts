import type { GestaoCatalog, WeeklyRecord, WeeklyRecordsFile } from "@/lib/gestao-xpe/catalog-types";
import { parseGestaoNumber } from "@/lib/gestao-xpe/metrics";
import { weekKeyToIsoDates } from "@/lib/gestao-xpe/week-utils";

export type IndicatorWeekPoint = {
  weekKey: string;
  label: string;
  weekStart: string;
  realizado: number | null;
  meta: number | null;
};

export type IndicatorGrowthRates = {
  semanal: number | null;
  mensal: number | null;
  trimestral: number | null;
  semestral: number | null;
  anual: number | null;
};

export type IndicatorHistoryStats = {
  min: number | null;
  max: number | null;
  media: number | null;
  ultimo: number | null;
  semanasComDado: number;
};

export type IndicatorHistorySeries = {
  id: string;
  nome: string;
  unidade?: string;
  tipo?: string;
  points: IndicatorWeekPoint[];
  stats: IndicatorHistoryStats;
  growth: IndicatorGrowthRates;
};

export type IndicatorHistoryPayload = {
  generatedAt: string;
  weekCount: number;
  fonte: "lancamentos" | "crm" | "misto";
  nota?: string;
  series: IndicatorHistorySeries[];
};

const GROWTH_WINDOWS = {
  semanal: 1,
  mensal: 4,
  trimestral: 13,
  semestral: 26,
  anual: 52
} as const;

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function growthFromSums(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return current > 0 ? 100 : current < 0 ? -100 : 0;
  return round1(((current - previous) / Math.abs(previous)) * 100);
}

function sumWindow(values: number[], size: number, offsetFromEnd = 0): number | null {
  const end = values.length - offsetFromEnd;
  if (end <= 0) return null;
  const slice = values.slice(Math.max(0, end - size), end);
  if (!slice.length) return null;
  return slice.reduce((a, b) => a + b, 0);
}

function computeGrowth(values: number[]): IndicatorGrowthRates {
  const last = values.at(-1) ?? null;
  const prev = values.length >= 2 ? values.at(-2) ?? null : null;

  return {
    semanal: growthFromSums(last, prev),
    mensal: growthFromSums(sumWindow(values, GROWTH_WINDOWS.mensal), sumWindow(values, GROWTH_WINDOWS.mensal, GROWTH_WINDOWS.mensal)),
    trimestral: growthFromSums(
      sumWindow(values, GROWTH_WINDOWS.trimestral),
      sumWindow(values, GROWTH_WINDOWS.trimestral, GROWTH_WINDOWS.trimestral)
    ),
    semestral: growthFromSums(
      sumWindow(values, GROWTH_WINDOWS.semestral),
      sumWindow(values, GROWTH_WINDOWS.semestral, GROWTH_WINDOWS.semestral)
    ),
    anual: growthFromSums(
      sumWindow(values, GROWTH_WINDOWS.anual),
      sumWindow(values, GROWTH_WINDOWS.anual, GROWTH_WINDOWS.anual)
    )
  };
}

function computeStats(values: number[]): IndicatorHistoryStats {
  if (!values.length) {
    return { min: null, max: null, media: null, ultimo: null, semanasComDado: 0 };
  }
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    media: round1(sum / values.length),
    ultimo: values.at(-1) ?? null,
    semanasComDado: values.length
  };
}

export function finalizeSeries(series: IndicatorHistorySeries): IndicatorHistorySeries {
  const values = series.points.map((p) => p.realizado).filter((n): n is number => n !== null);
  return {
    ...series,
    stats: computeStats(values),
    growth: computeGrowth(values)
  };
}

export type HistoryWeekStub = Pick<WeeklyRecord, "weekKey" | "weekStart" | "label">;

export function weekStubsFromKeys(weekKeys: string[], records: WeeklyRecordsFile): HistoryWeekStub[] {
  return weekKeys.map((weekKey) => {
    const existing = records.semanas[weekKey];
    if (existing) {
      return { weekKey: existing.weekKey, weekStart: existing.weekStart, label: existing.label };
    }
    const { weekStart, label } = weekKeyToIsoDates(weekKey);
    return { weekKey, weekStart, label };
  });
}

export function buildIndicatorHistoryForWeeks(
  catalog: GestaoCatalog,
  records: WeeklyRecordsFile,
  indicatorIds: string[],
  weekStubs: HistoryWeekStub[]
): IndicatorHistoryPayload {
  const uniqueIds = [...new Set(indicatorIds)].filter((id) => catalog.indicators[id]);

  const series: IndicatorHistorySeries[] = uniqueIds.map((id) => {
    const def = catalog.indicators[id];
    const points: IndicatorWeekPoint[] = weekStubs.map((week) => {
      const entry = records.semanas[week.weekKey]?.valores[id];
      return {
        weekKey: week.weekKey,
        label: week.label,
        weekStart: week.weekStart,
        realizado: parseGestaoNumber(entry?.realizado),
        meta: parseGestaoNumber(entry?.meta)
      };
    });

    return finalizeSeries({
      id,
      nome: def.nome,
      unidade: def.unidade,
      tipo: def.tipo,
      points,
      stats: computeStats([]),
      growth: computeGrowth([])
    });
  });

  const hasLancamento = series.some((s) =>
    s.points.some((p) => records.semanas[p.weekKey]?.valores[s.id]?.realizado?.trim())
  );

  return {
    generatedAt: new Date().toISOString(),
    weekCount: weekStubs.length,
    fonte: hasLancamento ? "lancamentos" : "lancamentos",
    nota: hasLancamento
      ? undefined
      : "Nenhum realizado salvo nos lançamentos semanais ainda.",
    series
  };
}

export function buildIndicatorHistory(
  catalog: GestaoCatalog,
  records: WeeklyRecordsFile,
  indicatorIds: string[]
): IndicatorHistoryPayload {
  const weeks = Object.values(records.semanas).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const stubs = weeks.map((w) => ({ weekKey: w.weekKey, weekStart: w.weekStart, label: w.label }));
  const payload = buildIndicatorHistoryForWeeks(catalog, records, indicatorIds, stubs);
  return payload;
}

export function mergeSeriesForChart(series: IndicatorHistorySeries[]) {
  const weekMap = new Map<string, { weekKey: string; label: string; weekStart: string }>();
  for (const s of series) {
    for (const p of s.points) {
      if (!weekMap.has(p.weekKey)) {
        weekMap.set(p.weekKey, { weekKey: p.weekKey, label: p.label, weekStart: p.weekStart });
      }
    }
  }

  const weeks = [...weekMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return weeks.map((w) => {
    const row: Record<string, string | number | null> = {
      weekKey: w.weekKey,
      label: w.label,
      weekStart: w.weekStart
    };
    for (const s of series) {
      const pt = s.points.find((p) => p.weekKey === w.weekKey);
      row[s.id] = pt?.realizado ?? null;
    }
    return row;
  });
}
