import { getISOWeekKey } from "@/lib/gestao-xpe/week-utils";

/** Parte YYYY-MM-DD de timestamps do Pipedrive (`2026-06-30 20:50:24`). */
export function pipedriveDateKey(value: string | null | undefined): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value?.trim() ?? "");
  return match ? match[1] : null;
}

export function pipedriveDateInRange(
  value: string | null | undefined,
  rangeStart: string,
  rangeEnd: string
): boolean {
  const key = pipedriveDateKey(value);
  if (!key) return false;
  return key >= rangeStart && key <= rangeEnd;
}

/** Semana ISO a partir de data do Pipedrive (meio-dia UTC evita borda de fuso). */
export function weekKeyFromPipedriveDate(value: string | null | undefined): string | null {
  const key = pipedriveDateKey(value);
  if (!key) return null;
  return getISOWeekKey(new Date(`${key}T12:00:00Z`));
}

export function activityCompletedDateKey(fields: {
  marked_as_done_time?: string | null;
  done?: boolean;
  due_date?: string | null;
}): string | null {
  const marked = pipedriveDateKey(fields.marked_as_done_time);
  if (marked) return marked;
  if (fields.done && fields.due_date?.trim()) return fields.due_date.trim().slice(0, 10);
  return null;
}
