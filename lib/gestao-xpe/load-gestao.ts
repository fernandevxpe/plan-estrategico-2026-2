import { readFile } from "node:fs/promises";
import path from "node:path";
import type { GestaoDashboard } from "@/lib/gestao-xpe/types";

export async function loadGestaoDashboard(): Promise<GestaoDashboard> {
  const file = path.join(process.cwd(), "data/gestao-xpe/gestao-dashboard.json");
  return JSON.parse(await readFile(file, "utf8")) as GestaoDashboard;
}
