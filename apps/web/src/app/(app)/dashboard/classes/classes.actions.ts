'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { ApiError, apiPatch, apiPost } from '../../../../lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../actions';

function failure(error: unknown, errorKey: string): FormState {
  /*
   * A lane the pool does not have — POOLSE-43. The number is named, because
   * "that lane does not exist" without saying which one leaves somebody
   * re-reading a form with six fields in it.
   */
  if (error instanceof ApiError && error.status === 400 && error.message === 'noSuchLane') {
    const details = (error.details ?? {}) as Record<string, unknown>;
    return {
      ok: false,
      errorKey: 'classes.noSuchLane',
      detail: String(details['lane'] ?? ''),
    };
  }

  // Everything else — session, role, refused value, unreachable API — reads the
  // same way here as everywhere else in the app. POOLSE-QA-06.
  return describeFailure(error, errorKey);
}

/**
 * Every field the turma form posts — and it has to be *every* one.
 *
 * This is a hand-written list of FormData keys, which nothing typechecks: a
 * control on the form whose name is missing here posts its value and has it
 * dropped on the floor, silently and on every save. `colour` was exactly that
 * from round 6 until round 10 — the swatches rendered, the operator picked one,
 * the API defaulted it back to null and the calendar went on using the level's
 * tint. Nothing errored, because nothing was wrong: the value simply never left.
 *
 * When you add a control to `class-forms.tsx`, add its name here in the same
 * commit, and assert it survives a save.
 */
