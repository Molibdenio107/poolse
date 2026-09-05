import { parseImportDate } from '../students/import.js';
import { POOL_METRICS, type PoolMetric } from './analyses.repository.js';

/**
 * Reading a club's water log — round 5, ticket 5.
 *
 * Pure: no database, no clock, no tenant. The repository calls it with what it
 * has already fetched, which is what makes every rule below testable without a
 * fixture.
 *
 * **A row is one analysis, not one reading.** A club writes one line per visit
 * with a column per metric, and the database stores `pool_analysis` with a
 * `pool_analysis_value` per measurement. Turning the wide row into several
 * values is this file's job.
 *
 * **A bad reading is not a bad row.** Chlorine at 0.1 is exactly what a water
 * log exists to record, so an out-of-range value is a *warning* and imports.
 * Only a value that is not a number, or a date that is not a date, refuses a
 * row. Getting this backwards would make the importer silently drop the days
 * that matter most.
 */

export const MAX_ANALYSIS_IMPORT_ROWS = 5000;

/** One row as the mapping step produced it: field name to raw cell text. */
export type RawAnalysisRow = Record<string, string>;

export type AnalysisProblem =
  | 'dateMissing'
  | 'dateInvalid'
  | 'timeInvalid'
  | 'noReadings'
  | 'valueInvalid'
  | 'otherPool';

/**
 * Note what is *not* here: an out-of-range warning.
 *
 * The safe bands live in `apps/web/src/lib/water.ts`, which says why they are
 * the five a Portuguese municipal pool is inspected against and why the other
 * four get no invented band. Copying them here to flag a row would be a second
 * definition of "safe" that drifts from the one the pool page already draws,
 * and the API has nothing to add to the judgement. The preview marks an odd
 * reading from the values it gets back, using the bands it already owns.
 */
export type AnalysisWarning = 'duplicateInFile' | 'alreadyRecorded';

export interface AnalysisImportRow {
  /** 0-based position among the data rows — the client's stable handle. */
  index: number;
  /** The line in the spreadsheet, counting the header as line 1. */
  line: number;
  /** ISO date, or empty when the row has none. */
  takenOn: string;
  /** HH:MM, or null when the sheet carries no time. */
  takenTime: string | null;
  notes: string | null;
  values: { metric: PoolMetric; value: number }[];
  /** Which metrics could not be read, so the message can name them. */
  badMetrics: PoolMetric[];
  problems: AnalysisProblem[];
  warnings: AnalysisWarning[];
  importable: boolean;
}

export interface AnalysisImportSummary {
  total: number;
  importable: number;
  refused: number;
  /** Importable rows that repeat a moment already recorded, or an earlier row. */
  duplicates: number;
}

/**
 * A number as a club actually writes one.
 *
 * **The comma is the point.** pt-PT is the default locale and a Portuguese sheet
 * writes pH as `7,4`; `Number('7,4')` is `NaN`, so a parser that used it would
 * refuse every row of every Portuguese water log while accepting every English
 * one. That is the kind of bug that ships because the person testing it typed a
 * dot.
 *
 * A thousands separator is not accepted, deliberately. `1.234` is ambiguous —
 * 1234 in pt-PT, 1.234 in en — and salt is the one metric where both readings
 * are plausible. Refusing it asks a question; guessing would put a pool's
 * salinity out by a factor of a thousand.
 */
export function parseReading(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;

  // One separator, at most, and at least one digit either side of nothing.
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(text)) return null;

  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/** `HH:MM`, or `HH:MM:SS` as a spreadsheet often writes it. Null when absent. */
export function parseReadingTime(raw: string): { time: string } | { error: true } | null {
  const text = raw.trim();
  if (text === '') return null;

  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
  if (!match) return { error: true };

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return { error: true };

  return { time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` };
}

export interface AnalysisImportContext {
  /** The tank these readings belong to — the page they were uploaded from. */
  poolName: string;
  /** Moments already recorded for this tank, as `YYYY-MM-DD HH:MM`. */
  existing: Set<string>;
}

/** The key a moment is deduplicated on — date plus time, or date alone. */
export function momentKey(takenOn: string, takenTime: string | null): string {
  return takenTime === null ? takenOn : `${takenOn} ${takenTime}`;
}

/**
 * Validate every row, in file order.
 *
 * Order matters for one rule only: a row repeating a moment an *earlier row in
 * the same file* already used is flagged, which is how a club's copy-pasted
 * sheet gets caught before it writes two analyses for one visit.
 */
export function checkAnalysisRows(
  rows: RawAnalysisRow[],
  context: AnalysisImportContext,
): { rows: AnalysisImportRow[]; summary: AnalysisImportSummary } {
  const seen = new Set<string>();
  const checked: AnalysisImportRow[] = [];

  rows.forEach((raw, index) => {
    const problems: AnalysisProblem[] = [];
    const warnings: AnalysisWarning[] = [];
    const values: { metric: PoolMetric; value: number }[] = [];
    const badMetrics: PoolMetric[] = [];

    /*
     * A tank column naming somebody else's tank.
     *
     * A club exporting every tank into one sheet is ordinary, and importing all
     * of it into whichever tank the operator happened to open would be silent
     * and wrong. Compared without case or accents, because "Tanque Grande" and
     * "tanque grande" are the same tank.
     */
    const named = (raw['pool'] ?? '').trim();
    if (named !== '' && !sameName(named, context.poolName)) {
      problems.push('otherPool');
    }

    const rawDate = (raw['takenOn'] ?? '').trim();
    let takenOn = '';
    if (rawDate === '') {
      problems.push('dateMissing');
    } else {
      const parsed = parseImportDate(rawDate);
      if ('error' in parsed || parsed.date === '') problems.push('dateInvalid');
      else takenOn = parsed.date;
    }

    let takenTime: string | null = null;
    const time = parseReadingTime(raw['takenTime'] ?? '');
    if (time !== null) {
      if ('error' in time) problems.push('timeInvalid');
      else takenTime = time.time;
    }

    for (const metric of POOL_METRICS) {
      const cell = (raw[metric] ?? '').trim();
      if (cell === '') continue;

      const value = parseReading(cell);
      if (value === null) {
        badMetrics.push(metric);
        continue;
      }

      // Recorded whatever it says. A reading outside its band is the reason
      // the log exists; refusing it would lose the day the pool was unsafe.
      values.push({ metric, value });
    }

    if (badMetrics.length > 0) problems.push('valueInvalid');
    if (values.length === 0 && !problems.includes('otherPool')) problems.push('noReadings');

    if (problems.length === 0) {
      const key = momentKey(takenOn, takenTime);
      if (seen.has(key)) warnings.push('duplicateInFile');
      else if (context.existing.has(key)) warnings.push('alreadyRecorded');
      seen.add(key);
    }

    const notes = (raw['notes'] ?? '').trim();

    checked.push({
      index,
      // The header is line 1, so the first data row is line 2.
      line: index + 2,
      takenOn,
      takenTime,
      notes: notes === '' ? null : notes,
      values,
      badMetrics,
      problems,
      warnings,
      importable: problems.length === 0,
    });
  });

  return {
    rows: checked,
    summary: {
      total: checked.length,
      importable: checked.filter((row) => row.importable).length,
      refused: checked.filter((row) => !row.importable).length,
      duplicates: checked.filter(
        (row) =>
          row.importable &&
          (row.warnings.includes('duplicateInFile') || row.warnings.includes('alreadyRecorded')),
      ).length,
    },
  };
}

/** Case- and accent-insensitive, the same fold the search and the sort use. */
function sameName(left: string, right: string): boolean {
  return fold(left) === fold(right);
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
