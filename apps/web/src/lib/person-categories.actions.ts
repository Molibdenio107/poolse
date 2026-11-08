'use server';

import { ApiError, apiFetch, apiPatch, apiPost, type FeeCategory, type PersonCategory } from '@/lib/api';
import { outcome, type Outcome } from '@/lib/load-failure';
import type { FormState } from '@/app/(app)/dashboard/actions';

/**
 * A category on the person — POOLSE-202. The card on a student's record and in
 * Receção's person panel loads and saves through these. Each one is a public
 * endpoint like every server action; the API refuses anybody but the office.
 */

export type PersonRef = { studentId: string } | { membershipId: string };

export interface PersonCategoriesLoad {
  categories: PersonCategory[];
  /** The club's live categories, top rank first, for the add form. */
  options: { id: string; name: string }[];
}

export async function loadPersonCategories(person: PersonRef): Promise<Outcome<PersonCategoriesLoad>> {
  // Encoded: a server action is a public endpoint, and its argument is the caller's.
  const query =
    'studentId' in person
      ? `studentId=${encodeURIComponent(person.studentId)}`
      : `membershipId=${encodeURIComponent(person.membershipId)}`;
  return outcome(
    Promise.all([
      apiFetch<{ categories: PersonCategory[] }>(`/person-categories?${query}`),
      apiFetch<{ categories: FeeCategory[] }>('/fee-categories'),
    ]).then(([held, club]) => ({
      categories: held.categories,
      options: [...club.categories]
        .sort((a, b) => a.rank - b.rank)
        .map((one) => ({ id: one.id, name: one.name })),
    })),
  );
}

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    if (Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
    if (error.status === 404) return { ok: false, errorKey: 'personCategories.errors.gone' };
    if (error.status < 500) return { ok: false, errorKey };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

function value(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

function dates(formData: FormData): { proofSeenOn: string; validUntil: string | null; notes: string | null } {
  const validUntil = value(formData, 'validUntil');
  const notes = value(formData, 'notes');
  return {
    proofSeenOn: value(formData, 'proofSeenOn'),
    validUntil: validUntil === '' ? null : validUntil,
    notes: notes === '' ? null : notes,
  };
}

export async function addPersonCategoryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const studentId = value(formData, 'studentId');
  const membershipId = value(formData, 'membershipId');
  const categoryId = value(formData, 'categoryId');
  if (categoryId === '') return { ok: false, fields: { categoryId: 'personCategories.errors.categoryRequired' } };
  try {
    await apiPost('/person-categories', {
      ...(studentId !== '' ? { studentId } : { membershipId }),
      categoryId,
      ...dates(formData),
    });
  } catch (error) {
    return failure(error, 'personCategories.errors.saveFailed');
  }
  return { ok: true };
}

export async function renewPersonCategoryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const id = value(formData, 'personCategoryId');
  try {
    await apiPatch(`/person-categories/${encodeURIComponent(id)}`, dates(formData));
  } catch (error) {
    return failure(error, 'personCategories.errors.saveFailed');
  }
  return { ok: true };
}

export async function removePersonCategoryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const id = value(formData, 'personCategoryId');
  try {
    await apiPost(`/person-categories/${encodeURIComponent(id)}/archive`, {});
  } catch (error) {
    return failure(error, 'personCategories.errors.removeFailed');
  }
  return { ok: true };
}
