'use server';

import { revalidatePath } from 'next/cache';
import { apiPut } from '@/lib/api';
import type { FormState } from '../actions';

/**
 * Hides *Vamos começar*, or shows it again — POOLSE-229. The API answers the
 * Owner only and writes the session's own row; this passes the one boolean.
 */
export async function setChecklistDismissedAction(_previous: FormState, form: FormData): Promise<FormState> {
  const dismissed = form.get('dismissed') === 'true';
  try {
    await apiPut('/onboarding/checklist', { dismissed });
  } catch {
    return { ok: false, errorKey: 'checklist.failed' };
  }
  revalidatePath('/dashboard/welcome');
  revalidatePath('/dashboard/profile');
  return { ok: true, toastKey: dismissed ? 'checklist.dismissedToast' : 'checklist.restoredToast' };
}
