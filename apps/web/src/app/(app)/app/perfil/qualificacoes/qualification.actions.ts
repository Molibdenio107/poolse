'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch, apiPost, apiUpload, type Me } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import { MAX_FILE_BYTES } from '@/lib/files';
import type { FormState } from '@/app/(app)/dashboard/actions';

const text = (formData: FormData, key: string): string => String(formData.get(key) ?? '').trim();

/**
 * A teacher sends their own qualification (Rui, 07-11-2026). Whose it is comes
 * from the session, never the form; the API files it unconfirmed and checks the
 * certificate is one this person uploaded.
 */
export async function sendOwnQualificationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const me = await apiFetch<Me>('/me').catch(() => null);
  const membership = me?.memberships[0];
  if (membership === undefined) return { ok: false, errorKey: 'common.notAllowed' };

  let fileId: string | null = null;
  const file = formData.get('file');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { ok: false, errorKey: 'files.tooLarge' };
    try {
      const query = new URLSearchParams({ purpose: 'qualification_document', name: file.name });
      fileId = (await apiUpload<{ id: string }>(`/files?${query.toString()}`, await file.arrayBuffer())).id;
    } catch (error) {
      return { ok: false, errorKey: error instanceof ApiError && error.status < 500 ? 'files.uploadFailed' : 'common.noAnswer' };
    }
  }

  try {
    await apiPost(
      `/staff/${membership.membershipId}/qualifications`,
      {
        typeId: text(formData, 'typeId'),
        issuingBody: text(formData, 'issuingBody'),
        issuedOn: text(formData, 'issuedOn'),
        expiresOn: text(formData, 'expiresOn'),
        fileId,
      },
      { organizationId: membership.organizationId },
    );
  } catch (error) {
    return describeFailure(error, 'qualifications.error.saveFailed');
  }
  revalidatePath('/app/perfil/qualificacoes');
  return { ok: true, toastKey: 'app.teaching.qualificationSent' };
}
