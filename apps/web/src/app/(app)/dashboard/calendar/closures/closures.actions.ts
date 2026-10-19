'use server';

import { revalidatePath } from 'next/cache';
import {
  ApiError,
  apiFetch,
  apiPost,
  apiPut,
  type MessagePreview,
  type PartOfDay,
} from '../../../../../lib/api';
import type { FormState } from '../../actions';

/** What each of the API's closure refusals says — POOLSE-84. */
const REFUSALS: Record<string, string> = {
  closure_site_required: 'calendar.refused.siteRequired',
  closure_site_unknown: 'calendar.refused.siteRequired',
  closure_pool_elsewhere: 'calendar.refused.poolElsewhere',
  closure_half_day_one_day: 'calendar.refused.halfDayOneDay',
};

/** A saved closure hands back its id, so the dialog can warn its families. */
export interface ClosureState extends FormState {
  closureId?: string;
}

/**
 * Encerramentos — POOLSE-31.
 *
 * Creating one cancels the classes it covers straight away, so every screen that
 * shows a class has to be revalidated, not only this page.
 */
export async function createClosureAction(
  _previous: ClosureState,
  formData: FormData,
): Promise<ClosureState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const text = (field: string): string => String(formData.get(field) ?? '').trim();

  const reason = text('reason');
  if (reason === '') return { ok: false, fields: { reason: 'calendar.reasonRequired' } };

  // One site, and any of its tanks — each tank its own closure (POOLSE-84).
  const poolIds = formData
    .getAll('poolIds')
    .map((value) => String(value).trim())
    .filter((value) => value !== '');
  const partOfDay = text('partOfDay');

  let created: { id: string };
  try {
    created = await apiPost<{ id: string }>(
      '/closures',
      {
        startsOn: text('startsOn'),
        endsOn: text('endsOn'),
        reason,
        facilityId: text('facilityId'),
        poolIds,
        ...(partOfDay === '' ? {} : { partOfDay }),
      },
      { organizationId },
    );
  } catch (error) {
    return closureRefusal(error);
  }

  revalidateEverythingShowingClasses();
  return { ok: true, closureId: created.id };
}

/**
 * A refusal from saving a closure, as a sentence — shared by create and edit.
 *
 * An overlap comes back as a 409 naming the closure already there, and since
 * POOLSE-84 its tank: "overlaps with an existing closure" sends somebody hunting
 * through a year of calendar, and "Tanque 2 already has Esvaziamento" does not.
 */
function closureRefusal(error: unknown): ClosureState {
  if (error instanceof ApiError && error.status === 409) {
    // `details` is somebody else's JSON and typed `unknown` on purpose, so it
    // is narrowed here rather than believed.
    const details = error.details;
    const fields =
      details !== null && typeof details === 'object' ? (details as Record<string, unknown>) : {};
    if (error.code === 'attendance_recorded') {
      return { ok: false, errorKey: 'calendar.refused.registerTaken' };
    }
    const existing = typeof fields['existing'] === 'string' ? fields['existing'] : undefined;
    const pool = typeof fields['pool'] === 'string' ? fields['pool'] : undefined;

    return {
      ok: false,
      errorKey: pool === undefined ? 'calendar.closureOverlap' : 'calendar.closureOverlapTank',
      // In `values`, not `detail`: the sentence already names the closure, and
      // the toast appends a detail after it — which said it twice.
      values: { existing: existing ?? '', ...(pool === undefined ? {} : { pool }) },
    };
  }
  // POOLSE-84's refusals: each is a sentence, never the API's English.
  if (error instanceof ApiError && error.status === 422) {
    const key = REFUSALS[error.code ?? ''];
    if (key !== undefined) return { ok: false, errorKey: key };
  }
  return { ok: false, errorKey: 'calendar.closureFailed' };
}

/**
 * Change one closure — its days, reason, tank or half — POOLSE-84.
 *
 * One row, one tank: a closure made for two tanks is two rows, edited apart,
 * which is why they were stored apart. Shortening it gives back the lessons it no
 * longer covers at once; extending it cancels the ones it now does.
 */
