'use server';

import { AI_ROLES, guardAiCall } from '@/lib/ai-guard';
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch, apiPost, apiPut, type FacilityDetail } from '@/lib/api';
import { readSheet, readFailureKey } from '@/lib/read-sheet';
import { readTimetableGrid, type GridCandidate } from '@/lib/timetable-grid';
import { readTimetableDocument, type TimetableMedia } from '@/lib/timetable-reader-agent';
import { fromGridReading, type TimetableReading } from '@/lib/timetable-reading';
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
  /**
   * The reading as rows of meaning (POOLSE-223): pools, spans, two activities per
   * cell, closed blocks. The mapping step works on this; `reading` keeps only
   * the days and leftovers the dialog lists.
   */
  meaning?: TimetableReading;
  fileName?: string;
  errorKey?: string;
  attempt: number;
  /**
   * For a switched sheet: the file read it came from — October 2026 sweep.
   * Without it, switching sheets on file A and then uploading file B went on
   * showing A's sheet, because the switched reading outranked the new file.
   */
  fromFile?: number;
}

/** Step one: the file becomes a grid, already read into candidate bookings. */
export async function readTimetableAction(
  previous: ReadState,
  formData: FormData,
): Promise<ReadState> {
  const attempt = previous.attempt + 1;
  // Before any file is read: a PDF goes to the model — `lib/ai-guard.ts`.
  const refused = await guardAiCall(AI_ROLES.timetable);
  if (refused !== null) return { ok: false, errorKey: `import.ai.${refused}`, attempt };
  const upload = formData.get('file');
  const file = upload instanceof File ? upload : null;

  /*
   * A PDF or a photo is read for its meaning by the timetable reader (POOLSE-223);
   * a spreadsheet keeps the grid reader and no model call, converted to the same rows.
   */
  const media = file === null ? null : timetableMedia(file.name);
  if (file !== null && media !== null) {
    if (file.size === 0) return { ok: false, errorKey: readFailureKey('fileMissing'), attempt };
    const read = await readTimetableDocument(await file.arrayBuffer(), media);
    if ('error' in read) {
      const failure =
        read.error === 'off'
          ? 'pdfDisabled'
          : read.error === 'noKey'
            ? 'pdfNoKey'
            : read.error === 'capReached'
              ? 'pdfCapReached'
              : read.error === 'nothingFound'
                ? 'fileEmpty'
                : (`ai.${read.error}` as const);
      return { ok: false, errorKey: readFailureKey(failure), attempt };
    }
    return { ok: true, meaning: read.reading, reading: bridge(read.reading), fileName: file.name, attempt };
  }

  const outcome = await readSheet(file, { pdf: true });
  if ('error' in outcome) {
    return { ok: false, errorKey: readFailureKey(outcome.error), attempt };
  }

  const [first] = outcome.sheets;
  const grid = first === undefined ? undefined : readTimetableGrid(first);

  return {
    ok: true,
    sheets: outcome.sheets,
    ...(grid === undefined ? {} : { reading: grid, meaning: fromGridReading(grid) }),
    fileName: file?.name ?? '',
    attempt,
  };
}

/** Which files the timetable reader takes, by name; a spreadsheet is null. */
function timetableMedia(name: string): TimetableMedia | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  return null;
}

/** The days a reading covers, in the shape today's dialog shows. */
const DAY_HEADINGS = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

/** The days a reading of meaning covers, for the dialog's "N dias" line. */
function bridge(meaning: TimetableReading): NonNullable<ReadState['reading']> {
  const weekdays = [...new Set(meaning.rows.map((row) => row.weekday))].sort((a, b) => a - b);
  return {
    candidates: [],
    days: weekdays.map((weekday) => ({ column: weekday, weekday, heading: DAY_HEADINGS[weekday] ?? '' })),
    timeColumn: 0,
    unplaced: [],
  };
}

/** The reader, for a sheet the operator switched to. */
export async function readOtherSheetAction(
  previous: ReadState,
  formData: FormData,
): Promise<ReadState> {
  const attempt = previous.attempt + 1;
  const raw = String(formData.get('sheet') ?? '');
  const fromFile = Number(formData.get('fileAttempt') ?? '0');
  // Said, not silent: a switch that could not be read used to change nothing.
  const refused: ReadState = {
    ok: false,
    attempt,
    fromFile,
    errorKey: 'students.import.errorFileUnreadable',
  };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return refused;

    const record = parsed as { headers?: unknown; rows?: unknown };
    if (!Array.isArray(record.headers) || !Array.isArray(record.rows)) {
      return refused;
    }

    const reading = readTimetableGrid({
      headers: record.headers as string[],
      rows: record.rows as string[][],
    });
    return { ok: true, reading, meaning: fromGridReading(reading), attempt, fromFile };
  } catch {
    return refused;
  }
}

export interface TimetableClash {
  code: string;
  verdict: 'ok' | 'warn' | 'block';
  with: string | null;
  withLine: number | null;
  lane: string | null;
  /** The rule's own figures — lane, holder, headcount, capacity, count, limit. */
  detail: Record<string, string | number>;
}

