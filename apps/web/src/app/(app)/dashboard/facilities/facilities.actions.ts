'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiPatch, apiPost } from '../../../../lib/api';
import { POOL_METRICS } from '../../../../lib/pool-metrics';
import { addDays, today } from '../../../../lib/dates';
import type { FormState } from '../actions';

/**
 * Every action here returns state rather than throwing, for the same reason as
 * the invitation ones: "a site with that name already exists" is something the
 * person fixes by typing, not an error page.
 */

/** Same policy as the invitation actions: see the note on `failure` there. */
function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    if (error.status === 409) return { ok: false, errorKey: 'facilities.duplicate' };
    if (error.status < 500) return { ok: false, errorKey };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

export async function createFacilityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, errorKey: 'facilities.nameRequired' };

  try {
    await apiPost(
      '/facilities',
      {
        name,
        address: String(formData.get('address') ?? '').trim(),
        // From PlaceField, so the weather panel works on the first page load
        // rather than after somebody remembers to set a city — round 5.
        city: String(formData.get('city') ?? '').trim(),
        countryCode: String(formData.get('countryCode') ?? '').trim(),
        latitude: String(formData.get('latitude') ?? '').trim(),
        longitude: String(formData.get('longitude') ?? '').trim(),
        timezone: String(formData.get('timezone') ?? ''),
      },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'facilities.createFailed');
  }

  revalidatePath('/dashboard/facilities');
  // Back to the list, not to a detail page: a site has no screen of its own —
  // its card in the list is where the pools and the photographs are, and adding
  // a pool is the next thing anyone does.
  redirect('/dashboard/facilities');
}

/** Every attribute, sent every time — see the note on updatePool in the API. */
function poolBody(formData: FormData): Record<string, string> {
  return {
    name: String(formData.get('name') ?? '').trim(),
    kind: String(formData.get('kind') ?? 'indoor'),
    // Empty means "not recorded". The API keeps it null rather than inventing a
    // zero, and the CHECK constraints refuse a zero anyway.
    volumeLitres: String(formData.get('volumeLitres') ?? '').trim(),
    laneCount: String(formData.get('laneCount') ?? '').trim(),
    lengthM: String(formData.get('lengthM') ?? '').trim(),
    widthM: String(formData.get('widthM') ?? '').trim(),
    minDepthM: String(formData.get('minDepthM') ?? '').trim(),
    maxDepthM: String(formData.get('maxDepthM') ?? '').trim(),
  };
}

export async function createPoolAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const facilityId = String(formData.get('facilityId') ?? '');
  const body = poolBody(formData);
  if (!body['name']) return { ok: false, errorKey: 'facilities.poolNameRequired' };

  let created: { id: string };
  try {
    created = await apiPost<{ id: string }>(`/facilities/${facilityId}/pools`, body, {
      organizationId,
    });
  } catch (error) {
    return failure(error, 'facilities.poolFailed');
  }

  revalidatePath('/dashboard/facilities');

  // Outside the try: redirect() signals by throwing, and catching it here would
  // turn a successful create into "could not create the pool".
  //
  // Straight to the new pool rather than back to the list, because the next
  // thing anyone wants after describing a pool is to put photographs on it.
  redirect(`/dashboard/facilities/pools/${created.id}`);
}

export async function updatePoolAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const poolId = String(formData.get('poolId') ?? '');
  const body = poolBody(formData);
  if (!body['name']) return { ok: false, errorKey: 'facilities.poolNameRequired' };

  try {
    await apiPatch(`/facilities/pools/${poolId}`, body, { organizationId });
  } catch (error) {
    return failure(error, 'facilities.poolFailed');
  }

  revalidatePath('/dashboard/facilities');
  revalidatePath(`/dashboard/facilities/pools/${poolId}`);
  return { ok: true };
}

export async function archiveFacilityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const facilityId = String(formData.get('facilityId') ?? '');

  try {
    await apiPost(`/facilities/${facilityId}/archive`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'facilities.archiveFailed');
  }

  revalidatePath('/dashboard/facilities');
  return { ok: true };
}

export async function archivePoolAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const poolId = String(formData.get('poolId') ?? '');

  try {
    await apiPost(`/facilities/pools/${poolId}/archive`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'facilities.archiveFailed');
  }

  revalidatePath('/dashboard/facilities');
  return { ok: true };
}

/**
 * Inventory — round 4.
 *
 * Same policy as everything else in this file: a duplicate name or a mistyped
 * count comes back as state the form renders, because both are somebody typing
 * rather than anything going wrong.
 */
