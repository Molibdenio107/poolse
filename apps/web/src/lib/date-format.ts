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
 * October display as 30 September.
 *
 * **Noon UTC, not local midnight.** Local midnight was right on a server in
 * Lisbon and wrong in a browser east of it: midnight in Madrid is 23:00 the day
 * before in `APP_TIME_ZONE`, which is the zone every formatter here prints in.
 * Noon UTC is the same calendar day in every zone within twelve hours of
 * Greenwich, whatever clock the code happens to run on.
 */
function asDate(value: DateLike): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
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

/**
 * Now, as a `datetime-local` value on a given site's wall clock — POOLSE-70.
 *
 * An incident form sends `YYYY-MM-DDTHH:mm` in the *site's* time and the API
 * reads it in `facility.timezone`. Defaulting the box from the browser's clock
 * would be right in Lisbon and an hour out on a laptop set to Madrid, so the
 * default is computed here, from the site's zone, where every other formatter
 * in the app already lives.
 */
export function wallClockNow(timeZone: string, now: Date = new Date()): string {
  const parts = partsOf(
    new Intl.DateTimeFormat(PARTS_LOCALE, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    }),
    now,
  );
  return `${parts['year']}-${parts['month']}-${parts['day']}T${parts['hour']}:${parts['minute']}`;
}

/* ------------------------------------------------------- dates in words */

/*
 * **A deliberate exception to `dd-MM-yyyy`, for headings only** — POOLSE-96
 * (Rui, 22-10-2026). A week's heading and a day's column read better written
 * out ("16 a 22 de novembro de 2026") than as two strings of digits, and here
 * `Intl` *is* the right tool: `formatRange` knows to say the shared month and
 * year once, which no concatenation of two `formatDate`s can. Everything else
 * — tables, prose, `/admin` — stays `formatDate`. `docs/decisions.md` says so,
 * so this does not spread unasked.
 *
 * English is written as `en-GB` — "16–22 November 2026", day before month, as
 * the ticket and every other date in the product have it. Plain `en` is the
 * American order.
 */

function wordsLocale(locale: string): string {
  return locale.startsWith('en') ? 'en-GB' : 'pt-PT';
}

const WORDS: Record<string, Intl.DateTimeFormat> = {};

function words(locale: string, kind: 'long' | 'dayMonth' | 'range'): Intl.DateTimeFormat {
  const tag = wordsLocale(locale);
  const key = `${tag}:${kind}`;
  WORDS[key] ??= new Intl.DateTimeFormat(tag, {
    ...(kind === 'long' ? { weekday: 'long' } : {}),
    day: 'numeric',
    month: 'long',
    ...(kind === 'dayMonth' ? {} : { year: 'numeric' }),
    timeZone: APP_TIME_ZONE,
  });
  return WORDS[key];
}

/** "segunda-feira, 16 de novembro de 2026" / "Monday, 16 November 2026". */
export function formatDateLong(value: DateLike, locale: string): string {
  const date = asDate(value);
  return Number.isNaN(date.getTime()) ? '' : words(locale, 'long').format(date);
}

/** "16 de novembro" / "16 November" — a column heading that sits under its weekday. */
export function formatDayMonth(value: DateLike, locale: string): string {
  const date = asDate(value);
  return Number.isNaN(date.getTime()) ? '' : words(locale, 'dayMonth').format(date);
}

/**
 * "16 nov." / "16 Nov" — a calendar day column too narrow for the month in
 * full (POOLSE-107). Composed from the day and the month's own abbreviation,
 * because `Intl` asked for both at once writes pt-PT as 16/11 — a slashed date,
 * which is the one shape Poolse does not write.
 */
export function formatDayMonthShort(value: DateLike, locale: string): string {
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return '';
  const tag = wordsLocale(locale);
  const key = `${tag}:monthShort`;
  WORDS[key] ??= new Intl.DateTimeFormat(tag, { month: 'short', timeZone: APP_TIME_ZONE });
  const day = new Intl.DateTimeFormat(tag, { day: 'numeric', timeZone: APP_TIME_ZONE }).format(date);
  return `${day} ${WORDS[key].format(date)}`;
}

/**
 * A span of days in words, with what the two ends share said once.
 *
 * pt-PT: "16 a 22 de novembro de 2026", "30 de novembro a 6 de dezembro de
 * 2026". en: "16–22 November 2026", "30 November – 6 December 2026". `Intl`
 * collapses the month and year; for Portuguese the one thing changed is the
 * range's own separator, which CLDR writes as a dash and prose writes as "a" —
 * swapped part by part, never by searching the string.
 */
export function formatDateRange(from: DateLike, to: DateLike, locale: string): string {
  const start = asDate(from);
  const end = asDate(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';

  const parts = words(locale, 'range').formatRangeToParts(start, end);
  if (wordsLocale(locale) !== 'pt-PT') return parts.map((part) => part.value).join('');

  return parts
    .map((part) =>
      part.type === 'literal' && part.source === 'shared' && /[–—-]/.test(part.value) ? ' a ' : part.value,
    )
    .join('');
}
