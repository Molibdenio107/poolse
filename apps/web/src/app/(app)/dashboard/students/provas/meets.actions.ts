'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiFileResponse, apiPost, type MeetImportPreview } from '@/lib/api';
import { LENEX_MAX_BYTES, LenexError, parseLenex, type LenexClub, type LenexFile } from '@poolse/rules/lenex';
import type { FormState } from '../../actions';

/**
 * Importing a meet's results — POOLSE-81.
 *
 * The file is read here, on the Next server, and never leaves it: the API gets
 * the parser's fields for the chosen club and nothing else. Each step sends the
 * file again rather than keeping a reading in a session — a results file is a
 * few MB, the parse is deterministic, and nothing lives between the steps that
 * could go stale.
 */

export type ReadMeetState =
  | { ok: false; errorKey: string }
  | {
      ok: true;
      fileName: string;
      meet: LenexFile['meet'];
      clubs: LenexClub[];
    };

/**
 * The file a step reads: one dropped or chosen on the page, or — POOLSE-114 —
 * one that arrived by email, fetched from the API by its inbox row on every
 * step exactly as a dropped file is sent again on every step. Either way it is
 * read here and never in the browser.
 */
async function sourceFile(formData: FormData): Promise<File | { errorKey: string } | null> {
  const inboxId = String(formData.get('inboxId') ?? '');
  if (inboxId === '') {
    const file = formData.get('file');
    return file instanceof File ? file : null;
  }
  if (!/^[0-9a-f-]{36}$/i.test(inboxId)) return { errorKey: 'meetInbox.error.gone' };
  const response = await apiFileResponse(`/meet-inbox/${inboxId}/file`);
  if (response.status === 403) return { errorKey: 'meets.notPermitted' };
  if (response.status === 404) return { errorKey: 'meetInbox.error.gone' };
  if (!response.ok) return { errorKey: 'meets.import.error.failed' };
  const disposition = response.headers.get('content-disposition') ?? '';
  const encoded = /filename="([^"]*)"/.exec(disposition)?.[1] ?? '';
  let name = 'resultados.lef';
  try {
    name = decodeURIComponent(encoded) || name;
  } catch {
    // An unreadable name is the default one; the bytes are what matter.
  }
  return new File([await response.arrayBuffer()], name);
}

async function read(formData: FormData): Promise<{ file: File; parsed: LenexFile } | { errorKey: string }> {
  const file = await sourceFile(formData);
  if (file !== null && !(file instanceof File)) return file;
  if (!(file instanceof File) || file.size === 0) return { errorKey: 'meets.import.error.noFile' };
  if (!/\.(lef|lxf)$/i.test(file.name)) return { errorKey: 'meets.import.error.type' };
  if (file.size > LENEX_MAX_BYTES) return { errorKey: 'meets.import.error.tooBig' };
  try {
    return { file, parsed: parseLenex(new Uint8Array(await file.arrayBuffer())) };
  } catch (error) {
    return { errorKey: error instanceof LenexError ? error.key : 'meets.import.error.notLenex' };
  }
}

/** Step one: what the file is, and which clubs it holds. */
export async function readMeetFileAction(formData: FormData): Promise<ReadMeetState> {
  const outcome = await read(formData);
  if ('errorKey' in outcome) return { ok: false, errorKey: outcome.errorKey };
  const { parsed, file } = outcome;
  if (parsed.meet.name === '' || parsed.meet.startsOn === null) {
    return { ok: false, errorKey: 'meets.import.error.noMeet' };
  }
  return { ok: true, fileName: file.name, meet: parsed.meet, clubs: parsed.clubs };
}

export type ImportMeetState =
  | { ok: false; errorKey: string }
  | { ok: true; preview: MeetImportPreview };

/**
 * Step two and three, one path: the preview, and — with `commit` — the write of
 * exactly what the preview showed, which is the API's rule as well.
 */
export async function importMeetAction(formData: FormData): Promise<ImportMeetState> {
  const outcome = await read(formData);
  if ('errorKey' in outcome) return { ok: false, errorKey: outcome.errorKey };
  const { parsed, file } = outcome;

  const organizationId = String(formData.get('organizationId') ?? '');
  const clubCode = String(formData.get('clubCode') ?? '');
  const commit = formData.get('commit') === 'true';
  const json = (field: string): Record<string, unknown> => {
    try {
      const value: unknown = JSON.parse(String(formData.get(field) ?? '{}'));
      return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  try {
    const preview = await apiPost<MeetImportPreview>(
      '/meets/import',
      {
        fileName: file.name,
        clubCode,
        official: formData.get('official') !== 'false',
        commit,
        meet: { ...parsed.meet, startsOn: parsed.meet.startsOn, endsOn: parsed.meet.endsOn },
        // Only this club's swimmers leave the server — the file holds every club at the meet.
        athletes: parsed.athletes.filter((athlete) => athlete.clubCode === clubCode),
        confirmed: json('confirmed'),
        writeLicence: json('writeLicence'),
        inboxId: String(formData.get('inboxId') ?? '') || undefined,
      },
      { organizationId },
    );
    if (commit) revalidatePath('/dashboard/students/provas', 'layout');
    return { ok: true, preview };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return { ok: false, errorKey: 'meets.notPermitted' };
    if (error instanceof ApiError && error.status === 404) return { ok: false, errorKey: 'meetInbox.error.gone' };
    return { ok: false, errorKey: 'meets.import.error.failed' };
  }
}

export async function archiveMeetAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const meetId = String(formData.get('meetId') ?? '');
  let archived: { archiveEntryId: string };
  try {
    archived = await apiPost<{ archiveEntryId: string }>(`/meets/${meetId}/archive`, {}, { organizationId });
  } catch {
    return { ok: false, errorKey: 'meets.archiveFailed' };
  }
  revalidatePath('/dashboard/students/provas');
  // Navigated by the client so the toast and its Anular are still raised — POOLSE-78.
  return {
    ok: true,
    undo: archived.archiveEntryId,
    toastKey: 'archive.archived.swim_meet',
    redirectTo: '/dashboard/students/provas',
  };
}

/** *Rejeitar* — owner and admin (POOLSE-114). The reason is optional. */
export async function discardInboxAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const inboxId = String(formData.get('inboxId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason.length > 500) return { ok: false, errorKey: 'meetInbox.error.reasonTooLong' };
  try {
    await apiPost(`/meet-inbox/${inboxId}/discard`, { reason }, { organizationId });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return { ok: false, errorKey: 'meets.notPermitted' };
    if (error instanceof ApiError && error.status === 404) return { ok: false, errorKey: 'meetInbox.error.gone' };
    return { ok: false, errorKey: 'meetInbox.error.discardFailed' };
  }
  revalidatePath('/dashboard/students/provas', 'layout');
  return { ok: true, toastKey: 'meetInbox.discarded' };
}

/** A new address — owner and admin. The old one stops at once. */
export async function regenerateInboxAddressAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  try {
    await apiPost('/meet-inbox/address', {}, { organizationId });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return { ok: false, errorKey: 'meets.notPermitted' };
    return { ok: false, errorKey: 'meetInbox.error.regenerateFailed' };
  }
  revalidatePath('/dashboard/students/provas', 'layout');
  return { ok: true, toastKey: 'meetInbox.regenerated' };
}
