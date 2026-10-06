'use server';

import { revalidatePath } from 'next/cache';
import { apiPut } from '../../../lib/api';

/**
 * Remembers which site the dashboard shows — POOLSE-66 AC 10.
 *
 * On the person's membership rather than in a cookie, so the choice follows
 * them from the office laptop to their phone. Null is every site. Answers
 * rather than throws: a refused choice is a toast, never the error page.
 */
export async function rememberScopeAction(facilityId: string | null): Promise<{ ok: boolean }> {
  try {
    await apiPut('/dashboard/scope', { facilityId });
  } catch {
    return { ok: false };
  }
  revalidatePath('/dashboard');
  return { ok: true };
}
