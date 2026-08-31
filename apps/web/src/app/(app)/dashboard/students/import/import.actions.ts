'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost, type ImportResult } from '@/lib/api';
import {
  applyMapping,
  guessMapping,
  EMPTY_MAPPING,
  IMPORT_FIELDS,
  type Mapping,
  type Sheet,
} from '@/lib/sheet';
import { readSheet, type ReadFailure } from './read-sheet';

/**
 * Slice 1.10 — the three steps, as server actions.
 *
 * The file is read here and never leaves: what crosses to the API is a list of
 * rows keyed by field name. That keeps the API free of file formats, and it
 * keeps the Clerk token on the server, same as every other call in this app.
 *
 * The sheet then lives in the wizard's own state rather than in a server-side
 * upload session. Nothing to expire, nothing to clean up, and a preview that is
 * still valid after somebody makes coffee — at the cost of posting the rows
 * twice, which for a few hundred swimmers is nothing.
 */

export interface ReadState {
  ok: boolean;
  sheet?: Sheet;
  /** The wizard's opening guess, computed here so the client has it in one round trip. */
  mapping?: Mapping;
  fileName?: string;
  errorKey?: string;
  /** Increments on every submission, so two failures in a row still re-render. */
  attempt: number;
}

export interface ImportState {
  ok: boolean;
  result?: ImportResult;
  /** True when this state came back from a commit rather than a preview. */
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
};

/**
 * Step one: the file becomes a grid, and the columns get a first guess.
 *
 * The guess is made here rather than on the client so it arrives in the same
 * round trip as the sheet — the wizard renders a mapping step that is already
 * filled in, instead of one that fills itself in a moment later.
 */
export async function readSheetAction(
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

  return {
    ok: true,
    sheet: outcome.sheet,
    mapping: guessMapping(outcome.sheet.headers),
    fileName: file?.name ?? '',
    attempt,
  };
}

/**
 * What the wizard posts for steps two and three.
 *
 * Arrives as two hidden fields rather than one: `rows` is the whole spreadsheet
 * and is written once, `settings` is small and is rewritten on every keystroke.
 * One field meant re-serialising a club's entire register while somebody typed.
 */
interface RunRequest {
  rows: string[][];
  mapping: Mapping;
  defaultRelationship: string;
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

    // Two fields rather than one: the rows are the whole spreadsheet and never
    // change, the settings change on every keystroke. See `RequestFields`.
    const sentRows: unknown = JSON.parse(rawRows);
    const rows = Array.isArray(sentRows) ? (sentRows as string[][]) : null;
    if (rows === null) return null;

    // Rebuilt key by key rather than trusted whole: this is a hidden field, and
    // a mapping with an unexpected key would reach `applyMapping` as an index
    // into a column that is not there.
    const mapping: Mapping = { ...EMPTY_MAPPING };
    const sent = record['mapping'];
    if (sent !== null && typeof sent === 'object') {
      for (const field of IMPORT_FIELDS) {
        const at = (sent as Record<string, unknown>)[field];
        mapping[field] = typeof at === 'number' && Number.isInteger(at) && at >= 0 ? at : null;
      }
    }

    return {
      rows,
      mapping,
      defaultRelationship: String(record['defaultRelationship'] ?? '').trim(),
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
 * the same reason the API has one endpoint. A separate "commit" path would be a
 * second place for the mapping to be applied, and applying it differently is how
 * an approved preview turns into a different set of rows.
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

  try {
    const result = await apiPost<ImportResult>('/students/import', {
      rows: request.rows.map((row) => applyMapping(row, request.mapping)),
      commit: request.commit,
      include: request.commit ? request.include : null,
      defaultRelationship: request.defaultRelationship,
    });

    // The register gained rows; the list page is cached per request but the
    // navigation counts are not, and landing on a stale register after
    // importing two hundred students reads as the import having failed.
    if (request.commit) revalidatePath('/dashboard/students');

    return { ok: true, result, committed: request.commit, attempt };
  } catch (error) {
    if (error instanceof ApiError) {
      const key =
        error.status === 403
          ? 'students.import.errorForbidden'
          : 'students.import.errorFailed';
      return {
        ok: false,
        errorKey: key,
        detail: error.status >= 500 ? `${error.status} ${error.message}`.trim() : error.message,
        attempt,
      };
    }
    return { ok: false, errorKey: 'students.import.errorFailed', detail: String(error), attempt };
  }
}
