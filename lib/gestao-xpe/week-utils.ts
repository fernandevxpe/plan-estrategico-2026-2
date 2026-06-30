import type { GestaoPeriodo, PeriodAnchor } from "@/lib/gestao-xpe/catalog-types";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function getISOWeekKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = date.getMonth();
  const day = date.getDate();
  const d = new Date(Date.UTC(y, m, day));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad2(weekNo)}`;
}

/** Semanas ISO no ano (52 ou 53). */
export function isoWeeksInYear(year: number): number {
  const dec28 = new Date(Date.UTC(year, 11, 28));
  const d = new Date(Date.UTC(dec28.getUTCFullYear(), dec28.getUTCMonth(), dec28.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function parseWeekKey(weekKey: string): { year: number; week: number } {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) throw new Error(`weekKey inválido: ${weekKey}`);
  return { year: Number(match[1]), week: Number(match[2]) };
}

/** Segunda-feira da semana ISO (aproximação estável para gestão) */
export function weekKeyToRange(weekKey: string): { start: Date; end: Date; label: string } {
  const { year, week } = parseWeekKey(weekKey);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - day + 1);
  const start = new Date(mondayWeek1);
  start.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  const fmt = (d: Date) =>
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
}

export function weekKeyToIsoDates(weekKey: string) {
  const { start, end, label } = weekKeyToRange(weekKey);
  return {
    weekStart: start.toISOString().slice(0, 10),
    weekEnd: end.toISOString().slice(0, 10),
    label
  };
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function periodAnchorToDateRange(anchor: PeriodAnchor): { start: string; end: string } {
  if (anchor.periodo === "semanal") {
    const { weekStart, weekEnd } = weekKeyToIsoDates(anchor.chave);
    return { start: weekStart, end: weekEnd };
  }

  if (anchor.periodo === "mensal") {
    const [y, m] = anchor.chave.split("-").map(Number);
    const start = `${y}-${pad2(m)}-01`;
    const end = `${y}-${pad2(m)}-${pad2(lastDayOfMonth(y, m))}`;
    return { start, end };
  }

  if (anchor.periodo === "trimestral") {
    const match = /^(\d{4})-Q(\d)$/.exec(anchor.chave);
    if (!match) return { start: "1970-01-01", end: "1970-01-01" };
    const year = Number(match[1]);
    const q = Number(match[2]);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return {
      start: `${year}-${pad2(startMonth)}-01`,
      end: `${year}-${pad2(endMonth)}-${pad2(lastDayOfMonth(year, endMonth))}`
    };
  }

  if (anchor.periodo === "semestral") {
    const match = /^(\d{4})-H(\d)$/.exec(anchor.chave);
    if (!match) return { start: "1970-01-01", end: "1970-01-01" };
    const year = Number(match[1]);
    const h = Number(match[2]);
    if (h === 1) return { start: `${year}-01-01`, end: `${year}-06-30` };
    return { start: `${year}-07-01`, end: `${year}-12-31` };
  }

  const year = Number(anchor.chave);
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function shiftWeekKey(weekKey: string, delta: number): string {
  if (delta === 0) return weekKey;
  let { year, week } = parseWeekKey(weekKey);
  week += delta;
  while (week > isoWeeksInYear(year)) {
    week -= isoWeeksInYear(year);
    year += 1;
  }
  while (week < 1) {
    year -= 1;
    week += isoWeeksInYear(year);
  }
  return `${year}-W${pad2(week)}`;
}

/** Lista weekKeys ISO consecutivas, inclusive. */
export function listWeekKeysBetween(fromWeekKey: string, toWeekKey: string): string[] {
  if (fromWeekKey > toWeekKey) return [];
  const keys: string[] = [];
  let cur = fromWeekKey;
  for (let guard = 0; guard < 200; guard++) {
    keys.push(cur);
    if (cur === toWeekKey) break;
    const next = shiftWeekKey(cur, 1);
    if (next === cur) break;
    cur = next;
  }
  return keys;
}

const CRM_HISTORY_START_WEEK = "2025-W01";

/** Semanas para histórico CRM: desde início comercial no Pipedrive até a semana atual. */
export function weekKeysForCrmHistory(records: { semanas: Record<string, { weekKey: string }> }): string[] {
  const current = getISOWeekKey();
  const recordKeys = Object.keys(records.semanas).sort();
  let start = CRM_HISTORY_START_WEEK;
  if (recordKeys.length && recordKeys[0] < start) start = recordKeys[0];
  return listWeekKeysBetween(start, current);
}

export function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

export function currentQuarterKey(date = new Date()) {
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()}-Q${q}`;
}

