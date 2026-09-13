'use server';

import { redirect } from 'next/navigation';
import { ApiError, apiPost } from '@/lib/api';
import type { FormState } from '../actions';

/**
 * Starting and managing what the club pays — slice 2.4.
 *
 * **Both actions end in a redirect to Stripe.** The card is typed on a page
 * Stripe hosts, not one Poolse renders, and that is the whole point: a payment
 * form on our side is a PCI question with no upside. What crosses back is a URL
 * and nothing else.
 *
 * The API refuses anybody but the owner, so these are a courtesy on top of a
 * guard rather than the guard. Each failure comes back as a key the page turns
 * into a sentence — including "this installation does not sell anything", which
 * is the honest state of every machine without a Stripe key.
 */

const REFUSALS: Record<string, string> = {
  billing_not_configured: 'subscription.notConfigured',
  already_subscribed: 'subscription.alreadySubscribed',
  no_customer: 'subscription.noCustomer',
  checkout_failed: 'subscription.checkoutFailed',
  invalid_plan: 'subscription.planInvalid',
};

export async function checkoutAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const plan = String(formData.get('plan') ?? '');

  let url: string;
  try {
    const session = await apiPost<{ url: string }>(
      '/subscription/checkout',
      { plan },
      { organizationId },
    );
    url = session.url;
  } catch (error) {
    return refusal(error);
  }

  /*
   * `redirect` throws, which is how Next implements it — so it has to be outside
   * the try, or the catch above would swallow the redirect and report it as a
   * failed checkout. That is a mistake with no symptom other than a button that
   * appears to do nothing.
   */
  redirect(url);
}

export async function portalAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');

  let url: string;
  try {
    const session = await apiPost<{ url: string }>('/subscription/portal', {}, { organizationId });
    url = session.url;
  } catch (error) {
    return refusal(error);
  }

  redirect(url);
}

function refusal(error: unknown): FormState {
  if (error instanceof ApiError) {
    if (error.status === 403) return { ok: false, errorKey: 'subscription.ownerOnly' };
    const key = error.code === null ? undefined : REFUSALS[error.code];
    if (key !== undefined) return { ok: false, errorKey: key };
  }
  return { ok: false, errorKey: 'subscription.failed' };
}
