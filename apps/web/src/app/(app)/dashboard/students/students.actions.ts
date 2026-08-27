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
  const text = (field: string): string => String(formData.get(field) ?? '').trim();

  return {
    firstName: text('firstName'),
    lastName: text('lastName'),
    birthDate: text('birthDate'),
    levelId: text('levelId'),
    contactEmail: text('contactEmail'),
    contactPhone: text('contactPhone'),
    notes: text('notes'),
    // POOLSE-04. Always posted, even for an adult: the block hides rather than
    // unmounts, and a form that stopped submitting fields it was still showing
    // would be the worse of the two surprises.
    guardianName: text('guardianName'),
    guardianRelationship: text('guardianRelationship'),
    guardianPhone: text('guardianPhone'),
    guardianEmail: text('guardianEmail'),
    guardianTaxNumber: text('guardianTaxNumber'),
    guardianAddress: text('guardianAddress'),
  };
}

/**
 * Turns the API's field errors into a `FormState` the form can place.
 *
 * A guardian rejection names the field it is about — POOLSE-04 asks for the
 * requirement, and a message at the top saying "a guardian is needed" would
 * leave somebody looking for which of six boxes was empty.
 */
function withFields(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError && Object.keys(error.fields).length > 0) {
    return { ok: false, fields: error.fields };
  }
  return failure(error, errorKey);
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
    return withFields(error, 'students.createFailed');
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
    return withFields(error, 'students.saveFailed');
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
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
} {
  return {
    name: String(formData.get('name') ?? '').trim(),
    minAgeMonths: ageBound(formData, 'minAgeMonths'),
    maxAgeMonths: ageBound(formData, 'maxAgeMonths'),
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
  minAgeMonths: number | null,
  maxAgeMonths: number | null,
): Promise<number> {
  const params = new URLSearchParams();
  if (minAgeMonths !== null) params.set('minAgeMonths', String(minAgeMonths));
  if (maxAgeMonths !== null) params.set('maxAgeMonths', String(maxAgeMonths));

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
