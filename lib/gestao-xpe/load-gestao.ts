import { readFile } from "node:fs/promises";
import type { GestaoDashboard } from "@/lib/gestao-xpe/types";
import { dataPath } from "@/lib/data/processed-store";

export async function loadGestaoDashboard(): Promise<GestaoDashboard> {
  const file = dataPath("gestao-xpe", "gestao-dashboard.json");
  return JSON.parse(await readFile(file, "utf8")) as GestaoDashboard;
}
