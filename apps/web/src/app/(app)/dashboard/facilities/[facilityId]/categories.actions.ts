'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch, apiPatch, apiPost, type FeeCategory } from '@/lib/api';
import { parseCents } from '@/lib/money';
import type { FormState } from '../../actions';

/**
 * The club's fee categories — round 19, moved here from Alunos.
 *
 * A category is the reason one person pays a different price from the person in
 * the next lane, and since round 19 it carries what that is worth. It belongs
 * beside the price list it modifies: the panel lives on each site's page, the
 * list itself is the *club's* and is the same on every one of them.
 *
 * The endpoint is organization-scoped, so the facility id here is only the path
 * to revalidate. That is deliberate — a "Sénior" meaning one thing at one pool
 * and another at the next is a concession nobody could report on.
 */

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
  /**
   * Whether this reader may see what a category is worth.
   *
   * Its own answer rather than something inferred from null values, because
   * "this category has no discount" and "you may not see amounts" are different
   * facts and only a blank would make them look the same.
   */
  canSeeValues: boolean;
} | null> {
  try {
    return await apiFetch<{
      categories: FeeCategory[];
      canManage: boolean;
      canSeeValues: boolean;
    }>('/fee-categories');
  } catch {
    // Null for anybody the endpoint refuses, exactly as the price list does.
    return null;
  }
}

/**
 * Saving a category, value and all.
 *
 * The amount is turned into integer cents **here**, by `parseCents`, which is
 * what every other money field on this page does — the API takes cents and
 * refuses anything else rather than rounding a stray "35,5 %" into something
 * plausible.
 */
export async function saveCategoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get('categoryId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const sortOrder = Number(formData.get('sortOrder') ?? 0);
  const facilityId = String(formData.get('facilityId') ?? '').trim();

  // Checked here as well, so an empty name does not cost a round trip to be
  // told the obvious.
  if (name === '') return { ok: false, fields: { name: 'categories.nameRequired' } };

  const kind = String(formData.get('discountKind') ?? 'none');
  const raw = String(formData.get('discountValue') ?? '').trim();

  let discountPercent: number | null = null;
  let discountCents: number | null = null;

  if (kind === 'percent') {
    // Either decimal mark, because a Portuguese keyboard writes 7,5 and the
    // number input on a phone writes 7.5 — the same normalisation `parseCents`
    // does for an amount.
    const percent = Number(raw.replace(',', '.'));
    if (raw === '' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      return { ok: false, fields: { discountValue: 'categories.percentRange' } };
    }
    discountPercent = percent;
  } else if (kind === 'amount') {
    const cents = parseCents(raw);
    if (cents === null) return { ok: false, fields: { discountValue: 'categories.amountInvalid' } };
    discountCents = cents;
  }

  const body = {
    name,
    sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
    discountPercent,
    discountCents,
  };

  try {
    if (id === '') await apiPost('/fee-categories', body);
    else await apiPatch(`/fee-categories/${id}`, body);
  } catch (error) {
    return failure(error, 'categories.saveFailed');
  }

  revalidatePath(`/dashboard/facilities/${facilityId}`);
  return { ok: true };
}

export async function archiveCategoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get('categoryId') ?? '').trim();
  const facilityId = String(formData.get('facilityId') ?? '').trim();

  try {
    await apiPost(`/fee-categories/${id}/archive`, {});
  } catch (error) {
    return failure(error, 'categories.saveFailed');
  }

  revalidatePath(`/dashboard/facilities/${facilityId}`);
  return { ok: true };
}
