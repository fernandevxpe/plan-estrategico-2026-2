import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { activityCompletedDateKey } from "@/lib/gestao-xpe/pipedrive-datetime";

export type PipedriveActivity = {
  id: number;
  type: string;
  subject: string;
  done: boolean;
  deal_id: number | null;
  add_time: string;
  marked_as_done_time: string | null;
  due_date: string | null;
  due_time: string | null;
  user_id: number | null;
};

/** Data em que a atividade foi concluída (CRM pode preencher só due_date). */
export function activityCompletedAt(a: PipedriveActivity): Date | null {
  const key = activityCompletedDateKey(a);
  if (!key) return null;
  const d = new Date(`${key}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function activityDoneInRange(
  a: PipedriveActivity,
  rangeStart: string,
  rangeEnd: string
): boolean {
  if (!a.done) return false;
  const key = activityCompletedDateKey(a);
  if (!key) return false;
  return key >= rangeStart && key <= rangeEnd;
}

export function isProposalElaborationActivity(a: PipedriveActivity): boolean {
  if (a.type === "elaborar_proposta") return true;
  return /elaborar proposta|solicito proposta|elaborando proposta/i.test(a.subject ?? "");
}

export function isFollowupActivity(a: PipedriveActivity): boolean {
  if (a.type === "call" || a.type === "email") return true;
  if (a.type === "social_point") {
    const subject = (a.subject ?? "").trim();
    if (/^chamada$/i.test(subject)) return true;
    if (/follow\s*up|followup/i.test(subject)) return true;
  }
  return false;
}

/** Visita/diagnóstico no campo — não é apresentação de proposta. */
export function isDiagnosticVisitSubject(subject: string | null | undefined): boolean {
  const s = (subject ?? "").trim();
  if (!s) return false;
  return (
    /^visita\s+diagn/i.test(s) ||
    /^diagnóstico$/i.test(s) ||
    /^diagnostico$/i.test(s)
  );
}

/** Placeholder de agendamento — não conta como apresentação realizada. */
export function isSchedulingMeetingSubject(subject: string | null | undefined): boolean {
  const s = (subject ?? "").trim();
  if (!s) return false;
  return (
    /^agendar entre executivo e cliente/i.test(s) ||
    /^remarcar reunião/i.test(s) ||
    /^agendar$/i.test(s)
  );
}

/** Reunião no Pipedrive = apresentação de proposta (presencial, online, conselho, assembleia, etc.). */
export function isPresentationMeetingActivity(a: PipedriveActivity): boolean {
  if (a.type !== "meeting") return false;
  const subject = a.subject ?? "";
  if (isDiagnosticVisitSubject(subject)) return false;
  if (isSchedulingMeetingSubject(subject)) return false;
  return true;
}

/** Assembleia = reunião concluída com "assembleia" no assunto. */
export function isAssemblyMeetingActivity(a: PipedriveActivity): boolean {
  if (!isPresentationMeetingActivity(a)) return false;
  return /assembleia|assembléia/i.test(a.subject ?? "");
}

function isSocialPointVisit(a: PipedriveActivity): boolean {
  if (a.type !== "social_point") return false;
  return /pesquisa|qualifica|visita/i.test(a.subject ?? "");
}

export function isVisitActivity(a: PipedriveActivity): boolean {
  if (a.type === "visita_diagnostico" || a.type === "pesquisaqualificacao") return true;
  if (isSocialPointVisit(a)) return true;
  if (a.type === "meeting" && isDiagnosticVisitSubject(a.subject)) return true;
  return /visita\s+diagn|visita\s+de\s+levantamento/i.test(a.subject ?? "");
}

export async function loadPipedriveActivities(): Promise<PipedriveActivity[]> {
  const file = path.join(process.cwd(), "data/raw/pipedrive-activities.json");
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as { data: PipedriveActivity[] };
    return raw.data ?? [];
  } catch {
    return [];
  }
}
