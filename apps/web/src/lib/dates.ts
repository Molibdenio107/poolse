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
 * The season to be working on, September to the end of August.
 *
 * A swimming school's year is not a calendar year: it starts when school does
 * and stops for the August holidays. Generating "this season" from January has
 * to mean the season already under way, not the eleven months from now.
 *
 * **August belongs to the season ahead, not the one closing.** The pivot used to
 * be September, and through the whole of August that offered a season with days
 * left in it — every one of them inside the August closure. An operator pressing
 * "Gerar a época" on the 27th of August generated a year that was already over
 * and then looked at an empty calendar, which is the exact failure that made the
 * calendar look broken.
 *
 * August is the right pivot precisely because it is the month the pool is shut:
 * there is never anything left to generate in it, so nothing is lost by moving
 * on, and the operator is offered the season they are about to run.
 */
export function seasonOf(date: string): { from: string; to: string } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const startYear = month >= 8 ? year : year - 1;
  return { from: `${startYear}-09-01`, to: `${startYear + 1}-08-31` };
}

/**
 * `en` means British English here, not American.
 *
 * Intl resolves a bare `en` to `en-US`, which renders "August 24, 2026" — month
 * first, and a comma. Poolse is a Portuguese product whose English is for
 * European readers, and POOLSE-02 spells the expected form out: "24 August 2026".
 * Every date in the English interface was in the wrong order until this existed.
 *
 * Done here rather than by renaming the locale, because `en` is the message
 * catalogue's name and the URL's, and those are not worth churning for a date
 * format. `pt-PT` is already explicit and passes through untouched.
 */
function forFormatting(locale: string): string {
  return locale === 'en' ? 'en-GB' : locale;
}

/** Formatted in the reader's locale — "12 dez" in pt-PT, "12 Dec" in en. */
export function shortDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(forFormatting(locale), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(toDate(date)));
}

/**
 * "24 ago 2026" — the narrow-screen form, keeping the year.
 *
 * POOLSE-02 asks the week header to shorten rather than wrap on a phone. It
 * keeps the year because the header's whole job is saying *which* week, and a
 * range with no year is ambiguous the moment somebody is looking at January from
 * December.
 */
export function mediumDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(forFormatting(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(toDate(date)));
}

export function longDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(forFormatting(locale), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(toDate(date)));
}
