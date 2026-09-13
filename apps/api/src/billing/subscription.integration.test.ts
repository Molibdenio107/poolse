import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { withPlatform } from '@poolse/db';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { StripeWebhookController } from '../webhooks/stripe-webhook.controller.js';
import { SubscriptionController, resetPriceCache } from './subscription.controller.js';
import { readSubscription } from './subscription.repository.js';
import { resetStripeClient } from './stripe.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * The operator gets paid — slice 2.4.
 *
 * **No network, and the signature check is real.** `constructEvent` is HMAC over
 * the raw bytes and a timestamp tolerance; none of that needs Stripe to be
 * reachable, and the SDK ships `generateTestHeaderString` precisely so an
 * endpoint can be exercised for real offline. So these tests sign their own
 * payloads with a test secret and go through the same `verify` a live delivery
 * would — which matters more here than anywhere else in the product, because
 * that check *is* the authentication for a route anybody on the internet can
 * reach.
 *
 * What is deliberately not tested: the calls that go *out* to Stripe — checkout
 * and the portal. Those need an account, and the honest coverage for them is
 * that they refuse to run unconfigured, which is asserted below.
 *
 * The price lookup *is* attempted, with a key Stripe will refuse, and the
 * assertion is the fallback: three plans, unpriced. That is the same branch a
 * Stripe outage takes, and this screen exists to tell a club where it stands —
 * losing it over a figure they could also read on the public site would be the
 * wrong trade.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const SECRET = 'whsec_test_poolse';

process.env['STRIPE_SECRET_KEY'] = 'sk_test_poolse';
process.env['STRIPE_WEBHOOK_SECRET'] = SECRET;
process.env['STRIPE_PRICE_CLUB'] = 'price_club_test';
resetStripeClient();
resetPriceCache();

const signer = new Stripe('sk_test_poolse', { apiVersion: '2026-08-26.dahlia' });

/**
 * A prefix per run, because a Stripe event id is unique per delivery and so is
 * the primary key that makes this feature idempotent.
 *
 * Fixed ids passed once and then reported every event as a duplicate on the
 * second run — the idempotency working exactly as designed, against the tests.
 * `stripe_event` rows for a scratch tenant are swept at teardown like any other
 * table; a row for a customer nobody knows carries no tenant and is removed by
 * the one test that makes one.
 */
const RUN = `${process.pid}${Math.floor(performance.now())}`;
const evt = (name: string): string => `evt_test_${RUN}_${name}`;

/**
 * The trail, read as the role that owns it.
 *
 * Not through `tenant.sql`: that is the app connection with the tenant GUC set,
 * and `stripe_event` is revoked from it *and* has no policy naming it — which is
 * the property `subscription.sql` asserts. A test that could read it there would
 * be a test of something this feature promises is impossible.
 */
async function trail(id: string): Promise<
  { id: string; outcome: string; organization_id: string | null; changed: Record<string, unknown> }[]
> {
  return withPlatform(async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      outcome: string;
      organization_id: string | null;
      changed: Record<string, unknown>;
    }>(`SELECT id, outcome, organization_id, changed FROM stripe_event WHERE id = ANY($1::text[])`, [
      [id],
    ]);
    return rows;
  });
}

/** A signed delivery, as Express hands one to the controller. */
function delivery(event: Record<string, unknown>, options: { tamper?: boolean } = {}): RawBodyRequest<Request> {
  const payload = JSON.stringify(event);
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });

  return {
    headers: { 'stripe-signature': options.tamper === true ? `${header}x` : header },
    rawBody: Buffer.from(payload, 'utf8'),
  } as unknown as RawBodyRequest<Request>;
}

function subscriptionEvent(
  id: string,
  type: string,
  customer: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    type,
    data: {
      object: {
        id: 'sub_test_1',
        customer,
        status: 'active',
        cancel_at_period_end: false,
        items: {
          data: [{ price: { id: 'price_club_test' }, current_period_end: 1_800_000_000 }],
        },
        ...extra,
      },
    },
  };
}

/**
 * The customer id a webhook will name, as a checkout would have left it.
 *
 * Through `tenant.sql`, which is the harness's owner connection. The first
 * attempt used `withoutTenantScope`, which is the *app* pool with no GUC set —
 * so RLS refused the update, silently, and every webhook then landed on a club
 * with no customer id. Tenant isolation working as designed, against the test.
 */
async function giveCustomer(tenant: ScratchTenant, customerId: string): Promise<void> {
  await tenant.sql(`UPDATE organization SET stripe_customer_id = $2 WHERE id = $1`, [
    tenant.organizationId,
    customerId,
  ]);
}

