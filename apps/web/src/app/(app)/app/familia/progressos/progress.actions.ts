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
      course: text(data, 'course'),
      time: text(data, 'time'),
      swumOn: text(data, 'swumOn'),
    });
  } catch (error) {
    return refused(error, { distance: 'distanceM', time: 'time', date: 'swumOn' });
  }
  revalidatePath(PAGE);
  return { ok: true };
}

export async function addMeasureAction(_previous: FormState, data: FormData): Promise<FormState> {
  try {
    await apiPost(`/app/progress/${encodeURIComponent(text(data, 'studentId'))}/measures`, {
      kind: text(data, 'kind'),
      value: text(data, 'value'),
      measuredOn: text(data, 'measuredOn'),
    });
  } catch (error) {
    return refused(error, { value: 'value', date: 'measuredOn' });
  }
  revalidatePath(PAGE);
  return { ok: true };
}

export async function removeEntryAction(_previous: FormState, data: FormData): Promise<FormState> {
  const what = text(data, 'what') === 'measures' ? 'measures' : 'times';
  try {
    await apiPost(
      `/app/progress/${encodeURIComponent(text(data, 'studentId'))}/${what}/${encodeURIComponent(text(data, 'entry'))}/archive`,
      {},
    );
  } catch (error) {
    return refused(error, {});
  }
  revalidatePath(PAGE);
  return { ok: true };
}
