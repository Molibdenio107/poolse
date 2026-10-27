'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPut } from '@/lib/api';
import type { FormState } from '../../dashboard/actions';

/**
 * *Vou / Não vou* — POOLSE-90 slice 2. The API decides whose child, who
 * answers and whether the lesson still takes an answer; this says its answer in
 * a toast and refreshes the agenda and the lesson page.
 */
export async function saveNoticeAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const sessionId = String(formData.get('sessionId') ?? '');
  const studentId = String(formData.get('studentId') ?? '');
  const going = formData.get('going') === 'true';

  try {
    await apiPut(`/sessions/${sessionId}/notices/${studentId}`, { going });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 403) {
        return {
          ok: false,
          errorKey: error.code === 'notice_guardian_answers' ? 'app.notice.guardianAnswers' : 'app.notice.notAllowed',
        };
      }
      if (error.status === 409 && (error.code === 'notice_closed' || error.code === 'notice_not_offered')) {
        return { ok: false, errorKey: `app.notice.refused.${error.code}` };
      }
    }
    return { ok: false, errorKey: 'app.notice.failed' };
  }

  revalidatePath('/app/familia');
  revalidatePath(`/app/familia/aulas/${sessionId}`);
  return { ok: true, toastKey: going ? 'app.notice.savedGoing' : 'app.notice.savedNotGoing' };
}
