'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPatch, apiPost, apiUpload } from '@/lib/api';
import { AI_ROLES, guardAiCall } from '@/lib/ai-guard';
import { idDocumentReaderAvailable, readIdDocument } from '@/lib/id-document-agent';
import type { FormState } from '../../actions';

/**
 * *Documentos* on the student's record — POOLSE-132.
 *
 * Three saves, each one request: the identification document, the FPN
 * disciplines, and the club's Associação and Sigla FPN. The API decides who
 * may (owner and admin) and names the fields it refuses; these only carry the
 * request and hand those keys back to sit beside their fields.
 */

function refusal(error: unknown): FormState {
  if (error instanceof ApiError) {
    if (error.status === 400 && Object.keys(error.fields).length > 0) {
      return { ok: false, errorKey: 'common.checkTheFields', fields: error.fields };
    }
    if (error.status === 403) return { ok: false, errorKey: 'common.notAllowed' };
    if (error.status < 500) return { ok: false, errorKey: 'common.notSaved' };
    return { ok: false, errorKey: 'common.notSaved', detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey: 'common.noAnswer' };
}

const text = (formData: FormData, name: string): string => String(formData.get(name) ?? '').trim();

export async function saveIdDocumentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const studentId = text(formData, 'studentId');
  const number = text(formData, 'idDocumentNumber');
  try {
    await apiPatch(`/students/${studentId}/documents`, {
      idDocumentType: text(formData, 'idDocumentType'),
      // Left empty, the number on file stays: the screen never holds it.
      ...(number === '' ? {} : { idDocumentNumber: number }),
      idDocumentIssuedOn: text(formData, 'idDocumentIssuedOn'),
      idDocumentValidUntil: text(formData, 'idDocumentValidUntil'),
    });
  } catch (error) {
    return refusal(error);
  }
  revalidatePath(`/dashboard/students/${studentId}`);
  return { ok: true };
}

export async function saveDisciplinesAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const studentId = text(formData, 'studentId');
  try {
    await apiPatch(`/students/${studentId}/documents`, {
      disciplines: formData.getAll('discipline').map(String),
    });
  } catch (error) {
    return refusal(error);
  }
  revalidatePath(`/dashboard/students/${studentId}`);
  return { ok: true };
}

export async function saveFpnSettingsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const studentId = text(formData, 'studentId');
  try {
    await apiPatch('/fpn-settings', {
      association: text(formData, 'association'),
      clubCode: text(formData, 'clubCode'),
    });
  } catch (error) {
    return refusal(error);
  }
  revalidatePath(`/dashboard/students/${studentId}`);
  return { ok: true };
}

/**
 * The ID document's photograph — Rui, 30-10-2026. Filed on the student (a
 * `student_document` of kind `id_document`), then, when the reader is switched
 * on, read for its number and dates. What it reads is only proposed: the form
 * beside it is filled for a person to confirm and save.
 */
export interface IdPhotoState extends FormState {
  proposal?: { type: 'cc' | 'bi' | 'passport' | 'other' | null; number: string | null; issuedOn: string | null; validUntil: string | null };
  /** Why nothing was proposed, when a read was attempted. */
  readNote?: 'disabled' | 'unreadable' | 'nothingFound' | 'notAllowed' | 'rateLimited';
}

export async function uploadIdPhotoAction(_previous: IdPhotoState, formData: FormData): Promise<IdPhotoState> {
  const studentId = String(formData.get('studentId') ?? '');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, errorKey: 'files.uploadFailed' };
  const bytes = await file.arrayBuffer();
  try {
    const query = new URLSearchParams({ purpose: 'student_document', name: file.name });
    const stored = await apiUpload<{ id: string }>(`/files?${query.toString()}`, bytes);
    await apiPost(`/students/${studentId}/documents/copies`, { kind: 'id_document', seasonId: null, fileId: stored.id });
  } catch (error) {
    return { ok: false, errorKey: error instanceof ApiError && error.status < 500 ? 'files.uploadFailed' : 'common.noAnswer' };
  }
  revalidatePath(`/dashboard/students/${studentId}`);

  if (!idDocumentReaderAvailable()) return { ok: true, toastKey: 'documents.idPhoto.filed', readNote: 'disabled' };
  const refused = await guardAiCall(AI_ROLES.students);
  if (refused !== null) {
    return { ok: true, toastKey: 'documents.idPhoto.filed', readNote: refused === 'notAllowed' ? 'notAllowed' : 'rateLimited' };
  }
  const read = await readIdDocument(Buffer.from(bytes), file.type || 'image/jpeg');
  if ('error' in read) return { ok: true, toastKey: 'documents.idPhoto.filed', readNote: read.error };
  return { ok: true, toastKey: 'documents.idPhoto.read', proposal: read.draft };
}
