'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost, apiPut } from '@/lib/api';
import type { FormState } from '../../actions';

/**
 * Mínimos — POOLSE-85. FPN age groups, qualifying standards and their entry
 * times, all typed by the club (Rui, 19-10-2026). The API decides; these carry
 * the form across and turn a refusal into a field marker.
 */

const PROVAS = '/dashboard/students/provas';

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    if (Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
    if (error.status < 500) return { ok: false, errorKey };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

const text = (formData: FormData, field: string): string => String(formData.get(field) ?? '').trim();

function ageGroupBody(formData: FormData): Record<string, unknown> {
  const gender = text(formData, 'gender');
  return {
    name: text(formData, 'name'),
    gender: gender === 'male' || gender === 'female' ? gender : null,
    bornFrom: text(formData, 'bornFrom'),
    bornTo: text(formData, 'bornTo'),
  };
}

function standardBody(formData: FormData): Record<string, unknown> {
  return {
    name: text(formData, 'name'),
    windowFrom: text(formData, 'windowFrom'),
    windowTo: text(formData, 'windowTo'),
  };
}

export async function createAgeGroupAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const organizationId = text(formData, 'organizationId');
  try {
    await apiPost('/qualifying/age-groups', { seasonId: text(formData, 'seasonId'), ...ageGroupBody(formData) }, {
      organizationId,
    });
  } catch (error) {
    return failure(error, 'qualifying.saveFailed');
  }
  revalidatePath(PROVAS, 'layout');
  return { ok: true };
}

export async function updateAgeGroupAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const organizationId = text(formData, 'organizationId');
  try {
    await apiPut(`/qualifying/age-groups/${text(formData, 'id')}`, ageGroupBody(formData), { organizationId });
  } catch (error) {
    return failure(error, 'qualifying.saveFailed');
  }
  revalidatePath(PROVAS, 'layout');
  return { ok: true };
}

export async function archiveAgeGroupAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const organizationId = text(formData, 'organizationId');
  try {
    await apiPost(`/qualifying/age-groups/${text(formData, 'id')}/archive`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'qualifying.archiveFailed');
  }
  revalidatePath(PROVAS, 'layout');
  return { ok: true, toastKey: 'qualifying.archivedToast' };
}

export async function createStandardAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const organizationId = text(formData, 'organizationId');
  let created: { id: string };
  try {
    created = await apiPost<{ id: string }>(
      '/qualifying/standards',
      { seasonId: text(formData, 'seasonId'), ...standardBody(formData) },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'qualifying.saveFailed');
  }
  revalidatePath(PROVAS, 'layout');
  // Straight to its times: a standard is created to be filled in.
  return { ok: true, redirectTo: `${PROVAS}/minimos/${created.id}?tab=times` };
}

export async function updateStandardAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const organizationId = text(formData, 'organizationId');
  const id = text(formData, 'id');
  try {
    await apiPut(`/qualifying/standards/${id}`, standardBody(formData), { organizationId });
  } catch (error) {
    return failure(error, 'qualifying.saveFailed');
  }
  revalidatePath(`${PROVAS}/minimos/${id}`);
  revalidatePath(PROVAS, 'layout');
  return { ok: true };
}

export async function archiveStandardAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const organizationId = text(formData, 'organizationId');
  try {
    await apiPost(`/qualifying/standards/${text(formData, 'id')}/archive`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'qualifying.archiveFailed');
  }
  revalidatePath(PROVAS, 'layout');
  return { ok: true, toastKey: 'qualifying.archivedToast', redirectTo: `${PROVAS}/minimos` };
}

/**
 * One age group's column of times. Every cell is a field `t:<stroke>:<distance>:<course>`
 * carrying what was typed; the API reads each with `parseSwimTime` and names
 * every one it cannot.
 */
export async function setEntryTimesAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const organizationId = text(formData, 'organizationId');
  const standardId = text(formData, 'standardId');
  const times: { stroke: string; distanceM: number; course: string; time: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('t:')) continue;
    const [, stroke, distance, course] = key.split(':');
    if (stroke === undefined || distance === undefined || course === undefined) continue;
    times.push({ stroke, distanceM: Number(distance), course, time: String(value) });
  }
  try {
    await apiPut(`/qualifying/standards/${standardId}/times/${text(formData, 'ageGroupId')}`, { times }, {
      organizationId,
    });
  } catch (error) {
    return failure(error, 'qualifying.saveFailed');
  }
  revalidatePath(`${PROVAS}/minimos/${standardId}`);
  return { ok: true };
}
