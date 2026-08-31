'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost, type ImportResult } from '@/lib/api';
import { getTranslations } from 'next-intl/server';
import {
  applyMapping,
  describeColumns,
  matchColumns,
  EMPTY_MAPPING,
  IMPORT_FIELDS,
  type Mapping,
  type MatchResult,
  type NamedSheet,
  type Sheet,
} from '@/lib/sheet';
import { readSheet, type ReadFailure } from './read-sheet';
import { agentAvailable, matchWithAgent } from './match-agent';

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
  /**
   * Every sheet in the workbook that has data on it, hidden ones excluded.
   *
   * All of them, in one read, rather than re-uploading the file each time the
   * operator tries a different tab — the file object is gone the moment the
   * action returns, so a second read would mean a second choose-a-file dialog
   * for what is really a change of mind.
   */
  sheets?: NamedSheet[];
  /** The matcher's verdict on the first sheet, so the wizard opens already decided. */
  match?: MatchResult;
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
 * Which column is which — heuristic first, agent for whatever is left.
 *
 * The heuristic settles almost every real sheet on its own and costs nothing.
 * Only the columns it could not place are described to the model, and only when
 * a key is configured; with no key this is exactly the heuristic's answer.
 *
 * **Nothing the agent says can overwrite a heuristic match.** It is offered the
 * unclaimed columns and the unfilled fields, and its answers are merged into the
 * gaps — so a confident local match is never traded for a remote guess.
 */
export async function matchSheet(sheet: Sheet): Promise<MatchResult> {
  const base = matchColumns(sheet);
  if (base.unmatched.length === 0 || !agentAvailable()) return base;

  const unfilled = IMPORT_FIELDS.filter((field) => base.mapping[field] === null);
  if (unfilled.length === 0) return base;

  const t = await getTranslations();
  const shapes = describeColumns(sheet).filter((shape) => base.unmatched.includes(shape.index));

  const extra = await matchWithAgent({
    columns: shapes,
    // The label the operator would see, so the model is reasoning about the same
    // words the screen uses rather than about our internal field names.
    fields: unfilled.map((field) => ({
      field,
      label: t(`students.import.field.${field}`),
    })),
  });

  const mapping: Mapping = { ...base.mapping };
  const matches = [...base.matches];
  const claimed = new Set(base.unmatched.filter((index) => !base.unmatched.includes(index)));

  for (const match of extra) {
    if (mapping[match.field] !== null || claimed.has(match.column)) continue;
    mapping[match.field] = match.column;
    claimed.add(match.column);
    matches.push(match);
  }

  /* Same rule as the heuristic: both name halves means the whole-name column is
   * not read, so it must not be shown as though it were. */
  if (mapping.firstName !== null && mapping.fullName !== null) {
    const column = mapping.fullName;
    mapping.fullName = null;
    claimed.delete(column);
    const at = matches.findIndex((match) => match.field === 'fullName');
    if (at !== -1) matches.splice(at, 1);
  }

  const used = new Set(
    IMPORT_FIELDS.map((field) => mapping[field]).filter((at): at is number => at !== null),
  );

  return {
    mapping,
    matches,
    unmatched: base.unmatched.filter((index) => !used.has(index)),
  };
}

export interface MatchState {
  match?: MatchResult;
  attempt: number;
}

/**
 * The matcher, for a sheet the operator switched to.
 *
 * A separate action because switching tabs is the uncommon case: the first
 * sheet's answer already came back with the file, so most imports never call
 * this at all.
 */
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
    return { match: await matchSheet(sheet), attempt };
  } catch {
    return { attempt };
  }
}

/**
 * Step one: the file becomes one grid per sheet, already matched.
 *
 * The first sheet's columns are matched here rather than on the client so the
 * agent — which needs a server and a key — runs in the same round trip. A sheet
 * the operator switches to later goes through `matchSheetAction`.
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

  const [first] = outcome.sheets;

  return {
    ok: true,
    sheets: outcome.sheets,
    ...(first === undefined ? {} : { match: await matchSheet(first) }),
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
