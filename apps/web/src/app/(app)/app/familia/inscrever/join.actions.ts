'use server';

import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { ApiError, apiPost } from '@/lib/api';
import type { FormState } from '../../../dashboard/actions';

/**
 * Asking to join a class from the app — POOLSE-121. The API decides whose
 * person it is, whether the turma still has room and whether this was asked
 * already; this turns its answer into a field error or the toast.
 */
export async function requestJoinAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const value = (key: string): string => String(formData.get(key) ?? '');
  const body = {
    studentId: value('studentId'),
    classGroupId: value('classGroupId'),
    firstName: value('firstName'),
    lastName: value('lastName'),
    birthDate: value('birthDate'),
    relationship: value('relationship'),
    note: value('note'),
    consent: formData.get('consent') === 'on',
    locale: await getLocale(),
  };

  try {
    await apiPost('/app/enrolment-requests', body);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 400 && Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
      if (error.status === 409 && error.code !== null) {
        return error.code === 'no_email'
          ? { ok: false, errorKey: 'app.join.refused.no_email' }
          : { ok: false, fields: { classGroupId: `app.join.refused.${error.code}` } };
      }
      if (error.status === 404) return { ok: false, fields: { studentId: 'app.join.error.person' } };
    }
    return { ok: false, errorKey: 'app.join.failed' };
  }

  revalidatePath('/app/familia/inscrever');
  return { ok: true, toastKey: 'app.join.sent' };
}