test('2.4 — a signed subscription event moves the club onto its plan', async () => {
  await withScratchTenant(async (tenant) => {
    const customer = `cus_${tenant.organizationId.slice(0, 8)}`;
    await giveCustomer(tenant, customer);

    const webhook = new StripeWebhookController();
    await webhook.handle(delivery(subscriptionEvent(evt('a1'), 'customer.subscription.updated', customer)));

    const subscription = await readSubscription(tenant.organizationId);
    assert.equal(subscription?.status, 'active');
    assert.equal(subscription?.plan, 'club');
    assert.equal(subscription?.hasSubscription, true);
    assert.equal(subscription?.cancelAtPeriodEnd, false);
    assert.equal(
      subscription?.currentPeriodEnd,
      new Date(1_800_000_000 * 1000).toISOString(),
    );

    const [event] = await trail(evt('a1'));
    assert.equal(event?.outcome, 'applied');
    assert.deepEqual(
      Object.keys(event!.changed).sort(),
      ['plan', 'stripe_subscription_id', 'subscription_current_period_end', 'subscription_status'],
    );
  });
});

test('2.4 — a redelivery changes nothing, which is what Stripe retrying means', async () => {
  await withScratchTenant(async (tenant) => {
    const customer = `cus_${tenant.organizationId.slice(0, 8)}`;
    await giveCustomer(tenant, customer);

    const webhook = new StripeWebhookController();
    const event = subscriptionEvent(evt('b1'), 'customer.subscription.updated', customer);

    await webhook.handle(delivery(event));

    // Somebody cancels in the portal; a *later* event says so.
    await webhook.handle(
      delivery(
        subscriptionEvent(evt('b2'), 'customer.subscription.updated', customer, {
          cancel_at_period_end: true,
        }),
      ),
    );

    // And now Stripe redelivers the first one, out of order, as it may.
    await webhook.handle(delivery(event));

    const subscription = await readSubscription(tenant.organizationId);
    assert.equal(
      subscription?.cancelAtPeriodEnd,
      true,
      'the redelivery must not undo what came after it',
    );

    assert.equal((await trail(evt('b1'))).length, 1, 'one row per event, however many deliveries');
    assert.equal((await trail(evt('b2'))).length, 1);
  });
});

test('2.4 — a tampered signature is refused, and nothing is written', async () => {
  await withScratchTenant(async (tenant) => {
    const customer = `cus_${tenant.organizationId.slice(0, 8)}`;
    await giveCustomer(tenant, customer);

    const webhook = new StripeWebhookController();
    const event = subscriptionEvent(evt('c1'), 'customer.subscription.updated', customer);

    await expectStatus(() => webhook.handle(delivery(event, { tamper: true })), 401);

    // The body a forger would send: the same JSON, signed with their own secret.
    const forged = new Stripe('sk_test_poolse', { apiVersion: '2026-08-26.dahlia' });
    const payload = JSON.stringify(event);
    const wrong = forged.webhooks.generateTestHeaderString({ payload, secret: 'whsec_not_ours' });
    await expectStatus(
      () =>
        webhook.handle({
          headers: { 'stripe-signature': wrong },
          rawBody: Buffer.from(payload, 'utf8'),
        } as unknown as RawBodyRequest<Request>),
      401,
    );

    const subscription = await readSubscription(tenant.organizationId);
    assert.equal(subscription?.plan, null, 'an unsigned event marked nobody as paid');

    assert.equal((await trail(evt('c1'))).length, 0);
  });
});

test('2.4 — a delivery with no signature at all is refused', async () => {
  const webhook = new StripeWebhookController();
  await expectStatus(
    () =>
      webhook.handle({
        headers: {},
        rawBody: Buffer.from('{}', 'utf8'),
      } as unknown as RawBodyRequest<Request>),
    401,
  );
});

test('2.4 — a customer Poolse does not know is recorded and ignored', async () => {
  await withScratchTenant(async (tenant) => {
    const webhook = new StripeWebhookController();
    await webhook.handle(
      delivery(subscriptionEvent(evt('d1'), 'customer.subscription.updated', 'cus_a_stranger')),
    );

    const [event] = await trail(evt('d1'));
    assert.equal(event?.outcome, 'unknown_customer');
    assert.equal(event?.organization_id, null);

    // Recorded, and answered 200: an endpoint that 500s on test traffic gets
    // itself disabled by Stripe, taking the real events with it.
    //
    // This row names no tenant, so no teardown sweeps it — the same property
    // `platform_audit_log` has, and the reason its own test scopes to its actor
    // rather than counting the table. An append-only trail that a test could
    // tidy up would not be append-only.
  });
});

