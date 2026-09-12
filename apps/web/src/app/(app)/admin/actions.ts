'use server';

import { revalidatePath } from 'next/cache';
import { apiPost } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '@/app/(app)/dashboard/actions';

/**
 * The platform operator's four actions — slice 3.
 *
 * **No `organizationId` option on any of these calls.** Everywhere else in this
 * app that argument names the tenant the caller is acting *as*, and the API
 * re-checks the membership behind it. Here the tenant is the *subject*, not the
 * actor: it travels in the path, and the caller's right to touch it comes from
 * `platform_admin` by way of `PlatformAdminGuard`. Sending the header would ask
 * the API to scope a request that has no tenant scope, and an operator who
 * belongs to no organization — which is the normal case — would be refused.
 *
 * Each returns a `FormState`, so `useSavedAction` raises the toast and
 * `describeFailure` puts a 400's named field beside the box that caused it. One
 * place says a save happened; none of these has to remember to.
 */

/** Both admin pages show plan and suspension state, so both are stale after a write. */
function revalidateAdmin(tenantId: string): void {
  revalidatePath('/admin');
  revalidatePath(`/admin/tenants/${tenantId}`);
}

export async function setTrialAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenantId = String(formData.get('tenantId') ?? '');
  const endsAt = String(formData.get('endsAt') ?? '');

  try {
    /*
     * A date input gives `YYYY-MM-DD`, which `new Date()` reads as midnight UTC.
     * A trial "ending on the 30th" should include the 30th, so the end of that
     * day is what is sent — otherwise every extension quietly loses a day, which
     * is the kind of bug nobody reports and everybody notices.
     */
    await apiPost(`/platform/tenants/${tenantId}/trial`, {
      endsAt: `${endsAt}T23:59:59.000Z`,
    });
  } catch (error) {
    return describeFailure(error, 'admin.error.trialFailed');
  }

  revalidateAdmin(tenantId);
  return { ok: true };
}

export async function setSubscriptionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenantId = String(formData.get('tenantId') ?? '');

  try {
    await apiPost(`/platform/tenants/${tenantId}/subscription`, {
      status: String(formData.get('status') ?? ''),
    });
  } catch (error) {
    return describeFailure(error, 'admin.error.subscriptionFailed');
  }

  revalidateAdmin(tenantId);
  return { ok: true };
}

export async function setPlanAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenantId = String(formData.get('tenantId') ?? '');

  try {
    await apiPost(`/platform/tenants/${tenantId}/plan`, {
      maxFacilities: String(formData.get('maxFacilities') ?? ''),
      // Empty means unlimited, and is passed through as the empty string rather
      // than coerced here — the API owns that reading, and coercing on both
      // sides is how the two come to disagree about what a blank box means.
      maxManagementUsers: String(formData.get('maxManagementUsers') ?? ''),
    });
  } catch (error) {
    return describeFailure(error, 'admin.error.planFailed');
  }

  revalidateAdmin(tenantId);
  return { ok: true };
}

/**
 * Suspend, or restore.
 *
 * One action for both directions, mirroring the endpoint: they write the same
 * two columns and have to stay each other's exact inverse, which is easier to
 * keep true in one place than in two.
 */
export async function setSuspensionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenantId = String(formData.get('tenantId') ?? '');
  const suspended = formData.get('suspended') === 'true';

  try {
    await apiPost(`/platform/tenants/${tenantId}/suspension`, {
      suspended,
      reason: suspended ? String(formData.get('reason') ?? '') : null,
    });
  } catch (error) {
    return describeFailure(error, 'admin.error.suspensionFailed');
  }

  revalidateAdmin(tenantId);
  return { ok: true };
}
