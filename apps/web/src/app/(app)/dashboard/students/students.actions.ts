'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  ApiError,
  apiFetch,
  apiPatch,
  apiPost,
  type DuplicateMatch,
  type PersonSummary,
  type Skill,
} from '../../../../lib/api';
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
function studentBody(formData: FormData): Record<string, unknown> {
  const text = (field: string): string => String(formData.get(field) ?? '').trim();

  return {
    firstName: text('firstName'),
    lastName: text('lastName'),
    birthDate: text('birthDate'),
    levelId: text('levelId'),
    contactEmail: text('contactEmail'),
    contactPhone: text('contactPhone'),
    notes: text('notes'),
  };
}

/**
 * The guardians the form is showing — POOLSE-04, POOLSE-17.
 *
 * One JSON field rather than indexed input names. The block posts the whole set,
 * including for an adult: it hides rather than unmounts, and a form that stopped
 * submitting what it was still showing would be the worse of the two surprises.
 *
 * A malformed value becomes an empty list rather than an exception. This is a
 * hidden field the browser wrote; if it is not what we expect, something is
 * wrong in a way an error page cannot help with, and refusing to save the rest
 * of the student would help less.
 */
function guardiansFrom(formData: FormData): unknown[] {
  const raw = String(formData.get('guardians') ?? '');
  if (raw.trim() === '') return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
  const body: Record<string, unknown> = {
    ...studentBody(formData),
    guardians: guardiansFrom(formData),
  };
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
  const body: Record<string, unknown> = {
    ...studentBody(formData),
    guardians: guardiansFrom(formData),
  };
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

/**
 * People matching what somebody is typing — POOLSE-17.
 *
 * A server action rather than a fetch from the browser, for the same reason as
 * every other call here: the Clerk session token stays on the server and there
 * is no CORS surface to keep in step across two environments.
 *
 * Returns an empty list on failure. A search box that shows nothing is a search
 * box that found nothing; one that throws takes the whole student form down
 * because somebody typed while the API was restarting.
 */
export async function searchPeopleAction(query: string): Promise<PersonSummary[]> {
  try {
    const result = await apiFetch<{ people: PersonSummary[] }>(
      `/people-search?q=${encodeURIComponent(query)}`,
    );
    return result.people;
  } catch {
    return [];
  }
}

/**
 * The skills of one level — POOLSE-20.
 *
 * Fetched from the level list rather than sent with it, because most visits to
 * that page are about levels and not about skills: loading every skill of every
 * level to render a page that usually shows none of them is work nobody asked
 * for.
 */
export async function skillsOfAction(levelId: string): Promise<Skill[]> {
  try {
    const result = await apiFetch<{ skills: Skill[] }>(
      `/skills?levelId=${encodeURIComponent(levelId)}`,
    );
    return result.skills;
  } catch {
    return [];
  }
}

export async function createSkillAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const text = (field: string): string => String(formData.get(field) ?? '').trim();

  const name = text('name');
  if (name === '') return { ok: false, fields: { name: 'skills.nameRequired' } };

  try {
    await apiPost(
      '/skills',
      {
        levelId: text('levelId'),
        name,
        minDays: text('minDays'),
        minLessons: text('minLessons'),
        videoUrl: text('videoUrl'),
      },
      { organizationId },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { ok: false, fields: { name: 'skills.duplicate' } };
    }
    return { ok: false, errorKey: 'skills.createFailed' };
  }

  revalidatePath('/dashboard/students/levels');
  return { ok: true };
}

export async function archiveSkillAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const skillId = String(formData.get('skillId') ?? '');

  try {
    await apiPost(`/skills/${skillId}/archive`, {}, { organizationId });
  } catch {
    return { ok: false, errorKey: 'skills.createFailed' };
  }

  revalidatePath('/dashboard/students/levels');
  return { ok: true };
}

/**
 * Is this person already here? — POOLSE-17 AC9.
 *
 * Called as the guardian block is filled in, so the warning appears before a
 * second record exists rather than after. Returns null on failure: a dedup check
 * that cannot reach the API must not stop somebody enrolling a child.
 */
export async function findDuplicateAction(
  taxNumber: string,
  email: string,
): Promise<DuplicateMatch | null> {
  const nif = taxNumber.trim();
  const address = email.trim();
  if (nif === '' && address === '') return null;

  try {
    const result = await apiFetch<{ match: DuplicateMatch | null }>(
      `/people/duplicate?taxNumber=${encodeURIComponent(nif)}&email=${encodeURIComponent(address)}`,
    );
    return result.match;
  } catch {
    return null;
  }
}

/** AC9's other half: add the role to the person who is already there. */
export async function grantRoleAction(
  organizationId: string,
  membershipId: string,
  role: string,
): Promise<boolean> {
  try {
    await apiPost(`/people/${membershipId}/roles`, { role }, { organizationId });
    revalidatePath('/dashboard/students/guardians');
    revalidatePath('/dashboard/facilities/staff');
    return true;
  } catch {
    return false;
  }
}

/**
 * The order skills are taught in — POOLSE-40 AC7.
 *
 * Meaningful rather than cosmetic: POOLSE-19 will read it to decide when a level
 * is finished. Returns nothing — `Reorderable` rolls its own list back when the
 * promise rejects, which is what makes the optimistic move safe.
 */
export async function reorderSkillsAction(
  organizationId: string,
  levelId: string,
  ids: string[],
): Promise<void> {
  await apiPost('/skills/reorder', { levelId, ids }, { organizationId });
}

/**
 * Create a level and hand back its id — round 4.
 *
 * A second entry point to the same endpoint, and it exists because of one HTML
 * rule: the turma form is a `<form>`, and a form cannot contain another form, so
 * the "new level" panel on that page cannot submit the way `createLevelAction`
 * is submitted. This is called directly instead, with plain arguments rather
 * than `FormData`, and returns the new id so the picker can select what the
 * operator just created — which is the entire point of creating it there.
 *
 * Server-side permission is unchanged: `POST /levels` is owner and admin only
 * and does its own check. Nothing here is a shortcut around that.
 */
export async function createLevelInline(
  organizationId: string,
  name: string,
  minAgeMonths: string,
  maxAgeMonths: string,
): Promise<{ ok: true; id: string; name: string } | { ok: false; errorKey: string }> {
  const trimmed = name.trim();
  if (trimmed === '') return { ok: false, errorKey: 'students.levelNameRequired' };

  try {
    const created = await apiPost<{ id: string }>(
      '/levels',
      {
        name: trimmed,
        minAgeMonths: minAgeMonths.trim() === '' ? null : Number(minAgeMonths),
        maxAgeMonths: maxAgeMonths.trim() === '' ? null : Number(maxAgeMonths),
      },
      { organizationId },
    );

    // The levels list and anything that offers levels as choices.
    revalidatePath('/dashboard/students/levels');
    revalidatePath('/dashboard/classes');

    return { ok: true, id: created.id, name: trimmed };
  } catch (error) {
    const failed = failure(error, 'students.levelFailed');
    return { ok: false, errorKey: failed.errorKey ?? 'students.levelFailed' };
  }
}
