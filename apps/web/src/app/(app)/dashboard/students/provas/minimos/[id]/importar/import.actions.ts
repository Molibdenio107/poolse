'use server';

import { revalidatePath } from 'next/cache';
import { AI_ROLES, guardAiCall } from '@/lib/ai-guard';
import {
  ApiError,
  apiFetch,
  apiPost,
  type QualifyingImportCell,
  type QualifyingImportResult,
  type QualifyingStandard,
} from '@/lib/api';
import {
  BASE_FIELDS,
  cellsOf,
  groupField,
  groupOf,
  matchQualifyingColumns,
  type QualifyingMapping,
  type SheetAgeGroup,
} from '@/lib/qualifying-sheet';
import { readSheet, type ReadFailure } from '@/lib/read-sheet';
import type { MatchResult, NamedSheet, Sheet } from '@/lib/sheet';

/**
 * Importing a standard's entry times — POOLSE-85, slice 2.
 *
 * The partner importer's shape: the file is read here and never leaves the Next
 * server; what reaches the API is cells keyed by age group, for one pool
 * length. The columns are matched against the standard's own season's groups,
 * fetched here rather than trusted from the form.
 */

export interface ReadState {
  ok: boolean;
  sheets?: NamedSheet[];
  match?: MatchResult<string>;
  fileName?: string;
  errorKey?: string;
  attempt: number;
}

export interface MatchState {
  match?: MatchResult<string>;
  attempt: number;
}

/** A cell, plus the fields the shared wizard machine seeds its ticks from. */
export interface ImportPreviewCell extends QualifyingImportCell {
  index: number;
  importable: boolean;
  duplicate: string | null;
}

export interface RunState {
  ok: boolean;
  result?: { rows: ImportPreviewCell[]; created?: number; updated?: number };
  summary?: QualifyingImportResult['summary'];
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

async function groupsOf(standardId: string): Promise<SheetAgeGroup[] | null> {
  try {
    const standard = await apiFetch<QualifyingStandard>(`/qualifying/standards/${encodeURIComponent(standardId)}`);
    return standard.ageGroups.map(({ id, name, gender }) => ({ id, name, gender }));
  } catch {
    return null;
  }
}

export async function readSheetAction(previous: ReadState, formData: FormData): Promise<ReadState> {
  const attempt = previous.attempt + 1;
  // Before any file is read: a PDF goes to the model — `lib/ai-guard.ts`.
  const refused = await guardAiCall(AI_ROLES.qualifying);
  if (refused !== null) return { ok: false, errorKey: `import.ai.${refused}`, attempt };

  const groups = await groupsOf(String(formData.get('standardId') ?? ''));
  if (groups === null) return { ok: false, errorKey: 'qualifying.import.errorFailed', attempt };

  const upload = formData.get('file');
  const file = upload instanceof File ? upload : null;
  const outcome = await readSheet(file, { pdf: true });
  if ('error' in outcome) return { ok: false, errorKey: READ_ERRORS[outcome.error], attempt };

  const [first] = outcome.sheets;
  return {
    ok: true,
    sheets: outcome.sheets,
    ...(first === undefined ? {} : { match: matchQualifyingColumns(first, groups) }),
    fileName: file?.name ?? '',
    attempt,
  };
}

/** The matcher again, for a different sheet of the same workbook. */
export async function matchSheetAction(previous: MatchState, formData: FormData): Promise<MatchState> {
  const attempt = previous.attempt + 1;
  const groups = await groupsOf(String(formData.get('standardId') ?? ''));
  if (groups === null) return { attempt };
  try {
    const parsed = JSON.parse(String(formData.get('sheet') ?? '')) as { headers?: unknown; rows?: unknown };
    if (!Array.isArray(parsed.headers) || !Array.isArray(parsed.rows)) return { attempt };
    const sheet: Sheet = { headers: parsed.headers as string[], rows: parsed.rows as string[][] };
    return { match: matchQualifyingColumns(sheet, groups), attempt };
  } catch {
    return { attempt };
  }
}

/**
 * The mapping, rebuilt key by key: a hidden field is not trusted whole, and a key
 * that is neither a base field nor `group:<uuid>` is dropped.
 */
function readMapping(raw: unknown): QualifyingMapping {
  const mapping: QualifyingMapping = { event: null, distance: null, stroke: null };
  if (raw === null || typeof raw !== 'object') return mapping;
  for (const [field, at] of Object.entries(raw as Record<string, unknown>)) {
    const id = groupOf(field);
    const known = (BASE_FIELDS as readonly string[]).includes(field) || (id !== null && /^[0-9a-f-]{36}$/i.test(id));
    if (!known) continue;
    mapping[id === null ? field : groupField(id)] = typeof at === 'number' && Number.isInteger(at) && at >= 0 ? at : null;
  }
  return mapping;
}

/** Preview and commit, one action and one API path — `commit` is the only difference. */
export async function runImportAction(previous: RunState, formData: FormData): Promise<RunState> {
  const attempt = previous.attempt + 1;
  const standardId = String(formData.get('standardId') ?? '');
  let rows: string[][];
  let settings: Record<string, unknown>;
  try {
    rows = JSON.parse(String(formData.get('rows') ?? '[]')) as string[][];
    settings = JSON.parse(String(formData.get('settings') ?? '{}')) as Record<string, unknown>;
    if (!Array.isArray(rows)) throw new Error('rows');
  } catch {
    return { ok: false, errorKey: 'students.import.errorRequest', attempt };
  }
  const course = settings['course'] === 'scm' ? 'scm' : 'lcm';
  const commit = settings['commit'] === true;
  const mapping = readMapping(settings['mapping']);
  const cells = cellsOf({ headers: [], rows }, mapping);
  if (cells.length === 0) return { ok: false, errorKey: 'qualifying.import.nothing', attempt };

  try {
    const result = await apiPost<QualifyingImportResult>(
      `/qualifying/standards/${encodeURIComponent(standardId)}/times/import`,
      { course, commit, cells },
    );
    if (commit) revalidatePath(`/dashboard/students/provas/minimos/${standardId}`);
    return {
      ok: true,
      result: {
        rows: result.cells.map((cell, index) => ({
          ...cell,
          index,
          importable: cell.status === 'new' || cell.status === 'changed',
          duplicate: cell.status === 'unchanged' ? 'unchanged' : null,
        })),
        created: result.summary.new,
        updated: result.summary.changed,
      },
      summary: result.summary,
      committed: commit,
      attempt,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        errorKey: error.status === 403 ? 'qualifying.import.errorForbidden' : 'qualifying.import.errorFailed',
        ...(error.status >= 500 ? { detail: `${error.status} ${error.message}`.trim() } : {}),
        attempt,
      };
    }
    return { ok: false, errorKey: 'qualifying.import.errorFailed', detail: String(error), attempt };
  }
}
