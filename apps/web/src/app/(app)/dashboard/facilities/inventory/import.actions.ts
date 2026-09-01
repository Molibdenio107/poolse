'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost, type InventoryImportResult } from '@/lib/api';
import {
  applyInventoryMapping,
  EMPTY_INVENTORY_MAPPING,
  INVENTORY_FIELDS,
  matchInventoryColumns,
  type InventoryMapping,
} from '@/lib/inventory-sheet';
import type { MatchResult, NamedSheet, Sheet } from '@/lib/sheet';
import { readSheet, type ReadFailure } from '@/lib/read-sheet';
import type { InventoryField } from '@/lib/inventory-sheet';

/**
 * The inventory importer's three steps, as server actions — round 6.
 *
 * The register's `import.actions.ts` with the vocabulary changed, and the shape
 * is the same on purpose: the file is read here and never leaves, what crosses
 * to the API is a list of rows keyed by field name, and the sheet then lives in
 * the wizard's own state rather than in a server-side upload session. Nothing to
 * expire, nothing to clean up, and a preview that is still valid after somebody
 * makes coffee — at the cost of posting the rows twice, which for a store room
 * is nothing.
 *
 * **No match agent here.** The register's importer asks a model about columns
 * the heuristic could not place, because a club register has twenty columns with
 * unguessable headings. A kit list has four or five, and their headings are
 * "Material", "Qtd", "Obs". Sending a store room to an API to save a dropdown
 * would be cost and a data-sharing question for no gain.
 */

export interface ReadState {
  ok: boolean;
  /** Every sheet in the workbook with data on it, hidden ones excluded. */
  sheets?: NamedSheet[];
  /** The matcher's verdict on the first sheet, so the wizard opens already decided. */
  match?: MatchResult<InventoryField>;
  fileName?: string;
  errorKey?: string;
  /** Increments on every submission, so two failures in a row still re-render. */
  attempt: number;
}

export interface ImportState {
  ok: boolean;
  result?: InventoryImportResult;
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

export interface MatchState {
  match?: MatchResult<InventoryField>;
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
    return { match: matchInventoryColumns(sheet), attempt };
  } catch {
    return { attempt };
  }
}

/** Step one: the file becomes one grid per sheet, already matched. */
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
    ...(first === undefined ? {} : { match: matchInventoryColumns(first) }),
    fileName: file?.name ?? '',
    attempt,
  };
}

/**
 * What the wizard posts for steps two and three.
 *
 * `rows` is the whole spreadsheet and is written once; `settings` is small and
 * is rewritten on every keystroke. One field meant re-serialising the file while
 * somebody ticked a box.
 */
interface RunRequest {
  facilityId: string;
  rows: string[][];
  mapping: InventoryMapping;
  commit: boolean;
  /** Row indexes ticked on the preview. Only read on a commit. */
  include: number[];
}

function readRequest(formData: FormData): RunRequest | null {
  const rawRows = String(formData.get('rows') ?? '');
  const rawSettings = String(formData.get('settings') ?? '');
  const facilityId = String(formData.get('facilityId') ?? '').trim();
  if (rawRows.trim() === '' || rawSettings.trim() === '' || facilityId === '') return null;

  try {
    const parsed: unknown = JSON.parse(rawSettings);
    if (parsed === null || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;

    const sentRows: unknown = JSON.parse(rawRows);
    const rows = Array.isArray(sentRows) ? (sentRows as string[][]) : null;
    if (rows === null) return null;

    // Rebuilt key by key rather than trusted whole: this is a hidden field, and
    // a mapping with an unexpected key would reach `applyInventoryMapping` as an
    // index into a column that is not there.
    const mapping: InventoryMapping = { ...EMPTY_INVENTORY_MAPPING };
    const sent = record['mapping'];
    if (sent !== null && typeof sent === 'object') {
      for (const field of INVENTORY_FIELDS) {
        const at = (sent as Record<string, unknown>)[field];
        mapping[field] = typeof at === 'number' && Number.isInteger(at) && at >= 0 ? at : null;
      }
    }

    return {
      facilityId,
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
    const result = await apiPost<InventoryImportResult>('/inventory/import', {
      facilityId: request.facilityId,
      rows: request.rows.map((row) => applyInventoryMapping(row, request.mapping)),
      commit: request.commit,
      include: request.commit ? request.include : null,
    });

    if (request.commit) revalidatePath('/dashboard/facilities/inventory');

    return { ok: true, result, committed: request.commit, attempt };
  } catch (error) {
    if (error instanceof ApiError) {
      const key =
        error.status === 403 ? 'inventory.import.errorForbidden' : 'inventory.import.errorFailed';
      return {
        ok: false,
        errorKey: key,
        detail: error.status >= 500 ? `${error.status} ${error.message}`.trim() : error.message,
        attempt,
      };
    }
    return { ok: false, errorKey: 'inventory.import.errorFailed', detail: String(error), attempt };
  }
}
