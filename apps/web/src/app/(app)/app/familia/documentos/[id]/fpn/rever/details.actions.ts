'use server';

import { ApiError, apiPatch } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../../../../../../dashboard/actions';
import { viewRefusal } from '@/lib/form-failure';

const ID = /^[0-9a-f-]{36}$/i;

/**
 * The person's corrections to the FPN form's details — POOLSE-193. The API decides
 * who may and checks every value; this carries the form and says the answer.
 */
export async function saveFpnDetailsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const child = String(formData.get('child') ?? '');
  if (!ID.test(child)) return { ok: false, errorKey: 'app.documents.review.failed' };
  const text = (name: string): string => String(formData.get(name) ?? '');
  try {
    await apiPatch(`/app/documents/fpn?child=${encodeURIComponent(child)}`, {
      addressLine: text('addressLine'),
      locality: text('locality'),
      postalCode: text('postalCode'),
      idDocumentType: text('idDocumentType'),
      idDocumentNumber: text('idDocumentNumber'),
      idDocumentIssuedOn: text('idDocumentIssuedOn'),
      idDocumentValidUntil: text('idDocumentValidUntil'),
      disciplines: formData.getAll('disciplines').map(String),
    });
    return { ok: true, toastKey: 'app.documents.review.saved' };
  } catch (error) {
    const view = viewRefusal(error);
    if (view !== null) return view;
    if (error instanceof ApiError && error.code === 'already_sent') {
      return { ok: false, errorKey: 'app.documents.review.locked' };
    }
    return describeFailure(error, 'app.documents.review.failed');
  }
}
