'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost, type SalaryImportResult, type SalaryImportRowResult } from '@/lib/api';
import { parseSheetCents } from '@/lib/money';
import {
  applySalaryMapping,
  EMPTY_SALARY_MAPPING,
  matchSalaryColumns,
  SALARY_FIELDS,
  type SalaryField,
  type SalaryMapping,
} from '@/lib/salary-sheet';
import type { MatchResult, NamedSheet, Sheet } from '@/lib/sheet';
import { readSheet, type ReadFailure } from '@/lib/read-sheet';

/**
 * The salaries importer's three steps, as server actions — POOLSE-59.
 *
 * The partnerships' `partner-import.actions.ts` with the vocabulary changed, and
 * the shape is the same on purpose: **the file is read here and never leaves the
 * Next server.** What crosses to the API is a list of rows keyed by Poolse's own
 * field names — never the workbook, never the columns the club did not map. The
 * sheet then lives in the wizard's own state rather than in a server-side upload
 * session, so there is nothing to expire and nothing to clean up, and a preview
 * is still valid after somebody goes to check a figure with the accountant.
 *
 * **No match agent, and this one is not a close call.** A pay list is the most
 * sensitive file this product handles; sending a club's salaries to a model to
 * save somebody a dropdown would be a metered call, a data-sharing question and
 * a bad answer to all three. `matchSalaryColumns` places these columns without
 * help.
 *
 * **The amount becomes cents here.** `parseSheetCents` normalises what a
 * workbook carries and hands the result to `parseCents` — the same conversion
 * the typed form uses — so a file and a form cannot disagree about what
 * €1.234,56 is worth. The raw cell travels alongside it so a refusal can quote
 * back what was actually in the column.
 */

export interface ReadState {
  ok: boolean;
  sheets?: NamedSheet[];
  match?: MatchResult<SalaryField>;
  fileName?: string;
  errorKey?: string;
  /** Increments on every submission, so two failures in a row still re-render. */
  attempt: number;
}

/**
 * A preview row, plus the one field the shared wizard machine asks for.
 *
 * `useImportWizard` seeds the tick boxes with everything importable that is not
 * already recorded, and asks each importer to express "already recorded" in its
 * own terms through a field it calls `duplicate`. Here that is `unchanged`: a
 * row saying what the live rate already says has nothing to write.
 *
 * Aliased rather than recomputed, so the preview's default and the API's own
 * default — `include === null` means "everything importable" — cannot drift.
 */
export interface SalaryPreviewRow extends SalaryImportRowResult {
  duplicate: true | null;
}

export interface ImportState {
  ok: boolean;
  result?: { rows: SalaryPreviewRow[]; created?: number; updated?: number };
  summary?: SalaryImportResult['summary'];
  /** Set when the whole file is refused — the commit button stays shut. */
  refusal?: SalaryImportResult['refusal'];
  committed?: boolean;
  errorKey?: string;
  detail?: string;
  attempt: number;
}

export interface MatchState {
  match?: MatchResult<SalaryField>;
  attempt: number;
}

const READ_ERRORS: Record<ReadFailure, string> = {
  fileMissing: 'students.import.errorFileMissing',
  fileTooLarge: 'students.import.errorFileTooLarge',
  fileType: 'students.import.errorFileType',
  fileEmpty: 'students.import.errorFileEmpty',
  fileUnreadable: 'students.import.errorFileUnreadable',
};

/** The matcher, for a sheet the operator switched to. */
export async function matchSheetAction(
  previous: MatchState,
  formData: FormData,
): Promise<MatchState> {
  const attempt = previous.attempt + 1;
  const raw = String(formData.get('sheet') ?? '');

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return { attempt };

    const record = parsed as { headers?: unknown; rows?: unknown };
    if (!Array.isArray(record.headers) || !Array.isArray(record.rows)) return { attempt };

    const sheet: Sheet = {
      headers: record.headers as string[],
      rows: record.rows as string[][],
    };
    return { match: matchSalaryColumns(sheet), attempt };
  } catch {
    return { attempt };
  }
}

