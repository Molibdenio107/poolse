import { BadRequestException } from '@nestjs/common';
import { ORGANISMS, POOL_METRICS } from '@poolse/rules';
import { parseImportDate } from '../students/import.js';
import {
  momentKey,
  parseReading,
  parseReadingTime,
  sameName,
  type AnalysisProblem,
  type AnalysisWarning,
  type AnalysisImportSummary,
} from './analysis-import.js';
import type { LabParameter } from './lab-results.repository.js';

// `LAB_PARAMETERS`, built here rather than imported: the repository imports this
// file, and a value import back would be a cycle.
const LAB_PARAMETERS: readonly LabParameter[] = [...ORGANISMS, ...POOL_METRICS];

/**
 * A laboratory's report, imported as lab results — POOLSE-101.
 *
 * The twin of `analysis-import.ts`, for the other table. A report whose
 * parser found an organism count is a laboratory's analysis and lands in
 * `lab_result`, where it is graded under NP 4542 on every read; a report with
 * only pH and chlorine is the club's own reading and goes through the readings
 * import as before. The web app decides which rows come here
 * (`reportDestination` in `lib/analysis-report.ts`); this file only checks
 * them, with the same problem words the readings preview already speaks, so
 * one preview table can show both.
 *
 * **Pure.** The repository supplies the tank's name, the moments already on
 * file and the club's today; this decides what each row would become.
 */

export const MAX_LAB_IMPORT_ROWS = 200;

/** What a report row may carry: the tank, the moment, the lab's own labels, the values. */
const LAB_IMPORT_FIELDS = new Set<string>([
  'takenOn',
  'takenTime',
  'pool',
  'notes',
  'laboratory',
  'reportReference',
  ...LAB_PARAMETERS,
]);

export type LabImportProblem = AnalysisProblem | 'dateInFuture';

export interface LabImportRow {
  index: number;
  /** The row's position counted as the readings preview counts it: header is line 1. */
  line: number;
  takenOn: string;
  takenTime: string | null;
  notes: string | null;
  laboratory: string | null;
  reportReference: string | null;
  values: { parameter: LabParameter; value: number }[];
  /** The parameters that could not be read, so the message can name them. */
  badParameters: LabParameter[];
  problems: LabImportProblem[];
  warnings: AnalysisWarning[];
  importable: boolean;
}

export interface LabImportContext {
  poolName: string;
  /** Lab results already on file for the tank, as `YYYY-MM-DD HH:MM` and as `YYYY-MM-DD`. */
  existing: Set<string>;
  /** Now on the facility's clock, `YYYY-MM-DD HH:MM` — a sample cannot be taken after it. */
  now: string;
}

/**
 * A colony count as a laboratory writes one.
 *
 * Counts are whole numbers, so "<1" means exactly none, and so does a word of
 * absence ("Ausência", "não detetado"). Both are read as 0 — not a guess, the
 * same fact in another notation, and the one NP 4542's "0 means none allowed"
 * is written against. Any other "<N" is a detection limit above one colony and
 * says nothing exact about the count, so it is refused and the preview names it.
 */
export function parseOrganismCount(raw: string): number | null {
  const text = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (text === '') return null;
  if (/^<\s*1(?:[.,]0+)?$/.test(text)) return 0;
  if (/^(ausencia|ausente|absence|absent|nd|n\.d\.|nao detetado|nao detectado|not detected)$/.test(text)) {
    return 0;
  }
  const value = parseReading(text);
  return value === null || value < 0 ? null : value;
}

function readValue(parameter: LabParameter, raw: string): number | null {
  if ((ORGANISMS as readonly string[]).includes(parameter)) return parseOrganismCount(raw);
  const value = parseReading(raw);
  if (value === null || value < 0) return null;
  if (parameter === 'ph' && value > 14) return null;
  return value;
}

function text(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/** Every row, in file order — an earlier row's moment flags a later one, as in the readings import. */
export function checkLabRows(
  rows: Record<string, string>[],
  context: LabImportContext,
): { rows: LabImportRow[]; summary: AnalysisImportSummary } {
  const seen = new Set<string>();
  const checked: LabImportRow[] = rows.map((raw, index) => {
    const problems: LabImportProblem[] = [];
    const warnings: AnalysisWarning[] = [];
    const values: { parameter: LabParameter; value: number }[] = [];
    const badParameters: LabParameter[] = [];

    const named = (raw['pool'] ?? '').trim();
    if (named !== '' && !sameName(named, context.poolName)) problems.push('otherPool');

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

    // A row with no time is filed at midnight (see the repository), so that is
    // the moment compared — and refused here rather than by the write.
    if (takenOn !== '' && !problems.includes('timeInvalid') && `${takenOn} ${takenTime ?? '00:00'}` > context.now) {
      problems.push('dateInFuture');
    }

    for (const parameter of LAB_PARAMETERS) {
      const cell = (raw[parameter] ?? '').trim();
      if (cell === '') continue;
      const value = readValue(parameter, cell);
      if (value === null) badParameters.push(parameter);
      else values.push({ parameter, value });
    }

    if (badParameters.length > 0) problems.push('valueInvalid');
    if (values.length === 0 && !problems.includes('otherPool')) problems.push('noReadings');

    if (problems.length === 0) {
      const key = momentKey(takenOn, takenTime);
      if (seen.has(key)) warnings.push('duplicateInFile');
      else if (context.existing.has(key)) warnings.push('alreadyRecorded');
      seen.add(key);
    }

    return {
      index,
      line: index + 2,
      takenOn,
      takenTime,
      notes: text(raw['notes']),
      laboratory: text(raw['laboratory']),
      reportReference: text(raw['reportReference']),
      values,
      badParameters,
      problems,
      warnings,
      importable: problems.length === 0,
    };
  });

  return {
    rows: checked,
    summary: {
      total: checked.length,
      importable: checked.filter((row) => row.importable).length,
      refused: checked.filter((row) => !row.importable).length,
      duplicates: checked.filter((row) => row.importable && row.warnings.length > 0).length,
    },
  };
}

/** The body's rows, keeping only the fields a lab row may carry. */
export function readLabRows(raw: unknown): Record<string, string>[] {
  if (!Array.isArray(raw)) throw new BadRequestException('rows must be a list');
  if (raw.length === 0) throw new BadRequestException('rows is empty');
  if (raw.length > MAX_LAB_IMPORT_ROWS) {
    throw new BadRequestException(`at most ${MAX_LAB_IMPORT_ROWS} rows in one import`);
  }
  return raw.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new BadRequestException('each row must be an object of field to value');
    }
    const row: Record<string, string> = {};
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (!LAB_IMPORT_FIELDS.has(key) || value === null || value === undefined) continue;
      row[key] = typeof value === 'string' ? value : String(value);
    }
    return row;
  });
}

/** Row indexes, or null when the caller expressed no selection at all. */
export function readLabInclude(raw: unknown): number[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw new BadRequestException('include must be a list of row indexes');
  return raw.map((entry) => {
    const index = typeof entry === 'number' ? entry : Number(entry);
    if (!Number.isInteger(index) || index < 0 || index >= MAX_LAB_IMPORT_ROWS) {
      throw new BadRequestException('include must hold row indexes');
    }
    return index;
  });
}

