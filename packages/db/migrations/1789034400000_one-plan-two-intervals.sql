-- Up Migration
--
-- One plan, two billing intervals — POOLSE-60.
--
-- `1788948000000_stripe-subscription.sql` shipped three plans — starter, club,
-- network — one day ago. **That is reversed.** An organization either pays for
-- Poolse and gets everything, or it does not pay and is on a trial. No feature
-- is gated by plan, ever; the only axis left is how often they pay.
--
-- **There is no live subscription to migrate, which is why this is a retype and
-- not a backfill.** Nobody is on Stripe: there is no account, no key on any
-- machine and no `stripe_customer_id` anywhere but a test fixture. A month from
-- now this same change would have been a data migration with real money behind
-- it, and the cost of doing it today is one column rewrite on rows that are all
-- null.
--
-- **What makes the reversal cheap is a decision the Stripe migration already
-- took**: `plan` is *descriptive*, and the ceilings — `max_facilities`,
-- `max_management_users` — are a hand-set operator decision in `/admin`. That
-- stays exactly as it is. Nothing here lets Stripe widen a licence, and
-- `billing_interval` below is descriptive for the same reason and enforces
-- nothing.

-- ---------------------------------------------------------------------------
-- One plan
--
-- Renaming the old type rather than dropping it lets the column be repointed in
-- one ALTER with a cast through text, which is the only way across two enum
-- types — the dance `1787864400000_drop-late-attendance.sql` established.
--
-- `poolse_full` rather than the *poolse-full* Rui wrote: enum values in this
-- schema are English snake_case (`fee_kind`, `member_role`, `compensation_kind`),
-- so the hyphen becomes an underscore and the word does not change. It appears
-- in the database and in `/admin`, and nowhere a customer reads — the pricing
-- page renders its own label.
-- ---------------------------------------------------------------------------

ALTER TYPE plan_key RENAME TO plan_key_old;

CREATE TYPE plan_key AS ENUM ('poolse_full');

COMMENT ON TYPE plan_key IS
  'The one plan. Descriptive: what a club bought, never what it may do — the ceilings are an operator decision in /admin. POOLSE-60.';

/*
 * Every old value maps to the one plan.
 *
 * A `CASE` rather than a cast through text, because none of the three old names
 * exists in the new type and a text cast would raise on the first row that had
 * one. All rows are null today; the mapping is here so that the migration is
 * correct rather than merely sufficient for the data that happens to be there.
 */
ALTER TABLE organization
  ALTER COLUMN plan TYPE plan_key
  USING (CASE WHEN plan IS NULL THEN NULL ELSE 'poolse_full'::plan_key END);

DROP TYPE plan_key_old;

COMMENT ON COLUMN organization.plan IS
  'poolse_full, or null where nobody has subscribed. Descriptive only — slice 2.4, narrowed to one plan by POOLSE-60.';

-- ---------------------------------------------------------------------------
-- Two intervals
--
-- How often they pay, and nothing else. Written only by the Stripe webhook,
-- alongside `plan`, from the price the subscription carries; null until they
-- subscribe. A club on the yearly interval has exactly the same product as one
-- on the monthly interval — the only difference is the invoice.
-- ---------------------------------------------------------------------------

CREATE TYPE billing_interval AS ENUM ('monthly', 'yearly');

COMMENT ON TYPE billing_interval IS
  'How often a subscription is billed. Descriptive, like plan: it changes the invoice and nothing about the product.';

ALTER TABLE organization
  ADD COLUMN billing_interval billing_interval;

COMMENT ON COLUMN organization.billing_interval IS
  'monthly | yearly, from the Stripe price. Null until they subscribe. Enforces nothing — POOLSE-60.';

/*
 * The twelfth named column on the platform role's UPDATE grant.
 *
 * The reasoning is slice 3's, unchanged: a bare `GRANT UPDATE ON organization`
 * would hand over the name, the slug and the VAT number along with it. This one
 * joins the list because the Stripe webhook writes it, on the same connection
 * and for the same reason as `plan` — an event names a customer rather than an
 * organization, which the tenant role has no way to resolve.
 */
GRANT UPDATE (billing_interval) ON organization TO poolse_platform;

-- Down Migration

REVOKE UPDATE (billing_interval) ON organization FROM poolse_platform;

ALTER TABLE organization DROP COLUMN IF EXISTS billing_interval;
DROP TYPE IF EXISTS billing_interval;

/*
 * The three plans come back, and every row that had one comes back as null.
 *
 * That asymmetry is honest and is the reason a Down exists at all: the way up
 * destroyed *which* of the three a club had bought, and no column survived
 * holding it. On today's data — every row null — the two directions are exact.
 */
ALTER TYPE plan_key RENAME TO plan_key_new;

CREATE TYPE plan_key AS ENUM ('starter', 'club', 'network');

ALTER TABLE organization
  ALTER COLUMN plan TYPE plan_key
  USING NULL::plan_key;

DROP TYPE plan_key_new;
