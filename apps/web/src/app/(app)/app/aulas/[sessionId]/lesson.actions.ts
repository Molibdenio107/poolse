'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost } from '@/lib/api';
import { addDays, today } from '@/lib/dates';
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

/**
 * A word to the class — POOLSE-199: the aviso first, because it reaches everybody
 * in the app, then the email. A failed email leaves the aviso standing and says so.
 */
export async function sendClassMessageAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const words = {
    audience: 'class_group',
    targetId: String(formData.get('classGroupId') ?? ''),
    subject: String(formData.get('subject') ?? ''),
    body: String(formData.get('body') ?? ''),
  };
  const day = today();
  try {
    await apiPost('/avisos', { ...words, shownFrom: day, shownUntil: addDays(day, 7) });
  } catch (error) {
    return viewRefusal(error) ?? describeFailure(error, 'app.teaching.messageFailed');
  }
  try {
    await apiPost('/messages', { ...words, commit: true });
  } catch (error) {
    // Nobody with an address is not a failure: the aviso reached them.
    if (!(error instanceof ApiError && error.code === 'no_recipients')) {
      return { ok: true, toastKey: 'app.teaching.messageAvisoOnly' };
    }
  }
  return { ok: true, toastKey: 'app.teaching.messageSent' };
}
