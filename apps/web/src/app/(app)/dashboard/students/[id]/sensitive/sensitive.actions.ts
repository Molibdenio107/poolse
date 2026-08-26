'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost, apiPut } from '../../../../../../lib/api';
import type { FormState } from '../../../actions';

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    if (error.status === 409) return { ok: false, errorKey: 'sensitive.alreadyRecorded' };
    if (error.status === 403) return { ok: false, errorKey: 'sensitive.notPermitted' };
    if (error.status < 500) return { ok: false, errorKey };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

export async function saveNotesAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const studentId = String(formData.get('studentId') ?? '');

  try {
    // PUT, not PATCH: an empty box means "there are no medical notes", which is
    // a different and equally real statement from "leave what is there alone".
    await apiPut(
      `/students/${studentId}/sensitive`,
      { medicalNotes: String(formData.get('medicalNotes') ?? '') },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'sensitive.saveFailed');
  }

  revalidatePath(`/dashboard/students/${studentId}/sensitive`);
  return { ok: true };
}

export async function recordConsentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const studentId = String(formData.get('studentId') ?? '');

  try {
    await apiPost(
      `/students/${studentId}/consent`,
      {
        kind: String(formData.get('kind') ?? ''),
        granted: String(formData.get('granted') ?? '') === 'true',
        evidenceNote: String(formData.get('evidenceNote') ?? '').trim(),
      },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'sensitive.consentFailed');
  }

  revalidatePath(`/dashboard/students/${studentId}/sensitive`);
  return { ok: true };
}

export async function withdrawConsentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const studentId = String(formData.get('studentId') ?? '');
  const consentId = String(formData.get('consentId') ?? '');

  try {
    await apiPost(
      `/students/${studentId}/consent/${consentId}/withdraw`,
      {},
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'sensitive.withdrawFailed');
  }

  revalidatePath(`/dashboard/students/${studentId}/sensitive`);
  return { ok: true };
}
