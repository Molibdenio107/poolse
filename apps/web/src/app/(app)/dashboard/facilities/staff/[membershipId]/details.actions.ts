'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPatch } from '@/lib/api';
import type { FormState } from '../../../actions';

/** The fields the card may send; one the form did not offer is not sent. */
const FIELDS = [
  'address',
  'locality',
  'postalCode',
  'taxNumber',
  'niss',
  'nationality',
  'birthplace',
  'emergencyName',
  'emergencyPhone',
  'emergencyRelation',
] as const;

/**
 * A staff member's personal details — POOLSE-149 slice A. The API decides who
 * may set what, checks the NIF and NISS, and answers each refusal under its
 * field; this hands it the form and brings those back.
 */
export async function saveDetailsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const membershipId = String(formData.get('membershipId') ?? '');
  const body: Record<string, string> = {};
  for (const field of FIELDS) {
    const value = formData.get(field);
    if (value !== null) body[field] = String(value);
  }

  try {
    await apiPatch(`/staff/${membershipId}/details`, body);
  } catch (error) {
    if (error instanceof ApiError && Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
    if (error instanceof ApiError && error.status === 403) return { ok: false, errorKey: 'staffDetails.notAllowed' };
    return { ok: false, errorKey: 'staffDetails.failed' };
  }
  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  return { ok: true };
}
