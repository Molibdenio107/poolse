'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost, apiPut } from '../../../../../../lib/api';
import type { FormState } from '../../../actions';

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    if (error.status < 500) return { ok: false, errorKey };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

export async function addRecordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const studentId = String(formData.get('studentId') ?? '');

  try {
    await apiPost(
      `/students/${studentId}/progression`,
      {
        stroke: String(formData.get('stroke') ?? ''),
        distanceM: String(formData.get('distanceM') ?? '').trim(),
        // Three fields, not one. "1:23.45", "83.45" and "1.23.45" are all things
        // people type, and guessing between them produces a silently wrong
        // personal best.
        minutes: String(formData.get('minutes') ?? '').trim(),
        seconds: String(formData.get('seconds') ?? '').trim(),
        hundredths: String(formData.get('hundredths') ?? '').trim(),
        swumOn: String(formData.get('swumOn') ?? '').trim(),
        note: String(formData.get('note') ?? '').trim(),
      },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'progress.addFailed');
  }

  revalidatePath(`/dashboard/students/${studentId}/progress`);
  return { ok: true };
}

export async function archiveRecordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const studentId = String(formData.get('studentId') ?? '');
  const recordId = String(formData.get('recordId') ?? '');

  try {
    await apiPost(
      `/students/${studentId}/progression/${recordId}/archive`,
      {},
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'progress.archiveFailed');
  }

  revalidatePath(`/dashboard/students/${studentId}/progress`);
  return { ok: true };
}

export async function setFavouriteStrokeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const studentId = String(formData.get('studentId') ?? '');

  try {
    await apiPut(
      `/students/${studentId}/progression/favourite-stroke`,
      { stroke: String(formData.get('stroke') ?? '') },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'progress.favouriteFailed');
  }

  revalidatePath(`/dashboard/students/${studentId}/progress`);
  return { ok: true };
}
