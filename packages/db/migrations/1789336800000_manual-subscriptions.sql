-- Up Migration
--
-- Subscriptions paid outside Stripe — POOLSE-63, slice D.
--
-- Some clubs will pay in cash, by transfer, on a handshake. `/admin` has to be
-- able to turn a subscription on for them **without a Stripe customer existing at
-- all**, and POOLSE-61 made that urgent rather than tidy: the trial clock now
-- runs hourly, so a club paying by bank transfer that is left on `trialing`
-- becomes read-only on day 15 by machine. Until this migration there is no honest
-- state for a paying friend — only `comped`, which says the money is not real.
--
-- **Three columns, three questions, still none of them merged.** `billing_mode`
-- says *how* a club pays, `subscription_status` says *whether* they are paying,
-- and `suspended_at` says whether the door is open. That separation is the
-- platform slice's and this migration keeps it.
--
-- **`comped` moves home, and this is the reversal.** `subscription_status` has
-- carried the value since `platform-admin.sql`. Once `billing_mode` exists, that
-- is two homes for one fact — a club could be `billing_mode = 'manual'` and
-- `subscription_status = 'comped'`, reading as "pays in cash" and "is not billed"
-- at once. So the mode owns it: a comped club is `billing_mode = 'comped'`,
-- `subscription_status = 'active'`, which is also the more honest pair, since a
-- free pilot *is* active and what is unusual about it is how it pays. Settled
-- 13 September 2026, `docs/backlog/CONFLICTS.md`. The enum value stays where it
-- is because removing one is a rebuild, and a value nothing writes costs nothing.
--
-- **The ladder stops at read-only for a manual club — decided 18 September 2026.**
-- A trial that runs out walks all the way down to an archive; a customer who is
-- late does not. `past_due`, then read-only after a grace, and nothing further:
-- no `pending_delete_at`, no closed door, no archive. A club that has paid before
-- is not a trial that never did, and the machine must never file one away.

-- ---------------------------------------------------------------------------
-- How a club pays
-- ---------------------------------------------------------------------------

CREATE TYPE billing_mode AS ENUM ('stripe', 'manual', 'comped');

COMMENT ON TYPE billing_mode IS
  'How a club pays for Poolse: by card through Stripe, by hand to the operator, '
  'or not at all because it is a free pilot. Distinct from subscription_status, '
  'which says whether they are paying, and from suspended_at, which says whether '
  'the door is open. POOLSE-63.';

ALTER TABLE organization
  ADD COLUMN billing_mode billing_mode NOT NULL DEFAULT 'stripe',
  ADD COLUMN paid_through date;

COMMENT ON COLUMN organization.billing_mode IS
  'stripe | manual | comped. Owns `comped` since 18-09-2026 — the status carried '
  'it until then and two homes for one fact is how they drift. Descriptive of the '
  'payment route only: no ceiling and no feature is decided by it.';

/*
 * A date, not a timestamp, and the deviation from the ticket is deliberate.
 *
 * Cover runs to the end of a day: "paid through 31 October" is a sentence about
 * a calendar, it is typed as `dd-MM-yyyy` and shown the same way. A `timestamptz`
 * would invite exactly the reading CLAUDE.md warns against — a `YYYY-MM-DD`
 * parsed as a UTC instant, which is the off-by-one that made a rate effective on
 * 1 October read as 30 September. There is no hour here to lose.
 */
COMMENT ON COLUMN organization.paid_through IS
  'The last day a manual subscription is paid up to, inclusive. Moved only by '
  'recording a payment — a field typed by hand is a field that disagrees with the '
  'money. Null for a club that has never paid outside Stripe. POOLSE-63.';

/*
 * `comped` moves from the status to the mode, in the migration that creates the
 * mode.
 *
 * Both halves in one statement so no row is ever briefly neither. Nothing else
 * changes: the club stays live, unbilled and untouched by the trial clock, which
 * filters on `trialing` and never saw a comped tenant anyway.
 */
UPDATE organization
   SET billing_mode = 'comped',
       subscription_status = 'active'
 WHERE subscription_status = 'comped';

/*
 * The constraint this slice exists for.
 *
 * Without it an operator flips a club to active, forgets, and they run free for
 * two years. **A manual subscription that cannot be forgotten is the whole
 * requirement** — so an active one must say what it is paid up to, and the
 * database is what says so rather than a screen that can be worked around with a
 * database client.
 *
 * It binds only an *active manual* subscription. A manual club that has lapsed to
 * `past_due`, or one marked manual before the first money arrives, is a real
 * state and is allowed: what is refused is claiming somebody is paid up without
 * saying until when.
 */
