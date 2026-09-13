import { withOrg, withPlatform } from '@poolse/db';
import type { PlanKey } from './stripe.js';

/**
 * The organization's own subscription — slice 2.4.
 *
 * **Two connections, and the split is not arbitrary.** What a club reads about
 * itself is an ordinary tenant-scoped query on `poolse_app`. What the Stripe
 * webhook writes is cross-tenant by nature — an event names a customer, not an
 * organization, so resolving it means looking across every club — and that is
 * `poolse_platform`, on its own pool, holding UPDATE on five named billing
 * columns and nothing else.
 *
 * **Every webhook write records itself, in the same transaction.** `stripe_event`
 * is both the idempotency key and the trail: a redelivery finds the row and
 * stops, and a change that rolled back left no row to find. The operator's own
 * write path keeps its own book (`platform_audit_log` via `changeTenant`), and
 * the two are separate because their actors are — one is a person, one is not.
 */

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'comped';

export interface OrganizationSubscription {
  organizationId: string;
  name: string;
  plan: PlanKey | null;
  status: SubscriptionStatus | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
  hasSubscription: boolean;
  /** Shut clubs see the notice, not this screen — but the state is still true. */
  suspendedAt: string | null;
}

/** What a club reads about its own subscription. Tenant-scoped, like any page. */
export async function readSubscription(
  organizationId: string,
): Promise<OrganizationSubscription | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      name: string;
      plan: PlanKey | null;
      subscription_status: SubscriptionStatus | null;
      trial_ends_at: Date | null;
      subscription_current_period_end: Date | null;
      subscription_cancel_at_period_end: boolean;
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
      suspended_at: Date | null;
    }>(
      `SELECT id, name, plan, subscription_status, trial_ends_at,
              subscription_current_period_end, subscription_cancel_at_period_end,
              stripe_customer_id, stripe_subscription_id, suspended_at
         FROM organization
        WHERE id = $1`,
      [organizationId],
    );

    const row = rows[0];
    if (row === undefined) return null;

    return {
      organizationId: row.id,
      name: row.name,
      plan: row.plan,
      status: row.subscription_status,
      trialEndsAt: row.trial_ends_at?.toISOString() ?? null,
      currentPeriodEnd: row.subscription_current_period_end?.toISOString() ?? null,
      cancelAtPeriodEnd: row.subscription_cancel_at_period_end,
      // The ids themselves never leave the API. A club has no use for them, and
      // a customer id in a browser is one more thing to keep out of a screenshot.
      hasCustomer: row.stripe_customer_id !== null,
      hasSubscription: row.stripe_subscription_id !== null,
      suspendedAt: row.suspended_at?.toISOString() ?? null,
    };
  });
}

/** The Stripe customer for this club, if one has been made. Never sent to a client. */
export async function readCustomerId(organizationId: string): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ stripe_customer_id: string | null }>(
      `SELECT stripe_customer_id FROM organization WHERE id = $1`,
      [organizationId],
    );
    return rows[0]?.stripe_customer_id ?? null;
  });
}

/**
 * Remember the customer Stripe just made for this club.
 *
 * Tenant-scoped and written by the club's own request, because that is when it
 * happens: an owner presses Subscrever, a customer is created, and the id has to
 * survive so the next checkout does not make a second one. The unique index is
 * what makes a second one impossible even if this is ever called twice.
 */
export async function rememberCustomer(
  organizationId: string,
  customerId: string,
): Promise<void> {
  await withOrg(organizationId, async (tx) => {
    await tx.query(
      `UPDATE organization SET stripe_customer_id = $2
        WHERE id = $1 AND stripe_customer_id IS NULL`,
      [organizationId, customerId],
    );
  });
}

/** What a Stripe event says about a club, already read out of the payload. */
export interface SubscriptionChange {
  plan?: PlanKey | null | undefined;
  status?: SubscriptionStatus | undefined;
  subscriptionId?: string | null | undefined;
  currentPeriodEnd?: Date | null | undefined;
  cancelAtPeriodEnd?: boolean | undefined;
}

