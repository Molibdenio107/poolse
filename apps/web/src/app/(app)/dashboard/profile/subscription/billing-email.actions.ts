'use server';

import { revalidatePath } from 'next/cache';
import { apiPut } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../../actions';

/**
 * The billing email — POOLSE-209. Saved in Poolse first; if Stripe could not be
 * told, the save stands and the screen says the next checkout or portal visit
 * carries it (`stripeSynced: false`), as a note rather than an error.
 */
export async function saveBillingEmailAction(_previous: FormState, formData: FormData): Promise<FormState> {
  let synced = true;
  try {
    const answer = await apiPut<{ stripeSynced: boolean }>('/subscription/billing-email', {
      billingEmail: String(formData.get('billingEmail') ?? ''),
    });
    synced = answer.stripeSynced;
  } catch (error) {
    return describeFailure(error, 'subscription.billingEmail.saveFailed');
  }
  revalidatePath('/dashboard/profile/subscription');
  return synced ? { ok: true } : { ok: true, errorKey: 'subscription.billingEmail.stripeLater' };
}