/** Step one: the file becomes one grid per sheet, already matched. */
export async function readSheetAction(previous: ReadState, formData: FormData): Promise<ReadState> {
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
    ...(first === undefined ? {} : { match: matchSalaryColumns(first) }),
    fileName: file?.name ?? '',
    attempt,
  };
}

interface RunRequest {
  rows: string[][];
  mapping: SalaryMapping;
  commit: boolean;
  /** Row indexes ticked on the preview. Only read on a commit. */
  include: number[];
}

function readRequest(formData: FormData): RunRequest | null {
  const rawRows = String(formData.get('rows') ?? '');
  const rawSettings = String(formData.get('settings') ?? '');
  if (rawRows.trim() === '' || rawSettings.trim() === '') return null;

  try {
    const parsed: unknown = JSON.parse(rawSettings);
    if (parsed === null || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;

    const sentRows: unknown = JSON.parse(rawRows);
    const rows = Array.isArray(sentRows) ? (sentRows as string[][]) : null;
    if (rows === null) return null;

    // Rebuilt key by key rather than trusted whole: this is a hidden field, and
    // a mapping with an unexpected key would reach `applySalaryMapping` as an
    // index into a column that is not there.
    const mapping: SalaryMapping = { ...EMPTY_SALARY_MAPPING };
    const sent = record['mapping'];
    if (sent !== null && typeof sent === 'object') {
      for (const field of SALARY_FIELDS) {
        const at = (sent as Record<string, unknown>)[field];
        mapping[field] = typeof at === 'number' && Number.isInteger(at) && at >= 0 ? at : null;
      }
    }

    return {
      rows,
      mapping,
      commit: record['commit'] === true,
      include: Array.isArray(record['include'])
        ? record['include'].filter((value): value is number => typeof value === 'number')
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * Steps two and three: preview, then commit.
 *
 * One action for both, because they are one request with one boolean changed —
 * the same reason the API has one endpoint. A separate commit path would be a
 * second place the mapping is applied, and applying it differently is how an
 * approved preview turns into a different set of writes.
 */
export async function runImportAction(
  previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const attempt = previous.attempt + 1;
  const request = readRequest(formData);

  if (request === null) return { ok: false, errorKey: 'students.import.errorRequest', attempt };
  if (request.rows.length === 0) {
    return { ok: false, errorKey: 'students.import.errorFileEmpty', attempt };
  }

  const rows = request.rows.map((row) => {
    const mapped = applySalaryMapping(row, request.mapping);
    const amount = mapped['amount'] ?? '';
    return { ...mapped, amount, amountCents: amount === '' ? null : parseSheetCents(amount) };
  });

  try {
    const result = await apiPost<SalaryImportResult>('/staff/salaries/import', {
      rows,
      commit: request.commit,
      include: request.commit ? request.include : null,
    });

    if (request.commit && result.committed) {
      revalidatePath('/dashboard/facilities/staff/salaries');
    }

    return {
      ok: true,
      result: {
        rows: result.rows.map((row) => ({ ...row, duplicate: row.unchanged ? true : null })),
        // "Created" is the only count this importer has: every write is a new
        // effective-dated rate, and nothing is ever updated in place.
        created: result.written,
        updated: 0,
      },
      summary: result.summary,
      refusal: result.refusal,
      committed: result.committed,
      attempt,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, errorKey: 'salaries.notPermitted', attempt };
    }
    if (error instanceof ApiError && error.status === 409) {
      /*
       * A row the constraint refused at the last moment — somebody saved a rate
       * between the preview and the commit. Nothing was written: the whole file
       * rolled back, and the line is named so the operator knows which row to
       * look at rather than which half of the club was paid.
       */
      const detail = error.details as { line?: number } | null;
      return {
        ok: false,
        errorKey: 'salaries.import.refusedAtCommit',
        ...(typeof detail?.line === 'number' ? { detail: `#${detail.line}` } : {}),
        attempt,
      };
    }
    return { ok: false, errorKey: 'salaries.import.failed', attempt };
  }
}
