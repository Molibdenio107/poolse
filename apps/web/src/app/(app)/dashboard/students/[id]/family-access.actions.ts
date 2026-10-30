'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost } from '@/lib/api';
import type { FormState } from '../../actions';

/**
 * Inviting a family into the app from the student's record — POOLSE-129.
 *
 * The API decides who may (owner, admin, an instructor for their own turmas)
 * and names the person the club already has; these only carry the request and
 * translate the refusal.
 */

export interface FamilyInviteState extends FormState {
  /** The link, shown once: only its hash is stored. */
  link?: string;
  /** Which row the link belongs to, so only that row offers to share it. */
  rowKey?: string;
  emailed?: boolean;
  email?: string | null;
}

interface Issued {
  invitationId: string;
  link: string;
  email: string | null;
  emailed: boolean;
  expiresAt: string;
}

const REFUSALS: Record<string, string> = {
  already_in_app: 'familyAccess.error.alreadyInApp',
  already_invited: 'familyAccess.error.alreadyInvited',
  email_taken: 'familyAccess.error.emailTaken',
  no_email: 'familyAccess.error.noEmail',
  invalid_email: 'familyAccess.error.invalidEmail',
  not_your_student: 'familyAccess.error.notYourStudent',
};

function refusal(error: unknown): FamilyInviteState {
  if (error instanceof ApiError) {
    const key = error.code === null ? undefined : REFUSALS[error.code];
    if (key !== undefined) {
      return key === 'familyAccess.error.invalidEmail' || key === 'familyAccess.error.noEmail' || key === 'familyAccess.error.emailTaken'
        ? { ok: false, errorKey: key, fields: { email: key } }
        : { ok: false, errorKey: key };
    }
    if (error.status < 500) return { ok: false, errorKey: 'familyAccess.error.failed' };
    return { ok: false, errorKey: 'familyAccess.error.failed', detail: `${error.status} ${error.message}`.trim() };
  }
  // Nothing answered: say so, rather than print the network error.
  return { ok: false, errorKey: 'common.noAnswer' };
}

function done(studentId: string, rowKey: string, issued: Issued): FamilyInviteState {
  revalidatePath(`/dashboard/students/${studentId}`);
  return {
    ok: true,
    rowKey,
    link: issued.link,
    email: issued.email,
    emailed: issued.emailed,
    toastKey: issued.emailed
      ? 'familyAccess.toast.emailed'
      : issued.email === null
        ? 'familyAccess.toast.linkReady'
        : 'familyAccess.toast.notEmailed',
    ...(issued.email === null ? {} : { values: { email: issued.email } }),
  };
}

export async function inviteFamilyAction(
  _previous: FamilyInviteState,
  formData: FormData,
): Promise<FamilyInviteState> {
  const studentId = String(formData.get('studentId') ?? '');
  const membershipId = String(formData.get('membershipId') ?? '');
  const channel = formData.get('channel') === 'link' ? 'link' : 'email';
  const email = String(formData.get('email') ?? '').trim();
  const rowKey = String(formData.get('rowKey') ?? '');

  try {
    const issued = await apiPost<Issued>(`/students/${studentId}/invitations`, {
      // An empty id is the student themself.
      membershipId: membershipId === '' ? null : membershipId,
      channel,
      ...(email === '' ? {} : { email }),
    });
    return done(studentId, rowKey, issued);
  } catch (error) {
    return refusal(error);
  }
}

export async function reissueFamilyAction(
  _previous: FamilyInviteState,
  formData: FormData,
): Promise<FamilyInviteState> {
  const studentId = String(formData.get('studentId') ?? '');
  const invitationId = String(formData.get('invitationId') ?? '');
  const rowKey = String(formData.get('rowKey') ?? '');
  try {
    const issued = await apiPost<Issued>(`/students/${studentId}/invitations/${invitationId}/reissue`, {});
    return done(studentId, rowKey, issued);
  } catch (error) {
    return refusal(error);
  }
}

export async function revokeFamilyAction(
  _previous: FamilyInviteState,
  formData: FormData,
): Promise<FamilyInviteState> {
  const studentId = String(formData.get('studentId') ?? '');
  const invitationId = String(formData.get('invitationId') ?? '');
  try {
    await apiPost(`/students/${studentId}/invitations/${invitationId}/revoke`, {});
  } catch (error) {
    return refusal(error);
  }
  revalidatePath(`/dashboard/students/${studentId}`);
  return { ok: true, toastKey: 'familyAccess.toast.revoked' };
}