function groupBody(formData: FormData): Record<string, string> {
  return {
    name: String(formData.get('name') ?? '').trim(),
    levelId: String(formData.get('levelId') ?? '').trim(),
    poolId: String(formData.get('poolId') ?? '').trim(),
    instructorMembershipId: String(formData.get('instructorMembershipId') ?? '').trim(),
    capacity: String(formData.get('capacity') ?? '').trim(),
    lane: String(formData.get('lane') ?? '').trim(),
    colour: String(formData.get('colour') ?? '').trim(),
    feeCategoryId: String(formData.get('feeCategoryId') ?? '').trim(),
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
 *
 * **`laneIds` carries the pistas, and omitting it is not the same as sending
 * none.** Omitted, the class keeps the lanes it has and they follow the clock;
 * an empty array puts it in no lane for that week. This used not to exist, so a
 * drag sideways followed by "só esta semana" silently discarded the pista and
 * then refused the move because the *old* one was busy — "essa pista já está
 * ocupada", pointing at a lane the operator had never touched.
 */
export async function moveOccurrenceAction(
  organizationId: string,
  sessionId: string,
  date: string,
  startTime: string,
  laneIds?: string[],
  /**
   * A new length for this week only — round 8.
   *
   * Undefined means "I did not ask about the length", the same contract
   * `laneIds` has. A resize answered "só esta semana" used to send the hour and
   * drop the length, so the block sprang back to its old height.
   */
  durationMinutes?: number,
): Promise<{ ok: true } | { ok: false; errorKey: string; detail?: string }> {
  try {
    await apiPost(
      `/sessions/${sessionId}/move`,
      {
        date,
        startTime,
        ...(laneIds === undefined ? {} : { laneIds }),
        ...(durationMinutes === undefined ? {} : { durationMinutes }),
      },
      { organizationId },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      // The lane and the class holding it, where the server named them — the
      // same shape `bookingFailure` uses, so the grid renders one refusal.
      const body = (error.details ?? {}) as {
        message?: string;
        lane?: string;
        holder?: string;
      };
      // The class already happened. A different refusal from a busy lane, and
      // one nothing can be done about — so it says so rather than reading as a
      // clash somebody could go and clear.
      if (body.message === 'occurrenceTaught') {
        return { ok: false, errorKey: 'classes.occurrenceTaught' };
      }
      const detail = [body.lane, body.holder].filter(Boolean).join(' · ');
      return detail === ''
        ? { ok: false, errorKey: 'classes.occurrenceOccupied' }
        : { ok: false, errorKey: 'classes.occurrenceOccupied', detail };
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
    /**
     * The date of the occurrence that was dragged — round 8.
     *
     * That week follows the pattern even if it had been moved by hand before,
     * because the operator has just dragged that very block and said "todas as
     * semanas". Without it a series move left the block exactly where they
     * picked it up and reported nothing.
     */
    fromDate?: string | null;
  },
): Promise<
  | { ok: true; weeksBlocked: number; weeksKept: number }
  | { ok: false; errorKey: string; detail?: string }
> {
  let result: { weeksFollowed?: number; weeksBlocked?: number; weeksKept?: number };
  try {
    result = await apiPost<{
      weeksFollowed: number;
      weeksBlocked: number;
      weeksKept: number;
    }>(`/bookings/${scheduleId}/move`, target, { organizationId });
  } catch (error) {
    return await bookingFailure(error);
  }

  revalidatePath('/dashboard/calendar');
  revalidatePath('/dashboard/classes');
  /*
   * How many weeks stayed behind — round 8.
   *
   * A series move re-times the sessions still sitting where the pattern put
   * them; one whose new hour is already taken that week is left alone rather
   * than failing the whole move. That is a success with a caveat, not a
   * refusal, so it comes back on the ok path and the grid says it as a warning.
   */
  return {
    ok: true,
    weeksBlocked: result.weeksBlocked ?? 0,
    weeksKept: result.weeksKept ?? 0,
  };
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
    return await bookingFailure(error);
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
async function bookingFailure(
  error: unknown,
): Promise<{ ok: false; errorKey: string; detail?: string }> {
  if (error instanceof ApiError && error.status === 409) {
    const body = (error.details ?? {}) as {
      message?: string;
      lane?: string;
      holder?: string;
      reason?: string;
      opensAt?: string | null;
      closesAt?: string | null;
      /** Where the blocking booking's *pattern* sits — round 8. */
      weekday?: number;
      startTime?: string;
    };

    /*
     * The site is shut then — and this is what Rui's second report was about.
     *
     * It used to fall through to `dropRefused` ("não foi possível colocar
     * aqui"), which is true and useless: the operator has just dropped a class
     * on a Tuesday morning and wants to know that the pool opens at 14:45 that
     * day. The API now sends the reason and the hours in parts, and the sentence
     * is composed here, where the locale is.
     */
    if (body.message === 'closed') {
      const hours = [body.opensAt, body.closesAt].filter(Boolean).join('–');
      if (body.reason === 'outsideHours') {
        return { ok: false, errorKey: 'grid.closedOutsideHours', detail: hours };
      }
      if (body.reason === 'endsAfterClosing') {
        // `exactOptionalPropertyTypes` is on, so an absent detail is an absent
        // key rather than an explicit `undefined`.
        const closes = body.closesAt ?? '';
        return closes === ''
          ? { ok: false, errorKey: 'grid.closedEndsAfter' }
          : { ok: false, errorKey: 'grid.closedEndsAfter', detail: closes };
      }
      return { ok: false, errorKey: 'grid.closedThatDay' };
    }

    if (body.message === 'lanesNotContiguous') {
      return { ok: false, errorKey: 'grid.lanesNotContiguous' };
    }
    if (body.message === 'laneTaken') {
      /*
       * Where the blocker sits, and that it is the *pattern* — round 8.
       *
       * This check defends the recurring booking, which is right: a series move
       * rewrites the recurring booking. But the calendar draws each week's
       * *session*, and a class every one of whose sessions has been moved
       * elsewhere is drawn nowhere near the slot its pattern still holds. Naming
       * only the lane and the holder produced a refusal citing a class the
       * operator could see on another day — true, and impossible to act on.
       *
       * The day is translated here rather than assembled on the client, because
       * the words and their order belong to the catalogue: `laneTakenPattern`
       * owns the sentence and this only fills the holes.
       */
      const t = await getTranslations();
      const where =
        typeof body.weekday === 'number' &&
        body.weekday >= 1 &&
        body.weekday <= 7 &&
        typeof body.startTime === 'string' &&
        body.startTime !== ''
          ? t('grid.laneTakenPattern', {
              day: t(`week.${body.weekday}`),
              time: body.startTime,
            })
          : '';

      return {
        ok: false,
        errorKey: 'grid.laneTaken',
        detail: [body.lane, body.holder, where].filter(Boolean).join(' · '),
      };
    }
    if (body.message === 'alreadyThere') {
      return { ok: false, errorKey: 'grid.alreadyThere' };
    }
    return { ok: false, errorKey: 'grid.dropRefused' };
  }

  // Anything else. `dropRefused` stays as the honest last resort rather than a
  // guess dressed up as a diagnosis.
  return { ok: false, errorKey: 'grid.dropRefused' };
}

/**
 * "This one has nobody" — and the way back — POOLSE-53.
 *
 * The only transition an operator makes by hand. Everything else about a
 * booking's instructor status is the database's: assigning somebody sets
 * `assigned`, a partner's own teacher sets `external`, and removing an
 * instructor returns the booking to `to_define`. What a person decides is
 * whether an empty slot has become a problem.
 *
 * **The API's answer is returned, not the request's.** Escalating a booking that
 * turns out to be staffed comes back `assigned`, because the trigger corrected
 * it — so the caller renders what the database holds rather than what it asked
 * for. A screen that assumed otherwise would draw a red chip on a class with a
 * name on it.
 */
export async function setInstructorStatusAction(
  organizationId: string,
  scheduleId: string,
  status: 'to_define' | 'uncovered',
): Promise<{ ok: true; status: string } | { ok: false; errorKey: string }> {
  let answer: { status: string };
  try {
    answer = await apiPost<{ status: string }>(
      `/bookings/${scheduleId}/instructor-status`,
      { status },
      { organizationId },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, errorKey: 'notAllowed' };
    }
    return { ok: false, errorKey: 'dropRefused' };
  }

  revalidatePath('/dashboard/calendar');
  revalidatePath('/dashboard/classes');
  return { ok: true, status: answer.status };
}

/**
 * Put somebody on a class, from the grid — the other half of POOLSE-53's alert.
 *
 * `membershipId` null clears the booking's override and hands it back to the
 * turma's own instructor, which for a turma with nobody means back to
 * "a definir". The status is never sent: POOLSE-53 made it the database's, and
 * the answer that comes back is what the row actually holds.
 */
export async function assignInstructorAction(
  organizationId: string,
  scheduleId: string,
  membershipId: string | null,
): Promise<
  { ok: true; status: string; instructorName: string | null } | { ok: false; errorKey: string }
> {
  let answer: { status: string; instructorName: string | null };
  try {
    answer = await apiPost(
      `/bookings/${scheduleId}/instructor`,
      { membershipId },
      { organizationId },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, errorKey: 'grid.notAllowed' };
    }
    return { ok: false, errorKey: 'grid.dropRefused' };
  }

  revalidatePath('/dashboard/calendar');
  revalidatePath('/dashboard/classes');
  return { ok: true, ...answer };
}
