/**
 * Calendar-date arithmetic, on strings.
 *
 * Every date here is a plain `YYYY-MM-DD` and every operation goes through UTC.
 * That is not laziness about timezones — it is the opposite. These are calendar
 * dates, not instants: "the week of the 12th" is the same week whether the
 * server is in Lisbon or Virginia, and doing the arithmetic in local time is how
 * a page rendered at 00:30 in one zone shows the previous week in another.
 *
 * The times shown *inside* those days are a different matter entirely, and are
 * already resolved to the facility's own zone by the API — see `localTime` on a
 * session. Nothing in this file should ever produce a time of day.
 */

const DAY_MS = 86_400_000;

export function toDate(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  return new Date(toDate(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Is this a date at all? Guards a query parameter anyone can type. */
export function isDate(value: string | undefined): value is string {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** ISO weekday: Monday 1 … Sunday 7, matching the database and `week.*`. */
export function isoWeekday(date: string): number {
  const day = new Date(toDate(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function today(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    .toISOString()
    .slice(0, 10);
}

/** The seven dates of the week containing `date`, Monday first. */
export function weekOf(date: string): string[] {
  const monday = mondayOf(date);
  return [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(monday, offset));
}

/**
 * The season a date falls in, September to the end of August.
 *
 * A swimming school's year is not a calendar year: it starts when school does
 * and stops for the August holidays. Generating "this season" from January has
 * to mean the season already under way, not the eleven months from now.
 */
export function seasonOf(date: string): { from: string; to: string } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const startYear = month >= 9 ? year : year - 1;
  return { from: `${startYear}-09-01`, to: `${startYear + 1}-08-31` };
}

/** Formatted in the reader's locale — "12 dez" in pt-PT, "12 Dec" in en. */
export function shortDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(toDate(date)));
}

export function longDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(toDate(date)));
}
