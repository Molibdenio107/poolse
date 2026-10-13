'use server';

import { revalidatePath } from 'next/cache';
import { apiPost, apiPut } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../../actions';

/** Publishes a new version of a facility's operating regulation — POOLSE-73. */
export async function publishRegulationAction(_p: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '').trim();
  if (body === '') return { ok: false, fields: { body: 'regulation.bodyRequired' } };
  if (effectiveFrom === '') return { ok: false, fields: { effectiveFrom: 'regulation.dateInvalid' } };
  try {
    await apiPost(`/facilities/${facilityId}/regulations`, { body, effectiveFrom });
  } catch (error) {
    return describeFailure(error, 'regulation.publishFailed');
  }
  revalidatePath(`/dashboard/facilities/${facilityId}`);
  return { ok: true, toastKey: 'regulation.published' };
}

/** Withdraws a version published by mistake. Archived, never deleted. */
export async function withdrawRegulationAction(_p: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const regulationId = String(formData.get('regulationId') ?? '');
  try {
    await apiPost(`/facilities/${facilityId}/regulations/${regulationId}/archive`, {});
  } catch (error) {
    return describeFailure(error, 'regulation.withdrawFailed');
  }
  revalidatePath(`/dashboard/facilities/${facilityId}`);
  return { ok: true, toastKey: 'regulation.withdrawn' };
}

/** The club's complaints regime — the same on every site's public pages. */
export async function saveComplaintsAction(_p: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const regime = formData.get('regime') === 'public_service' ? 'public_service' : 'private';
  const url = String(formData.get('url') ?? '').trim();
  if (regime === 'public_service' && url === '') {
    return { ok: false, fields: { url: 'publicNotices.urlRequired' } };
  }
  try {
    await apiPut('/settings/complaints', { regime, url });
  } catch (error) {
    return describeFailure(error, 'publicNotices.saveFailed');
  }
  revalidatePath(`/dashboard/facilities/${facilityId}`);
  return { ok: true };
}
