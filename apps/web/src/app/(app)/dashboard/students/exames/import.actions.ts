'use server';

import { revalidatePath } from 'next/cache';
import { AI_ROLES, guardAiCall } from '@/lib/ai-guard';
import { ApiError, apiPost } from '@/lib/api';
import {
  applyExamMapping,
  carriesNoExam,
  EMPTY_EXAM_MAPPING,
  EXAM_FIELDS,
  matchExamColumns,
  type ExamField,
  type ExamMapping,
} from '@/lib/exam-sheet';
import type { ExamImportRowResult } from '@/lib/medical-exams';
import { readSheet, type ReadFailure } from '@/lib/read-sheet';
import type { MatchResult, NamedSheet, Sheet } from '@/lib/sheet';

/**
 * The exame médico importer's steps, as server actions — POOLSE-133.
 *
 * The salaries' `import.actions.ts` with the vocabulary changed: the file is
 * read here and never leaves the Next server, and what crosses to the API is
 * rows keyed by Poolse's own field names, dates already ISO and the result
 * already the enum. Preview and commit are one action with one flag, because
 * the API is one route with one flag.
 *
 * **What a tick means here.** The API writes every row it matched by NIF; the
 * only choice a person makes is to confirm a row it matched by name and birth
 * date. So the preview's tick boxes are exactly those rows, sent as `confirmed`.
 */

export interface ReadState {
  ok: boolean;
  sheets?: NamedSheet[];
  match?: MatchResult<ExamField>;
  fileName?: string;
  errorKey?: string;
  attempt: number;
}

export interface MatchState {
  match?: MatchResult<ExamField>;
  attempt: number;
}

/**
 * A preview row, plus what the shared wizard machine asks for. `importable` is
 * "a person may tick it" — only a row awaiting confirmation — and `duplicate`
 * is set on those too, so nothing is ticked for them by default.
 */
export interface ExamPreviewRow extends ExamImportRowResult {
  importable: boolean;
  duplicate: true | null;
  /** The sheet's own line, header counted, as a person reads it in Excel. */
  line: number;
  /** A line with no exam on it — the export's row for a student who has none. */
  blank: boolean;
}

export interface ImportState {
  ok: boolean;
  result?: { rows: ExamPreviewRow[]; created?: number; updated?: number };
  committed?: boolean;
  errorKey?: string;
  detail?: string;
  attempt: number;
}

const READ_ERRORS: Record<ReadFailure, string> = {
  fileMissing: 'students.import.errorFileMissing',
  fileTooLarge: 'students.import.errorFileTooLarge',
  fileType: 'students.import.errorFileType',
  fileEmpty: 'students.import.errorFileEmpty',
  fileUnreadable: 'students.import.errorFileUnreadable',
  pdfDisabled: 'import.pdfDisabled',
};

export async function matchSheetAction(previous: MatchState, formData: FormData): Promise<MatchState> {
  const attempt = previous.attempt + 1;
  try {
    const parsed: unknown = JSON.parse(String(formData.get('sheet') ?? ''));
    if (parsed === null || typeof parsed !== 'object') return { attempt };
    const record = parsed as { headers?: unknown; rows?: unknown };
    if (!Array.isArray(record.headers) || !Array.isArray(record.rows)) return { attempt };
    const sheet: Sheet = { headers: record.headers as string[], rows: record.rows as string[][] };
    return { match: matchExamColumns(sheet), attempt };
  } catch {
    return { attempt };
  }
}

export async function readSheetAction(previous: ReadState, formData: FormData): Promise<ReadState> {
  const attempt = previous.attempt + 1;
  // Before any file is read: a PDF goes to the model — `lib/ai-guard.ts`. The
  // register's roles, which are this importer's (owner and admin).
  const refused = await guardAiCall(AI_ROLES.students);
  if (refused !== null) return { ok: false, errorKey: `import.ai.${refused}`, attempt };
  const upload = formData.get('file');
  const file = upload instanceof File ? upload : null;

  const outcome = await readSheet(file, { pdf: true });
  if ('error' in outcome) return { ok: false, errorKey: READ_ERRORS[outcome.error], attempt };

  const [first] = outcome.sheets;
  return {
    ok: true,
    sheets: outcome.sheets,
    ...(first === undefined ? {} : { match: matchExamColumns(first) }),
    fileName: file?.name ?? '',
    attempt,
  };
}

interface RunRequest {
  rows: string[][];
  mapping: ExamMapping;
  commit: boolean;
  confirmed: number[];
}

function readRequest(formData: FormData): RunRequest | null {
  try {
    const sentRows: unknown = JSON.parse(String(formData.get('rows') ?? ''));
    const settings: unknown = JSON.parse(String(formData.get('settings') ?? ''));
    if (!Array.isArray(sentRows) || settings === null || typeof settings !== 'object') return null;
    const record = settings as Record<string, unknown>;

    // Rebuilt key by key rather than trusted whole: it is a hidden field.
    const mapping: ExamMapping = { ...EMPTY_EXAM_MAPPING };
    const sent = record['mapping'];
    if (sent !== null && typeof sent === 'object') {
      for (const field of EXAM_FIELDS) {
        const at = (sent as Record<string, unknown>)[field];
        mapping[field] = typeof at === 'number' && Number.isInteger(at) && at >= 0 ? at : null;
      }
    }

    return {
      rows: sentRows as string[][],
      mapping,
      commit: record['commit'] === true,
      confirmed: Array.isArray(record['confirmed'])
        ? record['confirmed'].filter((value): value is number => typeof value === 'number')
        : [],
    };
  } catch {
    return null;
  }
}

export async function runImportAction(previous: ImportState, formData: FormData): Promise<ImportState> {
  const attempt = previous.attempt + 1;
  const request = readRequest(formData);
  if (request === null) return { ok: false, errorKey: 'students.import.errorRequest', attempt };
  if (request.rows.length === 0) return { ok: false, errorKey: 'students.import.errorFileEmpty', attempt };

  const rows = request.rows.map((row) => applyExamMapping(row, request.mapping));

  try {
    const result = await apiPost<{ rows: ExamImportRowResult[]; written: number }>('/medical-exams/import', {
      rows,
      confirmed: request.confirmed,
      commit: request.commit,
    });

    if (request.commit) revalidatePath('/dashboard/students');

    return {
      ok: true,
      result: {
        rows: result.rows.map((row) => ({
          ...row,
          importable: row.status === 'needs_confirmation',
          duplicate: row.status === 'needs_confirmation' ? true : null,
          line: row.index + 2,
          blank: carriesNoExam(request.rows[row.index] ?? [], request.mapping),
        })),
        created: result.written,
        updated: 0,
      },
      committed: request.commit,
      attempt,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, errorKey: 'exams.notPermitted', attempt };
    }
    return {
      ok: false,
      errorKey: 'exams.import.failed',
      ...(error instanceof ApiError && error.status >= 500 ? { detail: `${error.status}` } : {}),
      attempt,
    };
  }
}
