'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../../actions';

/**
 * Courts and pitches on a site — POOLSE-125's first piece (Rui, 29-10-2026).
 * The API decides who may (owner, admin) and whether the sport is switched on
 * for the club (403 `sport_not_enabled`); these turn its answer into the toast
 * or a field error.
 */
export async function addRecintoAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  try {
    await apiPost(`/facilities/${facilityId}/playing-areas`, {
      sportId: String(formData.get('sportId') ?? ''),
      name: String(formData.get('name') ?? ''),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 409) return { ok: false, fields: { name: 'recintos.nameTaken' } };
      if (error.status === 403 && error.code === 'sport_not_enabled') {
        return { ok: false, fields: { sportId: 'recintos.sportOff' } };
      }
    }
    return describeFailure(error, 'recintos.addFailed');
  }
  revalidatePath(`/dashboard/facilities/${facilityId}`);
  return { ok: true, toastKey: 'recintos.added' };
}

export async function archiveRecintoAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const areaId = String(formData.get('areaId') ?? '');
  try {
    await apiPost(`/facilities/playing-areas/${areaId}/archive`, {});
  } catch (error) {
    return describeFailure(error, 'recintos.archiveFailed');
  }
  revalidatePath(`/dashboard/facilities/${facilityId}`);
  return { ok: true, toastKey: 'recintos.archived' };
}
