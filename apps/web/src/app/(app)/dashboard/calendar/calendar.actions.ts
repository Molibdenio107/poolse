'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost } from '../../../../lib/api';
import type { FormState } from '../actions';

export interface GenerateState extends FormState {
  /** What the run actually did, so the button can say more than "done". */
  result?: { holidaysAdded: number; created: number; cancelled: number; restored: number };
}

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    if (error.status < 500) return { ok: false, errorKey, detail: error.message };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

/**
 * Everything the calendar touches, revalidated together.
 *
 * The student pages are in the list because a cancelled class disappears from a
 * student's own week too — and a screen that still shows a class that was called
 * off an hour ago is the exact failure this slice exists to prevent.
 */
function revalidateCalendar(): void {
  revalidatePath('/dashboard/calendar');
  revalidatePath('/dashboard/calendar/closures');
  revalidatePath('/dashboard/classes');
  revalidatePath('/dashboard/students', 'layout');
}

export async function generateSeasonAction(
  _previous: GenerateState,
  formData: FormData,
): Promise<GenerateState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const from = String(formData.get('from') ?? '').trim();
  const to = String(formData.get('to') ?? '').trim();

  let result: GenerateState['result'];
  try {
    result = await apiPost<NonNullable<GenerateState['result']>>(
      '/calendar/generate',
      { from, to },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'calendar.generateFailed');
  }

  revalidateCalendar();
  return { ok: true, result };
}

export async function createClosureAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const startsOn = String(formData.get('startsOn') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  if (!startsOn) return { ok: false, errorKey: 'calendar.startRequired' };
  if (!reason) return { ok: false, errorKey: 'calendar.reasonRequired' };

  // An empty end means a single day. Making the operator type the same date
  // twice to close the pool for one afternoon is a form arguing with its user.
  const endsOn = String(formData.get('endsOn') ?? '').trim() || startsOn;
  if (endsOn < startsOn) return { ok: false, errorKey: 'calendar.endBeforeStart' };

  try {
    await apiPost(
      '/closures',
      {
        startsOn,
        endsOn,
        reason,
        poolId: String(formData.get('poolId') ?? '').trim(),
        blocksGeneration: formData.get('blocksGeneration') !== 'note',
        repeatsAnnually: formData.get('repeatsAnnually') === 'on',
      },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'calendar.closureFailed');
  }

  revalidateCalendar();
  return { ok: true };
}

export async function removeClosureAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const closureId = String(formData.get('closureId') ?? '');

  try {
    await apiPost(`/closures/${closureId}/archive`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'calendar.closureRemoveFailed');
  }

  revalidateCalendar();
  return { ok: true };
}

/**
 * Cancels one class. There is no restore path here any more — backlog round 3,
 * story 5.
 *
 * `revalidateCalendar` is what makes "updates immediately, with no manual
 * refresh" true: revalidating inside a server action re-renders the current
 * route on the client, so the slot is struck through by the time the button
 * stops spinning. The student pages go with it, because the same class has just
 * disappeared from somebody's own week.
 */
export async function cancelSessionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const sessionId = String(formData.get('sessionId') ?? '');

  try {
    await apiPost(
      `/sessions/${sessionId}/cancel`,
      { reason: String(formData.get('reason') ?? '').trim() },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'calendar.cancelFailed');
  }

  revalidateCalendar();
  return { ok: true };
}
