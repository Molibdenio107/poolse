'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiPatch, apiPost } from '../../../../lib/api';
import type { FormState } from '../actions';

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    if (error.status === 409) return { ok: false, errorKey: `${errorKey}Conflict` };
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
