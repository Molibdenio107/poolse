'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost } from '../../../../../../lib/api';
import type { FormState } from '../../../actions';

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    // The API's own code, where it sends one, beats a generic message: "that day
    // is already booked" and "a rejection needs a reason" want different words.
    if (error.code === 'day_already_booked') return { ok: false, errorKey: 'vacations.dayTaken' };
    if (error.code === 'sunday_not_allowed') return { ok: false, errorKey: 'vacations.noSundays' };
    if (error.code === 'already_decided') return { ok: false, errorKey: 'vacations.alreadyDecided' };
    if (error.code === 'note_required') return { ok: false, errorKey: 'vacations.noteRequired' };
    return { ok: false, errorKey, detail: error.message };
  }
  return { ok: false, errorKey, detail: String(error) };
}

/** Every screen the decision touches: my year, the queue, and the team map. */
function revalidateVacations(): void {
  revalidatePath('/dashboard/facilities/staff/vacations');
}

export async function requestVacationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  // The grid submits its selection as one comma-separated field, because a
  // FormData with 40 identically-named entries is harder to read in the log than
  // one string of dates.
  const days = String(formData.get('days') ?? '')
    .split(',')
    .map((day) => day.trim())
    .filter(Boolean);

  if (days.length === 0) return { ok: false, errorKey: 'vacations.pickADay' };

  try {
    await apiPost('/vacations/requests', { days }, { organizationId });
  } catch (error) {
    return failure(error, 'vacations.requestFailed');
  }

  revalidateVacations();
  return { ok: true };
}

export async function withdrawVacationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');

  try {
    await apiPost(`/vacations/requests/${requestId}/withdraw`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'vacations.withdrawFailed');
  }

  revalidateVacations();
  return { ok: true };
}

export async function decideVacationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const approve = formData.get('decision') === 'approve';
  const note = String(formData.get('note') ?? '').trim();

  // Checked here as well as by the API and the database. Story 7 is explicit,
  // and catching it before the round trip keeps the note the manager already
  // typed on the screen instead of losing it to a failed submit.
  if (!approve && note === '') return { ok: false, errorKey: 'vacations.noteRequired' };

  try {
    await apiPost(
      `/vacations/requests/${requestId}/${approve ? 'approve' : 'reject'}`,
      { note },
      { organizationId },
    );
  } catch (error) {
    return failure(error, approve ? 'vacations.approveFailed' : 'vacations.rejectFailed');
  }

  revalidateVacations();
  return { ok: true };
}
