'use server';

import { apiPost } from '@/lib/api';
import type { FormState } from '@/app/(app)/dashboard/actions';

const ID = /^[0-9a-f-]{36}$/i;

/**
 * The young adult answers a consent a parent signed — POOLSE-208 rule 1. The API
 * holds every rule (their own login, adult path, a parent's consent); this says
 * the outcome once.
 */
export async function answerConsentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const consentId = String(formData.get('consentId') ?? '');
  const answer = String(formData.get('answer') ?? '');
  if (!ID.test(consentId) || (answer !== 'confirm' && answer !== 'withdraw')) {
    return { ok: false, errorKey: 'app.consents.failed' };
  }
  try {
    await apiPost(`/app/consents/${consentId}/${answer}`, {});
  } catch {
    return { ok: false, errorKey: 'app.consents.failed' };
  }
  return { ok: true, toastKey: answer === 'confirm' ? 'app.consents.confirmed' : 'app.consents.withdrawn' };
}
