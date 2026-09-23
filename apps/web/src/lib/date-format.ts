/**
 * Every date in Poolse, in one shape — `dd-MM-yyyy`.
 *
 * Decided 13 September 2026: one shape everywhere, prose included, `/admin`
 * included. `13-09-2026`, and `13-09-2026 14:30` where a time is needed.
 *
 * **Why this is a function and not a named format.** The convention has been
 * that a date's shape is a named format in `i18n.ts`, defined once and passed to
 * both `getRequestConfig` and `NextIntlClientProvider` — and the reason for it
 * stands: one definition, or they drift. What changed is that `Intl` cannot
 * produce this shape. It has no separator option: `pt-PT` writes `13/09/2026`,
 * `en-US` writes `09/13/2026`, and no locale writes a day-first date with
 * hyphens. So the single definition moved here, and `long`, `short` and `stamp`
 * are gone from `i18n.ts` — asking for one now fails the format check rather
 * than quietly rendering the old shape.
 *
 * **It is built from parts, not from a string replacement.** `formatToParts`
 * gives the day, month and year as values; joining them is then arithmetic-free
 * and cannot be confused by a locale that puts a marker in the middle.
 *
 * **The timezone is not optional.** A `timestamptz` rendered in the runtime's
 * zone is a date that changes between the server and a browser in another
 * country — and this product already lost an afternoon to `toISOString()`
 * turning 1 October into 30 September. Everything here goes through
 * `APP_TIME_ZONE`, which `i18n.ts` also hands to next-intl, so one constant
 * governs both.
 */

/**
 * The club's zone, and next-intl's.
 *
 * One constant imported by `i18n.ts` rather than two copies of the same string:
 * the day a club in the Azores needs a different one, this is the single place
 * that has to learn to ask.
 */
export const APP_TIME_ZONE = 'Europe/Lisbon';

/**
 * A fixed locale, deliberately.
 *
 * `en-GB` is day-first and numeric, which is the order this product wants in
 * every language; the separator is replaced below in any case. Using the
 * *reader's* locale here would be the bug this file exists to prevent — an
 * English-speaking operator of a Portuguese pool would get `09-13-2026` and read
 * it as 9 September.
 */
const PARTS_LOCALE = 'en-GB';

const DATE_PARTS = new Intl.DateTimeFormat(PARTS_LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: APP_TIME_ZONE,
});

const TIME_PARTS = new Intl.DateTimeFormat(PARTS_LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: APP_TIME_ZONE,
});

/** Anything a column can hold: a Date, an ISO instant, or a `YYYY-MM-DD` day. */
export type DateLike = Date | string | number;

/**
 * A `YYYY-MM-DD` string is a **day**, not an instant.
 *
 * `new Date('2026-10-01')` is parsed as UTC midnight, which in a zone behind UTC
 * is the previous day — the exact off-by-one that made a rate effective on 1
 * October display as 30 September. Appending a local midnight makes it the day
 * it says it is.
 */
function asDate(value: DateLike): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

function partsOf(formatter: Intl.DateTimeFormat, value: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of formatter.formatToParts(value)) out[part.type] = part.value;
  return out;
}

/** `13-09-2026`. An empty string for a date that is not one, never "Invalid Date". */
export function formatDate(value: DateLike | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';

  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return '';

  const { day, month, year } = partsOf(DATE_PARTS, date);
  return `${day}-${month}-${year}`;
}

/** `13-09-2026 14:30`. The same day, with the moment on the end. */
export function formatStamp(value: DateLike | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';

  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return '';

  const { hour, minute } = partsOf(TIME_PARTS, date);
  return `${formatDate(date)} ${hour}:${minute}`;
}

/**
 * `14:30` — the time half, for a sentence that needs the two apart.
 *
 * "Limpo por X às {hora} do dia {data}" cannot use `formatStamp`, because the
 * word order between the two is the translation's business and not this
 * module's. The alternative was a call site asking next-intl for
 * `{ hour, minute }` — which is how that panel came to render `14:30` in
 * Portuguese and `2:30 PM` in English while `formatStamp` said 24-hour
 * everywhere else. Same clock, same zone, one definition.
 */
export function formatTime(value: DateLike | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';

  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return '';

  const { hour, minute } = partsOf(TIME_PARTS, date);
  return `${hour}:${minute}`;
}
