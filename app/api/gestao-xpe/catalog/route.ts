import { loadGestaoCatalog, saveGestaoCatalog } from "@/lib/gestao-xpe/weekly-records-store";
import type { GestaoCatalog } from "@/lib/gestao-xpe/catalog-types";

export async function GET() {
  const catalog = await loadGestaoCatalog();
  return Response.json(catalog);
}

export async function PUT(request: Request) {
  const body = (await request.json()) as GestaoCatalog;
  const saved = await saveGestaoCatalog(body);
  return Response.json({ ok: true, catalog: saved });
}