export async function addMaterialAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const poolId = String(formData.get('poolId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, errorKey: 'facilities.materialNameRequired' };

  const quantity = Number(String(formData.get('quantity') ?? '0').trim() || '0');
  if (!Number.isInteger(quantity) || quantity < 0) {
    return { ok: false, errorKey: 'facilities.materialQuantityInvalid' };
  }

  try {
    await apiPost(
      `/facilities/pools/${poolId}/materials`,
      {
        name,
        quantity,
        unit: String(formData.get('unit') ?? '').trim(),
        notes: String(formData.get('notes') ?? '').trim(),
      },
      { organizationId },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      // The one duplicate message in this file that is not about a site or a
      // pool: "you already have a row for these" is a different instruction from
      // "that name is taken", because the fix is to correct the count on the row
      // that exists rather than to think of another name.
      return { ok: false, errorKey: 'facilities.materialDuplicate' };
    }
    return failure(error, 'facilities.materialFailed');
  }

  revalidatePath(`/dashboard/facilities/pools/${poolId}`);
  return { ok: true };
}

/** Corrects an item — in practice its count, after somebody has been counting. */
export async function updateMaterialAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const poolId = String(formData.get('poolId') ?? '');
  const materialId = String(formData.get('materialId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, errorKey: 'facilities.materialNameRequired' };

  const quantity = Number(String(formData.get('quantity') ?? '0').trim() || '0');
  if (!Number.isInteger(quantity) || quantity < 0) {
    return { ok: false, errorKey: 'facilities.materialQuantityInvalid' };
  }

  try {
    await apiPatch(
      `/facilities/materials/${materialId}`,
      {
        name,
        quantity,
        unit: String(formData.get('unit') ?? '').trim(),
        notes: String(formData.get('notes') ?? '').trim(),
      },
      { organizationId },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { ok: false, errorKey: 'facilities.materialDuplicate' };
    }
    return failure(error, 'facilities.materialFailed');
  }

  revalidatePath(`/dashboard/facilities/pools/${poolId}`);
  return { ok: true };
}

/** Archived, never deleted: the club had these once, and that is history. */
export async function archiveMaterialAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const poolId = String(formData.get('poolId') ?? '');
  const materialId = String(formData.get('materialId') ?? '');

  try {
    await apiPost(`/facilities/materials/${materialId}/archive`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'facilities.materialFailed');
  }

  revalidatePath(`/dashboard/facilities/pools/${poolId}`);
  return { ok: true };
}


/**
 * Record a water analysis — round 4.
 *
 * The values arrive as one form field per metric and are posted as an object,
 * blanks included: the API drops the empty ones, which keeps "the club only
 * tests three of these" a normal case rather than an error. Nothing here decides
 * a unit — the server looks that up from the metric, so a pH can never be stored
 * as ppm.
 */
export async function recordAnalysisAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const poolId = String(formData.get('poolId') ?? '');
  const takenAt = String(formData.get('takenAt') ?? '').trim();

  if (takenAt === '') return { ok: false, errorKey: 'facilities.analysisMomentRequired' };

  const values: Record<string, string> = {};
  for (const metric of POOL_METRICS) {
    values[metric] = String(formData.get(metric) ?? '').trim();
  }

  // Told here rather than by a 400, because "you filled in the date and nothing
  // else" is a form mistake and deserves a sentence beside the form.
  if (Object.values(values).every((value) => value === '')) {
    return { ok: false, errorKey: 'facilities.analysisEmpty' };
  }

  try {
    await apiPost(
      `/pools/${poolId}/analyses`,
      { takenAt, notes: String(formData.get('notes') ?? '').trim(), values },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'facilities.analysisFailed');
  }

  revalidatePath(`/dashboard/facilities/pools/${poolId}`);
  return { ok: true };
}

export async function archiveAnalysisAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const poolId = String(formData.get('poolId') ?? '');
  const analysisId = String(formData.get('analysisId') ?? '');

  try {
    await apiPost(`/analyses/${analysisId}/archive`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'facilities.analysisFailed');
  }

  revalidatePath(`/dashboard/facilities/pools/${poolId}`);
  return { ok: true };
}

/**
 * Close a pool because its water is out of range — round 4 follow-up.
 *
 * An ordinary closure, created through the ordinary endpoint. It is visible on
 * Encerramentos, removable there, and indistinguishable from one drawn on the
 * calendar by hand — deliberately, because a second kind of closure that only
 * this panel understands is a second thing to remember.
 *
 * The range is computed from a day count rather than asked for as two dates: the
 * operator dosing a pool thinks "three days", not "the 29th to the 31st". One
 * day means today only, so `endsOn` is today plus `days - 1`.
 */
export async function closePoolForWaterAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const poolId = String(formData.get('poolId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();

  const days = Number(String(formData.get('days') ?? '').trim());
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return { ok: false, errorKey: 'facilities.closureDaysInvalid' };
  }

  const from = today();
  const to = addDays(from, days - 1);

  try {
    await apiPost('/closures', { startsOn: from, endsOn: to, reason, poolId }, { organizationId });
  } catch (error) {
    return failure(error, 'facilities.closureFailed');
  }

  revalidatePath(`/dashboard/facilities/pools/${poolId}`);
  revalidatePath('/dashboard/calendar/closures');
  revalidatePath('/dashboard/calendar');
  return { ok: true };
}
