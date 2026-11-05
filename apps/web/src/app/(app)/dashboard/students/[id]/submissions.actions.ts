'use server';

import { ApiError, apiPost } from '@/lib/api';
import type { FormState } from '../../actions';

const ID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RESULTS = ['fit', 'fit_with_conditions', 'unfit'];

/**
 * The office decides what a family sent — POOLSE-179 slice 2. Accepting files
 * it as the office files a copy; rejecting files nothing and shreds a sealed
 * file. The API holds both rules; this carries the answer.
 */
export async function decideSubmissionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get('studentId') ?? '');
  const submissionId = String(formData.get('submissionId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  if (!ID.test(studentId) || !ID.test(submissionId) || (decision !== 'accept' && decision !== 'reject')) {
    return { ok: false, errorKey: 'documents.submissions.failed' };
  }
  const body: Record<string, string | null> = {};
  if (decision === 'accept' && formData.has('result')) {
    const result = String(formData.get('result') ?? '');
    const validUntil = String(formData.get('validUntil') ?? '');
    if (!RESULTS.includes(result)) return { ok: false, errorKey: 'documents.submissions.needsResult' };
    body['result'] = result;
    body['validUntil'] = DAY.test(validUntil) ? validUntil : null;
  }
  try {
    await apiPost(`/students/${studentId}/documents/submissions/${submissionId}/${decision}`, body);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'needs_result') return { ok: false, errorKey: 'documents.submissions.needsResult' };
    if (error instanceof ApiError && error.status === 404) return { ok: false, errorKey: 'documents.submissions.gone' };
    return { ok: false, errorKey: 'documents.submissions.failed' };
  }
  // No revalidatePath: it would unmount this form before its toast. `useSavedAction` refreshes after it.
  return { ok: true, toastKey: decision === 'accept' ? 'documents.submissions.accepted' : 'documents.submissions.rejected' };
}
