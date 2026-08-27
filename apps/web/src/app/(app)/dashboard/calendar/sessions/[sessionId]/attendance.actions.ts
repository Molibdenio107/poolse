'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost } from '../../../../../../lib/api';
import type { FormState } from '../../../actions';

/**
 * Saves a whole register in one call — slice 1.8.
 *
 * The form submits every student at once, so one round trip marks the class.
 * A per-student save would be fifteen requests on poolside wifi, and a screen
 * somebody walks away from halfway leaves a class half-marked with no way to
 * tell whether the rest were absent or simply never reached.
 */
export async function recordAttendanceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const sessionId = String(formData.get('sessionId') ?? '');

  /*
   * Read out of the form by field name rather than from a JSON blob in a hidden
   * input, so the register still works with JavaScript disabled and degrades to
   * an ordinary form post.
   *
   * `status-<id>` empty means "not marked" and is sent as null, which the API
   * turns into a delete. Dropping it instead would make clearing a mistaken mark
   * impossible.
   */
  const marks: { studentId: string; status: string | null; note: string | null }[] = [];

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('status-')) continue;

    const studentId = key.slice('status-'.length);
    const status = String(value).trim();
    const note = String(formData.get(`note-${studentId}`) ?? '').trim();

    marks.push({
      studentId,
      status: status === '' ? null : status,
      note: note === '' ? null : note,
    });
  }

  if (marks.length === 0) return { ok: false, errorKey: 'attendance.nobodyToMark' };

  try {
    await apiPost(`/sessions/${sessionId}/attendance`, { marks }, { organizationId });
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, errorKey: 'attendance.saveFailed', detail: error.message };
    }
    return { ok: false, errorKey: 'attendance.saveFailed', detail: String(error) };
  }

  revalidatePath(`/dashboard/calendar/sessions/${sessionId}`);
  revalidatePath('/dashboard/calendar');
  return { ok: true };
}
