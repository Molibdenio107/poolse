'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, apiPatch, apiPost } from '../../../../lib/api';
import type { FormState } from '../actions';

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    if (error.status === 409) return { ok: false, errorKey: 'students.duplicateLevel' };
    if (error.status < 500) return { ok: false, errorKey };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

/** Shared by create and edit — the same fields, read out of the same form. */
function studentBody(formData: FormData): Record<string, string> {
  return {
    firstName: String(formData.get('firstName') ?? '').trim(),
    lastName: String(formData.get('lastName') ?? '').trim(),
    birthDate: String(formData.get('birthDate') ?? '').trim(),
    levelId: String(formData.get('levelId') ?? '').trim(),
    contactEmail: String(formData.get('contactEmail') ?? '').trim(),
    contactPhone: String(formData.get('contactPhone') ?? '').trim(),
    notes: String(formData.get('notes') ?? '').trim(),
  };
}

export async function createStudentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const body = studentBody(formData);
  if (!body['firstName'] || !body['lastName']) {
    return { ok: false, errorKey: 'students.nameRequired' };
  }

  let created: { id: string };
  try {
    created = await apiPost<{ id: string }>('/students', body, { organizationId });
  } catch (error) {
    return failure(error, 'students.createFailed');
  }

  revalidatePath('/dashboard/students');
  // Outside the try: redirect() signals by throwing, and catching it here would
  // turn a successful save into "could not create".
  //
  // Straight to the student rather than back to the register, because a student
  // record is not finished at their name — the photograph, the consents and the
  // level are all on that page, and it is where you were going anyway.
  redirect(`/dashboard/students/${created.id}`);
}

export async function updateStudentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const studentId = String(formData.get('studentId') ?? '');
  const body = studentBody(formData);
  if (!body['firstName'] || !body['lastName']) {
    return { ok: false, errorKey: 'students.nameRequired' };
  }

  try {
    await apiPatch(`/students/${studentId}`, body, { organizationId });
  } catch (error) {
    return failure(error, 'students.saveFailed');
  }

  revalidatePath('/dashboard/students');
  revalidatePath(`/dashboard/students/${studentId}`);
  return { ok: true };
}

export async function archiveStudentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const studentId = String(formData.get('studentId') ?? '');

  try {
    await apiPost(`/students/${studentId}/archive`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'students.archiveFailed');
  }

  revalidatePath('/dashboard/students');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/** Empty means "no bound" — "Adultos" genuinely has no maximum. */
function ageBound(formData: FormData, field: string): number | null {
  const raw = String(formData.get(field) ?? '').trim();
  if (raw === '') return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function levelBody(formData: FormData): {
  name: string;
  minAgeYears: number | null;
  maxAgeYears: number | null;
} {
  return {
    name: String(formData.get('name') ?? '').trim(),
    minAgeYears: ageBound(formData, 'minAgeYears'),
    maxAgeYears: ageBound(formData, 'maxAgeYears'),
  };
}

export async function createLevelAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const body = levelBody(formData);
  if (!body.name) return { ok: false, errorKey: 'students.levelNameRequired' };

  try {
    await apiPost('/levels', body, { organizationId });
  } catch (error) {
    return failure(error, 'students.levelFailed');
  }

  revalidatePath('/dashboard/students/levels');
  revalidatePath('/dashboard/students');
  return { ok: true };
}

/**
 * Renames a level and sets its age range — backlog round 4, ticket 4.
 *
 * Name and range travel together because the form submits both, and a
 * half-applied edit is a state nobody can explain. Narrowing removes nobody: the
 * count of students who would fall outside is shown before saving, and what
 * happens to them afterwards is the club's decision.
 */
/**
 * The whole order, in one call — POOLSE-05.
 *
 * Throws rather than returning a `FormState`, because the caller is an
 * optimistic list rather than a form: a rejected promise is what tells it to put
 * the previous order back.
 */
export async function reorderLevelsAction(
  organizationId: string,
  ids: string[],
): Promise<void> {
  await apiPost('/levels/reorder', { ids }, { organizationId });

  revalidatePath('/dashboard/students/levels');
  revalidatePath('/dashboard/students');
}

export async function renameLevelAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const levelId = String(formData.get('levelId') ?? '');
  const body = levelBody(formData);
  if (!body.name) return { ok: false, errorKey: 'students.levelNameRequired' };

  try {
    await apiPatch(`/levels/${levelId}`, body, { organizationId });
  } catch (error) {
    return failure(error, 'students.levelFailed');
  }

  revalidatePath('/dashboard/students/levels');
  revalidatePath('/dashboard/students');
  return { ok: true };
}

/**
 * How many students would fall outside a proposed range.
 *
 * Asked as the operator types, before saving. Students with no birth date are
 * never counted — missing dates are the normal case, and reporting them as
 * "outside" would produce a frightening number that means nothing.
 */
export async function countOutsideRangeAction(
  organizationId: string,
  levelId: string,
  minAgeYears: number | null,
  maxAgeYears: number | null,
): Promise<number> {
  const params = new URLSearchParams();
  if (minAgeYears !== null) params.set('minAgeYears', String(minAgeYears));
  if (maxAgeYears !== null) params.set('maxAgeYears', String(maxAgeYears));

  const { outside } = await apiFetch<{ outside: number }>(
    `/levels/${levelId}/outside?${params.toString()}`,
    { organizationId },
  );
  return outside;
}

export async function archiveLevelAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const levelId = String(formData.get('levelId') ?? '');

  try {
    await apiPost(`/levels/${levelId}/archive`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'students.archiveFailed');
  }

  // Students who were in it are now unlevelled, so the register is stale too.
  revalidatePath('/dashboard/students/levels');
  revalidatePath('/dashboard/students');
  return { ok: true };
}
