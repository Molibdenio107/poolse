'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch, apiPatch, apiPost, apiPut, type PassProduct } from '@/lib/api';
import { outcome, type Outcome } from '@/lib/load-failure';
import type { FormState } from '../../actions';

/**
 * What a site sells at reception — POOLSE-68.
 *
 * Amounts cross this boundary as integer cents: the form reads "4,50" and
 * `parseCents` turns it into 450 before it gets here, as on the price list.
 */

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    if (Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
    if (error.status < 500) return { ok: false, errorKey };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

function refresh(facilityId: string): void {
  revalidatePath(`/dashboard/facilities/${facilityId}`);
  revalidatePath('/dashboard/rececao');
}

export async function listPassProducts(
  facilityId: string,
): Promise<Outcome<{ products: PassProduct[]; stayMinutes: number }>> {
  return outcome(
    apiFetch<{ products: PassProduct[]; stayMinutes: number }>(
      `/facilities/${facilityId}/pass-products`,
    ),
  );
}

function wholeOrNull(formData: FormData, name: string): number | string | null {
  const raw = String(formData.get(name) ?? '').trim();
  if (raw === '') return null;
  const value = Number(raw);
  // An unreadable number goes to the API as it was typed, which names the field.
  return Number.isFinite(value) ? value : raw;
}

export async function saveProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const productId = String(formData.get('productId') ?? '');
  const cents = String(formData.get('amountCents') ?? '').trim();
  if (cents === '' || !Number.isInteger(Number(cents))) {
    return { ok: false, fields: { amountCents: 'fees.amountInvalid' } };
  }

  const body = {
    kind: String(formData.get('kind') ?? ''),
    name: String(formData.get('name') ?? '').trim(),
    entries: wholeOrNull(formData, 'entries'),
    validityDays: wholeOrNull(formData, 'validityDays'),
    amountCents: Number(cents),
    vatRate: wholeOrNull(formData, 'vatRate') ?? 0,
    vatExempt: formData.get('vatExempt') === 'on',
    shareable: formData.get('shareable') === 'on',
    soldInApp: formData.get('soldInApp') === 'on',
  };

  try {
    if (productId === '') await apiPost(`/facilities/${facilityId}/pass-products`, body);
    else await apiPatch(`/facilities/${facilityId}/pass-products/${productId}`, body);
  } catch (error) {
    return failure(error, 'passes.saveFailed');
  }
  refresh(facilityId);
  return { ok: true };
}

export async function archiveProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const productId = String(formData.get('productId') ?? '');
  try {
    await apiPost(`/facilities/${facilityId}/pass-products/${productId}/archive`, {});
  } catch (error) {
    return failure(error, 'passes.saveFailed');
  }
  refresh(facilityId);
  return { ok: true };
}

export async function saveStayAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const minutes = Number(String(formData.get('minutes') ?? '').trim());
  try {
    await apiPatch(`/facilities/${facilityId}/reception/stay`, { minutes });
  } catch (error) {
    return failure(error, 'passes.saveFailed');
  }
  refresh(facilityId);
  return { ok: true };
}

/**
 * A price for one set of categories — POOLSE-203. `categoryIds` repeats in the
 * form (one per category); a new combination needs two or more, said in words.
 */
export async function setPriceAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const productId = String(formData.get('productId') ?? '');
  const categoryIds = formData.getAll('categoryIds').map(String).filter((id) => id !== '');
  if (categoryIds.length === 0) return { ok: false, fields: { categoryIds: 'passes.prices.categoriesRequired' } };
  // A combination is two or more; one category has its own row already.
  if (formData.get('combination') === '1' && categoryIds.length < 2) {
    return { ok: false, fields: { categoryIds: 'passes.prices.combinationTwo' } };
  }
  const cents = String(formData.get('amountCents') ?? '').trim();
  if (cents === '' || !Number.isInteger(Number(cents))) {
    return { ok: false, fields: { amountCents: 'fees.amountInvalid' } };
  }
  try {
    await apiPut(`/facilities/${encodeURIComponent(facilityId)}/pass-products/${encodeURIComponent(productId)}/prices`, {
      categoryIds,
      amountCents: Number(cents),
    });
  } catch (error) {
    return failure(error, 'passes.prices.saveFailed');
  }
  refresh(facilityId);
  return { ok: true };
}

export async function archivePriceAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const productId = String(formData.get('productId') ?? '');
  const priceId = String(formData.get('priceId') ?? '');
  try {
    await apiPost(
      `/facilities/${encodeURIComponent(facilityId)}/pass-products/${encodeURIComponent(productId)}/prices/${encodeURIComponent(priceId)}/archive`,
      {},
    );
  } catch (error) {
    return failure(error, 'passes.prices.removeFailed');
  }
  refresh(facilityId);
  return { ok: true };
}