export async function updateClosureAction(
  _previous: ClosureState,
  formData: FormData,
): Promise<ClosureState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const closureId = String(formData.get('closureId') ?? '');
  const text = (field: string): string => String(formData.get(field) ?? '').trim();

  const reason = text('reason');
  if (reason === '') return { ok: false, fields: { reason: 'calendar.reasonRequired' } };
  const startsOn = text('startsOn');
  const endsOn = text('endsOn');
  if (startsOn === '' || endsOn === '') {
    return { ok: false, fields: { startsOn: 'calendar.refused.datesRequired' } };
  }
  if (endsOn < startsOn) return { ok: false, fields: { endsOn: 'calendar.refused.endsBefore' } };
  const poolId = text('poolId');
  const partOfDay = text('partOfDay');

  try {
    await apiPut(
      `/closures/${closureId}`,
      {
        startsOn,
        endsOn,
        reason,
        facilityId: text('facilityId'),
        poolIds: poolId === '' ? [] : [poolId],
        ...(partOfDay === '' || startsOn !== endsOn ? {} : { partOfDay }),
      },
      { organizationId },
    );
  } catch (error) {
    return closureRefusal(error);
  }

  revalidateEverythingShowingClasses();
  return { ok: true, closureId };
}

/**
 * Who a closure's warning would reach — the families of turmas it took a lesson
 * from. The same `/messages` preview the composer uses, with the `closure`
 * audience, so the count confirmed is the count the send resolves. Null when
 * the count could not be had, which the dialog says.
 */
export async function previewClosureWarning(
  organizationId: string,
  closureId: string,
): Promise<MessagePreview | null> {
  try {
    return await apiPost<MessagePreview>(
      '/messages',
      { audience: 'closure', targetId: closureId },
      { organizationId },
    );
  } catch {
    return null;
  }
}

export async function sendClosureWarning(
  organizationId: string,
  closureId: string,
  subject: string,
  body: string,
): Promise<{ ok: true } | { ok: false; errorKey: string; values?: Record<string, number> }> {
  try {
    await apiPost(
      '/messages',
      { audience: 'closure', targetId: closureId, subject, body, commit: true },
      { organizationId },
    );
  } catch (error) {
    if (error instanceof ApiError && error.code === 'message_quota') {
      const quota = (error.details as { messageQuota?: Record<string, unknown> } | null)
        ?.messageQuota;
      const limit = Number(quota?.['limit']);
      const used = Number(quota?.['used']);
      const requested = Number(quota?.['requested']);
      return {
        ok: false,
        errorKey:
          quota?.['kind'] === 'addresses'
            ? 'messages.error.quotaAddresses'
            : 'messages.error.quotaMessages',
        values: { limit, used, requested, left: Math.max(limit - used, 0) },
      };
    }
    if (error instanceof ApiError && error.code === 'no_recipients') {
      return { ok: false, errorKey: 'messages.error.noRecipients' };
    }
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, errorKey: 'calendar.warn.wordsRequired' };
    }
    return { ok: false, errorKey: 'messages.error.sendFailed' };
  }
  revalidatePath('/dashboard/students/messages');
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
  } catch {
    return { ok: false, errorKey: 'calendar.closureFailed' };
  }

  revalidateEverythingShowingClasses();
  return { ok: true };
}

/**
 * What a range would take down, asked before it is committed — criterion 10.
 *
 * Returns null rather than throwing. The number is a courtesy; a closure that
 * cannot be previewed should still be creatable, and an error page in place of a
 * warning would be a worse outcome than no warning.
 */
export async function impactAction(
  organizationId: string,
  scope: {
    startsOn: string;
    endsOn: string;
    facilityId: string;
    poolIds: string[];
    partOfDay: PartOfDay | null;
  },
): Promise<{ sessions: number; marked: number } | null> {
  const query = new URLSearchParams({
    startsOn: scope.startsOn,
    endsOn: scope.endsOn,
    facilityId: scope.facilityId,
    poolIds: scope.poolIds.join(','),
    ...(scope.partOfDay === null ? {} : { partOfDay: scope.partOfDay }),
  });
  try {
    return await apiFetch<{ sessions: number; marked: number }>(
      `/closures/impact?${query.toString()}`,
      { organizationId },
    );
  } catch {
    return null;
  }
}

/**
 * A closure changes what is on the calendar, the timetable and the dashboard.
 *
 * Listed rather than looped, so the set is visible: a page that quietly kept
 * showing a cancelled class would be the bug this whole ticket exists to avoid.
 */
function revalidateEverythingShowingClasses(): void {
  revalidatePath('/dashboard/calendar/closures');
  revalidatePath('/dashboard/calendar');
  revalidatePath('/dashboard/classes');
  revalidatePath('/dashboard');
}
