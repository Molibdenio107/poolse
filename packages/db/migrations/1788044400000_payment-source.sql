-- Up Migration
--
-- How a fee was paid — round 6, ticket 5.0.
--
-- Every payment recorded so far is somebody in the office ticking a box. That
-- is about to stop being the only way: `docs/roadmap.md` phase 2 brings MB WAY
-- and débito direto, and a webhook settling a month has to be distinguishable
-- from a clerk settling it. Without this column a club reconciling its bank
-- statement against Poolse has no way to tell which rows should appear on it.
--
-- **An enum, not a lookup table.** The set is closed and only a developer opens
-- it: adding a provider is an integration, not a value an operator types. That
-- is the rule `docs/data-model.md` states and the same reasoning `fee_kind` and
-- `class_session_status` follow.
--
-- **Defaulting to `manual`, and every existing row is one.** Backfilling to
-- anything else would invent a payment method for history nobody recorded one
-- for, and `manual` is exactly what those rows were.
--
-- The ticket asks for an "extension point" and this is the honest shape of one:
-- the column exists, `markFeePaid` takes the value, and a webhook that lands in
-- phase 2 passes its own instead of touching the schema again.

CREATE TYPE payment_source AS ENUM ('manual', 'mbway', 'sepa');

ALTER TABLE student_fee_payment
  ADD COLUMN source payment_source NOT NULL DEFAULT 'manual';

COMMENT ON COLUMN student_fee_payment.source IS
  'How this period was settled. manual is an office tick; the rest arrive from a provider.';

-- Down Migration

ALTER TABLE student_fee_payment DROP COLUMN IF EXISTS source;
DROP TYPE IF EXISTS payment_source;
