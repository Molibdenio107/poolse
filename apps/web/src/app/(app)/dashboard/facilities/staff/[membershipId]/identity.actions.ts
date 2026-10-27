'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPatch } from '@/lib/api';
import type { FormState } from '../../../actions';

/**
 * A staff member's date of birth and ID document — POOLSE-100. The API decides
 * who may, checks the CC number and keeps a login's own date of birth theirs;
 * this hands it the form and brings its field errors back beside their fields.
 */
export async function saveIdentityAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const membershipId = String(formData.get('membershipId') ?? '');
  const body: Record<string, string | null> = {
    idDocumentType: String(formData.get('idDocumentType') ?? '') || null,
    idDocumentNumber: String(formData.get('idDocumentNumber') ?? ''),
  };
  // Only sent when the form offered it: a login's date of birth is theirs.
  if (formData.get('birthDate') !== null) body['birthDate'] = String(formData.get('birthDate') ?? '');

  try {
    await apiPatch(`/staff/${membershipId}/identity`, body);
  } catch (error) {
    if (error instanceof ApiError && Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
    if (error instanceof ApiError && error.status === 403) return { ok: false, errorKey: 'staffIdentity.notAllowed' };
    return { ok: false, errorKey: 'staffIdentity.failed' };
  }
  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  return { ok: true };
}
