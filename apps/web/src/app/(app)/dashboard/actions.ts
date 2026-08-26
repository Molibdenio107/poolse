'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost, type AcceptResult, type CreatedInvitation } from '../../../lib/api';

/**
 * Server actions for the invitation flow.
 *
 * They exist so the browser never talks to the API directly — same reason as
 * `apiFetch`: the Clerk session token stays on the server and there is no CORS
 * surface to keep in step across two environments.
 *
 * Every one returns a state object rather than throwing. A thrown error in a
 * server action reaches the user as the generic error page, which is the wrong
 * answer for "that address already has an invitation" — a thing they can fix by
 * typing something else.
 */

export interface FormState {
  ok: boolean;
  /** A key into the message catalogue, never a sentence: this is i18n territory. */
  errorKey?: string;
  /** Server detail worth showing verbatim — an API message, not a translated string. */
  detail?: string;
}

export interface InviteState extends FormState {
  invitation?: CreatedInvitation;
}

export async function createOrganizationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, errorKey: 'organization.nameRequired' };

  try {
    await apiPost('/organizations', {
      name,
      facilityName: String(formData.get('facilityName') ?? '').trim(),
    });
  } catch (error) {
    return failure(error, 'organization.createFailed');
  }

  // The dashboard reads memberships; it is now wrong.
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function inviteAction(
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const email = String(formData.get('email') ?? '').trim();
  const roles = formData.getAll('roles').map(String).filter(Boolean);

  if (!email) return { ok: false, errorKey: 'invite.emailRequired' };
  if (roles.length === 0) return { ok: false, errorKey: 'invite.rolesRequired' };

  let invitation: CreatedInvitation;
  try {
    invitation = await apiPost<CreatedInvitation>(
      '/invitations',
      { email, roles },
      { organizationId },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { ok: false, errorKey: 'invite.duplicate' };
    }
    return failure(error, 'invite.failed');
  }

  revalidatePath('/dashboard/people');
  return { ok: true, invitation };
}

export async function reissueAction(
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const invitationId = String(formData.get('invitationId') ?? '');

  let invitation: CreatedInvitation;
  try {
    invitation = await apiPost<CreatedInvitation>(
      `/invitations/${invitationId}/reissue`,
      {},
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'invite.reissueFailed');
  }

  revalidatePath('/dashboard/people');
  return { ok: true, invitation };
}

export async function revokeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const invitationId = String(formData.get('invitationId') ?? '');

  try {
    await apiPost(`/invitations/${invitationId}/revoke`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'invite.revokeFailed');
  }

  revalidatePath('/dashboard/people');
  return { ok: true };
}

export async function acceptAction(
  _previous: FormState & { result?: AcceptResult },
  formData: FormData,
): Promise<FormState & { result?: AcceptResult }> {
  const token = String(formData.get('token') ?? '');
  if (!token) return { ok: false, errorKey: 'join.tokenMissing' };

  let result: AcceptResult;
  try {
    result = await apiPost<AcceptResult>('/join', { token });
  } catch (error) {
    return failure(error, 'join.failed');
  }

  // Memberships changed, so both screens that list them are stale.
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/people');
  return { ok: result.status === 'accepted', result };
}

/**
 * The API writes its errors in English, for developers. Showing them to a
 * Portuguese operator alongside the translated sentence was worse than useless —
 * `400 A valid email address is required` in monospace reads as a crash, not as
 * "check the address".
 *
 * So the technical detail is kept for the cases where somebody genuinely needs
 * it: a server error or something that is not an ApiError at all. Anything the
 * API refused deliberately (4xx) already has a sentence in the reader's language
 * above it, and the status code adds nothing they can act on.
 */
function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    if (error.status < 500) return { ok: false, errorKey };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

export async function transferOwnershipAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const membershipId = String(formData.get('membershipId') ?? '');
  if (!membershipId) return { ok: false, errorKey: 'transfer.chooseSomeone' };

  try {
    await apiPost('/people/transfer-ownership', { membershipId }, { organizationId });
  } catch (error) {
    return failure(error, 'transfer.failed');
  }

  // The caller is no longer the owner, so every screen that gates on that is
  // now wrong — including the navigation.
  revalidatePath('/dashboard', 'layout');
  return { ok: true };
}

export async function revokeSessionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const sessionId = String(formData.get('sessionId') ?? '');
  if (!sessionId) return { ok: false, errorKey: 'sessions.endFailed' };

  try {
    await apiPost(`/me/sessions/${sessionId}/revoke`, {});
  } catch (error) {
    return failure(error, 'sessions.endFailed');
  }

  revalidatePath('/dashboard');
  return { ok: true };
}
