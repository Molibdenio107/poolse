'use server';

import { revalidatePath } from 'next/cache';
import { apiPost } from '@/lib/api';
import { describeFailure, viewRefusal } from '@/lib/form-failure';
import type { FormState } from '@/app/(app)/dashboard/actions';

/** The teacher's side of a lesson on the phone — POOLSE-198. */

function refresh(sessionId: string): void {
  revalidatePath(`/app/aulas/${sessionId}`);
  revalidatePath('/app/aulas');
}

export async function requestCoverAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const sessionId = String(formData.get('sessionId') ?? '');
  try {
    await apiPost(`/sessions/${sessionId}/cover-request`, { note: String(formData.get('note') ?? '') });
  } catch (error) {
    return viewRefusal(error) ?? describeFailure(error, 'app.teaching.coverFailed');
  }
  refresh(sessionId);
  return { ok: true, toastKey: 'app.teaching.coverRequested' };
}

export async function withdrawCoverAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const sessionId = String(formData.get('sessionId') ?? '');
  try {
    await apiPost(`/sessions/${sessionId}/cover-request/withdraw`, {});
  } catch (error) {
    return viewRefusal(error) ?? describeFailure(error, 'app.teaching.coverFailed');
  }
  refresh(sessionId);
  return { ok: true, toastKey: 'app.teaching.coverWithdrawn' };
}

export async function cancelLessonAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const sessionId = String(formData.get('sessionId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '') return { ok: false, fields: { reason: 'app.teaching.reasonRequired' } };
  try {
    await apiPost(`/sessions/${sessionId}/cancel`, { reason, scope: 'occurrence' });
  } catch (error) {
    return viewRefusal(error) ?? describeFailure(error, 'calendar.cancelFailed');
  }
  refresh(sessionId);
  return { ok: true, toastKey: 'app.teaching.cancelled' };
}
