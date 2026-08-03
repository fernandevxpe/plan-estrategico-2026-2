import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GestaoCatalog, WeeklyRecord, WeeklyRecordsFile } from "@/lib/gestao-xpe/catalog-types";
import { GESTAO_CATALOG_PATH, GESTAO_WEEKLY_RECORDS_PATH } from "@/lib/gestao-xpe/paths";
import { dataPath, resolveDataFile } from "@/lib/data/processed-store";
import { weekKeyToIsoDates } from "@/lib/gestao-xpe/week-utils";

// Esses dois arquivos são gravados pela plataforma (lançamentos semanais), então
// precisam viver no volume: no container o disco é descartado a cada deploy.
const CATALOG_REL = GESTAO_CATALOG_PATH.replace(/^data\//, "");
const RECORDS_REL = GESTAO_WEEKLY_RECORDS_PATH.replace(/^data\//, "");

// Escrita sempre no volume — é o que sobrevive ao redeploy.
const catalogFile = () => dataPath(CATALOG_REL);
const recordsFile = () => dataPath(RECORDS_REL);

// Leitura aceita a cópia do repositório enquanto o volume não foi semeado.
const catalogSource = () => resolveDataFile(CATALOG_REL);
const recordsSource = () => resolveDataFile(RECORDS_REL);

export async function loadGestaoCatalog(): Promise<GestaoCatalog> {
  const raw = await readFile(await catalogSource(), "utf8");
  return JSON.parse(raw) as GestaoCatalog;
}

export async function saveGestaoCatalog(catalog: GestaoCatalog): Promise<GestaoCatalog> {
  const payload: GestaoCatalog = {
    ...catalog,
    updatedAt: new Date().toISOString().slice(0, 10)
  };
  await writeFile(catalogFile(), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

export async function loadWeeklyRecords(): Promise<WeeklyRecordsFile> {
  try {
    const raw = await readFile(await recordsSource(), "utf8");
    return JSON.parse(raw) as WeeklyRecordsFile;
  } catch {
    return { version: 1, semanas: {} };
  }
}

export async function saveWeeklyRecords(file: WeeklyRecordsFile): Promise<WeeklyRecordsFile> {
  await writeFile(recordsFile(), `${JSON.stringify(file, null, 2)}\n`, "utf8");
  return file;
}

export function emptyWeekValues(catalog: GestaoCatalog): WeeklyRecord["valores"] {
  const valores: WeeklyRecord["valores"] = {};
  for (const id of Object.keys(catalog.indicators)) {
    valores[id] = { meta: catalog.indicators[id].metaReferencia, realizado: null };
  }
  return valores;
}

export function createWeekRecord(catalog: GestaoCatalog, weekKey: string): WeeklyRecord {
  const dates = weekKeyToIsoDates(weekKey);
  return {
    weekKey,
    weekStart: dates.weekStart,
    weekEnd: dates.weekEnd,
    label: dates.label,
    status: "rascunho",
    updatedAt: new Date().toISOString(),
    valores: emptyWeekValues(catalog)
  };
}

export async function getOrCreateWeek(weekKey: string): Promise<WeeklyRecord> {
  const [catalog, file] = await Promise.all([loadGestaoCatalog(), loadWeeklyRecords()]);
  const existing = file.semanas[weekKey];
  if (existing) return existing;

  const record = createWeekRecord(catalog, weekKey);
  file.semanas[weekKey] = record;
  await saveWeeklyRecords(file);
  return record;
}

export async function upsertWeek(record: WeeklyRecord): Promise<WeeklyRecord> {
  const file = await loadWeeklyRecords();
  const payload: WeeklyRecord = {
    ...record,
    updatedAt: new Date().toISOString()
  };
  file.semanas[record.weekKey] = payload;
  await saveWeeklyRecords(file);
  return payload;
}

export function listWeekSummaries(file: WeeklyRecordsFile) {
  return Object.values(file.semanas)
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
    .map((w) => ({
      weekKey: w.weekKey,
      label: w.label,
      status: w.status,
      updatedAt: w.updatedAt,
      filled: Object.values(w.valores).filter((v) => v.realizado?.trim()).length,
      total: Object.keys(w.valores).length
    }));
}
