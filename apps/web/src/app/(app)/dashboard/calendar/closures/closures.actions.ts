'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch, apiPost, type MessagePreview } from '../../../../../lib/api';
import type { FormState } from '../../actions';

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

  let created: { id: string };
  try {
    created = await apiPost<{ id: string }>(
      '/closures',
      {
        startsOn: text('startsOn'),
        endsOn: text('endsOn'),
        reason,
        poolId: text('poolId'),
      },
      { organizationId },
    );
  } catch (error) {
    /*
     * An overlap comes back as a 409 naming the closure already there — the
     * message is worth showing verbatim, because "overlaps with an existing
     * closure" sends somebody hunting through a year of calendar and "overlaps
     * with Encerramento de Natal" does not.
     */
    if (error instanceof ApiError && error.status === 409) {
      // `details` is somebody else's JSON and typed `unknown` on purpose, so it
      // is narrowed here rather than believed.
      const details = error.details;
      const existing =
        details !== null && typeof details === 'object' &&
        typeof (details as Record<string, unknown>)['existing'] === 'string'
          ? ((details as Record<string, unknown>)['existing'] as string)
          : undefined;

      return {
        ok: false,
        errorKey: 'calendar.closureOverlap',
        // Spread rather than `detail: existing`: with exactOptionalPropertyTypes
        // an explicit `undefined` is not the same as the key being absent.
        ...(existing === undefined ? {} : { detail: existing }),
      };
    }
    return { ok: false, errorKey: 'calendar.closureFailed' };
  }

  revalidateEverythingShowingClasses();
  return { ok: true, closureId: created.id };
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
  startsOn: string,
  endsOn: string,
): Promise<{ sessions: number; marked: number } | null> {
  try {
    return await apiFetch<{ sessions: number; marked: number }>(
      `/closures/impact?startsOn=${startsOn}&endsOn=${endsOn}`,
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
