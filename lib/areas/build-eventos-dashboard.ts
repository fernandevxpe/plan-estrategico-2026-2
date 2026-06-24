import focusJson from "@/data/areas/eventos-focus.json";

export type EventosCalendarItem = (typeof focusJson.eventCalendar.events)[number];

export type EventosDashboard = {
  focus: typeof focusJson;
  calendar: EventosCalendarItem[];
  daysToFesindico: number | null;
  fesindicoUrgent: boolean;
};

export function buildEventosDashboard(): EventosDashboard {
  const fesindico = focusJson.fesindico2026;
  const start = new Date(fesindico.dateStart + "T12:00:00");
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const diffMs = start.getTime() - today.getTime();
  const daysToFesindico = diffMs > 0 ? Math.ceil(diffMs / (1000 * 60 * 60 * 24)) : null;

  return {
    focus: focusJson,
    calendar: [...focusJson.eventCalendar.events].sort((a, b) => a.tier - b.tier),
    daysToFesindico,
    fesindicoUrgent: daysToFesindico !== null && daysToFesindico <= 120
  };
}
