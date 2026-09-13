-- Up Migration
--
-- The operator gets paid — slice 2.4.
--
-- Everything before this slice is something a *club* gets. This is the one part
-- of the money phase that points the other way: Poolse charging the club, on a
-- Stripe subscription against the organization.
--
-- **`stripe_customer_id` has been here since the core migration** and has never
-- been written. What it lacked was the rest of the state a subscription has:
-- which plan, which subscription, when the period ends, and whether it is set to
-- stop at the end of it.
--
-- **Status only.** Paying for Clube does *not* raise `max_facilities` —
-- decided 13 September 2026. The ceilings stay a hand-set operator decision in
-- `/admin`, where they already are, so there is exactly one place a limit is
-- decided and no webhook can quietly widen a tenant's licence. What Stripe moves
-- is `subscription_status` and the four columns below.
--
-- **`plan` is what they bought, not what they may do.** It names the price they
-- are on so the screen can say it and the operator can see it; nothing is
-- enforced from it. Keeping the two apart is what makes "a one-off deal for this
-- club" a thing an operator does in one place rather than a special case in a
-- webhook.

CREATE TYPE plan_key AS ENUM ('starter', 'club', 'network');

COMMENT ON TYPE plan_key IS
  'The three plans on the pricing page. A closed set only a developer changes — a new plan is a price in Stripe, an env var and a deploy.';

ALTER TABLE organization
  ADD COLUMN plan plan_key,
  ADD COLUMN stripe_subscription_id text,
  ADD COLUMN subscription_current_period_end timestamptz,
  ADD COLUMN subscription_cancel_at_period_end boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN organization.plan IS
  'Which plan they pay for. Descriptive only: the ceilings are max_facilities and max_management_users, set by an operator — slice 2.4, 13 September 2026.';

COMMENT ON COLUMN organization.subscription_current_period_end IS
  'When the paid period ends, from Stripe. What the screen counts down to once a subscription is set to cancel.';

COMMENT ON COLUMN organization.subscription_cancel_at_period_end IS
  'Set from Stripe when somebody cancels in the customer portal. They keep what they have until the period ends — cancelling is not suspension, and only suspension shuts a door.';

/*
 * One customer is one organization, and one subscription is one organization.
 *
 * Partial, because most rows are null and a plain unique constraint would let
 * exactly one of them be so. The webhook resolves an event to a tenant *through*
 * `stripe_customer_id`, so a duplicate here would mean an event applied to the
 * wrong club — which is the one mistake in this file that would be invisible.
 */
CREATE UNIQUE INDEX organization_stripe_customer_uq
  ON organization (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX organization_stripe_subscription_uq
  ON organization (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Every event Stripe delivered, and what it changed
-- ---------------------------------------------------------------------------
--
-- **Idempotency and the audit trail are one table**, because they are the same
-- fact written down: this event arrived, this is what it did. Stripe retries a
-- delivery it did not get a 2xx for — that is documented behaviour, not an edge
-- case — so applying one twice has to be impossible rather than unlikely. The
-- primary key is Stripe's own event id and the insert happens in the same
-- transaction as the change, so a retry either finds the row and stops or finds
-- nothing because the first attempt rolled back.
--
-- **It is the billing trail, and it is deliberately not `platform_audit_log`.**
-- That table's actor column is `clerk_user_id NOT NULL`, and a webhook has no
-- person behind it; writing 'stripe' into a column named for a Clerk user would
-- be a lie in the one place that exists to be believed. So the two write paths
-- to a tenant's billing state each record themselves in their own book — an
-- operator's through `changeTenant`, Stripe's through here — and neither can
-- write without leaving one.
--
-- Not tenant-scoped, like `platform_audit_log`: a row is *about* a tenant rather
-- than belonging to one, and `organization_id` is null for an event that names a
-- customer Poolse does not know.

CREATE TABLE stripe_event (
  -- Stripe's id, `evt_...`. The primary key *is* the idempotency.
  id              text PRIMARY KEY,
  type            text NOT NULL,
  organization_id uuid REFERENCES organization (id),
  /*
   * What actually moved, before and after — the same shape `platform_audit_log`
   * records for an operator's change. Never the Stripe payload: it carries the
   * customer's name and address, and a copy of those in a log is a second copy
   * to protect.
   */
  changed         jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** Set when the event was understood but changed nothing — a machine key. */
  outcome         text NOT NULL DEFAULT 'applied',
  received_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (id <> ''),
  CHECK (type <> '')
);

CREATE INDEX stripe_event_time_idx ON stripe_event (received_at DESC);
CREATE INDEX stripe_event_org_idx ON stripe_event (organization_id, received_at DESC);

-- No updated_at and no archived_at, for the reason `audit_log` has neither: an
-- entry is never edited and never removed.

-- ---------------------------------------------------------------------------
-- Who may write what
-- ---------------------------------------------------------------------------
--
-- `ALTER DEFAULT PRIVILEGES` in the core migration grants poolse_app all four
-- verbs on every table created since, so `stripe_event` arrived readable and
-- writable by the tenant connection. It goes back, exactly as the platform
-- tables did — belt and braces with RLS enabled and no policy naming poolse_app,
-- so a tenant query returns nothing for two independent reasons.

REVOKE ALL ON stripe_event FROM poolse_app;
ALTER TABLE stripe_event ENABLE ROW LEVEL SECURITY;

/*
 * `FOR ALL` rather than a SELECT and an INSERT policy, for the reason
 * `platform_audit_log_operators` gives: a policy's WITH CHECK is what governs an
 * insert, and a SELECT-only policy leaves the write refused by RLS even with the
 * grant in hand. The grant is still the narrow half — read and insert, never
 * update or delete, because an entry that can be edited is not a trail.
 */
CREATE POLICY stripe_event_operators ON stripe_event
  FOR ALL TO poolse_platform USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON stripe_event TO poolse_platform;

/*
 * Five more named columns for the platform role, and the reasoning is the one
 * slice 3 wrote down: a bare `GRANT UPDATE ON organization` would hand over the
 * name, the slug and the VAT number with them.
 *
 * `subscription_status` is already on that list. These five join it because the
 * Stripe webhook writes them and runs on the same connection — it is
 * cross-tenant by nature, resolving an event to a club by its customer id, and
 * the tenant role has no way to do that.
 *
 * `max_facilities` and `max_management_users` are *not* extended to the webhook
 * in any sense: they were already granted for the operator's own screens, and
 * nothing in the Stripe path writes them.
 */
GRANT UPDATE (
  plan,
  stripe_customer_id,
  stripe_subscription_id,
  subscription_current_period_end,
  subscription_cancel_at_period_end
) ON organization TO poolse_platform;

-- Down Migration

REVOKE UPDATE (
  plan,
  stripe_customer_id,
  stripe_subscription_id,
  subscription_current_period_end,
  subscription_cancel_at_period_end
) ON organization FROM poolse_platform;

DROP POLICY IF EXISTS stripe_event_operators ON stripe_event;
DROP TABLE IF EXISTS stripe_event;

DROP INDEX IF EXISTS organization_stripe_subscription_uq;
DROP INDEX IF EXISTS organization_stripe_customer_uq;

ALTER TABLE organization
  DROP COLUMN IF EXISTS subscription_cancel_at_period_end,
  DROP COLUMN IF EXISTS subscription_current_period_end,
  DROP COLUMN IF EXISTS stripe_subscription_id,
  DROP COLUMN IF EXISTS plan;

DROP TYPE IF EXISTS plan_key;
