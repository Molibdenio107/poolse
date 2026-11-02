'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiDelete, apiPatch, apiUpload } from '@/lib/api';
import { MAX_FILE_BYTES } from '@/lib/files';
import type { FormState } from '../../../actions';

/**
 * A staff member's contract — POOLSE-149 slice C. The API decides who may (the
 * pay rule: an Admin never the Owner's, nobody but the Owner their own) and
 * names the fields it refuses; these carry the request and bring those back.
 */

function refusal(error: unknown, fallback: string): FormState {
  if (error instanceof ApiError && Object.keys(error.fields).length > 0) {
    return { ok: false, errorKey: 'common.checkTheFields', fields: error.fields };
  }
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    return { ok: false, errorKey: 'staffContract.notAllowed' };
  }
  return { ok: false, errorKey: fallback };
}

export async function saveContractFactsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const membershipId = String(formData.get('membershipId') ?? '');
  try {
    await apiPatch(`/staff/${membershipId}/contract`, {
      kind: String(formData.get('kind') ?? ''),
      startsOn: String(formData.get('startsOn') ?? ''),
      endsOn: String(formData.get('endsOn') ?? ''),
    });
  } catch (error) {
    return refusal(error, 'staffContract.failed');
  }
  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  return { ok: true };
}

export async function uploadContractAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const membershipId = String(formData.get('membershipId') ?? '');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, errorKey: 'files.chooseFile' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, errorKey: 'files.tooLarge' };
  try {
    const query = new URLSearchParams({ name: file.name });
    await apiUpload(`/staff/${membershipId}/contract/file?${query.toString()}`, await file.arrayBuffer());
  } catch (error) {
    return refusal(error, 'files.uploadFailed');
  }
  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  return { ok: true, toastKey: 'staffContract.filed' };
}

export async function removeContractAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const membershipId = String(formData.get('membershipId') ?? '');
  try {
    await apiDelete(`/staff/${membershipId}/contract/file`);
  } catch (error) {
    return refusal(error, 'staffContract.failed');
  }
  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  return { ok: true, toastKey: 'staffContract.removed' };
}
