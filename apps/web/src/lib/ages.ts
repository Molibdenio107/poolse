import type { StudentLevel } from '@/lib/api';

/**
 * Age arithmetic for level ranges — backlog round 4, tickets 2 and 3.
 *
 * One module because the same three questions are asked from the level list, the
 * student form and the register, and three copies would drift the first time
 * somebody fixed a birthday edge case in only one of them.
 */

/**
 * Whole years, on the calendar.
 *
 * Both dates read in UTC, because a birth date is a calendar day rather than an
 * instant — reading it in a local timezone west of Greenwich turns a birthday on
 * the 1st into the 31st and makes somebody a year younger for a day.
 */
export function ageInYears(birthDate: string, on: Date = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;

  const born = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;

  let age = on.getUTCFullYear() - born.getUTCFullYear();

  // Not had their birthday yet this year.
  const month = on.getUTCMonth() - born.getUTCMonth();
  if (month < 0 || (month === 0 && on.getUTCDate() < born.getUTCDate())) age -= 1;

  return age < 0 ? null : age;
}

export type AgeFit = 'fits' | 'tooYoung' | 'tooOld' | 'unknown';

/**
 * Whether a student's age sits inside a level's range.
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
  level: Pick<StudentLevel, 'minAgeYears' | 'maxAgeYears'>,
  birthDate: string | null,
  on: Date = new Date(),
): AgeFit {
  if (level.minAgeYears === null && level.maxAgeYears === null) return 'fits';
  if (birthDate === null) return 'unknown';

  const age = ageInYears(birthDate, on);
  if (age === null) return 'unknown';

  if (level.minAgeYears !== null && age < level.minAgeYears) return 'tooYoung';
  if (level.maxAgeYears !== null && age > level.maxAgeYears) return 'tooOld';
  return 'fits';
}

/**
 * "3–5", "18+", "até 3", or null when the level has no bounds.
 *
 * Returns the numbers and lets the caller supply the words, because "up to" and
 * "and over" are user-facing strings and belong in the message catalogues.
 */
export function rangeShape(
  level: Pick<StudentLevel, 'minAgeYears' | 'maxAgeYears'>,
): { kind: 'both' | 'min' | 'max'; min: number | null; max: number | null } | null {
  const { minAgeYears: min, maxAgeYears: max } = level;

  if (min === null && max === null) return null;
  if (min !== null && max !== null) return { kind: 'both', min, max };
  if (min !== null) return { kind: 'min', min, max: null };
  return { kind: 'max', min: null, max };
}
