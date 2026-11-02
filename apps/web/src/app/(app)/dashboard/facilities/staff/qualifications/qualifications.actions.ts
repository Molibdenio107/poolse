'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiDelete, apiFetch, apiPatch, apiPost, apiPut, apiUpload, type Me, type QualificationTypes } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import { AI_ROLES, guardAiCall } from '@/lib/ai-guard';
import { aiReaderGate } from '@/lib/ai-meter';
import { MAX_FILE_BYTES } from '@/lib/files';
import { readCertificate, type CertificateDraft } from '@/lib/qualification-certificate-agent';
import type { FormState } from '../../../actions';

/**
 * Qualifications — POOLSE-27, 7b.2. Owner and admin; the API refuses anybody
 * else. A record is added or archived, never edited: a correction is archive and
 * add again, so the history of what was on file stays true.
 */

const LIST = '/dashboard/facilities/staff/qualifications';
const text = (formData: FormData, key: string): string => String(formData.get(key) ?? '').trim();
const optionalNumber = (formData: FormData, key: string): number | null | string => {
  const raw = text(formData, key);
  if (raw === '') return null;
  const n = Number(raw);
  // A non-number goes through as-is so the API names the field it refuses.
  return Number.isInteger(n) ? n : raw;
};

export async function addQualificationAction(
  organizationId: string,
  membershipId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const documentFileId = text(formData, 'documentFileId');
  let created: { id: string };
  try {
    created = await apiPost<{ id: string }>(
      `/staff/${membershipId}/qualifications`,
      {
        typeId: text(formData, 'typeId'),
        issuingBody: text(formData, 'issuingBody'),
        issuedOn: text(formData, 'issuedOn'),
        expiresOn: text(formData, 'expiresOn'),
      },
      { organizationId },
    );
  } catch (error) {
    return describeFailure(error, 'qualifications.error.saveFailed');
  }
  /*
   * A dropped certificate (POOLSE-149) goes on through the record's own attach
   * route, the one the upload below a record uses. Should that refuse, the
   * record stands without it and its row offers the upload as for any other.
   */
  if (documentFileId !== '') {
    try {
      await apiPut(`/qualifications/${created.id}/document`, { fileId: documentFileId }, { organizationId });
    } catch {
      revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
      revalidatePath(LIST);
      return { ok: true, toastKey: 'qualifications.certificate.savedWithout' };
    }
  }
  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  revalidatePath(LIST);
  return { ok: true };
}

/**
 * A certificate dropped on a person's *Qualificações* — POOLSE-149 slice D.
 * Filed first (the office's file until a record takes it), then, with the
 * reader switched on, read for its type, issuer and dates. What it reads only
 * fills the form; nothing is recorded until somebody presses *Guardar*.
 */
export interface CertificateState extends FormState {
  file?: { id: string; name: string; contentType: string };
  draft?: CertificateDraft;
  readNote?: 'off' | 'noKey' | 'capReached' | 'unreadable' | 'nothingFound' | 'notAllowed' | 'rateLimited';
}

export async function dropCertificateAction(_previous: CertificateState, formData: FormData): Promise<CertificateState> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, errorKey: 'files.chooseFile' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, errorKey: 'files.tooLarge' };
  const bytes = await file.arrayBuffer();
  let stored: { id: string; contentType: string };
  try {
    const query = new URLSearchParams({ purpose: 'qualification_document', name: file.name });
    stored = await apiUpload<{ id: string; contentType: string }>(`/files?${query.toString()}`, bytes);
  } catch (error) {
    return { ok: false, errorKey: error instanceof ApiError && error.status < 500 ? 'files.uploadFailed' : 'common.noAnswer' };
  }
  const filed = { ok: true, file: { id: stored.id, name: file.name, contentType: stored.contentType } } as const;

  const me = await apiFetch<Me>('/me').catch(() => null);
  const blocked = aiReaderGate('qualification_certificate', me);
  if (blocked !== null) return { ...filed, toastKey: 'qualifications.certificate.filed', readNote: blocked };
  const refused = await guardAiCall(AI_ROLES.qualificationCertificate);
  if (refused !== null) {
    return { ...filed, toastKey: 'qualifications.certificate.filed', readNote: refused === 'notAllowed' ? 'notAllowed' : 'rateLimited' };
  }
  const types = await apiFetch<QualificationTypes>('/qualification-types').catch(() => null);
  if (types === null || types.types.length === 0) {
    return { ...filed, toastKey: 'qualifications.certificate.filed', readNote: 'unreadable' };
  }
  const read = await readCertificate(Buffer.from(bytes), stored.contentType, types.types);
  if ('error' in read) return { ...filed, toastKey: 'qualifications.certificate.filed', readNote: read.error };
  return { ...filed, toastKey: 'qualifications.certificate.read', draft: read.draft };
}

export async function archiveQualificationAction(
  organizationId: string,
  membershipId: string,
  qualificationId: string,
): Promise<FormState> {
  try {
    await apiDelete(`/qualifications/${qualificationId}`, { organizationId });
  } catch (error) {
    return describeFailure(error, 'qualifications.error.archiveFailed');
  }
  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  revalidatePath(LIST);
  return { ok: true };
}

function typeBody(formData: FormData): Record<string, unknown> {
  return {
    name: text(formData, 'name'),
    defaultValidityMonths: optionalNumber(formData, 'defaultValidityMonths'),
    amberDays: optionalNumber(formData, 'amberDays'),
    requiredToTeach: formData.get('requiredToTeach') === 'on',
    blocksAssignment: formData.get('blocksAssignment') === 'on',
    // POOLSE-146: only when the form offered it — absent keeps the type's sport.
    ...(formData.has('sportId') ? { sportId: text(formData, 'sportId') } : {}),
  };
}

export async function saveTypeAction(
  organizationId: string,
  typeId: string | null,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    if (typeId === null) {
      await apiPost('/qualification-types', typeBody(formData), { organizationId });
    } else {
      await apiPatch(`/qualification-types/${typeId}`, typeBody(formData), { organizationId });
    }
  } catch (error) {
    return describeFailure(error, 'qualifications.error.saveFailed');
  }
  revalidatePath(LIST);
  return { ok: true };
}

export async function archiveTypeAction(organizationId: string, typeId: string): Promise<FormState> {
  try {
    await apiDelete(`/qualification-types/${typeId}`, { organizationId });
  } catch (error) {
    return describeFailure(error, 'qualifications.error.archiveFailed');
  }
  revalidatePath(LIST);
  return { ok: true };
}

export async function saveWindowAction(
  organizationId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await apiPut(
      '/qualification-settings',
      { amberDays: optionalNumber(formData, 'amberDays') },
      { organizationId },
    );
  } catch (error) {
    return describeFailure(error, 'qualifications.error.saveFailed');
  }
  revalidatePath(LIST);
  return { ok: true };
}
