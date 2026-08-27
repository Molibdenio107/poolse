import type { StudentLevel } from '@/lib/api';

/**
 * Age arithmetic for level ranges — backlog round 4 tickets 2 and 3, and
 * POOLSE-06.
 *
 * One module because the same three questions are asked from the level list, the
 * student form and the register, and three copies would drift the first time
 * somebody fixed a birthday edge case in only one of them.
 *
 * **Everything is months.** A baby class starts at six months, and whole years
 * cannot say so. Months rather than a value-plus-unit pair because the pair
 * means every comparison first agreeing on the unit, and the first one that
 * forgot would silently measure six months against six years.
 */

/** Twelve. Named, because `* 12` in six places is six chances to type `* 21`. */
export const MONTHS_IN_YEAR = 12;

/**
 * Whole months lived, on the calendar.
 *
 * Both dates read in UTC, because a birth date is a calendar day rather than an
 * instant — reading it in a local timezone west of Greenwich turns a birthday on
 * the 1st into the 31st and makes somebody a month younger for a day.
 */
export function ageInMonths(birthDate: string, on: Date = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;

  const born = new Date(`${birthDate}T00:00:00Z`);

  /*
   * Formatted back and compared, not merely checked for NaN.
   *
   * `new Date('2026-02-31')` does not throw — it rolls into the 3rd of March and
   * is a perfectly valid Date. Without this, an impossible birth date became a
   * real one three days later and quietly produced an age, which is exactly the
   * kind of wrong answer given confidently that this whole module exists to
   * avoid. `isDate` in `dates.ts` guards the same trap the same way.
   */
  if (Number.isNaN(born.getTime()) || born.toISOString().slice(0, 10) !== birthDate) {
    return null;
  }

  let months =
    (on.getUTCFullYear() - born.getUTCFullYear()) * MONTHS_IN_YEAR +
    (on.getUTCMonth() - born.getUTCMonth());

  // The day of the month has not come round yet, so the last month is not
  // complete. Somebody born on the 20th is not a month older on the 19th.
  if (on.getUTCDate() < born.getUTCDate()) months -= 1;

  return months < 0 ? null : months;
}

/** Whole years, for the places that show an age rather than compare one. */
export function ageInYears(birthDate: string, on: Date = new Date()): number | null {
  const months = ageInMonths(birthDate, on);
  return months === null ? null : Math.floor(months / MONTHS_IN_YEAR);
}

export type AgeFit = 'fits' | 'tooYoung' | 'tooOld' | 'unknown';

/**
 * Whether a student's age sits inside a level's range.
 *
 * Compared in months — POOLSE-06, criterion 4. A five-month-old is too young for
 * a level starting at six months, and comparing in years would have called them
 * both zero.
 *
 * `unknown` when there is no birth date, and it is the answer that matters most:
 * missing dates are the normal case, not the exception. The spreadsheets waiting
 * to be imported have a half-empty birth-date column, and treating absent as
 * "does not fit" would flag most of a register for no reason.
 *
 * A level with no bounds always fits, which is exactly how every level behaved
 * before ranges existed.
 */
export function fitsLevel(
  level: Pick<StudentLevel, 'minAgeMonths' | 'maxAgeMonths'>,
  birthDate: string | null,
  on: Date = new Date(),
): AgeFit {
  if (level.minAgeMonths === null && level.maxAgeMonths === null) return 'fits';
  if (birthDate === null) return 'unknown';

  const months = ageInMonths(birthDate, on);
  if (months === null) return 'unknown';

  if (level.minAgeMonths !== null && months < level.minAgeMonths) return 'tooYoung';
  if (level.maxAgeMonths !== null && months > level.maxAgeMonths) return 'tooOld';
  return 'fits';
}

/**
 * A count of months as the unit a person would say it in — POOLSE-06,
 * criterion 3.
 *
 * Months below a year, whole years above it, and years-with-months for the
 * awkward middle. Returns the numbers and the shape; the words are the message
 * catalogue's, because "6 meses" and "1 ano e 6 meses" are different sentences
 * with different plurals rather than one template.
 */
export type AgeShape =
  | { unit: 'months'; months: number }
  | { unit: 'years'; years: number }
  | { unit: 'yearsAndMonths'; years: number; months: number };

export function shapeOfMonths(total: number): AgeShape {
  if (total < MONTHS_IN_YEAR) return { unit: 'months', months: total };

  const years = Math.floor(total / MONTHS_IN_YEAR);
  const months = total % MONTHS_IN_YEAR;

  return months === 0 ? { unit: 'years', years } : { unit: 'yearsAndMonths', years, months };
}

/**
 * "3–5", "18+", "até 3", or null when the level has no bounds.
 *
 * Returns the shapes and lets the caller supply the words, because "up to" and
 * "and over" are user-facing strings and belong in the message catalogues.
 */
export function rangeShape(
  level: Pick<StudentLevel, 'minAgeMonths' | 'maxAgeMonths'>,
): { kind: 'both' | 'min' | 'max'; min: AgeShape | null; max: AgeShape | null } | null {
  const { minAgeMonths: min, maxAgeMonths: max } = level;

  if (min === null && max === null) return null;
  if (min !== null && max !== null) {
    return { kind: 'both', min: shapeOfMonths(min), max: shapeOfMonths(max) };
  }
  if (min !== null) return { kind: 'min', min: shapeOfMonths(min), max: null };
  return { kind: 'max', min: null, max: shapeOfMonths(max!) };
}

/**
 * The values the age picker offers — POOLSE-06, criterion 2.
 *
 * One to eleven months, then whole years. Below a year every month is a real
 * distinction for a baby class; above it nobody sets a level boundary at
 * "seven years and four months".
 */
export function ageOptions(maxYears = 100): number[] {
  const months = Array.from({ length: MONTHS_IN_YEAR - 1 }, (_, index) => index + 1);
  const years = Array.from({ length: maxYears }, (_, index) => (index + 1) * MONTHS_IN_YEAR);
  // Zero first: "from birth" is a real answer for a baby class.
  return [0, ...months, ...years];
}
