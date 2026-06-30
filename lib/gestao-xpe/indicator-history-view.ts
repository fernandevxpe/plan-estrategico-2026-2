import type { GestaoAgregacao, GestaoCatalog, GestaoPeriodo } from "@/lib/gestao-xpe/catalog-types";
import type { IndicatorHistorySeries, IndicatorWeekPoint } from "@/lib/gestao-xpe/indicator-history";
import { finalizeSeries } from "@/lib/gestao-xpe/indicator-history";

export type HistoryViewConfig = {
  granularity: GestaoPeriodo;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function bucketKeyFromWeekStart(weekStart: string, granularity: GestaoPeriodo): string {
  const [y, m] = weekStart.split("-").map(Number);
  if (granularity === "semanal") return weekStart;
  if (granularity === "mensal") return `${y}-${pad2(m)}`;
  if (granularity === "trimestral") return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  if (granularity === "semestral") return `${y}-H${m <= 6 ? 1 : 2}`;
  return String(y);
}

function bucketLabel(key: string, granularity: GestaoPeriodo): string {
  if (granularity === "semanal") {
    const d = new Date(`${key}T12:00:00Z`);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });
  }
  if (granularity === "mensal") {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
  }
  if (granularity === "trimestral") return key.replace("-", " ");
  if (granularity === "semestral") return key.replace("-", " ");
  return key;
}

function aggregateValues(values: number[], mode: GestaoAgregacao): number | null {
  if (!values.length) return null;
  if (mode === "soma") return values.reduce((a, b) => a + b, 0);
  if (mode === "media") return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  if (mode === "max") return Math.max(...values);
  if (mode === "min") return Math.min(...values);
  if (mode === "ultimo") return values.at(-1) ?? null;
  return values.reduce((a, b) => a + b, 0);
}

function aggregatePoints(
  points: IndicatorWeekPoint[],
  granularity: GestaoPeriodo,
  mode: GestaoAgregacao
): IndicatorWeekPoint[] {
  const buckets = new Map<
    string,
    {
      sortKey: string;
      values: number[];
      metas: number[];
      weekKeys: string[];
      weekStarts: string[];
    }
  >();

  for (const p of points) {
    if (p.realizado === null && p.meta === null) continue;
    const key = bucketKeyFromWeekStart(p.weekStart, granularity);
    const cur = buckets.get(key) ?? { sortKey: key, values: [], metas: [], weekKeys: [], weekStarts: [] };
    if (p.realizado !== null) cur.values.push(p.realizado);
    if (p.meta !== null) cur.metas.push(p.meta);
    cur.weekKeys.push(p.weekKey);
    cur.weekStarts.push(p.weekStart);
    buckets.set(key, cur);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[1].sortKey.localeCompare(b[1].sortKey))
    .map(([key, bucket]) => ({
      weekKey: bucket.weekKeys.at(-1) ?? key,
      weekStart: [...bucket.weekStarts].sort()[0] ?? key,
      label: bucketLabel(key, granularity),
      realizado: aggregateValues(bucket.values, mode),
      meta: aggregateValues(bucket.metas, mode === "media" ? "media" : mode === "max" ? "max" : "soma")
    }));
}

export function applyHistoryView(
  series: IndicatorHistorySeries[],
  catalog: GestaoCatalog,
  config: HistoryViewConfig
): IndicatorHistorySeries[] {
  return series.map((s) => {
    const def = catalog.indicators[s.id];
    const mode = def?.agregacaoMensal ?? "soma";
    const points =
      config.granularity === "semanal"
        ? s.points.map((p) => ({ ...p, label: p.label || bucketLabel(p.weekStart, "semanal") }))
        : aggregatePoints(s.points, config.granularity, mode);

    return finalizeSeries({ ...s, points });
  });
}

export function mergeViewSeriesForChart(series: IndicatorHistorySeries[]) {
  const keys = new Map<string, { label: string; weekKey: string; weekStart: string }>();

  for (const s of series) {
    for (const p of s.points) {
      if (!keys.has(p.weekKey)) {
        keys.set(p.weekKey, { label: p.label, weekKey: p.weekKey, weekStart: p.weekStart });
      }
    }
  }

  const ordered = [...keys.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return ordered.map((row) => {
    const out: Record<string, string | number | null> = {
      label: row.label,
      weekKey: row.weekKey,
      weekStart: row.weekStart
    };
    for (const s of series) {
      const pt = s.points.find((p) => p.weekKey === row.weekKey);
      out[s.id] = pt?.realizado ?? null;
      out[`${s.id}__meta`] = pt?.meta ?? null;
    }
    return out;
  });
}

export function granularityTitle(g: GestaoPeriodo) {
  switch (g) {
    case "semanal":
      return "semanal";
    case "mensal":
      return "mensal";
    case "trimestral":
      return "trimestral";
    case "semestral":
      return "semestral";
    case "anual":
      return "anual";
  }
}

export function granularityLabel(g: GestaoPeriodo) {
  switch (g) {
    case "semanal":
      return "por semana";
    case "mensal":
      return "por mês";
    case "trimestral":
      return "por trimestre";
    case "semestral":
      return "por semestre";
    case "anual":
      return "por ano";
  }
}

export function viewSummary(config: HistoryViewConfig, pointCount: number, weekCount?: number) {
  const weeks = weekCount ? `${weekCount} semanas · ` : "";
  return `${weeks}${pointCount} ponto(s) · ${granularityLabel(config.granularity)}`;
}
