-- Up Migration
--
-- The clock, and its own two books — POOLSE-61, slice B2.
--
-- B1 built the state a trial ends into and the door it closes. This is what moves
-- a tenant through it, hourly, and what it writes down on the way.
--
-- **A machine is not a person, and the audit table exists to be believed.**
-- `platform_audit_log.clerk_user_id` is `NOT NULL` and names a Clerk user. A cron
-- has nobody behind it, so writing `'system'` into that column would be a lie in
-- the one place whose whole purpose is to be trusted. Following the precedent
-- `stripe_event` set, these transitions get their own book. The alternative —
-- making that column nullable and adding an `actor_kind` — changes a shipped
-- audit table to accommodate a writer it was never about; a second book costs one
-- migration and keeps `clerk_user_id` meaning exactly what its name says.
-- Settled 13 September 2026.
--
-- **Both tables are platform-scoped**, like `stripe_event` and for the same
-- reasons: a row is *about* a tenant rather than belonging to one, it is
-- invisible to the tenant connection, and it is insert-only.
--
-- **Neither purge nor archiving is here, and the second one is a correction to the
-- ticket.** POOLSE-61's scheduler listed a third step — "thirty days later, archive
-- the row" — and the platform role cannot do it: `archived_at` is deliberately
-- absent from its column grant, because *deleting a tenant is not an operator
-- action* and a machine has an even weaker claim to it than a person. Widening
-- the grant to let an hourly job remove clubs would undo that guarantee for the
-- convenience of one rung of a ladder. So the ladder stops at "sign-in closed",
-- and what happens on day 75 is decided by the purge ticket — where the question
-- "may anything remove a tenant, and under whose hand" gets asked deliberately
-- rather than arrived at by a cron.

-- ---------------------------------------------------------------------------
-- What the clock did
-- ---------------------------------------------------------------------------

CREATE TYPE trial_transition AS ENUM (
  -- The trial ran out: the tenant became `expired` and read-only.
  'expired',
  -- Thirty days later: sign-in closed, through the existing suspension
  -- mechanism with a machine-set reason.
  'access_closed'
  -- There is deliberately no `archived`. Nothing this job can do removes a
  -- tenant — see the header — and an enum value nothing may ever write is a
  -- promise the schema cannot keep. The purge ticket adds one if it decides to.
);

CREATE TABLE trial_event (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization (id),

  transition       trial_transition NOT NULL,
  occurred_at      timestamptz NOT NULL DEFAULT now(),

  /*
   * The dates this transition set, as it set them.
   *
   * Not a general before-and-after like `platform_audit_log`'s: every row here is
   * one of three known shapes, and naming the two columns that move makes the
   * book readable without parsing JSON. Null where the transition did not set one.
   */
  read_only_at     timestamptz,
  pending_delete_at timestamptz,

  /*
   * The machine's own sentence, and the one the club is shown when sign-in
   * closes. Recorded because the suspension it writes is indistinguishable on the
   * `organization` row from one an operator typed, and six weeks later somebody
   * will need to know which it was.
   */
  reason           text,

  PRIMARY KEY (id)
);

COMMENT ON TABLE trial_event IS
  'What the trial clock did, and when. A machine''s book, separate from '
  'platform_audit_log because that table''s actor is a Clerk user and a cron is '
  'not a person. Insert-only. POOLSE-61.';

CREATE INDEX trial_event_org_idx ON trial_event (organization_id, occurred_at DESC);
CREATE INDEX trial_event_time_idx ON trial_event (occurred_at DESC);

/*
 * Deliberately **no** unique on (organization_id, transition).
 *
 * The job's idempotence comes from the state it reads, not from a constraint: a
 * tenant already `expired` does not match the query that expires one, so a second
 * pass in the same hour writes nothing. A unique here would instead refuse the
 * *legitimate* second event — an operator extends a trial, it runs out again —
 * and turn a correct transition into a failed job.
 */

-- No updated_at and no archived_at, for the reason `audit_log` has neither: an
-- entry is never edited and never removed.

REVOKE ALL ON trial_event FROM poolse_app;
ALTER TABLE trial_event ENABLE ROW LEVEL SECURITY;

-- `FOR ALL`, because a policy's WITH CHECK is what governs an insert and a
-- SELECT-only policy leaves the write refused even with the grant in hand. The
-- grant is the narrow half: read and insert, never update or delete.
CREATE POLICY trial_event_operators ON trial_event
  FOR ALL TO poolse_platform USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON trial_event TO poolse_platform;