ALTER TABLE organization
  ADD CONSTRAINT organization_manual_needs_end_date CHECK (
    billing_mode <> 'manual'
    OR subscription_status <> 'active'
    OR paid_through IS NOT NULL
  );

/*
 * Two more named columns for the platform login, and the reasoning is the one
 * every grant in this file's family carries: a bare `GRANT UPDATE ON
 * organization` would hand over the name, the slug and the VAT number with them.
 *
 * Both go through `changeTenant`, so every flip lands in `platform_audit_log`
 * with its before-and-after inside the transaction that made it.
 */
GRANT UPDATE (billing_mode, paid_through) ON organization TO poolse_platform;

-- ---------------------------------------------------------------------------
-- How long a lapsed manual subscription keeps writing
-- ---------------------------------------------------------------------------
--
-- Beside `trial_period()`, `trial_read_only_period()` and `trial_closed_period()`,
-- and for the same reason: the ladder's numbers belong in one place rather than
-- in a job, a document and a test that agree until one of them is edited.
--
-- Fifteen days. A club that pays in cash gets the same courtesy as a card that
-- bounced — the cheque is in the post, the treasurer is on holiday — and being
-- shut out of the register on the morning after a due date is not a courtesy.

CREATE FUNCTION manual_grace_period() RETURNS interval
LANGUAGE sql
STABLE
AS $$ SELECT interval '15 days' $$;

COMMENT ON FUNCTION manual_grace_period() IS
  'How long after paid_through a manual subscription may still write before it '
  'goes read-only. The single definition; the clock calls it rather than holding '
  'its own literal. POOLSE-63.';

-- ---------------------------------------------------------------------------
-- What was actually received
-- ---------------------------------------------------------------------------
--
-- **Insert-only**, the reasoning `invoice` and every other book in this schema
-- carries: a record that can be edited is not a record. A revoke rather than a
-- trigger, because a missing privilege cannot be forgotten by application code.
--
-- **Platform-scoped**, like `stripe_event`, `trial_event` and `platform_audit_log`:
-- a row is *about* a tenant rather than belonging to one. This is Poolse's own
-- revenue, not the club's money — the club never sees it, and a tenant connection
-- must not be able to read what another club paid.
--
-- **`docs/financials.md` applies, with one stated exception.** Every money
-- convention in §4 holds — integer cents, `char(3)` currency, a provenance on the
-- amount, `created_by` answerable — *except* the tenant-scoped ones: there is no
-- RLS policy for `poolse_app`, no composite foreign key and no `archived_at`,
-- because none of those are true of a platform book. Financial history is still
-- never destroyed; here that is a grant with no DELETE rather than a soft-delete
-- column.
--
-- Portugal: cash still needs a receipt. This table is the record that one was
-- owed and for what. Invoicing Poolse's own revenue is a later ticket; the data
-- has to exist from the first payment or it never will.

CREATE TYPE manual_payment_method AS ENUM ('cash', 'bank_transfer', 'other');

COMMENT ON TYPE manual_payment_method IS
  'How the money arrived. English snake_case, as every enum in this schema is — '
  'the Portuguese (dinheiro, transferência) is an i18n key, so a value is not '
  'frozen in the language of whoever typed it.';

CREATE TABLE manual_payment (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),

  amount_cents    integer NOT NULL,
  currency        char(3) NOT NULL DEFAULT 'EUR',
  /*
   * `actual` by definition: this is money that arrived, not a figure anybody
   * estimated. The column is here rather than implied because §2 of
   * docs/financials.md says every stored amount carries its provenance, and
   * because a later total across Poolse's own revenue must be labelled without a
   * migration. Nothing today writes anything but `actual`.
   */
  provenance      money_provenance NOT NULL DEFAULT 'actual',

  received_on     date NOT NULL,
  method          manual_payment_method NOT NULL,

  /*
   * What the money bought, which is what moves `paid_through`.
   *
   * `covers_to` is required — a payment that says nothing about the period it
   * covers cannot extend one, and this table is the only thing allowed to move
   * that date. `covers_from` is optional: an operator recording last month's
   * cash may know what it ends and not care what it started.
   */
  covers_from     date,
  covers_to       date NOT NULL,

  note            text,

  /** Who recorded it. Never nullable: this is a person's claim about money. */
  recorded_by_clerk_user_id text NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),

  CONSTRAINT manual_payment_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT manual_payment_currency_upper  CHECK (currency = upper(currency)),
  CONSTRAINT manual_payment_period_ordered  CHECK (covers_from IS NULL OR covers_from <= covers_to),
  CONSTRAINT manual_payment_actor_present   CHECK (btrim(recorded_by_clerk_user_id) <> ''),
  CONSTRAINT manual_payment_note_sane       CHECK (note IS NULL OR length(note) <= 500)
);

