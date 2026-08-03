import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObraSubgroupOverridesFile } from "@/lib/obra-subgroups/constants";
import { dataPath, resolveDataFile } from "@/lib/data/processed-store";

const OVERRIDES_FILE = "obra-subgroup-overrides.json";
// Escrita no volume; leitura aceita a cópia do repositório antes do primeiro sync.
const OVERRIDES_PATH = dataPath(OVERRIDES_FILE);

async function readOverridesFile(): Promise<ObraSubgroupOverridesFile> {
  const raw = await readFile(await resolveDataFile(OVERRIDES_FILE), "utf8");
  return JSON.parse(raw) as ObraSubgroupOverridesFile;
}

export async function GET() {
  try {
    const data = await readOverridesFile();
    return Response.json(data);
  } catch {
    return Response.json({ version: 1, updatedAt: null, overrides: {} });
  }
}

export async function PUT(request: Request) {
  const body = (await request.json()) as ObraSubgroupOverridesFile;
  const payload: ObraSubgroupOverridesFile = {
    version: body.version ?? 1,
    updatedAt: new Date().toISOString(),
    overrides: body.overrides ?? {}
  };
  await writeFile(OVERRIDES_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return Response.json({ ok: true, data: payload });
}