test('2.4 — a failed payment is past_due and the door stays open', async () => {
  await withScratchTenant(async (tenant) => {
    const customer = `cus_${tenant.organizationId.slice(0, 8)}`;
    await giveCustomer(tenant, customer);

    const webhook = new StripeWebhookController();
    await webhook.handle(
      delivery({
        id: evt('e1'),
        type: 'invoice.payment_failed',
        data: { object: { customer } },
      }),
    );

    const subscription = await readSubscription(tenant.organizationId);
    assert.equal(subscription?.status, 'past_due');
    assert.equal(
      subscription?.suspendedAt,
      null,
      'billing state and access state are two facts — only an operator shuts a club',
    );
  });
});

test('2.4 — a deleted subscription clears the plan and leaves no stale id', async () => {
  await withScratchTenant(async (tenant) => {
    const customer = `cus_${tenant.organizationId.slice(0, 8)}`;
    await giveCustomer(tenant, customer);

    const webhook = new StripeWebhookController();
    await webhook.handle(delivery(subscriptionEvent(evt('f1'), 'customer.subscription.updated', customer)));
    await webhook.handle(delivery(subscriptionEvent(evt('f2'), 'customer.subscription.deleted', customer)));

    const subscription = await readSubscription(tenant.organizationId);
    assert.equal(subscription?.status, 'canceled');
    assert.equal(subscription?.plan, null);
    assert.equal(subscription?.hasSubscription, false);
    assert.equal(subscription?.hasCustomer, true, 'the customer survives; they may come back');
  });
});

test('2.4 — an event type nobody handles leaves no trace', async () => {
  await withScratchTenant(async (tenant) => {
    const customer = `cus_${tenant.organizationId.slice(0, 8)}`;
    await giveCustomer(tenant, customer);

    await new StripeWebhookController().handle(
      delivery({ id: evt('g1'), type: 'invoice.created', data: { object: { customer } } }),
    );

    assert.equal(
      (await trail(evt('g1'))).length,
      0,
      'the trail is what Poolse did, not what Stripe sent',
    );
  });
});

test('2.4 — owner and admin read the subscription; nobody else does', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Sandra', 'Marques', ['admin']);
    const teacher = await addMember(tenant, 'Inês', 'Costa', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const view = await new SubscriptionController().read();
      assert.equal(view.canManage, true);
      assert.equal(view.subscription.organizationId, tenant.organizationId);
      assert.equal(view.plans.length, 3, 'the three plans are the product');
    });

    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      const view = await new SubscriptionController().read();
      // An admin needs to know the trial ends on Friday; an admin committing the
      // owner's card to a monthly charge is a different thing.
      assert.equal(view.canManage, false);
    });

    for (const role of ['instructor', 'maintenance', 'student', 'guardian'] as const) {
      await actingAs(tenant, { membershipId: teacher, roles: [role] }, async () => {
        const controller = new SubscriptionController();
        await expectStatus(() => controller.read(), 403);
        await expectStatus(() => controller.checkout({ plan: 'club' }), 403);
        await expectStatus(() => controller.portal(), 403);
      });
    }
  });
});

test('2.4 — an admin cannot start or change a subscription', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Sandra', 'Marques', ['admin']);

    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      const controller = new SubscriptionController();
      await expectStatus(() => controller.checkout({ plan: 'club' }), 403);
      await expectStatus(() => controller.portal(), 403);
    });
  });
});

test('2.4 — with no price configured, checkout refuses rather than half-working', async () => {
  await withScratchTenant(async (tenant) => {
    const had = process.env['STRIPE_PRICE_NETWORK'];
    delete process.env['STRIPE_PRICE_NETWORK'];

    try {
      await actingAs(tenant, { roles: ['owner'] }, async () => {
        // 503, not 500: the installation is not selling this plan today, which
        // is a true thing to say and a different one from a broken request.
        await expectStatus(() => new SubscriptionController().checkout({ plan: 'network' }), 503);
      });
    } finally {
      if (had !== undefined) process.env['STRIPE_PRICE_NETWORK'] = had;
    }
  });
});

test('2.4 — a plan nobody sells is a 400, and the portal needs a customer', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new SubscriptionController();
      await expectStatus(() => controller.checkout({ plan: 'enterprise' }), 400);
      await expectStatus(() => controller.checkout({}), 400);
      // Never subscribed, so there is nothing to manage — the screen offers the
      // plans instead, which is what it already shows.
      await expectStatus(() => controller.portal(), 409);
    });
  });
});
