'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPatch } from '@/lib/api';
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
