import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import { readChange } from './stripe-events.js';
import { resetStripeClient } from './stripe.js';

/**
 * What Poolse takes from a Stripe event — slice 2.4.
 *
 * Pure, so these are literal objects rather than a fixture library. Four things
 * are being pinned, and each one is a decision rather than a mapping:
 *
 * - a **deletion clears** the subscription, the plan and the period, because a
 *   stale id would leave the screen offering a portal for something gone;
 * - a **failed payment is `past_due` and only that** — never `suspended_at`,
 *   which is an operator's decision and shuts a door;
 * - **every Stripe status that is not one of ours becomes `past_due`**, which is
 *   the closest true thing to say about a club that is not paying and has not
 *   cancelled;
 * - an **unknown event type is ignored entirely**, not recorded, because the
 *   trail is what Poolse did.
 */

process.env['STRIPE_PRICE_YEARLY'] = 'price_yearly_test';
process.env['STRIPE_PRICE_MONTHLY'] = 'price_monthly_test';
resetStripeClient();

function subscriptionEvent(
  type: string,
  subscription: Record<string, unknown>,
): Stripe.Event {
  return {
    id: `evt_${type}`,
    type,
    data: { object: subscription },
  } as unknown as Stripe.Event;
}

const LIVE = {
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  cancel_at_period_end: false,
  items: { data: [{ price: { id: 'price_yearly_test' }, current_period_end: 1_800_000_000 }] },
};

test('2.4 — a live subscription carries its interval, its period and its status', () => {
  const read = readChange(subscriptionEvent('customer.subscription.updated', LIVE));

  assert.equal(read?.customerId, 'cus_1');
  assert.deepEqual(read?.change, {
    status: 'active',
    subscriptionId: 'sub_1',
    // One plan, so a live subscription is always on it — POOLSE-60. What the
    // price tells us is how often they pay.
    plan: 'poolse_full',
    interval: 'yearly',
    currentPeriodEnd: new Date(1_800_000_000 * 1000),
    cancelAtPeriodEnd: false,
  });
});

test('2.4 — the monthly price reads back as the monthly interval', () => {
  const read = readChange(
    subscriptionEvent('customer.subscription.updated', {
      ...LIVE,
      items: { data: [{ price: { id: 'price_monthly_test' }, current_period_end: 1 }] },
    }),
  );

  assert.equal(read?.change.interval, 'monthly');
  assert.equal(read?.change.plan, 'poolse_full');
});

test('2.4 — a deletion clears the subscription rather than leaving a stale id', () => {
  const read = readChange(subscriptionEvent('customer.subscription.deleted', LIVE));

  assert.deepEqual(read?.change, {
    status: 'canceled',
    subscriptionId: null,
    plan: null,
    interval: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });
});

test('2.4 — cancelling at the end of the period is not cancelled yet', () => {
  const read = readChange(
    subscriptionEvent('customer.subscription.updated', { ...LIVE, cancel_at_period_end: true }),
  );

  // Still active, still paid for, and the screen counts down to the period end.
  // Cancelling is not suspension and nothing shuts.
  assert.equal(read?.change.status, 'active');
  assert.equal(read?.change.cancelAtPeriodEnd, true);
});

test('2.4 — every status that is neither ours nor cancelled is past_due', () => {
  for (const status of ['unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
    const read = readChange(subscriptionEvent('customer.subscription.updated', { ...LIVE, status }));
    assert.equal(read?.change.status, 'past_due', `${status} should read as past_due`);
  }

  assert.equal(
    readChange(subscriptionEvent('customer.subscription.updated', { ...LIVE, status: 'trialing' }))
      ?.change.status,
    'trialing',
  );
});

test('2.4 — a failed payment is past_due and touches nothing else', () => {
  const read = readChange({
    id: 'evt_failed',
    type: 'invoice.payment_failed',
    data: { object: { customer: 'cus_1' } },
  } as unknown as Stripe.Event);

  // The settled distinction: a club whose card expired is past due and is also
  // mid-lesson. `suspended_at` is not here and must never be.
  assert.deepEqual(read?.change, { status: 'past_due' });
  assert.equal(read?.customerId, 'cus_1');
});

test('2.4 — a price nobody configured leaves the interval null rather than guessing', () => {
  const read = readChange(
    subscriptionEvent('customer.subscription.updated', {
      ...LIVE,
      items: { data: [{ price: { id: 'price_never_heard_of' }, current_period_end: 1 }] },
    }),
  );

  assert.equal(read?.change.interval, null);
  assert.equal(read?.change.plan, 'poolse_full', 'they are still on the one plan');
  assert.equal(read?.change.status, 'active', 'and the rest of the event still applies');
});

test('2.4 — an expanded customer object is read the same as an id', () => {
  const read = readChange(
    subscriptionEvent('customer.subscription.updated', { ...LIVE, customer: { id: 'cus_2' } }),
  );
  assert.equal(read?.customerId, 'cus_2');
});

test('2.4 — an event type Poolse does not handle is ignored, not recorded', () => {
  assert.equal(
    readChange({
      id: 'evt_other',
      type: 'invoice.created',
      data: { object: {} },
    } as unknown as Stripe.Event),
    null,
  );
});
