import type {
  AggregatedIndicator,
  CatalogIndicator,
  GestaoCatalog,
  PeriodAnchor,
  WeeklyIndicatorValue,
  WeeklyRecordsFile
} from "@/lib/gestao-xpe/catalog-types";
import { parseGestaoNumber } from "@/lib/gestao-xpe/metrics";
import { weekKeysInPeriod } from "@/lib/gestao-xpe/week-utils";

function aggregateNumbers(values: number[], mode: CatalogIndicator["agregacaoMensal"]) {
  if (!values.length) return null;
  if (mode === "soma") return values.reduce((a, b) => a + b, 0);
  if (mode === "media") return values.reduce((a, b) => a + b, 0) / values.length;
  if (mode === "max") return Math.max(...values);
  if (mode === "min") return Math.min(...values);
  if (mode === "ultimo") return values[values.length - 1];
  return null;
}

function collectNumeric(
  entries: WeeklyIndicatorValue[],
  field: "meta" | "realizado",
  mode: CatalogIndicator["agregacaoMensal"]
): string | null {
  if (mode === "texto") {
    const texts = entries.map((e) => e[field]?.trim()).filter(Boolean) as string[];
    return texts.length ? texts.join(" · ") : null;
  }

  const nums = entries
    .map((e) => parseGestaoNumber(e[field]))
    .filter((n): n is number => n !== null);

  const agg = aggregateNumbers(nums, mode);
  if (agg === null) return null;
  return Number.isInteger(agg) ? String(agg) : String(Math.round(agg * 10) / 10);
}

export function aggregatePeriod(
  catalog: GestaoCatalog,
  records: WeeklyRecordsFile,
  anchor: PeriodAnchor
): Record<string, AggregatedIndicator> {
  const weekKeys = weekKeysInPeriod(anchor);
  const result: Record<string, AggregatedIndicator> = {};

  for (const ind of Object.values(catalog.indicators)) {
    const entries: WeeklyIndicatorValue[] = [];
    for (const wk of weekKeys) {
      const rec = records.semanas[wk];
      if (rec?.valores[ind.id]) entries.push(rec.valores[ind.id]);
    }

    result[ind.id] = {
      indicatorId: ind.id,
      meta: collectNumeric(entries, "meta", ind.agregacaoMensal),
      realizado: collectNumeric(entries, "realizado", ind.agregacaoMensal),
      semanasIncluidas: entries.length
    };
  }

  return result;
}

export function countFilledIndicators(record: { valores: Record<string, WeeklyIndicatorValue> }) {
  const total = Object.keys(record.valores).length;
  const filled = Object.values(record.valores).filter((v) => v.realizado?.trim()).length;
  return { filled, total };
}
