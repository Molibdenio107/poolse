'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPut } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import type { FormState } from '../../dashboard/actions';

/**
 * A family's feedback on one lesson — POOLSE-116. The API decides everything:
 * whose child, who answers, whether the lesson takes feedback. This turns its
 * answer into a toast or a field error, and refreshes the agenda's face.
 */
export async function saveFeedbackAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const sessionId = String(formData.get('sessionId') ?? '');
  const studentId = String(formData.get('studentId') ?? '');
  const mood = Number(formData.get('mood') ?? '');
  const comment = String(formData.get('comment') ?? '');

  if (!Number.isInteger(mood) || mood < 1 || mood > 5) {
    return { ok: false, fields: { mood: 'app.feedback.error.mood' } };
  }

  try {
    await apiPut(`/app/lessons/${sessionId}/feedback`, { studentId, mood, comment });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 400 && Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
      if (error.status === 403) return { ok: false, errorKey: 'app.feedback.guardianAnswers' };
      if (error.status === 409 && error.code !== null && error.code.startsWith('feedback_')) {
        const closesOn = (error.details as { closesOn?: unknown } | null)?.closesOn;
        return {
          ok: false,
          errorKey: `app.feedback.refused.${error.code}`,
          values: typeof closesOn === 'string' ? { date: formatDate(closesOn) } : {},
        };
      }
    }
    return { ok: false, errorKey: 'app.feedback.failed' };
  }

  revalidatePath('/app/familia');
  revalidatePath(`/app/familia/aulas/${sessionId}`);
  return { ok: true, toastKey: 'app.feedback.saved' };
}
