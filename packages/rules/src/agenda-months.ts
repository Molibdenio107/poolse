/**
 * How far the family's calendar reaches — POOLSE-175. Six months ahead and three
 * back, whole months, one month at a time.
 *
 * Here because the stepper that stops at the edge and the API that refuses past
 * it must agree. Dates are `YYYY-MM-DD` strings and months `YYYY-MM`, compared as
 * text and shifted in UTC, so no timezone can move a day.
 */
export const AGENDA_MONTHS_BACK = 3;
export const AGENDA_MONTHS_AHEAD = 6;
/** The longest window `GET /app/agenda` answers: a month, either end included. */
export const AGENDA_WINDOW_MAX_DAYS = 31;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function utc(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function isAgendaMonth(value: string | undefined): value is string {
  return value !== undefined && MONTH.test(value);
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
