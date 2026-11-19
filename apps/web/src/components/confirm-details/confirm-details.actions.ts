'use server';

import { revalidatePath } from 'next/cache';
import { requiredDetails, type DetailField } from '@poolse/rules';
import { ApiError, apiFetch, apiPatch, apiPut, type Me } from '@/lib/api';
import type { FormState } from '@/app/(app)/dashboard/actions';

/** The form's name for each detail: the API's own, so its field errors land under the right box. */
const FORM_NAME: Record<DetailField, string> = {
  firstName: 'firstName',
  lastName: 'lastName',
  mobile: 'contactPhone',
  taxNumber: 'taxNumber',
  address: 'address',
  postalCode: 'postalCode',
  locality: 'locality',
};

const STAFF_FIELDS: readonly DetailField[] = ['taxNumber', 'address', 'postalCode', 'locality'];

/**
 * *Confirmar os seus dados* — POOLSE-227.
 *
 * Nothing new is written here: the name and mobile go through `PUT /me/profile`
 * (Clerk, then `app_user`, POOLSE-177) and a staff member's NIF and morada
 * through `PATCH /staff/:id/details`, each with its own role check and its own
 * validation. What this adds is *required*: which fields, from `requiredDetails`
 * in `@poolse/rules` over the reader's roles in the active club, read here from
 * `/me` rather than from anything the form sent — so a tampered form can neither
 * skip a field nor reach somebody else's record. The membership written is the
 * session's own, never an id from the form.
 *
 * Two calls are not one transaction. If the second fails the first stays saved,
 * and the gate comes back asking only for what is still missing — which is
 * exactly rule 2.
 */
export async function confirmDetailsAction(_previous: FormState, form: FormData): Promise<FormState> {
  let me: Me;
  try {
    me = await apiFetch<Me>('/me');
  } catch {
    return { ok: false, errorKey: 'confirmDetails.failed' };
  }
  const membership = me.memberships[0];
  if (membership === undefined || membership.view !== null) return { ok: false, errorKey: 'confirmDetails.failed' };

  // The gate only shows a student-only reader on the adult path, so asking as
  // if adult is right whenever this form exists; the API judged the path.
  const required = requiredDetails(membership.roles, { adultPathStudent: true });
  const value = (field: DetailField): string => String(form.get(FORM_NAME[field]) ?? '').trim();

  const fields: Record<string, string> = {};
  for (const field of required) {
    if (value(field) === '') fields[FORM_NAME[field]] = 'common.validation.required';
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };

  try {
    await apiPut<Me>('/me/profile', {
      firstName: value('firstName'),
      lastName: value('lastName'),
      contactPhone: value('mobile'),
      // Asked only in the setup's step 1 (optional); elsewhere sent back as it is.
      birthDate: form.has('birthDate') ? String(form.get('birthDate') ?? '').trim() : (me.user.birthDate ?? ''),
      locale: me.user.locale,
      theme: me.user.theme,
    });

    if (required.some((field) => STAFF_FIELDS.includes(field))) {
      await apiPatch(`/staff/${membership.membershipId}/details`, {
        taxNumber: value('taxNumber'),
        address: value('address'),
        postalCode: value('postalCode'),
        locality: value('locality'),
      });
    }
  } catch (error) {
    if (error instanceof ApiError && Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
    return {
      ok: false,
      errorKey: 'confirmDetails.failed',
      ...(error instanceof ApiError ? { detail: `${error.status} ${error.message}` } : {}),
    };
  }

  // Layout-deep: the gate is drawn by the layouts, which read `/me` again.
  revalidatePath('/', 'layout');
  // The setup's step 1 goes on to the next step; only a setup address, never an open redirect.
  const then = String(form.get('then') ?? '');
  if (/^\/dashboard\/setup\?step=[a-z]+$/.test(then)) return { ok: true, quiet: true, redirectTo: then };
  return { ok: true, toastKey: 'confirmDetails.saved' };
}
