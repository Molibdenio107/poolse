/**
 * How far the family's calendar reaches — POOLSE-175. Six months ahead and three
 * back, whole months, stepped a Monday-to-Sunday week at a time (Rui, 06-11-2026).
 *
 * Here because the stepper that stops at the edge and the API that refuses past
 * it must agree. Dates are `YYYY-MM-DD` strings and months `YYYY-MM`, compared as
 * text and shifted in UTC, so no timezone can move a day.
 */
export const AGENDA_MONTHS_BACK = 3;
export const AGENDA_MONTHS_AHEAD = 6;
/** The longest window `GET /app/agenda` answers: a month, either end included. */
export const AGENDA_WINDOW_MAX_DAYS = 31;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function utc(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, index - 1 + by, 1)).toISOString().slice(0, 7);
}

/** The first and last day of a month. */
export function monthDays(month: string): { from: string; to: string } {
  const [year, index] = month.split('-').map(Number) as [number, number];
  return {
    from: `${month}-01`,
    to: new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10),
  };
}

/** The earliest and latest month the calendar shows. */
export function agendaMonthRange(today: string): { first: string; last: string } {
  const month = today.slice(0, 7);
  return { first: shiftMonth(month, -AGENDA_MONTHS_BACK), last: shiftMonth(month, AGENDA_MONTHS_AHEAD) };
}

/** Monday 0 … Sunday 6. */
function weekday(date: string): number {
  return (new Date(utc(date)).getUTCDay() + 6) % 7;
}

function addDays(date: string, days: number): string {
  return new Date(utc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday of a date's week. */
export function agendaWeekOf(date: string): string {
  return addDays(date, -weekday(date));
}

/** Whether a value is a real Monday, which is how a week is named in an address. */
export function isAgendaWeek(value: string | undefined): value is string {
  if (value === undefined || !DATE.test(value) || Number.isNaN(utc(value))) return false;
  return weekday(value) === 0 && addDays(value, 0) === value;
}

/**
 * The earliest and latest Monday whose whole week `agendaWindowAllowed` answers:
 * a week hanging over either edge would be a 400, so the stepper stops short.
 */
export function agendaWeekRange(today: string): { first: string; last: string } {
  const months = agendaMonthRange(today);
  const start = monthDays(months.first).from;
  const end = monthDays(months.last).to;
  return {
    first: weekday(start) === 0 ? start : addDays(agendaWeekOf(start), 7),
    last: addDays(agendaWeekOf(addDays(end, 1)), -7),
  };
}

/** Whether `GET /app/agenda` answers this window. */
export function agendaWindowAllowed(today: string, from: string, to: string): boolean {
  if (!DATE.test(from) || !DATE.test(to)) return false;
  const start = utc(from);
  const end = utc(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return false;
  if ((end - start) / DAY_MS > AGENDA_WINDOW_MAX_DAYS) return false;
  const { first, last } = agendaMonthRange(today);
  return from >= monthDays(first).from && to <= monthDays(last).to;
}
