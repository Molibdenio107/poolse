import type Stripe from 'stripe';
import { planForPrice } from './stripe.js';
import type { SubscriptionChange, SubscriptionStatus } from './subscription.repository.js';

/**
 * One Stripe event, turned into the columns it moves — slice 2.4.
 *
 * **Its own module because it is the part worth testing.** Everything else in
 * the webhook path is a signature check and a database write; this is the
 * translation, and a translation is where a payload shape and an assumption
 * quietly stop agreeing. Pure — an event in, a change out, no clock, no
 * database, no network — so the tests are a handful of literal objects.
 */

export interface EventChange {
  customerId: string | null;
  change: SubscriptionChange;
}

/**
 * What Poolse takes from an event, and what it ignores.
 *
 * Four types, and they are the four that answer "does this club pay us":
 *
 * - `customer.subscription.created` / `.updated` — the plan, the status, the
 *   period end, and whether it is set to stop;
 * - `customer.subscription.deleted` — it has actually stopped;
 * - `invoice.payment_failed` — the card was refused, which is `past_due`.
 *
 * `checkout.session.completed` is deliberately **not** among them: the
 * subscription events carry everything it would, they arrive for changes made in
 * the portal as well as at checkout, and handling both would be two code paths
 * writing the same columns from payloads shaped differently.
 */
export function readChange(event: Stripe.Event): EventChange | null {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const deleted = event.type === 'customer.subscription.deleted';

      return {
        customerId: idOf(subscription.customer),
        change: {
          status: deleted ? 'canceled' : statusFrom(subscription.status),
          // Cleared on deletion: the club has no subscription any more, and a
          // stale id would make the screen offer a portal for something gone.
          subscriptionId: deleted ? null : subscription.id,
          plan: deleted ? null : planOf(subscription),
          currentPeriodEnd: deleted ? null : periodEnd(subscription),
          cancelAtPeriodEnd: deleted ? false : subscription.cancel_at_period_end,
        },
      };
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      /*
       * `past_due` and nothing else — the settled distinction from the platform
       * slice. A club whose card expired on Tuesday is past due and is also
       * mid-lesson with thirty children in the water; `suspended_at` is what
       * shuts a door, it is an operator's decision, and no webhook sets it.
       */
      return { customerId: idOf(invoice.customer), change: { status: 'past_due' } };
    }

    default:
      return null;
  }
}

/** Stripe hands back an id or an expanded object depending on the call. */
function idOf(value: string | { id: string } | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : value.id;
}

/**
 * Stripe's subscription status, in Poolse's four.
 *
 * `incomplete` and `incomplete_expired` are a checkout that never finished, and
 * `paused` is a state this product does not offer — all three mean *not paying*
 * without meaning *cancelled*, and `past_due` is the closest true thing to say
 * about a club in any of them. `comped` is never set from here: it is the free
 * pilot, and it is an operator's word.
 */
function statusFrom(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'canceled':
      return 'canceled';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
    default:
      return 'past_due';
  }
}

/**
 * Which plan this subscription is on, from the price it carries.
 *
 * Read back through the same env mapping the checkout used, so a price nobody
 * has configured leaves `plan` null rather than guessing. A subscription with
 * several items — which this product does not sell — takes the first, and the
 * null it may produce is the honest answer for a shape we do not handle.
 */
function planOf(subscription: Stripe.Subscription): SubscriptionChange['plan'] {
  const priceId = subscription.items.data[0]?.price?.id;
  return priceId === undefined ? null : planForPrice(priceId);
}

/**
 * When the paid period ends.
 *
 * On the subscription item since 2025's API versions, not on the subscription
 * itself. Read defensively through both, because the shape of this one field is
 * the thing most likely to move under a pinned version being bumped.
 */
function periodEnd(subscription: Stripe.Subscription): Date | null {
  const item = subscription.items.data[0];
  const seconds =
    item?.current_period_end ??
    (subscription as unknown as { current_period_end?: number }).current_period_end;

  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}
