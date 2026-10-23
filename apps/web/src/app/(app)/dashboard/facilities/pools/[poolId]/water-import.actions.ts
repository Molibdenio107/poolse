'use server';

import { AI_ROLES, guardAiCall } from '@/lib/ai-guard';
import { revalidatePath } from 'next/cache';
import { apiPost } from '@/lib/api';
import { readSheet, type ReadFailure } from '@/lib/read-sheet';
import { reportMediaType, type ReportRow } from '@/lib/analysis-report';
import { analysisReportParser } from '@/lib/analysis-report-agent';
import { describeFailure } from '@/lib/form-failure';
import type { NamedSheet } from '@/lib/sheet';
import {
  mergeAnswers,
  splitByDestination,
  type ImportAnswer,
  type LabAnswerRow,
  type Part,
  type ReadingsAnswerRow,
  type WaterImportRow,
  type WaterImportSummary,
} from '@/lib/water-import-routing';
import type { FormState } from '../../../actions';

/**
 * A club's water log, from a dropped file to rows of readings — round 5, #5.
 *
 * The same three-step shape as the register's, the store room's and the wall
 * timetable's, and the same reason for it: **the file is read here and never
 * leaves**. What crosses to the API is a list of rows in Poolse's own field
 * names, and the sheet then lives in the wizard's state rather than in a
 * server-side upload session. Nothing to expire, nothing to clean up, and a
 * preview still valid after somebody makes coffee.
 *
 * **No model call.** The mapping is `matchWaterColumns`, which is a `MatchSpec`
 * like the other three — so an assisted matcher would slot in at that one call
 * rather than being threaded through the wizard. See `lib/water-sheet.ts`.
 */

export interface WaterReadState {
  ok: boolean;
  /** Every sheet with data on it, so a workbook with a tab per tank can be picked. */
  sheets?: NamedSheet[];
  /**
   * What a report extracted, already in field names — round 6, ticket 1.
   *
   * Present instead of `sheets` when the file was a PDF or a photograph. There
   * is no mapping step to run: the parser answers in the shape
   * `applyWaterMapping` would have produced, so the wizard goes straight to the
   * preview the spreadsheet path reaches two steps later.
   */
  report?: ReportRow[];
  /**
   * True when the file was a report and this build cannot read one.
   *
   * A state of its own rather than an `errorKey`, because it is not a failure —
   * the feature is switched off, which is a sentence rather than a red box.
   */
  reportDisabled?: boolean;
  fileName?: string;
  errorKey?: string;
  /** Increments on every attempt, so a repeated failure still re-announces itself. */
  attempt: number;
}

const READ_ERRORS: Record<ReadFailure, string> = {
  fileMissing: 'students.import.errorFileMissing',
  fileTooLarge: 'students.import.errorFileTooLarge',
  fileType: 'students.import.errorFileType',
  fileEmpty: 'students.import.errorFileEmpty',
  fileUnreadable: 'students.import.errorFileUnreadable',
  // The PDF reader is off — said, so a PDF is not mistaken for a broken file.
  pdfDisabled: 'import.pdfDisabled',
};

/**
 * Step one: the file becomes sheets, or becomes rows.
 *
 * **One action, two readers, decided by the file type** — round 6, ticket 1. A
 * spreadsheet goes to `readSheet` and then to a mapping step in the browser; a
 * PDF or a photograph goes to the import agent and arrives already in field
 * names. They converge immediately: both produce rows for the same
 * `runWaterImportAction`, which is the same validate-preview-commit the other
 * three importers use.
 *
 * Two entry points rather than two *pipelines*, which is the distinction
 * CLAUDE.md draws. What the operator is shown and what gets written still come
 * from one code path.
 */
export async function readWaterFileAction(
  previous: WaterReadState,
  formData: FormData,
): Promise<WaterReadState> {
  const attempt = previous.attempt + 1;
  // Before any file is read: a PDF goes to the model — `lib/ai-guard.ts`.
  const refused = await guardAiCall(AI_ROLES.water);
  if (refused !== null) return { ok: false, errorKey: `import.ai.${refused}`, attempt };

  // `FormData` hands back a string for a text field and a File for an upload;
  // narrowing rather than casting means a form that posts the wrong thing is a
  // "choose a file" message instead of a crash inside the reader.
  const upload = formData.get('file');
  const file = upload instanceof File ? upload : null;

  const mediaType = file === null ? null : reportMediaType(file.name);
  if (file !== null && mediaType !== null) {
    return readReport(file, mediaType, attempt);
  }

  const result = await readSheet(file);
  if ('error' in result) {
    return { ok: false, errorKey: READ_ERRORS[result.error], attempt };
  }

  // The reader returns sheets only; the name is the browser's, and it is worth
  // keeping so the wizard can say which file it is showing.
  return { ok: true, sheets: result.sheets, fileName: file?.name ?? '', attempt };
}