COMMENT ON TABLE manual_payment IS
  'Money a club paid the operator outside Stripe — cash, transfer, a handshake. '
  'Insert-only and platform-scoped. Recording one is what moves '
  'organization.paid_through; it is never typed directly. POOLSE-63.';

COMMENT ON COLUMN manual_payment.covers_to IS
  'The last day this payment pays for. organization.paid_through is the greatest '
  'of these, so a later payment extends cover and an earlier one recorded out of '
  'order cannot shorten it.';

-- No updated_at and no archived_at, for the reason `audit_log` and `invoice` have
-- neither: an entry is never edited and never removed.

CREATE INDEX manual_payment_org_idx ON manual_payment (organization_id, received_on DESC);
CREATE INDEX manual_payment_received_idx ON manual_payment (received_on DESC);

/*
 * `ALTER DEFAULT PRIVILEGES` in the core migration grants poolse_app all four
 * verbs on every table created since, so this arrived readable and writable by
 * the tenant connection. It goes back, exactly as the platform tables did — belt
 * and braces with RLS enabled and no policy naming poolse_app, so a tenant query
 * returns nothing for two independent reasons.
 */
REVOKE ALL ON manual_payment FROM poolse_app;
ALTER TABLE manual_payment ENABLE ROW LEVEL SECURITY;

/*
 * `FOR ALL` rather than separate SELECT and INSERT policies, for the reason
 * `stripe_event_operators` gives: a policy's WITH CHECK is what governs an
 * insert, and a SELECT-only policy leaves the write refused by RLS even with the
 * grant in hand. The grant is the narrow half — read and insert, never update or
 * delete.
 */
CREATE POLICY manual_payment_operators ON manual_payment
  FOR ALL TO poolse_platform USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON manual_payment TO poolse_platform;

-- ---------------------------------------------------------------------------
-- The machine's book learns two more transitions
-- ---------------------------------------------------------------------------
--
-- `trial_event` and `trial_notice` are the clock's own books, kept apart from
-- `platform_audit_log` because that table's actor is `clerk_user_id NOT NULL` and
-- a cron is not a person. A manual subscription lapsing is the same kind of fact:
-- a machine moved a club because a date passed, and six weeks later somebody has
-- to be able to tell that from a sentence an operator typed.
--
-- **The two types have outgrown their names** — they now cover the whole access
-- ladder rather than only a trial. Renaming them is a proposal, not this ticket:
-- it would touch the tables, the enums, the service, three test files and the
-- docs for no behaviour. Left as one line here and in `docs/decisions.md`.
--
-- `ADD VALUE IF NOT EXISTS` and used by nothing in this transaction — Postgres
-- will add an enum value inside one and will not let the same one use it. The
-- code that writes these ships in the same commit and runs later.

ALTER TYPE trial_transition ADD VALUE IF NOT EXISTS 'payment_lapsed';
ALTER TYPE trial_transition ADD VALUE IF NOT EXISTS 'payment_read_only';

ALTER TYPE trial_notice_kind ADD VALUE IF NOT EXISTS 'payment_overdue';
ALTER TYPE trial_notice_kind ADD VALUE IF NOT EXISTS 'payment_read_only';

-- Down Migration
--
-- `comped` goes back to being a status, the columns and the book go, and the two
-- enums keep the values they gained.
--
-- **Enum values are not rebuilt out.** `platform-reach-widened.sql` set the
-- precedent and the reasoning is the same: rebuilding `trial_transition` would
-- mean rewriting rows that legitimately record a lapse that happened, and a value
-- nothing writes costs nothing. `billing_mode` is a different case — it is a type
-- this migration created, so dropping it is exact.
--
-- Payments already recorded are lost with the table, which is the one genuinely
-- destructive thing here and is unavoidable: there is nowhere else for them to
-- live. Reversing this migration on anything but a laptop is therefore a decision
-- and not a tidy-up.

DROP POLICY IF EXISTS manual_payment_operators ON manual_payment;
DROP TABLE IF EXISTS manual_payment;
DROP TYPE IF EXISTS manual_payment_method;

DROP FUNCTION IF EXISTS manual_grace_period();

REVOKE UPDATE (billing_mode, paid_through) ON organization FROM poolse_platform;

ALTER TABLE organization DROP CONSTRAINT IF EXISTS organization_manual_needs_end_date;

UPDATE organization
   SET subscription_status = 'comped'
 WHERE billing_mode = 'comped'
   AND subscription_status = 'active';

ALTER TABLE organization
  DROP COLUMN IF EXISTS paid_through,
  DROP COLUMN IF EXISTS billing_mode;

DROP TYPE IF EXISTS billing_mode;
