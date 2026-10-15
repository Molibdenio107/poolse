'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch, apiPatch, apiPost, type PassProduct } from '@/lib/api';
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
