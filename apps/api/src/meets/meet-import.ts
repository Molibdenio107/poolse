/**
 * The rules of a LENEX import, without a database — POOLSE-81.
 *
 * Kept pure so they are tested as rules: what a result is worth writing, how
 * an athlete in a file is matched to a student, and what the preview counts as
 * skipped. The repository reads the club's students and records, asks these, and
 * writes.
 */

export type Course = 'scm' | 'lcm';
export type Stroke = 'freestyle' | 'backstroke' | 'breaststroke' | 'butterfly' | 'medley';

/** One result as the web's parser hands it over. */
export interface IncomingResult {
  eventNumber: number;
  round: string;
  stroke: Stroke | null;
  distanceM: number;
  relayCount: number;
  course: Course | null;
  rawCourse: string;
  swumOn: string | null;
  timeMs: number | null;
  status: string;
}

export interface IncomingAthlete {
  key: string;
  clubCode: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  licence: string | null;
  results: IncomingResult[];
}

/** Why a result is not written. Each is counted on the preview. */
export type SkipReason = 'relay' | 'dsq' | 'dns' | 'dnf' | 'wdr' | 'otherStatus' | 'noTime' | 'yards' | 'stroke';

export const SKIP_REASONS: readonly SkipReason[] = [
  'relay',
  'dsq',
  'dns',
  'dnf',
  'wdr',
  'otherStatus',
  'noTime',
  'yards',
  'stroke',
];

/**
 * Whether a result is written, and if not why. Order matters only for the
 * count: a relay that was also disqualified is counted once, as a relay.
 */
export function skipReason(result: IncomingResult): SkipReason | null {
  if (result.relayCount > 1) return 'relay';
  switch (result.status) {
    case '':
    case 'OK':
      break;
    case 'DSQ':
      return 'dsq';
    case 'DNS':
      return 'dns';
    case 'DNF':
      return 'dnf';
    case 'WDR':
      return 'wdr';
    default:
      return 'otherStatus';
  }
  if (result.timeMs === null) return 'noTime';
  if (/Y$/.test(result.rawCourse) || /^(SCY|LCY)/.test(result.rawCourse)) return 'yards';
  if (result.stroke === null || result.distanceM <= 0 || result.distanceM > 10000) return 'stroke';
  return null;
}

/** Accent- and case-folded, spaces collapsed — the name half of the match key. */
export function foldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CandidateStudent {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  licence: string | null;
}

export type Match =
  | { kind: 'licence'; studentId: string }
  | { kind: 'proposed'; studentId: string }
  | { kind: 'none' };

/**
 * Licence first; else surname, first name and birth date all equal — a
 * proposal the operator confirms; else nobody. Two João Silvas at one meet is
 * ordinary, which is why the birth date is part of the key, and two students
 * who both fit is not a match either: a guess with a person's results in it.
 */
export function matchAthlete(athlete: IncomingAthlete, students: readonly CandidateStudent[]): Match {
  const licence = athlete.licence?.trim() ?? '';
  if (licence !== '') {
    const byLicence = students.find((student) => student.licence?.trim() === licence);
    if (byLicence !== undefined) return { kind: 'licence', studentId: byLicence.id };
  }

  if (athlete.birthDate === null) return { kind: 'none' };
  const first = foldName(athlete.firstName);
  const last = foldName(athlete.lastName);
  const candidates = students.filter(
    (student) =>
      student.birthDate === athlete.birthDate &&
      foldName(student.firstName) === first &&
      foldName(student.lastName) === last,
  );
  return candidates.length === 1 ? { kind: 'proposed', studentId: candidates[0]!.id } : { kind: 'none' };
}

/** The key a best is kept by: stroke, distance and course. */
export function bestKey(stroke: Stroke, distanceM: number, course: Course | null): string {
  return `${stroke}|${distanceM}|${course ?? ''}`;
}
