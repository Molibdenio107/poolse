'use server';

import { revalidatePath } from 'next/cache';
import { apiPost } from '@/lib/api';
import type { FormState } from '../actions';

const ID = /^[0-9a-f-]{36}$/i;

/**
 * *Fez 18 anos* and the acompanhante warning — POOLSE-207. The API holds every
 * rule (owner and admin, pending only, an acompanhante only); these carry the
 * answer and say so once.
 */

/** *Retirar acompanhante*: archives one accompanying link, on the record. */
export async function removeAcompanhanteAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get('studentId') ?? '');
  const linkId = String(formData.get('linkId') ?? '');
  if (!ID.test(studentId) || !ID.test(linkId)) return { ok: false, errorKey: 'majority.failed' };
  try {
    await apiPost(`/students/${studentId}/guardians/${linkId}/remove-acompanhante`, {});
  } catch {
    return { ok: false, errorKey: 'majority.failed' };
  }
  return { ok: true, toastKey: 'majority.acompanhanteRemoved' };
}

/**
 * One row of *Fez 18 anos*. `invited` first sends the existing student
 * invitation, by email, and records the review only once it has gone.
 */
export async function reviewMajorityAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get('studentId') ?? '');
  const action = String(formData.get('action') ?? '');
  if (!ID.test(studentId) || !['confirmed', 'accompanying', 'invited'].includes(action)) {
    return { ok: false, errorKey: 'majority.failed' };
  }
  try {
    if (action === 'invited') {
      await apiPost(`/students/${studentId}/invitations`, { membershipId: null, channel: 'email' });
    }
    await apiPost(`/students/${studentId}/majority-review`, { action });
  } catch {
    return { ok: false, errorKey: action === 'invited' ? 'majority.inviteFailed' : 'majority.failed' };
  }
  revalidatePath('/dashboard/students/fez-18');
  return { ok: true, toastKey: `majority.done.${action}` };
}
