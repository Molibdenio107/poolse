import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionAlert, type SubscriptionFacts } from './subscription-alert.js';

/** The avatar's subscription warning (Rui, 28-10-2026): which end, when, and which wins. */

const base: SubscriptionFacts = {
  status: 'active',
  billingMode: 'stripe',
  suspended: false,
  readOnlyOn: null,
  trialEndsOn: null,
  paidThrough: null,
  cancelAtPeriodEnd: false,
  periodEndsOn: null,
  today: '2026-10-28',
};
const facts = (over: Partial<SubscriptionFacts>): SubscriptionFacts => ({ ...base, ...over });

test('a paying club with nothing ending is not warned', () => {
  assert.equal(subscriptionAlert(base), null);
  assert.equal(subscriptionAlert(facts({ periodEndsOn: '2026-11-01' })), null, 'renewing is not ending');
});

test('a trial warns from seven days out, and not before', () => {
  assert.equal(subscriptionAlert(facts({ status: 'trialing', trialEndsOn: '2026-11-05' })), null, 'eight days');
  assert.deepEqual(subscriptionAlert(facts({ status: 'trialing', trialEndsOn: '2026-11-04' })), {
    kind: 'trial_ending',
    endsOn: '2026-11-04',
    daysLeft: 7,
  });
  assert.equal(subscriptionAlert(facts({ status: 'trialing', trialEndsOn: '2026-10-28' }))?.daysLeft, 0, 'its last day');
});

test('a club paying by hand warns before its paid-through day, and after it', () => {
  const manual = { billingMode: 'manual' as const };
  assert.equal(subscriptionAlert(facts({ ...manual, paidThrough: '2026-12-31' })), null);
  assert.deepEqual(subscriptionAlert(facts({ ...manual, paidThrough: '2026-11-02' })), {
    kind: 'paid_ending',
    endsOn: '2026-11-02',
    daysLeft: 5,
  });
  assert.equal(subscriptionAlert(facts({ ...manual, paidThrough: '2026-10-20' }))?.daysLeft, -8, 'late is negative');
});

test('a Stripe subscription set to cancel warns before its period ends', () => {
  assert.deepEqual(subscriptionAlert(facts({ cancelAtPeriodEnd: true, periodEndsOn: '2026-11-03' })), {
    kind: 'cancelling',
    endsOn: '2026-11-03',
    daysLeft: 6,
  });
  assert.equal(subscriptionAlert(facts({ cancelAtPeriodEnd: true, periodEndsOn: '2026-12-03' })), null);
});

test('a failed payment warns at once, with the paid-through day when a person records payments', () => {
  assert.deepEqual(subscriptionAlert(facts({ status: 'past_due' })), { kind: 'past_due', endsOn: null, daysLeft: null });
  assert.deepEqual(subscriptionAlert(facts({ status: 'past_due', billingMode: 'manual', paidThrough: '2026-10-10' })), {
    kind: 'past_due',
    endsOn: '2026-10-10',
    daysLeft: -18,
  });
});

test('ended beats late beats ending, and a closed or comped club is never warned', () => {
  assert.equal(
    subscriptionAlert(facts({ status: 'past_due', readOnlyOn: '2026-10-25', cancelAtPeriodEnd: true, periodEndsOn: '2026-10-30' }))?.kind,
    'ended',
  );
  assert.equal(subscriptionAlert(facts({ status: 'expired' }))?.kind, 'ended');
  assert.equal(subscriptionAlert(facts({ status: 'canceled' }))?.kind, 'ended');
  assert.equal(subscriptionAlert(facts({ suspended: true, readOnlyOn: '2026-10-25' })), null);
  assert.equal(subscriptionAlert(facts({ billingMode: 'comped', status: 'active' })), null);
  // Two ends in the window: the sooner one.
  assert.equal(
    subscriptionAlert(facts({ status: 'trialing', trialEndsOn: '2026-11-03', billingMode: 'manual', paidThrough: '2026-10-30' }))?.kind,
    'paid_ending',
  );
});
