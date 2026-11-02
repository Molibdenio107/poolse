'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPatch } from '@/lib/api';
import type { FormState } from '../../../actions';

/**
 * The sports a staff member belongs to — POOLSE-145. Owner and admin; the API
 * refuses anybody else, an empty list and a sport the club has off, each under
 * the field.
 */
export async function saveStaffSportsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const membershipId = String(formData.get('membershipId') ?? '');
  try {
    await apiPatch(`/staff/${membershipId}/sports`, { sports: formData.getAll('sport').map(String) });
  } catch (error) {
    if (error instanceof ApiError && Object.keys(error.fields).length > 0) {
      return { ok: false, errorKey: 'common.checkTheFields', fields: error.fields };
    }
    if (error instanceof ApiError && error.status === 403) return { ok: false, errorKey: 'common.notAllowed' };
    return { ok: false, errorKey: 'common.notSaved' };
  }
  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  revalidatePath('/dashboard/facilities/staff');
  return { ok: true };
}
