'use server';

import { revalidatePath } from 'next/cache';
import { apiDelete, apiPatch, apiPost, apiPut } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../../../actions';

/**
 * Qualifications — POOLSE-27, 7b.2. Owner and admin; the API refuses anybody
 * else. A record is added or archived, never edited: a correction is archive and
 * add again, so the history of what was on file stays true.
 */

const LIST = '/dashboard/facilities/staff/qualifications';
const text = (formData: FormData, key: string): string => String(formData.get(key) ?? '').trim();
const optionalNumber = (formData: FormData, key: string): number | null | string => {
  const raw = text(formData, key);
  if (raw === '') return null;
  const n = Number(raw);
  // A non-number goes through as-is so the API names the field it refuses.
  return Number.isInteger(n) ? n : raw;
};

export async function addQualificationAction(
  organizationId: string,
  membershipId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await apiPost(
      `/staff/${membershipId}/qualifications`,
      {
        typeId: text(formData, 'typeId'),
        issuingBody: text(formData, 'issuingBody'),
        issuedOn: text(formData, 'issuedOn'),
        expiresOn: text(formData, 'expiresOn'),
      },
      { organizationId },
    );
  } catch (error) {
    return describeFailure(error, 'qualifications.error.saveFailed');
  }
  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  revalidatePath(LIST);
  return { ok: true };
}

export async function archiveQualificationAction(
  organizationId: string,
  membershipId: string,
  qualificationId: string,
): Promise<FormState> {
  try {
    await apiDelete(`/qualifications/${qualificationId}`, { organizationId });
  } catch (error) {
    return describeFailure(error, 'qualifications.error.archiveFailed');
  }
  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  revalidatePath(LIST);
  return { ok: true };
}

function typeBody(formData: FormData): Record<string, unknown> {
  return {
    name: text(formData, 'name'),
    defaultValidityMonths: optionalNumber(formData, 'defaultValidityMonths'),
    amberDays: optionalNumber(formData, 'amberDays'),
    requiredToTeach: formData.get('requiredToTeach') === 'on',
    blocksAssignment: formData.get('blocksAssignment') === 'on',
  };
}

export async function saveTypeAction(
  organizationId: string,
  typeId: string | null,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    if (typeId === null) {
      await apiPost('/qualification-types', typeBody(formData), { organizationId });
    } else {
      await apiPatch(`/qualification-types/${typeId}`, typeBody(formData), { organizationId });
    }
  } catch (error) {
    return describeFailure(error, 'qualifications.error.saveFailed');
  }
  revalidatePath(LIST);
  return { ok: true };
}

export async function archiveTypeAction(organizationId: string, typeId: string): Promise<FormState> {
  try {
    await apiDelete(`/qualification-types/${typeId}`, { organizationId });
  } catch (error) {
    return describeFailure(error, 'qualifications.error.archiveFailed');
  }
  revalidatePath(LIST);
  return { ok: true };
}

export async function saveWindowAction(
  organizationId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await apiPut(
      '/qualification-settings',
      { amberDays: optionalNumber(formData, 'amberDays') },
      { organizationId },
    );
  } catch (error) {
    return describeFailure(error, 'qualifications.error.saveFailed');
  }
  revalidatePath(LIST);
  return { ok: true };
}
