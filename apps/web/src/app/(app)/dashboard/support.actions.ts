'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ACTIVE_ORG_COOKIE,
  apiFetch,
  apiPost,
  type OpenSupportGrant,
  type SupportActivity,
  type SupportGrant,
  type SupportRequest,
  type SupportStatus,
  type TenantSupport,
} from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import { outcome, type Outcome } from '@/lib/load-failure';
import type { FormState } from './actions';

/**
 * Support access — POOLSE-79.
 *
 * Two audiences. The club's Owner opens, revokes and answers: those calls are
 * tenant-scoped and Owner only on the API. Poolse support enters, leaves and
 * asks: those go to `/platform/support`, which never runs the tenant
 * middleware, so the cookie's club header on them is ignored.
 */

// ---------------------------------------------------------------------------
// The club's side
// ---------------------------------------------------------------------------

export async function loadSupportAccess(): Promise<
  Outcome<{ grants: SupportGrant[]; requests: SupportRequest[]; activity: SupportActivity[] }>
> {
  return outcome(
    Promise.all([
      apiFetch<{ grants: SupportGrant[] }>('/support-grants'),
      apiFetch<{ requests: SupportRequest[] }>('/support-grants/requests'),
      apiFetch<{ activity: SupportActivity[] }>('/support-grants/activity'),
    ]).then(([grants, requests, activity]) => ({
      grants: grants.grants,
      requests: requests.requests,
      activity: activity.activity,
    })),
  );
}

/** For the shell's strip. Null when it cannot be read — the strip is a courtesy. */
export async function loadSupportStatus(): Promise<SupportStatus | null> {
  try {
    return await apiFetch<SupportStatus>('/support-grants/status');
  } catch {
    return null;
  }
}

function refreshProfile(): void {
  revalidatePath('/dashboard', 'layout');
}

export async function openSupportWindowAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await apiPost('/support-grants', { hours: Number(formData.get('hours') ?? 0) });
  } catch (error) {
    return describeFailure(error, 'support.openFailed');
  }
  refreshProfile();
  return { ok: true, toastKey: 'support.openedToast' };
}

export async function revokeSupportWindowAction(
  grantId: string,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    await apiPost(`/support-grants/${encodeURIComponent(grantId)}/revoke`, {});
  } catch (error) {
    return describeFailure(error, 'support.revokeFailed');
  }
  refreshProfile();
  return { ok: true, toastKey: 'support.revokedToast' };
}

export async function answerSupportRequestAction(
  requestId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const approve = formData.get('answer') === 'approve';
  try {
    if (approve) {
      await apiPost(`/support-grants/requests/${encodeURIComponent(requestId)}/approve`, {
        hours: Number(formData.get('hours') ?? 0),
      });
    } else {
      await apiPost(`/support-grants/requests/${encodeURIComponent(requestId)}/decline`, {});
    }
  } catch (error) {
    return describeFailure(error, 'support.answerFailed');
  }
  refreshProfile();
  return { ok: true, toastKey: approve ? 'support.approvedToast' : 'support.declinedToast' };
}

// ---------------------------------------------------------------------------
// Poolse support's side
// ---------------------------------------------------------------------------

export async function listOpenSupportGrants(): Promise<Outcome<OpenSupportGrant[]>> {
  return outcome(apiFetch<{ grants: OpenSupportGrant[] }>('/platform/support').then((r) => r.grants));
}

export async function loadTenantSupport(tenantId: string): Promise<Outcome<TenantSupport>> {
  return outcome(apiFetch<TenantSupport>(`/platform/support/tenants/${encodeURIComponent(tenantId)}`));
}

async function setActiveClub(organizationId: string | null): Promise<void> {
  const jar = await cookies();
  if (organizationId === null) {
    jar.delete(ACTIVE_ORG_COOKIE);
    return;
  }
  // HttpOnly: only the Next server reads it, to name the club on each API call.
  jar.set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
  });
}

/** Enters a club through its open window, and switches this browser to it. */
export async function enterSupportAction(
  grantId: string,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  let organizationId: string;
  try {
    ({ organizationId } = await apiPost<{ organizationId: string }>(
      `/platform/support/${encodeURIComponent(grantId)}/enter`,
      {},
    ));
  } catch (error) {
    return describeFailure(error, 'support.enterFailed');
  }
  await setActiveClub(organizationId);
  redirect('/dashboard');
}

/**
 * *Terminar agora*: ends the window for this club and steps back out. Finds
 * the live window by the active club, since the session itself carries only
 * when it ends.
 */
export async function endSupportAction(
  organizationId: string,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const open = await apiFetch<{ grants: OpenSupportGrant[] }>('/platform/support');
    const grant = open.grants.find((one) => one.organizationId === organizationId);
    if (grant !== undefined) {
      await apiPost(`/platform/support/${encodeURIComponent(grant.grantId)}/leave`, {});
    }
  } catch (error) {
    return describeFailure(error, 'support.endFailed');
  }
  await setActiveClub(null);
  redirect('/admin');
}

/** Steps out of the club without ending the window — back to one's own. */
export async function stepOutOfSupportAction(): Promise<void> {
  await setActiveClub(null);
  redirect('/admin');
}

export async function requestSupportAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenantId = String(formData.get('tenantId') ?? '');
  try {
    await apiPost(`/platform/support/tenants/${encodeURIComponent(tenantId)}/request`, {
      reason: String(formData.get('reason') ?? ''),
    });
  } catch (error) {
    return describeFailure(error, 'support.requestFailed');
  }
  revalidatePath(`/admin/tenants/${tenantId}`);
  return { ok: true, toastKey: 'support.requestedToast' };
}

export async function overrideSupportAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenantId = String(formData.get('tenantId') ?? '');
  try {
    await apiPost(`/platform/support/tenants/${encodeURIComponent(tenantId)}/override`, {
      reason: String(formData.get('reason') ?? ''),
      // Passed straight through; the API compares it inside its transaction.
      confirmName: String(formData.get('confirmName') ?? ''),
    });
  } catch (error) {
    return describeFailure(error, 'support.overrideFailed');
  }
  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath('/admin');
  return { ok: true, toastKey: 'support.overrideToast' };
}

/** After a window ended: forget the club this browser chose, and go home. */
export async function forgetActiveClubAction(): Promise<void> {
  await setActiveClub(null);
  redirect('/dashboard');
}
