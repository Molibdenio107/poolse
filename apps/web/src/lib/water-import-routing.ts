import { reportDestination, type ReportDestination } from './analysis-report.ts';

/**
 * One water import, two tables — POOLSE-101.
 *
 * A dropped file's rows are split by `reportDestination`: a laboratory's go to
 * `/lab-results/import`, the club's own to `/analyses/import`. Both endpoints
 * take the same `commit` flag from the same action, so what the preview showed
 * and what the commit writes still come from one path; this file only keeps
 * each row's place in the file across the split, and puts the two answers back
 * into one list that says where every row will land.
 *
 * Pure, so the bookkeeping — the part that would silently tick the wrong row —
 * is tested without a server.
 */

/** One row of the merged preview. */
export interface WaterImportRow {
  /** The row's position in the file — the handle the tick boxes send back. */
  index: number;
  line: number;
  destination: ReportDestination;
  takenOn: string;
  takenTime: string | null;
  notes: string | null;
  /** Every value, named by parameter — a pool metric or an organism. */
  values: { parameter: string; value: number }[];
  badParameters: string[];
  problems: string[];
  warnings: string[];
  importable: boolean;
}

export interface WaterImportSummary {
  total: number;
  importable: number;
  refused: number;
  duplicates: number;
}

/** A row as `/analyses/import` answers it. */
export interface ReadingsAnswerRow {
  index: number;
  takenOn: string;
  takenTime: string | null;
  notes: string | null;
  values: { metric: string; value: number }[];
  badMetrics: string[];
  problems: string[];
  warnings: string[];
  importable: boolean;
}

/** A row as `/lab-results/import` answers it. */
export interface LabAnswerRow {
  index: number;
  takenOn: string;
  takenTime: string | null;
  notes: string | null;
  values: { parameter: string; value: number }[];
  badParameters: string[];
  problems: string[];
  warnings: string[];
  importable: boolean;
}

export interface ImportAnswer<Row> {
  rows: Row[];
  summary: WaterImportSummary;
  created?: number;
  skipped?: number;
}

export interface Part {
  rows: Record<string, string>[];
  /** For each row sent, its index in the file. */
  origin: number[];
  /** The ticked rows, as this endpoint numbers them; null when nothing was chosen yet. */
  include: number[] | null;
}

export function splitByDestination(
  rows: Record<string, string>[],
  include: number[] | null,
): Record<ReportDestination, Part> {
  const ticked = include === null ? null : new Set(include);
  const parts: Record<ReportDestination, Part> = {
    readings: { rows: [], origin: [], include: include === null ? null : [] },
    lab: { rows: [], origin: [], include: include === null ? null : [] },
  };
  rows.forEach((row, index) => {
    const part = parts[reportDestination(row)];
    if (ticked !== null && ticked.has(index)) part.include!.push(part.rows.length);
    part.rows.push(row);
    part.origin.push(index);
  });
  return parts;
}

function sum(...counts: (number | undefined)[]): number | undefined {
  const present = counts.filter((count): count is number => count !== undefined);
  return present.length === 0 ? undefined : present.reduce((a, b) => a + b, 0);
}

/** The two answers as one list in file order, each row saying where it goes. */
export function mergeAnswers(
  readings: { answer: ImportAnswer<ReadingsAnswerRow>; origin: number[] } | null,
  lab: { answer: ImportAnswer<LabAnswerRow>; origin: number[] } | null,
): ImportAnswer<WaterImportRow> {
  const rows: WaterImportRow[] = [];
  for (const row of readings?.answer.rows ?? []) {
    const index = readings!.origin[row.index]!;
    rows.push({
      index,
      line: index + 2,
      destination: 'readings',
      takenOn: row.takenOn,
      takenTime: row.takenTime,
      notes: row.notes,
      values: row.values.map((value) => ({ parameter: value.metric, value: value.value })),
      badParameters: row.badMetrics,
      problems: row.problems,
      warnings: row.warnings,
      importable: row.importable,
    });
  }
  for (const row of lab?.answer.rows ?? []) {
    const index = lab!.origin[row.index]!;
    rows.push({
      index,
      line: index + 2,
      destination: 'lab',
      takenOn: row.takenOn,
      takenTime: row.takenTime,
      notes: row.notes,
      values: row.values,
      badParameters: row.badParameters,
      problems: row.problems,
      warnings: row.warnings,
      importable: row.importable,
    });
  }
  rows.sort((a, b) => a.index - b.index);

  const a = readings?.answer.summary;
  const b = lab?.answer.summary;
  const created = sum(readings?.answer.created, lab?.answer.created);
  const skipped = sum(readings?.answer.skipped, lab?.answer.skipped);
  return {
    rows,
    summary: {
      total: (a?.total ?? 0) + (b?.total ?? 0),
      importable: (a?.importable ?? 0) + (b?.importable ?? 0),
      refused: (a?.refused ?? 0) + (b?.refused ?? 0),
      duplicates: (a?.duplicates ?? 0) + (b?.duplicates ?? 0),
    },
    ...(created === undefined ? {} : { created }),
    ...(skipped === undefined ? {} : { skipped }),
  };
}
