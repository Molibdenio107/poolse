-- Up Migration
--
-- Out-of-range water alerts — slice 4.2.
--
-- Round 4 built the analyses and round 6 built the parser that reads a lab
-- boletim. Both already show a crossed band on the pool's page, in visible text,
-- with the closure link beside it. What has never existed is the other half of
-- the roadmap's "done when": **an out-of-range reading reaches someone**. A club
-- runs one person's laptop; a pH of 8.4 recorded on a Friday afternoon and
-- noticed on Monday is the failure this table exists to record.
--
-- **The breach is derived; the alert is a record.** Whether a reading is outside
-- its band is answered by `excursions()` in `@poolse/rules`, from the values and
-- the published bands, and is never stored as a flag — the same reasoning as
-- `invoice_status` and the overdue-cleaning rule. What *is* stored is the thing
-- that cannot be derived twice: that on this date, these people were told. An
-- email is not idempotent.
--
-- **`metrics` is a snapshot, and that is not a contradiction of the above.**
-- `pool_analysis_value` has no `archived_at` — a measurement is corrected in
-- place — so an alert history that re-derived which readings were bad would
-- silently rewrite itself the first time somebody fixed a typo. A compliance
-- record that changes when the source is edited is not a record. Same argument
-- as every snapshot on an invoice line.
--
-- **No `archived_at`, and no DELETE grant.** History is soft-deleted rather than
-- destroyed everywhere else in this schema, but there is nothing here for an
-- operator to remove: the row says an email went out, and that either happened
-- or it did not. So the privilege is simply absent, as it is on `invoice` and
-- `audit_log`, and for the same reason — a missing grant cannot be forgotten by
-- application code. Teardown runs as the owner, which is what makes the test
-- harness able to clean up without weakening it.
--
-- **Not the missing-reading alert.** POOLSE-26 is a different alert about a
-- different fact — a sample that never happened — with its own intervals, its
-- own two-tier escalation and its own suppression rules. It gets its own table
-- and its own evaluation job. This one is only about a sample that did happen
-- and said something bad.

CREATE TABLE pool_analysis_alert (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),

  -- Denormalised from the analysis on purpose: every read of this table is "what
  -- has this tank raised", and the pool page's query should not have to join the
  -- analysis to answer it. The composite key below is what keeps the two honest.
  pool_id         uuid NOT NULL,
  analysis_id     uuid NOT NULL,

  -- When somebody was told, which is not when the sample was taken. Both matter
  -- and they are routinely hours apart: `pool_analysis.taken_at` is the water,
  -- this is the alert.
  raised_at       timestamptz NOT NULL DEFAULT now(),

  -- Which readings were outside their band, snapshotted. See the header.
  metrics         pool_metric[] NOT NULL,

  -- The addresses written to, as they were at the time.
  --
  -- Resolved by *role* — owner, admin and maintenance — rather than by named
  -- person, so staff turnover cannot silently orphan an alert. But the addresses
  -- are recorded, because "who was told" is not recoverable from the roles six
  -- months later: the person who left is no longer in either list. Empty is a
  -- legitimate state and means nobody in the club has an email address on file.
  recipients      text[] NOT NULL DEFAULT '{}',

  -- Null means the alert was recorded and nothing left the building — no email
  -- provider configured, no address to write to, or the provider refused. The
  -- screens say which rather than implying a family was contacted, exactly as
  -- the chase list does for 2.3.
  delivered_at    timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, pool_id)
    REFERENCES pool (organization_id, id),

  -- CASCADE for the same reason `pool_analysis_value` has it: an alert about an
  -- analysis that no longer exists is not a record of anything. An *archived*
  -- analysis is untouched by this — archiving is an UPDATE, and the alert
  -- survives it, because the email was sent and pretending otherwise would be
  -- rewriting the history this table is for.
  FOREIGN KEY (organization_id, analysis_id)
    REFERENCES pool_analysis (organization_id, id) ON DELETE CASCADE,

  -- An alert with no metric is an alert about nothing, which is the shape a
  -- careless caller would write if `excursions()` ever returned an empty list.
  CHECK (cardinality(metrics) > 0),

  -- Delivered to nobody is not delivered.
  CHECK (delivered_at IS NULL OR cardinality(recipients) > 0)
);

COMMENT ON TABLE pool_analysis_alert IS
  'One out-of-range water alert: which readings failed, who was told, and whether anything was actually sent.';
COMMENT ON COLUMN pool_analysis_alert.metrics IS
  'The metrics outside their band when the alert was raised. A snapshot — a measurement can be corrected in place, and this must not change with it.';
COMMENT ON COLUMN pool_analysis_alert.delivered_at IS
  'When email actually left the building. Null means recorded but not sent, which the screens say plainly.';

-- One alert per analysis.
--
-- Not partial, because this table has no `archived_at` — see the header. The
-- constraint is the one that makes the send path safe to re-enter: a client that
-- retries a submit, or two people pressing Guardar at once, cannot produce two
-- emails about one sample. A *second* analysis of the same tank still alerts,
-- which is right: somebody dosed the pool in between and this is a new reading.
CREATE UNIQUE INDEX pool_analysis_alert_analysis_uq
  ON pool_analysis_alert (organization_id, analysis_id);

-- The pool page's query: this tank's alerts, newest first.
CREATE INDEX pool_analysis_alert_pool_idx
  ON pool_analysis_alert (organization_id, pool_id, raised_at DESC);

CREATE TRIGGER pool_analysis_alert_updated_at BEFORE UPDATE ON pool_analysis_alert
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE pool_analysis_alert ENABLE ROW LEVEL SECURITY;

CREATE POLICY pool_analysis_alert_tenant ON pool_analysis_alert
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- SELECT, INSERT and UPDATE. No DELETE: see the header. The UPDATE is for
-- `delivered_at` and `recipients`, stamped after the send, which happens outside
-- the transaction that wrote the analysis — a mail server being slow must never
-- be able to roll back a recorded reading.
--
-- A REVOKE and not just a narrow GRANT, because `core-tenancy` sets default
-- privileges granting all four on every new table in this schema. The same shape
-- `invoice` uses, and the reason it is written as two statements rather than one.
REVOKE DELETE ON pool_analysis_alert FROM poolse_app;
GRANT SELECT, INSERT, UPDATE ON pool_analysis_alert TO poolse_app;

-- Down Migration

DROP POLICY IF EXISTS pool_analysis_alert_tenant ON pool_analysis_alert;

DROP TABLE IF EXISTS pool_analysis_alert;
