'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost } from '@/lib/api';
import type { FormState } from '../actions';

const ID = /^[0-9a-f-]{36}$/i;

/**
 * *O acesso é do encarregado* — POOLSE-218, rule 5. The API turns the student's
 * own login into the student's encarregado, in one transaction, after the
 * person confirmed; owner and admin only, refused server-side for anybody else.
 */
export async function handToGuardianAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get('studentId') ?? '');
  if (!ID.test(studentId)) return { ok: false, errorKey: 'childLogin.failed' };
  try {
    await apiPost(`/students/${studentId}/access/hand-to-guardian`, {});
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return { ok: false, errorKey: 'childLogin.notApplicable' };
    if (error instanceof ApiError && error.status === 403) return { ok: false, errorKey: 'grid.notAllowed' };
    return { ok: false, errorKey: 'childLogin.failed' };
  }
  revalidatePath(`/dashboard/students/${studentId}`);
  revalidatePath('/dashboard/students');
  return { ok: true, toastKey: 'childLogin.done' };
}
