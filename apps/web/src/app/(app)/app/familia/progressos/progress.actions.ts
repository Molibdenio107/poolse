'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost } from '@/lib/api';
import type { FormState } from '../../../dashboard/actions';

const PAGE = '/app/familia/progressos';

function text(data: FormData, name: string): string {
  return String(data.get(name) ?? '').trim();
}

/** The API refuses by code; each code lands under the field it is about. */
function refused(error: unknown, fieldOf: Record<string, string>): FormState {
  if (error instanceof ApiError) {
    const field = error.code == null ? undefined : fieldOf[error.code];
    if (field !== undefined) return { ok: false, fields: { [field]: `app.records.invalid.${field}` } };
    if (error.status === 403) return { ok: false, errorKey: 'app.records.guardianAnswers' };
  }
  return { ok: false, errorKey: 'app.records.saveFailed' };
}

export async function addTimeAction(_previous: FormState, data: FormData): Promise<FormState> {
  try {
    await apiPost(`/app/progress/${encodeURIComponent(text(data, 'studentId'))}/times`, {
      stroke: text(data, 'stroke'),
      distanceM: text(data, 'distanceM'),
      poolId: text(data, 'poolId'),
      sessionId: text(data, 'sessionId'),
      hours: text(data, 'hours'),
      minutes: text(data, 'minutes'),
      seconds: text(data, 'seconds'),
      hundredths: text(data, 'hundredths'),
      swumOn: text(data, 'swumOn'),
    });
  } catch (error) {
    return refused(error, { distance: 'distanceM', time: 'time', date: 'swumOn' });
  }
  revalidatePath(PAGE);
  return { ok: true };
}

export async function setFavouriteAction(_previous: FormState, data: FormData): Promise<FormState> {
  try {
    await apiPost(`/app/progress/${encodeURIComponent(text(data, 'studentId'))}/favourite`, { stroke: text(data, 'stroke') });
  } catch (error) {
    return refused(error, {});
  }
  revalidatePath(PAGE);
  return { ok: true };
}

export async function removeTimeAction(_previous: FormState, data: FormData): Promise<FormState> {
  try {
    await apiPost(
      `/app/progress/${encodeURIComponent(text(data, 'studentId'))}/times/${encodeURIComponent(text(data, 'entry'))}/archive`,
      {},
    );
  } catch (error) {
    return refused(error, {});
  }
  revalidatePath(PAGE);
  return { ok: true };
}
