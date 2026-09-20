'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, apiPatch, apiPost, type MeterDetail, type MeterList } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../actions';

/**
 * Energy — slices 5.1 and 5.2.
 *
 * The same shape as planned maintenance: a read returns null when the endpoint
 * refuses, so the panel is absent rather than empty; every action posts and
 * lets the API answer, and `canPlan` / `canRecord` travel with the read only so
 * the screen can avoid offering a control that would be refused.
 */

/*
 * Every screen a reading changes: the site's panel (latest figure, this
 * month), and the meter's own page (the list and the chart).
 */
function refresh(facilityId: string, meterId?: string): void {
  revalidatePath('/dashboard/energy');
  revalidatePath(`/dashboard/facilities/${facilityId}`);
  if (meterId !== undefined) revalidatePath(`/dashboard/facilities/energy/${meterId}`);
}

export async function listMeters(facilityId: string): Promise<MeterList | null> {
  return apiFetch<MeterList>(`/energy/facilities/${facilityId}/meters`).catch(() => null);
}

export async function getMeter(meterId: string): Promise<MeterDetail | null> {
  return apiFetch<MeterDetail>(`/energy/meters/${meterId}`).catch(() => null);
}

/**
 * What the meter form posts, read once.
 *
 * Numbers are text fields, for the reason every numeric field here is — a
 * number input refuses silently and the form then does nothing with no
 * explanation (POOLSE-QA-07). The API validates and names the field. A comma
 * is accepted as the decimal mark, because a Portuguese keyboard types one.
 */
function meterBody(formData: FormData): Record<string, unknown> {
  const initial = String(formData.get('initialIndex') ?? '').trim().replace(',', '.');
  return {
    name: String(formData.get('name') ?? '').trim(),
    kind: String(formData.get('kind') ?? ''),
    unit: String(formData.get('unit') ?? '').trim(),
    reads: String(formData.get('reads') ?? 'cumulative_index'),
    initialIndex: initial === '' ? null : Number(initial),
    poolId: String(formData.get('poolId') ?? ''),
    replacedMeterId: String(formData.get('replacedMeterId') ?? ''),
    cpe: String(formData.get('cpe') ?? '').trim(),
    serial: String(formData.get('serial') ?? '').trim(),
    notes: String(formData.get('notes') ?? '').trim(),
  };
}

export async function createMeter(_previous: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');

  try {
    await apiPost(`/energy/facilities/${facilityId}/meters`, meterBody(formData));
  } catch (error) {
    return describeFailure(error, 'energy.saveFailed');
  }

  refresh(facilityId);
  return { ok: true };
}

export async function updateMeter(_previous: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const meterId = String(formData.get('meterId') ?? '');

  try {
    await apiPatch(`/energy/meters/${meterId}`, meterBody(formData));
  } catch (error) {
    return describeFailure(error, 'energy.saveFailed');
  }

  refresh(facilityId, meterId);
  return { ok: true };
}

export async function archiveMeter(_previous: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const meterId = String(formData.get('meterId') ?? '');

  try {
    await apiPost(`/energy/meters/${meterId}/archive`, {});
  } catch (error) {
    return describeFailure(error, 'energy.saveFailed');
  }

  refresh(facilityId, meterId);
  return { ok: true };
}

/**
 * A figure off the dial.
 *
 * `takenAt` arrives as the `datetime-local` string the browser produced, in the
 * operator's own clock; `new Date` reads it as local time on the server, which
 * is the same machine's idea of local. Good enough for a monthly figure —
 * nothing here is minute-sensitive — and the alternative is a timezone picker
 * on a form whose whole content is one number.
 */
export async function recordReading(_previous: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const meterId = String(formData.get('meterId') ?? '');
  const takenAtRaw = String(formData.get('takenAt') ?? '').trim();
  const takenAt = takenAtRaw === '' ? '' : new Date(takenAtRaw).toISOString();

  try {
    await apiPost(`/energy/meters/${meterId}/readings`, {
      takenAt,
      value: Number(String(formData.get('value') ?? '').trim().replace(/\s/g, '').replace(',', '.')),
      note: String(formData.get('note') ?? '').trim(),
    });
  } catch (error) {
    return describeFailure(error, 'energy.readingFailed');
  }

  refresh(facilityId, meterId);
  return { ok: true };
}

export async function removeReading(_previous: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const meterId = String(formData.get('meterId') ?? '');

  try {
    await apiPost(`/energy/meters/${meterId}/readings/archive`, {
      takenAt: String(formData.get('takenAt') ?? ''),
    });
  } catch (error) {
    return describeFailure(error, 'energy.saveFailed');
  }

  refresh(facilityId, meterId);
  return { ok: true };
}

/**
 * What the tariff form posts — slice 5.3.
 *
 * **The price is not run through `parseCents`.** A unit price is
 * `numeric(12,6)` precisely so €0.1548/kWh survives; reading it as cents would
 * make it €0.15 and put a 3% error on the module whose purpose is cost
 * accuracy. A comma is accepted as the decimal mark, because a Portuguese
 * keyboard types one; the API validates the rest and names the field.
 *
 * An empty bound is null rather than zero — "not measured", as every optional
 * figure in this schema is.
 */
function tariffBody(formData: FormData): Record<string, unknown> {
  const decimal = (field: string): number | null => {
    const raw = String(formData.get(field) ?? '').trim().replace(/\s/g, '').replace(',', '.');
    return raw === '' ? null : Number(raw);
  };

  return {
    unitPrice: decimal('unitPrice'),
    unitPriceLow: decimal('unitPriceLow'),
    unitPriceHigh: decimal('unitPriceHigh'),
    provenance: String(formData.get('provenance') ?? 'contracted'),
    effectiveFrom: String(formData.get('effectiveFrom') ?? '').trim(),
    effectiveTo: String(formData.get('effectiveTo') ?? '').trim(),
    note: String(formData.get('note') ?? '').trim(),
  };
}

/** A new rate, from a day. The overlap is the database's to refuse. */
export async function setTariff(_previous: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const meterId = String(formData.get('meterId') ?? '');

  try {
    await apiPost(`/energy/meters/${meterId}/tariffs`, tariffBody(formData));
  } catch (error) {
    return describeFailure(error, 'energy.tariff.saveFailed');
  }

  refresh(facilityId, meterId);
  return { ok: true };
}

/** A rate that was typed wrong. A rate that *changed* is a new row, not this. */
export async function correctTariff(_previous: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const meterId = String(formData.get('meterId') ?? '');
  const tariffId = String(formData.get('tariffId') ?? '');

  try {
    await apiPatch(`/energy/meters/${meterId}/tariffs/${tariffId}`, tariffBody(formData));
  } catch (error) {
    return describeFailure(error, 'energy.tariff.saveFailed');
  }

  refresh(facilityId, meterId);
  return { ok: true };
}

/** A rate that never applied. The months it priced go back to dashes. */
export async function removeTariff(_previous: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const meterId = String(formData.get('meterId') ?? '');
  const tariffId = String(formData.get('tariffId') ?? '');

  try {
    await apiPost(`/energy/meters/${meterId}/tariffs/${tariffId}/archive`, {});
  } catch (error) {
    return describeFailure(error, 'energy.tariff.saveFailed');
  }

  refresh(facilityId, meterId);
  return { ok: true };
}