export interface TimetableRow {
  index: number;
  line: number;
  /** POOLSE-223/224: the row's pool, what it becomes, and its planned turma. */
  poolId: string | null;
  kind: 'turma' | 'evento' | 'free_swim';
  turmaKey: string | null;
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
  /** Days whose hours keep rows out — *Alargar o horário* (11-11-2026). */
  hoursNeeded?: TimetableHoursNeeded[];
  /** The turmas the turma rows become, new or existing (POOLSE-224). */
  turmas?: { key: string; name: string; poolId: string | null; existingId: string | null; slots: number[] }[];
  created?: number;
  turmasCreated?: number;
  /** Pools this import goes into that already have a calendar (12-11-2026); the commit waits for a choice. */
  existingCalendars?: PoolCalendar[];
  replacing?: boolean;
  importId?: string;
}

/** A pool's calendar this season, as the import found it (12-11-2026). */
export interface PoolCalendar {
  poolId: string;
  poolName: string;
  turmas: number;
  slots: number;
  /** Turmas with students: they stay unless ticked. */
  inUse: { id: string; name: string; students: number }[];
}

/** A confirmed import, for *Importações anteriores* (12-11-2026). */
export interface TimetableImportRecord {
  id: string;
  fileName: string | null;
  createdAt: string;
  createdByName: string | null;
  poolNames: string[];
  turmasCreated: number;
  slotsCreated: number;
  replaced: boolean;
  undone: boolean;
}

export async function listImportsAction(facilityId: string): Promise<TimetableImportRecord[] | null> {
  try {
    return await apiFetch<TimetableImportRecord[]>(`/bookings/timetable-imports/${encodeURIComponent(facilityId)}`);
  } catch {
    return null;
  }
}

export async function importInUseAction(importId: string): Promise<{ id: string; name: string; students: number }[] | null> {
  try {
    return await apiFetch(`/bookings/timetable-imports/${encodeURIComponent(importId)}/in-use`);
  } catch {
    return null;
  }
}

/** *Desfazer importação*: archive what it wrote; turmas with students only when ticked. */
export async function undoImportAction(
  importId: string,
  archiveTurmaIds: string[],
): Promise<{ ok: boolean; turmas?: number; slots?: number; errorKey?: string }> {
  try {
    const done = await apiPost<{ turmas: number; slots: number }>(
      `/bookings/timetable-imports/${encodeURIComponent(importId)}/undo`,
      { archiveTurmaIds },
    );
    revalidatePath('/dashboard/calendar');
    revalidatePath('/dashboard/classes');
    return { ok: true, turmas: done.turmas, slots: done.slots };
  } catch {
    return { ok: false, errorKey: 'timetableImport.history.undoFailed' };
  }
}

export interface TimetableHoursNeeded {
  weekday: number;
  current: { available: boolean; opens: string; closes: string } | null;
  needed: { opens: string; closes: string };
  rows: number;
}

/**
 * *Alargar o horário* (Rui, 11-11-2026): the site's week, with the days the file
 * needs opened and widened to what it needs, every other day as it was. The same
 * `PUT …/hours` the site's own form uses, so its rules (owner or admin, a closing
 * after the opening) apply unchanged.
 */
export async function extendHoursAction(
  facilityId: string,
  needed: TimetableHoursNeeded[],
): Promise<{ ok: boolean; errorKey?: string }> {
  try {
    const site = await apiFetch<FacilityDetail>(`/facilities/${encodeURIComponent(facilityId)}`);
    const days = [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
      const now = site.hours.find((day) => day.weekday === weekday);
      const want = needed.find((day) => day.weekday === weekday);
      if (want !== undefined) return { weekday, available: true, opensAt: want.needed.opens, closesAt: want.needed.closes };
      return now === undefined
        ? { weekday, available: false, opensAt: '00:00', closesAt: '24:00' }
        : { weekday, available: now.available, opensAt: now.opensAt.slice(0, 5), closesAt: now.closesAt.slice(0, 5) };
    });
    await apiPut(`/facilities/${encodeURIComponent(facilityId)}/hours`, { days });
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) return { ok: false, errorKey: 'facilities.hoursInvalid' };
    return { ok: false, errorKey: 'facilities.hoursSaveFailed' };
  }
  revalidatePath(`/dashboard/facilities/${facilityId}`);
  revalidatePath('/dashboard/calendar');
  return { ok: true };
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
  let settings: { commit?: boolean; drop?: number[]; replace?: { keepTurmaIds: string[] } | null; fileName?: string } = {};
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
      // The pool the file is for (02-11-2026): lane names match that pool only.
      poolId: String(formData.get('poolId') ?? '') || null,
      rows,
      commit: settings.commit === true,
      drop: Array.isArray(settings.drop) ? settings.drop : [],
      // Substituir o calendário atual (12-11-2026), and the file's name for the import's record.
      replace: settings.replace ?? null,
      fileName: settings.fileName ?? null,
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
