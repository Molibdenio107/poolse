'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost, apiPut } from '@/lib/api';
import { parseCents } from '@/lib/money';
import type { FormState } from '../../actions';

/**
 * Recording a cost — POOLSE-189. Every amount is typed through `parseCents`, and
 * the API decides who may record what; maintenance is answered with an id, never
 * a total. A cost is never edited: a mistake is archived and recorded again.
 */

const CUSTOS = '/dashboard/faturacao/custos';

function text(data: FormData, name: string): string {
  return String(data.get(name) ?? '').trim();
}

/** `null` is an amount nobody could read; an empty optional box is 0. */
function vatOf(data: FormData): number | null {
  const raw = text(data, 'vat');
  return raw === '' ? 0 : parseCents(raw);
}

function refused(error: unknown): FormState {
  if (error instanceof ApiError && error.status === 403) return { ok: false, errorKey: 'costs.record.notAllowed' };
  if (error instanceof ApiError && error.status === 404) return { ok: false, errorKey: 'costs.record.gone' };
  return { ok: false, errorKey: 'costs.record.failed' };
}

export async function recordCostAction(_previous: FormState, data: FormData): Promise<FormState> {
  const amountCents = parseCents(text(data, 'amount'));
  const vatCents = vatOf(data);
  const repeat = text(data, 'recurrence');
  const from = text(data, 'from');
  const to = text(data, 'to');
  const fields: Record<string, string> = {};
  if (amountCents === null) fields['amount'] = 'costs.record.amountInvalid';
  if (vatCents === null) fields['vat'] = 'costs.record.amountInvalid';
  if (from === '') fields['from'] = 'costs.record.dateNeeded';
  if (repeat === 'none' && to === '') fields['to'] = 'costs.record.dateNeeded';
  if (to !== '' && from !== '' && to < from) fields['to'] = 'costs.record.dateOrder';
  if (Object.keys(fields).length > 0) return { ok: false, fields };

  try {
    await apiPost('/costs', {
      kind: text(data, 'kind'),
      amountCents,
      vatCents,
      recurrence: repeat,
      ...(repeat === 'none'
        ? { periodFrom: from, periodTo: to }
        : { effectiveFrom: from, ...(to === '' ? {} : { effectiveTo: to }) }),
      supplier: text(data, 'supplier'),
      documentNumber: text(data, 'documentNumber'),
      note: text(data, 'note'),
    });
  } catch (error) {
    return refused(error);
  }
  revalidatePath(CUSTOS);
  return { ok: true };
}

/** Not paid, or recorded by mistake. On a recurring cost, it stops the months to come. */
export async function archiveCostAction(_previous: FormState, data: FormData): Promise<FormState> {
  try {
    await apiPost(`/costs/${encodeURIComponent(text(data, 'id'))}/archive`, {});
  } catch (error) {
    return refused(error);
  }
  revalidatePath(CUSTOS);
  return { ok: true };
}

export async function recordPurchaseAction(_previous: FormState, data: FormData): Promise<FormState> {
  const amountCents = parseCents(text(data, 'amount'));
  const vatCents = vatOf(data);
  const quantity = Number(text(data, 'quantity'));
  const boughtOn = text(data, 'boughtOn');
  const fields: Record<string, string> = {};
  if (amountCents === null) fields['amount'] = 'costs.record.amountInvalid';
  if (vatCents === null) fields['vat'] = 'costs.record.amountInvalid';
  if (!Number.isInteger(quantity) || quantity < 1) fields['quantity'] = 'costs.record.quantityInvalid';
  if (boughtOn === '') fields['boughtOn'] = 'costs.record.dateNeeded';
  if (Object.keys(fields).length > 0) return { ok: false, fields };

  try {
    await apiPost('/costs/purchases', {
      inventoryItemId: text(data, 'itemId'),
      quantity,
      amountCents,
      vatCents,
      boughtOn,
      supplier: text(data, 'supplier'),
      documentNumber: text(data, 'documentNumber'),
    });
  } catch (error) {
    return refused(error);
  }
  revalidatePath('/dashboard/facilities/inventory');
  return { ok: true };
}

export async function recordServiceAction(_previous: FormState, data: FormData): Promise<FormState> {
  const amountCents = parseCents(text(data, 'amount'));
  const vatCents = vatOf(data);
  const performedOn = text(data, 'performedOn');
  const fields: Record<string, string> = {};
  if (amountCents === null) fields['amount'] = 'costs.record.amountInvalid';
  if (vatCents === null) fields['vat'] = 'costs.record.amountInvalid';
  if (performedOn === '') fields['performedOn'] = 'costs.record.dateNeeded';
  if (Object.keys(fields).length > 0) return { ok: false, fields };

  try {
    await apiPost('/costs/maintenance-service', {
      maintenanceRequestId: text(data, 'requestId'),
      amountCents,
      vatCents,
      performedOn,
      supplier: text(data, 'supplier'),
      documentNumber: text(data, 'documentNumber'),
      note: text(data, 'note'),
    });
  } catch (error) {
    return refused(error);
  }
  return { ok: true };
}

export async function savePremiumAction(_previous: FormState, data: FormData): Promise<FormState> {
  const raw = text(data, 'premium');
  const premiumCents = raw === '' ? null : parseCents(raw);
  const vatCents = vatOf(data);
  const fields: Record<string, string> = {};
  if (raw !== '' && premiumCents === null) fields['premium'] = 'costs.record.amountInvalid';
  if (vatCents === null) fields['vat'] = 'costs.record.amountInvalid';
  if (Object.keys(fields).length > 0) return { ok: false, fields };

  try {
    await apiPut(`/costs/premiums/${encodeURIComponent(text(data, 'policyId'))}`, {
      premiumCents,
      premiumVatCents: premiumCents === null ? null : vatCents,
    });
  } catch (error) {
    return refused(error);
  }
  revalidatePath(`/dashboard/facilities/${text(data, 'facilityId')}`);
  return { ok: true };
}
