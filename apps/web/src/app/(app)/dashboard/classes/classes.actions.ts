'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiPatch, apiPost } from '../../../../lib/api';
import type { FormState } from '../actions';

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    if (error.status === 409) return { ok: false, errorKey: `${errorKey}Conflict` };

    /*
     * A lane the pool does not have — POOLSE-43. The number is named, because
     * "that lane does not exist" without saying which one leaves somebody
     * re-reading a form with six fields in it.
     */
    if (error.status === 400 && error.message === 'noSuchLane') {
      const details = (error.details ?? {}) as Record<string, unknown>;
      return {
        ok: false,
        errorKey: 'classes.noSuchLane',
        detail: String(details['lane'] ?? ''),
      };
    }

    if (error.status < 500) return { ok: false, errorKey };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

function groupBody(formData: FormData): Record<string, string> {
  return {
    name: String(formData.get('name') ?? '').trim(),
    levelId: String(formData.get('levelId') ?? '').trim(),
    poolId: String(formData.get('poolId') ?? '').trim(),
    instructorMembershipId: String(formData.get('instructorMembershipId') ?? '').trim(),
    capacity: String(formData.get('capacity') ?? '').trim(),
    lane: String(formData.get('lane') ?? '').trim(),
  };
}

export async function createClassAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const body = groupBody(formData);
  if (!body['name']) return { ok: false, errorKey: 'classes.nameRequired' };

  let created: { id: string };
  try {
    created = await apiPost<{ id: string }>('/class-groups', body, { organizationId });
  } catch (error) {
    return failure(error, 'classes.createFailed');
  }

  revalidatePath('/dashboard/classes');
  // Straight to the turma, because a class group with no weekly pattern is not
  // yet a class — adding the days is the next thing anyone wants to do.
  redirect(`/dashboard/classes/${created.id}`);
}

export async function updateClassAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const groupId = String(formData.get('groupId') ?? '');
  const body = groupBody(formData);
  if (!body['name']) return { ok: false, errorKey: 'classes.nameRequired' };

  try {
    await apiPatch(`/class-groups/${groupId}`, body, { organizationId });
  } catch (error) {
    return failure(error, 'classes.createFailed');
  }

  revalidatePath('/dashboard/classes');
  revalidatePath(`/dashboard/classes/${groupId}`);
  return { ok: true };
}

export async function archiveClassAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const groupId = String(formData.get('groupId') ?? '');

  try {
    await apiPost(`/class-groups/${groupId}/archive`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'classes.archiveFailed');
  }

  revalidatePath('/dashboard/classes');
  redirect('/dashboard/classes');
}

export async function addSlotAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const groupId = String(formData.get('groupId') ?? '');

  try {
    await apiPost(
      `/class-groups/${groupId}/schedules`,
      {
        weekday: String(formData.get('weekday') ?? ''),
        startTime: String(formData.get('startTime') ?? '').trim(),
        durationMinutes: String(formData.get('durationMinutes') ?? '').trim(),
      },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'classes.slotFailed');
  }

  revalidatePath('/dashboard/classes');
  revalidatePath(`/dashboard/classes/${groupId}`);
  return { ok: true };
}

export async function removeSlotAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const groupId = String(formData.get('groupId') ?? '');
  const scheduleId = String(formData.get('scheduleId') ?? '');

  try {
    await apiPost(
      `/class-groups/${groupId}/schedules/${scheduleId}/remove`,
      {},
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'classes.slotFailed');
  }

  revalidatePath('/dashboard/classes');
  revalidatePath(`/dashboard/classes/${groupId}`);
  return { ok: true };
}

export async function enrolAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const groupId = String(formData.get('groupId') ?? '');
  const studentId = String(formData.get('studentId') ?? '').trim();
  if (!studentId) return { ok: false, errorKey: 'classes.pickAStudent' };

  try {
    await apiPost(
      `/class-groups/${groupId}/enrollments`,
      { studentId, waiting: String(formData.get('waiting') ?? '') === 'true' },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'classes.enrolFailed');
  }

  revalidatePath('/dashboard/classes');
  revalidatePath(`/dashboard/classes/${groupId}`);
  return { ok: true };
}

