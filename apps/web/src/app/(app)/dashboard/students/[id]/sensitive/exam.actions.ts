'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost, apiUpload } from '@/lib/api';
import { MAX_FILE_BYTES } from '@/lib/files';
import type { FormState } from '../../../actions';

/**
 * The exame médico's writes — POOLSE-133. Owner and admin; the API refuses
 * anybody else, and these only carry the refusal back in words.
 */

const ID = /^[0-9a-f-]{36}$/i;

function refusal(error: unknown, fallback: string): FormState {
  if (error instanceof ApiError) {
    if (Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
    if (error.status === 403) return { ok: false, errorKey: 'exams.notPermitted' };
    if (error.status < 500) return { ok: false, errorKey: fallback };
    return { ok: false, errorKey: fallback, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey: fallback, detail: String(error) };
}

export async function recordExamAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get('studentId') ?? '');
  if (!ID.test(studentId)) return { ok: false, errorKey: 'exams.failed' };

  const examinedOn = String(formData.get('examinedOn') ?? '').trim();
  const result = String(formData.get('result') ?? '').trim();
  const validUntil = String(formData.get('validUntil') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();

  // The obvious ones answered here, in the API's own words, without a round trip.
  const fields: Record<string, string> = {};
  if (examinedOn === '') fields['examinedOn'] = 'exams.error.required';
  if (result === '') fields['result'] = 'exams.error.result';
  if (examinedOn !== '' && validUntil !== '' && validUntil < examinedOn) {
    fields['validUntil'] = 'exams.error.order';
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };

  try {
    await apiPost(`/students/${studentId}/medical-exams`, {
      examinedOn,
      result,
      ...(validUntil === '' ? {} : { validUntil }),
      ...(note === '' ? {} : { note }),
    });
  } catch (error) {
    return refusal(error, 'exams.failed');
  }

  revalidatePath(`/dashboard/students/${studentId}/sensitive`);
  return { ok: true, toastKey: 'exams.saved' };
}

export async function archiveExamAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get('studentId') ?? '');
  const examId = String(formData.get('examId') ?? '');
  if (!ID.test(studentId) || !ID.test(examId)) return { ok: false, errorKey: 'exams.archiveFailed' };

  try {
    await apiPost(`/students/${studentId}/medical-exams/${examId}/archive`, {});
  } catch (error) {
    return refusal(error, 'exams.archiveFailed');
  }

  revalidatePath(`/dashboard/students/${studentId}/sensitive`);
  return { ok: true, toastKey: 'exams.archived' };
}

/** The API's file refusals, each with the sentence the other uploads use. */
const FILE_CODES: Record<string, string> = {
  storage_not_configured: 'files.notConfigured',
  file_type: 'files.wrongType',
  file_too_large: 'files.tooLarge',
  file_empty: 'files.chooseFile',
};

/**
 * The certificate: raw bytes to the exam's own route, sealed and attached in
 * one step — the atestado's shape (POOLSE-109), so no orphan health file is
 * ever left in the bucket.
 */
export async function attachExamCertificateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const studentId = String(formData.get('studentId') ?? '');
  const examId = String(formData.get('examId') ?? '');
  const file = formData.get('file');
  if (!ID.test(studentId) || !ID.test(examId)) return { ok: false, errorKey: 'files.uploadFailed' };
  if (!(file instanceof File) || file.size === 0) return { ok: false, errorKey: 'files.chooseFile' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, errorKey: 'files.tooLarge' };

  try {
    const query = new URLSearchParams({ name: file.name });
    await apiUpload(
      `/students/${studentId}/medical-exams/${examId}/certificate?${query.toString()}`,
      await file.arrayBuffer(),
    );
  } catch (error) {
    if (error instanceof ApiError) {
      const key = error.code === null ? undefined : FILE_CODES[error.code];
      if (key !== undefined) return { ok: false, errorKey: key };
      if (error.status === 403) return { ok: false, errorKey: 'files.notAllowed' };
    }
    return refusal(error, 'files.uploadFailed');
  }

  revalidatePath(`/dashboard/students/${studentId}/sensitive`);
  return { ok: true, toastKey: 'exams.certificateSaved' };
}
