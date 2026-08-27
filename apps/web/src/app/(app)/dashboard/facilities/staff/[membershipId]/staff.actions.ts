'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPatch, apiPost } from '../../../../../../lib/api';
import type { FormState } from '../../../actions';

/**
 * Editing a staff record — POOLSE-39.
 *
 * The email is never in the body. It is not disabled-and-submitted, it is simply
 * not a field this action knows about — and the API refuses it outright if one
 * ever arrives, so the rule survives somebody crafting a request by hand.
 */
export async function saveStaffAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const membershipId = String(formData.get('membershipId') ?? '');
  const text = (field: string): string => String(formData.get(field) ?? '').trim();

  if (text('firstName') === '' && text('lastName') === '') {
    return { ok: false, fields: { firstName: 'staff.nameRequired' } };
  }

  const body: Record<string, string> = {
    firstName: text('firstName'),
    lastName: text('lastName'),
    phone: text('phone'),
  };

  // Only sent when the form showed the field — an instructor editing their own
  // record has no notes box, and sending an empty one would clear what an
  // administrator wrote about them.
  if (formData.get('notes') !== null) body['notes'] = text('notes');

  try {
    await apiPatch(`/staff/${membershipId}`, body, { organizationId });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, errorKey: 'staff.notYours' };
    }
    return { ok: false, errorKey: 'staff.saveFailed' };
  }

  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  revalidatePath('/dashboard/facilities/staff');
  // A name change shows in Alunos too, where the same Person may be a student.
  revalidatePath('/dashboard/students');

  return { ok: true };
}

/**
 * Moving somebody to a new address — AC3.
 *
 * Owner only, refused by the API. Their existing login keeps working until the
 * new address is accepted, which is what makes this safe to offer at all.
 */
export async function reinviteAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const membershipId = String(formData.get('membershipId') ?? '');
  const email = String(formData.get('email') ?? '').trim();

  if (email === '') return { ok: false, fields: { email: 'staff.emailRequired' } };

  try {
    await apiPost(`/staff/${membershipId}/reinvite`, { email }, { organizationId });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, errorKey: 'staff.reinviteOwnerOnly' };
    }
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, fields: { email: 'staff.emailInvalid' } };
    }
    return { ok: false, errorKey: 'staff.reinviteFailed' };
  }

  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  return { ok: true };
}

export async function cancelReinviteAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const membershipId = String(formData.get('membershipId') ?? '');

  try {
    await apiPost(`/staff/${membershipId}/reinvite/cancel`, {}, { organizationId });
  } catch {
    return { ok: false, errorKey: 'staff.reinviteFailed' };
  }

  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  return { ok: true };
}

/** Role changes go through POOLSE-17's endpoint, which applies the invite matrix. */
export async function setRoleAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const membershipId = String(formData.get('membershipId') ?? '');
  const role = String(formData.get('role') ?? '');
  const grant = formData.get('grant') === 'true';

  try {
    await apiPost(
      grant
        ? `/people/${membershipId}/roles`
        : `/people/${membershipId}/roles/${role}/revoke`,
      grant ? { role } : {},
      { organizationId },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, errorKey: 'staff.roleRefused' };
    }
    return { ok: false, errorKey: 'staff.roleFailed' };
  }

  revalidatePath(`/dashboard/facilities/staff/${membershipId}`);
  revalidatePath('/dashboard/facilities/staff');
  return { ok: true };
}