export async function endEnrollmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const groupId = String(formData.get('groupId') ?? '');
  const enrollmentId = String(formData.get('enrollmentId') ?? '');

  try {
    await apiPost(
      `/class-groups/${groupId}/enrollments/${enrollmentId}/end`,
      {},
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'classes.enrolFailed');
  }

  revalidatePath('/dashboard/classes');
  revalidatePath(`/dashboard/classes/${groupId}`);
  return { ok: true };
}

/**
 * Place an unscheduled turma on a day and time — round 5, drag and drop.
 *
 * Plain arguments rather than `FormData`: a drop is not a form submission, and
 * building a `FormData` to satisfy an action signature would be ceremony around
 * three strings.
 *
 * **The duration comes from the turma, not from the drop.** A turma that already
 * runs on Tuesday keeps that length on Thursday, which is what a club means by
 * "same class, second day". Only a turma with no slots at all takes the 45
 * minutes the form defaults to, and that is the one case where nothing better is
 * known.
 *
 * Returns the new slot's id so the caller can offer an undo that removes exactly
 * the row it created.
 */
export async function placeSlotAction(
  organizationId: string,
  groupId: string,
  weekday: number,
  startTime: string,
  durationMinutes: number,
): Promise<{ ok: true } | { ok: false; errorKey: string }> {
  try {
    await apiPost(
      `/class-groups/${groupId}/schedules`,
      { weekday: String(weekday), startTime, durationMinutes: String(durationMinutes) },
      { organizationId },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { ok: false, errorKey: 'classes.slotDuplicate' };
    }
    // The facility-hours trigger, most often: a closed day, or a class that
    // would run past closing. The API returns its sentence; this maps it to the
    // one string the grid can show without a banner.
    return { ok: false, errorKey: 'classes.slotRefused' };
  }

  revalidatePath('/dashboard/classes');
  revalidatePath('/dashboard/calendar');
  revalidatePath(`/dashboard/classes/${groupId}`);
  return { ok: true };
}

/** Move a slot already on the grid. Same refusals, same reasons. */
export async function moveSlotAction(
  organizationId: string,
  groupId: string,
  scheduleId: string,
  weekday: number,
  startTime: string,
): Promise<{ ok: true } | { ok: false; errorKey: string }> {
  try {
    await apiPost(
      `/class-groups/${groupId}/schedules/${scheduleId}/move`,
      { weekday: String(weekday), startTime },
      { organizationId },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { ok: false, errorKey: 'classes.slotDuplicate' };
    }
    return { ok: false, errorKey: 'classes.slotRefused' };
  }

  revalidatePath('/dashboard/classes');
  revalidatePath('/dashboard/calendar');
  revalidatePath(`/dashboard/classes/${groupId}`);
  return { ok: true };
}

/** The undo behind a drop: removes the slot the drop created. */
export async function undoSlotAction(
  organizationId: string,
  groupId: string,
  scheduleId: string,
): Promise<void> {
  try {
    await apiPost(
      `/class-groups/${groupId}/schedules/${scheduleId}/remove`,
      {},
      { organizationId },
    );
  } catch {
    // An undo that fails is not worth a banner: the slot is still on the grid,
    // which is the state the operator can see and can remove by hand.
  }

  revalidatePath('/dashboard/classes');
  revalidatePath('/dashboard/calendar');
  revalidatePath(`/dashboard/classes/${groupId}`);
}

/**
 * One week's class moved, and no other.
 *
 * The sibling of `moveSlotAction`, which edits the weekly pattern and therefore
 * changes every week from here on. This one changes Wednesday the 17th and
 * leaves the 24th where it was — "the pool is booked that morning" rather than
 * "the class has a new time".
 *
 * A date and a wall clock go over the wire, not an instant: the pool knows which
 * timezone 18:00 is in and the browser does not.
 */
