'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch, apiPatch, apiPost, type FeeCategory } from '@/lib/api';
import type { FormState } from '../../actions';

/**
 * The club's fee categories — POOLSE-23 AC4.
 *
 * A category is a *label*: the reason one person pays a different price from the
 * person in the next lane. What it is worth belongs to the pricing engine, which
 * is not built, so nothing here carries an amount.
 */

const PATH = '/dashboard/students/categories';

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    // The field message first, whatever the status: a duplicate name names the
    // box that holds it, and a sentence about saving does not.
    if (Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };

    /*
     * The two figures travel as values, not inside the sentence — the same
     * contract every refusal that needs numbers uses. "2 turmas e 5 inscrições"
     * is one translation entry per language rather than a string built here.
     */
    if (error.status === 409 && error.code === 'fee_category_in_use') {
      const values = (error.details as { values?: Record<string, number> } | null)?.values;
      return {
        ok: false,
        errorKey: 'categories.inUse',
        values: {
          groups: values?.['groups'] ?? 0,
          enrollments: values?.['enrollments'] ?? 0,
        },
      };
    }
    if (error.status < 500) return { ok: false, errorKey, detail: error.message };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

export async function listCategories(): Promise<{
  categories: FeeCategory[];
  canManage: boolean;
} | null> {
  try {
    return await apiFetch<{ categories: FeeCategory[]; canManage: boolean }>('/fee-categories');
  } catch {
    // Null for anybody the endpoint refuses, exactly as the price list does.
    return null;
  }
}

export async function saveCategoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get('categoryId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const sortOrder = Number(formData.get('sortOrder') ?? 0);

  // Checked here as well, so an empty name does not cost a round trip to be
  // told the obvious.
  if (name === '') return { ok: false, fields: { name: 'categories.nameRequired' } };

  const body = { name, sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0 };

  try {
    if (id === '') await apiPost('/fee-categories', body);
    else await apiPatch(`/fee-categories/${id}`, body);
  } catch (error) {
    return failure(error, 'categories.saveFailed');
  }

  revalidatePath(PATH);
  return { ok: true };
}

export async function archiveCategoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get('categoryId') ?? '').trim();

  try {
    await apiPost(`/fee-categories/${id}/archive`, {});
  } catch (error) {
    return failure(error, 'categories.saveFailed');
  }

  revalidatePath(PATH);
  return { ok: true };
}