export function currentSemesterKey(date = new Date()) {
  const h = date.getMonth() < 6 ? 1 : 2;
  return `${date.getFullYear()}-H${h}`;
}

export function currentYearKey(date = new Date()) {
  return String(date.getFullYear());
}

export function defaultPeriodAnchor(periodo: GestaoPeriodo = "semanal"): PeriodAnchor {
  const now = new Date();
  switch (periodo) {
    case "semanal": {
      const chave = getISOWeekKey(now);
      return { periodo, chave, label: weekKeyToRange(chave).label };
    }
    case "mensal": {
      const chave = currentMonthKey(now);
      const [y, m] = chave.split("-");
      const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric"
      });
      return { periodo, chave, label };
    }
    case "trimestral": {
      const chave = currentQuarterKey(now);
      return { periodo, chave, label: chave.replace("-", " ") };
    }
    case "semestral": {
      const chave = currentSemesterKey(now);
      return { periodo, chave, label: chave.replace("-", " ") };
    }
    case "anual": {
      const chave = currentYearKey(now);
      return { periodo, chave, label: chave };
    }
  }
}

export function shiftPeriodAnchor(anchor: PeriodAnchor, delta: number): PeriodAnchor {
  if (anchor.periodo === "semanal") {
    const chave = shiftWeekKey(anchor.chave, delta);
    return { periodo: "semanal", chave, label: weekKeyToRange(chave).label };
  }

  if (anchor.periodo === "mensal") {
    const [y, m] = anchor.chave.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const chave = currentMonthKey(d);
    const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return { periodo: "mensal", chave, label };
  }

  if (anchor.periodo === "trimestral") {
    const match = /^(\d{4})-Q(\d)$/.exec(anchor.chave);
    if (!match) return anchor;
    let year = Number(match[1]);
    let q = Number(match[2]) + delta;
    while (q > 4) {
      q -= 4;
      year += 1;
    }
    while (q < 1) {
      q += 4;
      year -= 1;
    }
    const chave = `${year}-Q${q}`;
    return { periodo: "trimestral", chave, label: chave.replace("-", " ") };
  }

  if (anchor.periodo === "semestral") {
    const match = /^(\d{4})-H(\d)$/.exec(anchor.chave);
    if (!match) return anchor;
    let year = Number(match[1]);
    let h = Number(match[2]) + delta;
    while (h > 2) {
      h -= 2;
      year += 1;
    }
    while (h < 1) {
      h += 2;
      year -= 1;
    }
    const chave = `${year}-H${h}`;
    return { periodo: "semestral", chave, label: chave.replace("-", " ") };
  }

  const year = Number(anchor.chave) + delta;
  return { periodo: "anual", chave: String(year), label: String(year) };
}

/** Semanas cujo weekStart cai no período */
export function weekKeysInPeriod(anchor: PeriodAnchor): string[] {
  if (anchor.periodo === "semanal") return [anchor.chave];

  const allYearWeeks = (year: number) => {
    const keys: string[] = [];
    let wk = `${year}-W01`;
    for (let i = 0; i < 53; i++) {
      try {
        const { start } = weekKeyToRange(wk);
        if (start.getUTCFullYear() > year) break;
        keys.push(wk);
        wk = shiftWeekKey(wk, 1);
      } catch {
        break;
      }
    }
    return keys;
  };

  const inMonth = (weekKey: string, monthKey: string) => {
    const { start } = weekKeyToRange(weekKey);
    const mk = `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}`;
    return mk === monthKey;
  };

  if (anchor.periodo === "mensal") {
    const year = Number(anchor.chave.slice(0, 4));
    return allYearWeeks(year).filter((wk) => inMonth(wk, anchor.chave));
  }

  if (anchor.periodo === "trimestral") {
    const match = /^(\d{4})-Q(\d)$/.exec(anchor.chave);
    if (!match) return [];
    const year = Number(match[1]);
    const q = Number(match[2]);
    const months = [(q - 1) * 3 + 1, (q - 1) * 3 + 2, (q - 1) * 3 + 3];
    return allYearWeeks(year).filter((wk) => {
      const { start } = weekKeyToRange(wk);
      return start.getUTCFullYear() === year && months.includes(start.getUTCMonth() + 1);
    });
  }

  if (anchor.periodo === "semestral") {
    const match = /^(\d{4})-H(\d)$/.exec(anchor.chave);
    if (!match) return [];
    const year = Number(match[1]);
    const h = Number(match[2]);
    const months = h === 1 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12];
    return allYearWeeks(year).filter((wk) => {
      const { start } = weekKeyToRange(wk);
      return start.getUTCFullYear() === year && months.includes(start.getUTCMonth() + 1);
    });
  }

  const year = Number(anchor.chave);
  return allYearWeeks(year);
}