-- ---------------------------------------------------------------------------
-- What somebody was owed, and whether it was ever sent
-- ---------------------------------------------------------------------------
--
-- **Recorded, not sent** — decided 13 September 2026. There is no email provider
-- wired and phase 0 deferred the choice, so each due notice writes a row saying
-- it was owed, to whom and why; the screens say plainly that nothing has been
-- delivered. Choosing a provider becomes a small slice that writes into this same
-- history, exactly as 2.3's chase list waited for 3.0.
--
-- The shape is `pool_analysis_alert`'s, for the same reason: an email is not
-- idempotent, so the *record* is written by the job and the *sending* is a later,
-- separate act that stamps `delivered_at`.

CREATE TYPE trial_notice_kind AS ENUM (
  'trial_ending_soon',   -- day 10 of 15
  'trial_last_day',      -- day 14
  'trial_ended',         -- day 15: read-only begins
  'access_closing_soon', -- a week before sign-in closes
  'access_closed',       -- sign-in closed
  'deletion_soon'        -- a week before the data goes
);

CREATE TABLE trial_notice (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),

  kind            trial_notice_kind NOT NULL,
  /** The day it fell due, which is what makes one owed twice distinguishable. */
  due_on          date NOT NULL,

  /*
   * The addresses it actually went to, frozen at the moment of sending.
   *
   * **Empty for every row the clock writes today, and that is deliberate.** The
   * job records that a notice was *owed*; nothing is sent, because no email
   * provider is wired. Resolving the owner's address would mean reading
   * `app_user.cached_email` — an owner's address is there and not on their
   * membership row — and `poolse_platform` holds no privilege on `app_user`. That
   * is not an oversight to route around: the platform login is narrow on purpose,
   * so that a mistake in it leaks seven tables rather than every user's name and
   * e-mail in every club.
   *
   * So the slice that chooses a provider resolves recipients **at send time**,
   * which is also when "who was told" becomes a fact worth freezing. Until then
   * empty means nobody has been written to, which is exactly true.
   */
  recipients      text[] NOT NULL DEFAULT '{}',

  /*
   * Null means recorded and nothing left the building. Said in words on the
   * screens rather than implied — the same honesty the chase list owes about what
   * Poolse has and has not delivered.
   */
  delivered_at    timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),

  /*
   * One notice per tenant per kind per due date.
   *
   * The date is in the key on purpose: a club whose trial is extended and runs
   * out again is genuinely owed the same notice a second time, on a different
   * day, and a key without it would swallow the second one silently.
   */
  UNIQUE (organization_id, kind, due_on)
);

COMMENT ON TABLE trial_notice IS
  'A notice the trial clock owed a club, and whether it was ever delivered. '
  'Null delivered_at means recorded and not sent — there is no email provider. '
  'POOLSE-61.';

CREATE TRIGGER trial_notice_updated_at BEFORE UPDATE ON trial_notice
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX trial_notice_org_idx ON trial_notice (organization_id, due_on DESC);

REVOKE ALL ON trial_notice FROM poolse_app;
ALTER TABLE trial_notice ENABLE ROW LEVEL SECURITY;

-- UPDATE is on the grant here and is not on `trial_event`'s, and the difference
-- is the point: a notice is stamped `delivered_at` when it is eventually sent,
-- and a transition is never touched again.
CREATE POLICY trial_notice_operators ON trial_notice
  FOR ALL TO poolse_platform USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON trial_notice TO poolse_platform;

-- ---------------------------------------------------------------------------
-- How long each rung lasts
-- ---------------------------------------------------------------------------
--
-- Beside `trial_period()`, and for the same reason: the ladder's numbers belong
-- in one place rather than in a job, a document and a test that agree until one
-- of them is edited.

CREATE FUNCTION trial_read_only_period() RETURNS interval
LANGUAGE sql
STABLE
AS $$ SELECT interval '30 days' $$;

CREATE FUNCTION trial_closed_period() RETURNS interval
LANGUAGE sql
STABLE
AS $$ SELECT interval '30 days' $$;

COMMENT ON FUNCTION trial_read_only_period() IS
  'How long a read-only tenant keeps its data before sign-in closes — the second '
  'rung of the ladder in docs/features/trial.md.';
COMMENT ON FUNCTION trial_closed_period() IS
  'How long a closed tenant is kept after sign-in closes. Read by the last notice '
  'the clock owes; nothing acts on it, because removing a tenant is the purge '
  'ticket''s decision and not a cron''s.';

-- Down Migration

DROP FUNCTION IF EXISTS trial_closed_period();
DROP FUNCTION IF EXISTS trial_read_only_period();

DROP TABLE IF EXISTS trial_notice;
DROP TYPE IF EXISTS trial_notice_kind;

DROP TABLE IF EXISTS trial_event;
DROP TYPE IF EXISTS trial_transition;
