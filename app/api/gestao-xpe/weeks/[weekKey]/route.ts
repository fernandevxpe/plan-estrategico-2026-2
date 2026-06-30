import type { WeeklyRecord } from "@/lib/gestao-xpe/catalog-types";
import {
  getOrCreateWeek,
  loadWeeklyRecords,
  upsertWeek
} from "@/lib/gestao-xpe/weekly-records-store";

type RouteParams = { params: Promise<{ weekKey: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { weekKey } = await params;
  const decoded = decodeURIComponent(weekKey);
  const record = await getOrCreateWeek(decoded);
  return Response.json(record);
}

export async function PUT(request: Request, { params }: RouteParams) {
  const { weekKey } = await params;
  const decoded = decodeURIComponent(weekKey);
  const body = (await request.json()) as WeeklyRecord;
  const record = await upsertWeek({ ...body, weekKey: decoded });
  return Response.json({ ok: true, record });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { weekKey } = await params;
  const decoded = decodeURIComponent(weekKey);
  const patch = (await request.json()) as Partial<WeeklyRecord>;
  const file = await loadWeeklyRecords();
  const current = file.semanas[decoded] ?? (await getOrCreateWeek(decoded));
  const record = await upsertWeek({
    ...current,
    ...patch,
    weekKey: decoded,
    valores: patch.valores ? { ...current.valores, ...patch.valores } : current.valores
  });
  return Response.json({ ok: true, record });
}
