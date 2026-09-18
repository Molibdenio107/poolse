'use server';

import { revalidatePath } from 'next/cache';
import { apiPost } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import { parseCents } from '@/lib/money';
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
      // Conceder novo período — POOLSE-62. Absent means a plain date change;
      // the API frees the address only when this says so.
      releaseClaim: formData.get('releaseClaim') === 'true',
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

/**
 * Read-only, or writing again — POOLSE-61.
 *
 * One action for both directions, like suspension above. **Lifting clears the
 * deletion date with it**: the two are set together and mean one thing between
 * them, and a club writing normally with a deletion still scheduled is the worst
 * of the two states and the one nobody would think to look for.
 *
 * The API decides what a blank `dataKeptUntil` means, not this — coercing on both
 * sides is how the two come to disagree about an empty box.
 */
export async function setReadOnlyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenantId = String(formData.get('tenantId') ?? '');
  const readOnly = formData.get('readOnly') === 'true';

  try {
    await apiPost(`/platform/tenants/${tenantId}/read-only`, {
      readOnly,
      dataKeptUntil: readOnly ? String(formData.get('dataKeptUntil') ?? '') : null,
    });
  } catch (error) {
    return describeFailure(error, 'admin.error.readOnlyFailed');
  }

  revalidateAdmin(tenantId);
  return { ok: true };
}

/**
 * How this club pays — POOLSE-63.
 *
 * Its own action beside the subscription status, because they are two facts: the
 * mode says *how* and the status says *whether*. Marking a club as paying in
 * cash is not a claim that they are up to date.
 */
export async function setBillingModeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenantId = String(formData.get('tenantId') ?? '');

  try {
    await apiPost(`/platform/tenants/${tenantId}/billing-mode`, {
      billingMode: String(formData.get('billingMode') ?? ''),
    });
  } catch (error) {
    return describeFailure(error, 'admin.error.billingModeFailed');
  }

  revalidateAdmin(tenantId);
  return { ok: true };
}

/**
 * Record money that arrived outside Stripe — POOLSE-63.
 *
 * **The amount becomes cents here and nowhere else.** `parseCents` is the one
 * place a typed "35,50" becomes a number in this product; the API takes integer
 * minor units and refuses anything else, so there is one definition of what a
 * comma means rather than two that agree until somebody types a thousands
 * separator.
 *
 * A figure that is not a figure is refused before the request, with the same
 * `fields` shape the API uses — so the message lands beside the box either way
 * and the operator cannot tell which side caught it.
 */
export async function recordPaymentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenantId = String(formData.get('tenantId') ?? '');

  const amountCents = parseCents(String(formData.get('amount') ?? ''));
  if (amountCents === null) {
    return { ok: false, fields: { amount: 'admin.error.amountInvalid' } };
  }

  try {
    await apiPost(`/platform/tenants/${tenantId}/payments`, {
      amountCents,
      receivedOn: String(formData.get('receivedOn') ?? ''),
      method: String(formData.get('method') ?? ''),
      coversFrom: String(formData.get('coversFrom') ?? ''),
      coversTo: String(formData.get('coversTo') ?? ''),
      note: String(formData.get('note') ?? ''),
    });
  } catch (error) {
    return describeFailure(error, 'admin.error.paymentFailed');
  }

  revalidateAdmin(tenantId);
  return { ok: true };
}
