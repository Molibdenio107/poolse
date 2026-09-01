'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiDelete, apiPost } from '@/lib/api';
import type { FormState } from '../../actions';

/**
 * Planning next year — POOLSE-45.
 *
 * A draft is a plan: any number may exist beside the season the club is running,
 * and no dated session is ever generated from one. These three actions are the
 * whole of what an operator does with them.
 */

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.message === 'seasonArchived') {
      return { ok: false, errorKey: 'seasons.cannotPublishArchived' };
    }
    if (error.status === 409 && error.message === 'draftNotDiscardable') {
      return { ok: false, errorKey: 'seasons.cannotDiscard' };
    }
    if (error.status < 500) return { ok: false, errorKey };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

/**
 * Everything a season change touches.
 *
 * The seasons screen, obviously; the calendar and the turmas because both filter
 * by which season is published, and a stale one after a publish reads as the
 * switch not having worked.
 */
function revalidateAll(): void {
  revalidatePath('/dashboard/classes/seasons');
  revalidatePath('/dashboard/classes');
  revalidatePath('/dashboard/calendar');
}

/**
 * Opens a draft, optionally copying a season's grid.
 *
 * "Duplicar época" is this with `copyFrom` set; an empty draft is the same
 * control with nothing to copy, for a club rebuilding its timetable from
 * scratch.
 */
export async function createDraftAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (name === '') return { ok: false, errorKey: 'seasons.nameRequired' };

  const startsOn = String(formData.get('startsOn') ?? '').trim();
  const endsOn = String(formData.get('endsOn') ?? '').trim();
  if (startsOn === '' || endsOn === '') {
    return { ok: false, errorKey: 'seasons.datesRequired' };
  }
  if (endsOn < startsOn) return { ok: false, errorKey: 'seasons.endsBeforeStart' };

  try {
    await apiPost(
      '/seasons/drafts',
      {
        name,
        startsOn,
        endsOn,
        copyFrom: String(formData.get('copyFrom') ?? '').trim(),
      },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'seasons.draftFailed');
  }

  revalidateAll();
  return { ok: true };
}

/** Makes a draft the season the club is running; the incumbent is retired. */
export async function publishSeasonAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const seasonId = String(formData.get('seasonId') ?? '');

  try {
    await apiPost(`/seasons/${seasonId}/publish`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'seasons.publishFailed');
  }

  revalidateAll();
  return { ok: true };
}

/** Throws a draft away. Refused once turmas have been parked in it. */
export async function discardDraftAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const seasonId = String(formData.get('seasonId') ?? '');

  try {
    await apiDelete(`/seasons/${seasonId}`, { organizationId });
  } catch (error) {
    return failure(error, 'seasons.discardFailed');
  }

  revalidateAll();
  return { ok: true };
}