const COLUMNS: Record<keyof SubscriptionChange, string> = {
  plan: 'plan',
  status: 'subscription_status',
  subscriptionId: 'stripe_subscription_id',
  currentPeriodEnd: 'subscription_current_period_end',
  cancelAtPeriodEnd: 'subscription_cancel_at_period_end',
};

/** Read back for the trail. Never the Stripe payload — see the migration. */
const AUDITED = [
  'plan',
  'subscription_status',
  'stripe_subscription_id',
  'subscription_current_period_end',
  'subscription_cancel_at_period_end',
] as const;

export type EventOutcome = 'applied' | 'duplicate' | 'unknown_customer' | 'ignored';

export interface AppliedEvent {
  outcome: EventOutcome;
  organizationId: string | null;
  changed: Record<string, { before: unknown; after: unknown }>;
}

/**
 * Apply one Stripe event, once.
 *
 * **The whole thing is one transaction, and the insert into `stripe_event` is
 * what makes it idempotent.** Stripe retries any delivery it did not get a 2xx
 * for; the primary key refuses the second one, and because the insert and the
 * update commit together, a retry after a failure finds nothing and applies the
 * change properly.
 *
 * **An event naming a customer Poolse does not know is recorded and ignored**,
 * not an error. A Stripe account can carry test traffic, a customer somebody
 * made by hand in the dashboard, or an old club that has since been removed —
 * and a webhook endpoint that 500s on any of those gets itself disabled by
 * Stripe after enough retries, taking the real events with it.
 */
export async function applyStripeEvent(
  eventId: string,
  eventType: string,
  customerId: string | null,
  change: SubscriptionChange,
): Promise<AppliedEvent> {
  return withPlatform(async (tx) => {
    const seen = await tx.query(`SELECT 1 FROM stripe_event WHERE id = $1`, [eventId]);
    if (seen.rows.length > 0) {
      return { outcome: 'duplicate' as const, organizationId: null, changed: {} };
    }

    const found =
      customerId === null
        ? { rows: [] }
        : await tx.query<{ id: string }>(
            `SELECT id FROM organization WHERE stripe_customer_id = $1`,
            [customerId],
          );

    const organizationId = found.rows[0]?.id ?? null;

    if (organizationId === null) {
      await tx.query(
        `INSERT INTO stripe_event (id, type, organization_id, outcome)
              VALUES ($1, $2, NULL, 'unknown_customer')`,
        [eventId, eventType],
      );
      return { outcome: 'unknown_customer' as const, organizationId: null, changed: {} };
    }

    const columns = (Object.keys(change) as (keyof SubscriptionChange)[]).filter(
      (key) => change[key] !== undefined,
    );

    if (columns.length === 0) {
      await tx.query(
        `INSERT INTO stripe_event (id, type, organization_id, outcome)
              VALUES ($1, $2, $3, 'ignored')`,
        [eventId, eventType, organizationId],
      );
      return { outcome: 'ignored' as const, organizationId, changed: {} };
    }

    const { rows: before } = await tx.query<Record<string, unknown>>(
      `SELECT ${AUDITED.join(', ')} FROM organization WHERE id = $1`,
      [organizationId],
    );

    // Built from a fixed key list, never from anything Stripe sent: these become
    // identifiers, which cannot be parameterised.
    const assignments = columns.map((key, index) => `${COLUMNS[key]} = $${index + 2}`);

    const { rows: after } = await tx.query<Record<string, unknown>>(
      `UPDATE organization SET ${assignments.join(', ')}
        WHERE id = $1
        RETURNING ${AUDITED.join(', ')}`,
      [organizationId, ...columns.map((key) => change[key] ?? null)],
    );

    const changed: AppliedEvent['changed'] = {};
    for (const column of AUDITED) {
      const was = normalise(before[0]![column]);
      const now = normalise(after[0]![column]);
      if (was !== now) changed[column] = { before: was, after: now };
    }

    await tx.query(
      `INSERT INTO stripe_event (id, type, organization_id, changed, outcome)
            VALUES ($1, $2, $3, $4::jsonb, 'applied')`,
      [eventId, eventType, organizationId, JSON.stringify(changed)],
    );

    return { outcome: 'applied' as const, organizationId, changed };
  });
}

/** A Date is not comparable by `!==`; an id and a status are. */
function normalise(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}