export async function moveOccurrenceAction(
  organizationId: string,
  sessionId: string,
  date: string,
  startTime: string,
): Promise<{ ok: true } | { ok: false; errorKey: string }> {
  try {
    await apiPost(`/sessions/${sessionId}/move`, { date, startTime }, { organizationId });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { ok: false, errorKey: 'classes.occurrenceOccupied' };
    }
    return { ok: false, errorKey: 'classes.slotRefused' };
  }

  revalidatePath('/dashboard/calendar');
  revalidatePath('/dashboard/classes');
  return { ok: true };
}

/**
 * A booking moved on the lane grid — POOLSE-50.
 *
 * The sibling of `moveSlotAction`, and it replaces it wherever the grid is
 * doing the moving. Two differences, both the point of the ticket: it carries
 * the **lanes** the block landed on, and it works for any subject rather than
 * only for a turma's pattern — a school's booking is moved by exactly the same
 * gesture as a class.
 *
 * Move, span and the keyboard versions of both are all this one call, because
 * the client already knows where the block ended up and three endpoints for one
 * outcome is three places for the rules to drift apart.
 */
export async function moveBookingAction(
  organizationId: string,
  scheduleId: string,
  target: {
    weekday: number;
    slotId: string | null;
    startTime: string | null;
    laneIds: string[];
    /** An explicit length, when the block edge was dragged. Null takes the slot s. */
    durationMinutes?: number | null;
  },
): Promise<{ ok: true } | { ok: false; errorKey: string; detail?: string }> {
  try {
    await apiPost(`/bookings/${scheduleId}/move`, target, { organizationId });
  } catch (error) {
    return bookingFailure(error);
  }

  revalidatePath('/dashboard/calendar');
  revalidatePath('/dashboard/classes');
  return { ok: true };
}

/**
 * Another one of these, on another day — the season-building gesture.
 *
 * The reference schedule repeats the same block on 2ª, 4ª and 6ª, so this is the
 * most-used action on the grid and not an afterthought. The copy carries the
 * subject, instructor, category and lane span; the API deliberately leaves the
 * notes behind, because a note names a date or a reason.
 */
export async function duplicateBookingAction(
  organizationId: string,
  scheduleId: string,
  target: {
    weekday: number;
    slotId: string | null;
    startTime: string | null;
    laneIds: string[];
    /** An explicit length, when the block edge was dragged. Null takes the slot s. */
    durationMinutes?: number | null;
  },
): Promise<{ ok: true } | { ok: false; errorKey: string; detail?: string }> {
  try {
    await apiPost(`/bookings/${scheduleId}/duplicate`, target, { organizationId });
  } catch (error) {
    return bookingFailure(error);
  }

  revalidatePath('/dashboard/calendar');
  revalidatePath('/dashboard/classes');
  return { ok: true };
}

/**
 * A refusal, turned into something the grid can say out loud.
 *
 * The operator is mid-gesture with a block under their hand; "conflict" sends
 * them hunting across six lanes for what went wrong. Every one of these names
 * the thing in the way — and `detail` carries the lane and the booking holding
 * it, so the message can be a sentence rather than a category.
 */
function bookingFailure(error: unknown): { ok: false; errorKey: string; detail?: string } {
  if (error instanceof ApiError && error.status === 409) {
    const body = (error.details ?? {}) as {
      message?: string;
      lane?: string;
      holder?: string;
    };

    if (body.message === 'lanesNotContiguous') {
      return { ok: false, errorKey: 'grid.lanesNotContiguous' };
    }
    if (body.message === 'laneTaken') {
      return {
        ok: false,
        errorKey: 'grid.laneTaken',
        detail: [body.lane, body.holder].filter(Boolean).join(' · '),
      };
    }
    if (body.message === 'alreadyThere') {
      return { ok: false, errorKey: 'grid.alreadyThere' };
    }
    return { ok: false, errorKey: 'grid.dropRefused' };
  }

  // The facility-hours trigger, most often: a closed day, or a booking that
  // would run past closing.
  return { ok: false, errorKey: 'grid.dropRefused' };
}
