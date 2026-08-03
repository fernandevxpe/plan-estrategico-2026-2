import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Leitura dos artefatos de `data/processed/` em tempo de execução.
 *
 * Antes esses arquivos eram importados estaticamente, o que os congelava no
 * bundle no momento do build — só um redeploy trocava o dado, e `marketing.json`
 * sozinho jogava 4,5 MB no JavaScript. Lendo do disco a cada request (com cache
 * em memória por processo) o sync diário passa a valer sem rebuild: basta o
 * arquivo mudar no volume.
 *
 * `DATA_DIR` aponta para o volume no Railway; no local e no build cai em
 * `<projeto>/data`.
 */
const DATA_ROOT = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");

const PROCESSED_DIR = path.join(DATA_ROOT, "processed");

/** Fallback para o snapshot versionado quando o volume ainda não foi populado. */
const SEED_DIR = path.join(process.cwd(), "data", "processed");

type CacheEntry = { mtimeMs: number; value: unknown };
const cache = new Map<string, CacheEntry>();

async function readJsonFrom(dir: string, file: string) {
  const target = path.join(dir, file);
  const { stat } = await import("node:fs/promises");
  const info = await stat(target);
  const cached = cache.get(target);
  if (cached && cached.mtimeMs === info.mtimeMs) return cached.value;

  const value = JSON.parse(await readFile(target, "utf8"));
  cache.set(target, { mtimeMs: info.mtimeMs, value });
  return value;
}

export async function readProcessed<T>(file: string, fallback?: T): Promise<T> {
  try {
    return (await readJsonFrom(PROCESSED_DIR, file)) as T;
  } catch (primaryError) {
    if (PROCESSED_DIR !== SEED_DIR) {
      try {
        return (await readJsonFrom(SEED_DIR, file)) as T;
      } catch {
        /* cai no tratamento abaixo */
      }
    }
    if (fallback !== undefined) {
      console.error(`data/processed/${file} indisponível, usando fallback:`, primaryError);
      return fallback;
    }
    throw primaryError;
  }
}

export const processedDir = PROCESSED_DIR;
export const dataRoot = DATA_ROOT;

/** Caminho dentro da raiz de dados — respeita o volume quando DATA_DIR existe. */
export function dataPath(...segments: string[]) {
  return path.join(DATA_ROOT, ...segments);
}
