'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiPatch, apiPost } from '../../../../lib/api';
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
