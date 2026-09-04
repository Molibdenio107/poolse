'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost } from '@/lib/api';
import { readSheet, type ReadFailure } from '@/lib/read-sheet';
import { readTimetableGrid, type GridCandidate } from '@/lib/timetable-grid';
import type { NamedSheet } from '@/lib/sheet';

/**
 * The wall timetable, from a dropped file to a set of bookings — POOLSE-57.
 *
 * The same three-step shape as the register's and the inventory's importers,
 * and the same reason for it: **the file is read here and never leaves**. What
 * crosses to the API is a list of candidate bookings in Poolse's own words, and
 * the sheet then lives in the wizard's state rather than in a server-side upload
 * session. Nothing to expire, nothing to clean up, and a preview that is still
 * valid after somebody makes coffee.
 *
 * What differs from the other three is the middle step. There are no columns to
 * map — `Segunda` is a heading, `06:30` is a heading, and the thing between them
 * is a booking — so `readTimetableGrid` reads the *layout* and the operator
 * confirms what it found rather than pointing columns at fields.
 */

export interface ReadState {
  ok: boolean;
  /** Every sheet with data on it, so a workbook with a tab per tank can be picked. */
  sheets?: NamedSheet[];
  /** What the reader made of the first sheet, so the wizard opens already read. */
  reading?: {
    candidates: GridCandidate[];
    days: { column: number; weekday: number; heading: string }[];
    timeColumn: number | null;
    unplaced: { line: number; text: string }[];
  };
  fileName?: string;
  errorKey?: string;
  attempt: number;
}

const READ_ERRORS: Record<ReadFailure, string> = {
  fileMissing: 'students.import.errorFileMissing',
  fileTooLarge: 'students.import.errorFileTooLarge',
  fileType: 'students.import.errorFileType',
  fileEmpty: 'students.import.errorFileEmpty',
  fileUnreadable: 'students.import.errorFileUnreadable',
};

/** Step one: the file becomes a grid, already read into candidate bookings. */
export async function readTimetableAction(
  previous: ReadState,
  formData: FormData,
): Promise<ReadState> {
  const attempt = previous.attempt + 1;
  const upload = formData.get('file');
  const file = upload instanceof File ? upload : null;

  const outcome = await readSheet(file);
  if ('error' in outcome) {
    return { ok: false, errorKey: READ_ERRORS[outcome.error], attempt };
  }

  const [first] = outcome.sheets;

  return {
    ok: true,
    sheets: outcome.sheets,
    ...(first === undefined ? {} : { reading: readTimetableGrid(first) }),
    fileName: file?.name ?? '',
    attempt,
  };
}

/** The reader, for a sheet the operator switched to. */
export async function readOtherSheetAction(
  previous: ReadState,
  formData: FormData,
): Promise<ReadState> {
  const attempt = previous.attempt + 1;
  const raw = String(formData.get('sheet') ?? '');

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return { ok: false, attempt };

    const record = parsed as { headers?: unknown; rows?: unknown };
    if (!Array.isArray(record.headers) || !Array.isArray(record.rows)) {
      return { ok: false, attempt };
    }

    return {
      ok: true,
      reading: readTimetableGrid({
        headers: record.headers as string[],
        rows: record.rows as string[][],
      }),
      attempt,
    };
  } catch {
    return { ok: false, attempt };
  }
}

export interface TimetableClash {
  code: string;
  verdict: 'ok' | 'warn' | 'block';
  with: string | null;
  withLine: number | null;
  lane: string | null;
}

export interface TimetableRow {
  index: number;
  line: number;
  name: string;
  weekday: number;
  startMinutes: number;
  durationMinutes: number;
  laneIds: string[];
  laneNames: string[];
  instructorId: string | null;
  instructorName: string | null;
  headcount: number | null;
  problems: { code: string; value?: string }[];
  warnings: { code: string; value?: string }[];
  clashes: TimetableClash[];
  readable: boolean;
  importable: boolean;
}

export interface TimetableResult {
  rows: TimetableRow[];
  summary: {
    total: number;
    importable: number;
    refused: number;
    blocked: number;
    flagged: number;
  };
  committable: boolean;
  created?: number;
}

export interface ImportState {
  ok: boolean;
  result?: TimetableResult;
  /** True when this state came back from a commit rather than a preview. */
  committed?: boolean;
  errorKey?: string;
  attempt: number;
}

/**
 * Steps two and three: preview, then commit.
 *
 * One action for both, because they are one request with one boolean changed —
 * the same reason the API has one endpoint. A separate commit path would be a
 * second place the rows are turned into records, and applying them differently
 * is how an approved preview becomes a different set of writes.
 */
export async function runTimetableImportAction(
  previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const attempt = previous.attempt + 1;

  const facilityId = String(formData.get('facilityId') ?? '').trim();
  const rawRows = String(formData.get('rows') ?? '');
  const rawSettings = String(formData.get('settings') ?? '');
  if (facilityId === '' || rawRows.trim() === '') {
    return { ok: false, errorKey: 'students.import.errorRequest', attempt };
  }

  let rows: unknown;
  let settings: { commit?: boolean; drop?: number[] } = {};
  try {
    rows = JSON.parse(rawRows);
    if (rawSettings.trim() !== '') settings = JSON.parse(rawSettings) as typeof settings;
  } catch {
    return { ok: false, errorKey: 'students.import.errorRequest', attempt };
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, errorKey: 'students.import.errorFileEmpty', attempt };
  }

  try {
    const result = await apiPost<TimetableResult>(`/bookings/timetable-import/${facilityId}`, {
      rows,
      commit: settings.commit === true,
      drop: Array.isArray(settings.drop) ? settings.drop : [],
    });

    if (settings.commit === true) {
      revalidatePath('/dashboard/calendar');
      revalidatePath('/dashboard/classes');
      revalidatePath('/dashboard');
    }

    return { ok: true, result, committed: settings.commit === true, attempt };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, errorKey: 'grid.notAllowed', attempt };
    }
    if (error instanceof ApiError && error.status === 404) {
      return { ok: false, errorKey: 'timetableImport.noSeason', attempt };
    }
    return { ok: false, errorKey: 'timetableImport.failed', attempt };
  }
}
