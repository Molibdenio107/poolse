'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiDelete, apiFetch, apiPatch, apiUpload, type Me } from '@/lib/api';
import { AI_ROLES, guardAiCall } from '@/lib/ai-guard';
import { idDocumentReaderBlocked, readIdDocument } from '@/lib/id-document-agent';
import { MAX_FILE_BYTES } from '@/lib/files';
import type { FormState } from '../../../actions';

/**
 * A staff member's date of birth and ID document — POOLSE-100. The API decides
 * who may, checks the CC number and keeps a login's own date of birth theirs;
 * this hands it the form and brings its field errors back beside their fields.
 */
export async function saveIdentityAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const membershipId = String(formData.get('membershipId') ?? '');
  const body: Record<string, string | null> = {
    idDocumentType: String(formData.get('idDocumentType') ?? '') || null,
    idDocumentNumber: String(formData.get('idDocumentNumber') ?? ''),
  };
  // Only sent when the form offered it: a login's date of birth is theirs.
  if (formData.get('birthDate') !== null) body['birthDate'] = String(formData.get('birthDate') ?? '');

  try {
    await apiPatch(`/staff/${membershipId}/identity`, body);
  } catch (error) {
    if (error instanceof ApiError && Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
    if (error instanceof ApiError && error.status === 403) return { ok: false, errorKey: 'staffIdentity.notAllowed' };
    return { ok: false, errorKey: 'staffIdentity.failed' };
  }
  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  return { ok: true };
}

/**
 * The ID document's photograph, one side — POOLSE-149 slice B. Sealed, filed
 * and attached by the staff record's own route in one step; then, for the front
 * and with the reader switched on, read for the type and number. What it reads
 * is only proposed: the card beside it is filled for a person to confirm.
 */
export interface StaffIdPhotoState extends FormState {
  proposal?: { type: 'cc' | 'passport' | 'residence_permit' | 'other' | null; number: string | null };
  /** Why nothing was proposed, when a read was attempted. */
  readNote?: 'off' | 'noKey' | 'capReached' | 'unreadable' | 'nothingFound' | 'notAllowed' | 'rateLimited';
}

export async function uploadStaffIdPhotoAction(_previous: StaffIdPhotoState, formData: FormData): Promise<StaffIdPhotoState> {
  const membershipId = String(formData.get('membershipId') ?? '');
  const side = String(formData.get('side') ?? '') === 'back' ? 'back' : 'front';
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, errorKey: 'files.chooseFile' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, errorKey: 'files.tooLarge' };
  const bytes = await file.arrayBuffer();
  try {
    const query = new URLSearchParams({ name: file.name });
    await apiUpload(`/staff/${membershipId}/identity/photo/${side}?${query.toString()}`, bytes);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return { ok: false, errorKey: 'staffIdentity.notAllowed' };
    return { ok: false, errorKey: error instanceof ApiError && error.status < 500 ? 'files.uploadFailed' : 'common.noAnswer' };
  }
  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  if (side === 'back') return { ok: true, toastKey: 'staffIdentity.photo.filed' };

  const me = await apiFetch<Me>('/me').catch(() => null);
  const blocked = me === null ? 'off' : idDocumentReaderBlocked(me);
  if (blocked !== null) return { ok: true, toastKey: 'staffIdentity.photo.filed', readNote: blocked };
  const refused = await guardAiCall(AI_ROLES.staffIdentity);
  if (refused !== null) {
    return { ok: true, toastKey: 'staffIdentity.photo.filed', readNote: refused === 'notAllowed' ? 'notAllowed' : 'rateLimited' };
  }
  const read = await readIdDocument(Buffer.from(bytes), file.type || 'image/jpeg');
  if ('error' in read) return { ok: true, toastKey: 'staffIdentity.photo.filed', readNote: read.error };
  // A Bilhete de Identidade is not one of the staff record's types: it is "other".
  const type = read.draft.type === 'bi' ? 'other' : read.draft.type;
  return { ok: true, toastKey: 'staffIdentity.photo.read', proposal: { type, number: read.draft.number } };
}

/** Takes a side's photograph off; the database shreds it. */
export async function removeStaffIdPhotoAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const membershipId = String(formData.get('membershipId') ?? '');
  const side = String(formData.get('side') ?? '') === 'back' ? 'back' : 'front';
  try {
    await apiDelete(`/staff/${membershipId}/identity/photo/${side}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return { ok: false, errorKey: 'staffIdentity.notAllowed' };
    return { ok: false, errorKey: 'staffIdentity.failed' };
  }
  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  return { ok: true, toastKey: 'staffIdentity.photo.removed' };
}
