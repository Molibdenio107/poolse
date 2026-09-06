/**
 * "Limpo há 2 dias" — round 6.
 *
 * Nothing in `dates.ts` formatted an elapsed time; it stops at `longDate`. The
 * cleaning list needs one, and the temptation on a Tuesday evening is to write
 * `` `há ${days} dias` `` in the component, which is a Portuguese string
 * hard-coded into an interface that ships in two languages — and then a second
 * one in English next to it, and then the plural rules of a third language
 * nobody has thought about yet.
 *
 * `Intl.RelativeTimeFormat` already knows all of that. This wraps it so the
 * choice of unit — the only real decision — is made once and the same way
 * everywhere.
 *
 * **It returns the phrase, not the sentence.** The caller composes
 * `t('spaces.cleanedAgo', { ago })`, so the word order stays in the translation
 * file where a translator can move it. English puts the phrase last ("Cleaned 2
 * days ago") and Portuguese in the middle ("Limpo há 2 dias"); a helper that
 * returned a whole sentence would have to know that, and it does not.
 */

/**
 * The unit ladder, largest first.
 *
 * Seconds are deliberately absent from the *top* of the sensible range but
 * present at the bottom: "há 4 segundos" is right for something that just
 * happened, and it is what the operator sees for a second or two after tapping
 * "Marcar como limpo" — the alternative, "há 0 minutos", reads like a bug.
 */
const UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
  { unit: 'second', ms: 1000 },
];

/**
 * How long ago, in the locale's words.
 *
 * `now` is a parameter rather than a call to `Date.now()` so this is testable
 * without freezing the clock, and so a list rendering forty rows measures them
 * all against one instant instead of forty.
 *
 * Returns null for anything unparseable, which the caller renders as "never"
 * rather than as "Invalid Date" — a cleaning log with a broken timestamp is a
 * bug, but it must not be a bug that occupies the whole row.
 */
export function timeAgo(
  iso: string | null | undefined,
  locale: string,
  now: number = Date.now(),
): string | null {
  if (iso === null || iso === undefined || iso === '') return null;

  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;

  const elapsed = now - then;

  /*
   * A future timestamp is clamped to "now" rather than rendered as "em 3
   * minutos".
   *
   * It happens for real: the server stamps `now()` and a browser whose clock is
   * a minute slow renders the reply. "Cleaned in 1 minute" is nonsense on a
   * record of something that has already happened, and clock skew is not
   * something an operator can act on.
   */
  const magnitude = Math.max(elapsed, 0);

  /*
   * `always`, not `auto`.
   *
   * `auto` speaks better Portuguese — it says "ontem" and "anteontem" instead of
   * "há 1 dia" and "há 2 dias" — and it is the wrong choice here anyway. This
   * phrase sits in a list where every other row is a count, and one row reading
   * "anteontem" between "há 5 horas" and "há 3 dias" makes the reader stop to
   * work out whether it means something different. A cleaning list is scanned,
   * not read.
   */
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });

  for (const { unit, ms } of UNITS) {
    if (magnitude >= ms || unit === 'second') {
      // Negative: the past. `Math.round` rather than `floor`, so 47 hours reads
      // as two days rather than as one.
      return format.format(-Math.round(magnitude / ms), unit);
    }
  }

  return null;
}
