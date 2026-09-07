'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost, type PartnerImportResult, type PartnerImportRowResult } from '@/lib/api';
import {
  applyPartnerMapping,
  EMPTY_PARTNER_MAPPING,
  matchPartnerColumns,
  PARTNER_FIELDS,
  type PartnerField,
  type PartnerMapping,
} from '@/lib/partner-sheet';
import type { MatchResult, NamedSheet, Sheet } from '@/lib/sheet';
import { readSheet, type ReadFailure } from '@/lib/read-sheet';

/**
 * The partnerships importer's three steps, as server actions — POOLSE-48.
 *
 * The inventory's `import.actions.ts` with the vocabulary changed, and the shape
 * is the same on purpose: **the file is read here and never leaves the Next
 * server.** What crosses to the API is a list of rows keyed by Poolse's own
 * field names — never the workbook, never the columns the club did not map. The
 * sheet then lives in the wizard's own state rather than in a server-side upload
 * session, so there is nothing to expire and nothing to clean up, and a preview
 * is still valid after somebody goes to ask the school how many children are
 * actually coming.
 *
 * **No match agent here either.** A partnerships sheet has three to five columns
 * with headings like "Escola", "Turma", "Alunos". `matchPartnerColumns` places
 * those without help, and sending a club's list of schools and coordinators to a
 * model to save a dropdown would be a metered call and a data-sharing question
 * for no gain — see the free-pilot rule in CLAUDE.md.
 */

export interface ReadState {
  ok: boolean;
  /** Every sheet in the workbook with data on it, hidden ones excluded. */
  sheets?: NamedSheet[];
  /** The matcher's verdict on the first sheet, so the wizard opens already decided. */
  match?: MatchResult<PartnerField>;
  fileName?: string;
  errorKey?: string;
  /** Increments on every submission, so two failures in a row still re-render. */
  attempt: number;
}

/**
 * A preview row, plus the one field the shared wizard machine asks for.
 *
 * `useImportWizard` seeds the tick boxes with everything importable that is not
 * already recorded, and it asks each importer to express "already recorded" in
 * its own terms through a field it calls `duplicate` — its docstring says the
 * field is deliberately `unknown` for exactly this reason. Here that is
 * `groupId`: a group the club already has carries one, a new one does not, and
 * `existing` is true in precisely the same cases.
 *
 * Aliased rather than recomputed, so the preview's default and the API's own
 * default — `include === null` means "create what is new, leave what exists
 * alone" — cannot drift apart.
 */
export interface PartnerPreviewRow extends PartnerImportRowResult {
  duplicate: string | null;
}

export interface ImportState {
  ok: boolean;
  result?: { rows: PartnerPreviewRow[]; created?: number; updated?: number };
  /** The tree and the counts, which the shared machine has no opinion about. */
  partners?: PartnerImportResult['partners'];
  summary?: PartnerImportResult['summary'];
  /** True when this state came back from a commit rather than a preview. */
  committed?: boolean;
  /** Partnerships created, as distinct from groups — only on a commit. */
  createdPartners?: number;
  errorKey?: string;
  detail?: string;
  attempt: number;
}

export interface MatchState {
  match?: MatchResult<PartnerField>;
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
 * The matcher, for a sheet the operator switched to.
 *
 * A separate action because switching tabs is the uncommon case: the first
 * sheet's answer already came back with the file, so most imports never call
 * this at all. QA 48.8 is the one that does — a workbook whose data is on the
 * third tab.
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
    return { match: matchPartnerColumns(sheet), attempt };
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
    ...(first === undefined ? {} : { match: matchPartnerColumns(first) }),
    fileName: file?.name ?? '',
    attempt,
  };
}

/**
 * What the wizard posts for steps two and three.
 *
 * `rows` is the whole spreadsheet and is written once; `settings` is small and
 * is rewritten on every tick. One field meant re-serialising the file while
 * somebody ticked a box.
 */
interface RunRequest {
  facilityId: string;
  rows: string[][];
  mapping: PartnerMapping;
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
    // a mapping with an unexpected key would reach `applyPartnerMapping` as an
    // index into a column that is not there.
    const mapping: PartnerMapping = { ...EMPTY_PARTNER_MAPPING };
    const sent = record['mapping'];
    if (sent !== null && typeof sent === 'object') {
      for (const field of PARTNER_FIELDS) {
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
    const result = await apiPost<PartnerImportResult>(
      `/facilities/${encodeURIComponent(request.facilityId)}/partners/import`,
      {
        rows: request.rows.map((row) => applyPartnerMapping(row, request.mapping)),
        commit: request.commit,
        include: request.commit ? request.include : null,
      },
    );

    if (request.commit) revalidatePath(`/dashboard/facilities/${request.facilityId}`);

    return {
      ok: true,
      result: {
        rows: result.rows.map((row) => ({ ...row, duplicate: row.groupId })),
        created: result.createdGroups ?? 0,
        updated: result.updatedGroups ?? 0,
      },
      partners: result.partners,
      summary: result.summary,
      committed: request.commit,
      createdPartners: result.createdPartners ?? 0,
      attempt,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        errorKey:
          error.status === 403 ? 'partnerImport.errorForbidden' : 'partnerImport.errorFailed',
        detail: error.status >= 500 ? `${error.status} ${error.message}`.trim() : error.message,
        attempt,
      };
    }
    return { ok: false, errorKey: 'partnerImport.errorFailed', detail: String(error), attempt };
  }
}