/**
 * A laboratory report, read by the import agent — round 6, ticket 1.
 *
 * The bytes are read here and go no further than the model call: nothing is
 * stored, which is the same rule the three spreadsheet importers follow and the
 * reason none of them has an upload session to expire.
 *
 * **The original file is not kept, and the ticket asked for it.** There is no
 * file storage in Poolse — it is a deliberately deferred decision, and the three
 * photo controls that wait on it are visibly disabled for the same reason. This
 * would be the fourth. When storage lands, this function is where the report is
 * written and where the analysis rows learn its id.
 */
async function readReport(
  file: File,
  mediaType: NonNullable<ReturnType<typeof reportMediaType>>,
  attempt: number,
): Promise<WaterReadState> {
  const parser = analysisReportParser();
  if (!parser.available()) {
    return { ok: false, reportDisabled: true, fileName: file.name, attempt };
  }

  const result = await parser.parse({
    name: file.name,
    mediaType,
    bytes: Buffer.from(await file.arrayBuffer()),
  });

  if ('error' in result) {
    return {
      ok: false,
      ...(result.error === 'disabled'
        ? { reportDisabled: true }
        : { errorKey: `facilities.waterImport.report.${result.error}` }),
      fileName: file.name,
      attempt,
    };
  }

  return { ok: true, report: result.rows, fileName: file.name, attempt };
}

export type { WaterImportRow, WaterImportSummary } from '@/lib/water-import-routing';

export interface WaterImportState extends FormState {
  rows?: WaterImportRow[];
  summary?: WaterImportSummary;
  /** Present only after a commit. */
  created?: number;
  skipped?: number;
  attempt: number;
}

/**
 * Steps two and three: check what the file says, then write it.
 *
 * One action with a `commit` flag rather than two, mirroring the API. What the
 * operator was shown and what gets written have to be produced by the same code
 * path, or the preview is a promise the commit does not keep.
 *
 * **Two tables behind it since POOLSE-101.** A row with an organism count is a
 * laboratory's and goes to `/lab-results/import`, graded under NP 4542; the
 * rest are readings and go to `/analyses/import`, as every row did before. The
 * split (`splitByDestination`) runs on preview and commit alike, so a row is
 * filed where the preview said it would be.
 */
export async function runWaterImportAction(
  previous: WaterImportState,
  formData: FormData,
): Promise<WaterImportState> {
  const attempt = previous.attempt + 1;
  const poolId = String(formData.get('poolId') ?? '');
  const commit = formData.get('commit') === 'true';

  let rows: Record<string, string>[];
  let include: number[] | null;
  try {
    rows = JSON.parse(String(formData.get('rows') ?? '[]')) as Record<string, string>[];
    const ticked = formData.get('include');
    include = ticked === null ? null : (JSON.parse(String(ticked)) as number[]);
  } catch {
    // The wizard builds both, so this is a bug rather than bad input — but a
    // thrown SyntaxError would reach the operator as a blank screen.
    return { ok: false, errorKey: 'facilities.waterImport.failed', attempt };
  }

  const parts = splitByDestination(rows, include);
  const send = <Row>(path: string, part: Part): Promise<ImportAnswer<Row> | null> =>
    part.rows.length === 0
      ? Promise.resolve(null)
      : apiPost<ImportAnswer<Row>>(`/facilities/pools/${poolId}/${path}`, {
          rows: part.rows,
          commit,
          ...(part.include === null ? {} : { include: part.include }),
        });

  let merged: ImportAnswer<WaterImportRow>;
  try {
    // Readings, then the laboratory: two endpoints, two transactions. A
    // report almost always holds one kind, so the pair rarely both run; when
    // they do and the second fails, the failure is said and the page is
    // revalidated below, so the readings that were written show at once.
    const readings = await send<ReadingsAnswerRow>('analyses/import', parts.readings);
    const lab = await send<LabAnswerRow>('lab-results/import', parts.lab);
    merged = mergeAnswers(
      readings === null ? null : { answer: readings, origin: parts.readings.origin },
      lab === null ? null : { answer: lab, origin: parts.lab.origin },
    );
  } catch (error) {
    if (commit) revalidatePath(`/dashboard/facilities/pools/${poolId}`);
    return { ...describeFailure(error, 'facilities.waterImport.failed'), attempt };
  }

  if (commit) {
    revalidatePath(`/dashboard/facilities/pools/${poolId}`);
  }

  return {
    ok: true,
    rows: merged.rows,
    summary: merged.summary,
    ...(merged.created === undefined ? {} : { created: merged.created }),
    ...(merged.skipped === undefined ? {} : { skipped: merged.skipped }),
    attempt,
  };
}

/*
 * **The matching is not here, and that is the one place this differs from its
 * three siblings.**
 *
 * The register's wizard asks the server to match its columns because the server
 * is where the optional model call lives — it holds the API key, and the shapes
 * it sends must not be assembled in a browser. The store room's copied that
 * shape without needing it.
 *
 * The water log has no model call by decision, and `matchWaterColumns` is pure:
 * no key, no fetch, no `server-only` in its import graph. Routing it through a
 * server action would be a network round trip to run a function the browser
 * already has. So the wizard calls it directly, and the extraction that follows
 * this ticket is where the three shapes get reconciled into one.
 */
