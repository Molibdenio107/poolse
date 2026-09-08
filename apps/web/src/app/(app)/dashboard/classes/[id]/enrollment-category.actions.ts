'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiDelete, apiPatch } from '@/lib/api';
import type { FormState } from '../../actions';

/**
 * Putting one person on a category, or returning them to their turma's.
 *
 * An empty choice is a **DELETE**, not a PATCH carrying a null. "Back to
 * whatever the turma says" is what clearing an override means, and the two verbs
 * keep that distinct from "on no category at all" — which is a different state
 * and is reached by taking the category off the turma instead.
 */
export async function setEnrollmentCategoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const enrollmentId = String(formData.get('enrollmentId') ?? '').trim();
  const categoryId = String(formData.get('categoryId') ?? '').trim();

  try {
    if (categoryId === '') {
      await apiDelete(`/enrollments/${enrollmentId}/fee-category`);
    } else {
      await apiPatch(`/enrollments/${enrollmentId}/fee-category`, { categoryId });
    }
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) {
      return { ok: false, errorKey: 'categories.saveFailed', detail: error.message };
    }
    return { ok: false, errorKey: 'categories.saveFailed' };
  }

  /*
   * The turma page, because that is where the roster is and the effective
   * category on every other row is unchanged but re-read anyway — the
   * precedence is resolved on the server and this is how the screen gets the
   * new answer rather than computing it.
   */
  revalidatePath('/dashboard/classes', 'layout');
  return { ok: true };
}
