-- Up Migration

-- ---------------------------------------------------------------------------
-- POOLSE-225 — a club's Owners are told when the platform suspends or restores it
-- ---------------------------------------------------------------------------
--
-- Platform-scoped, like `trial_notice`: a row is *about* a tenant rather than
-- belonging to one. No grant and no policy for poolse_app, so a club can neither
-- read who was told nor write itself a notice.
--
-- Its own table rather than two more kinds on `trial_notice`: that key is
-- (tenant, kind, due_on), so a club suspended twice in a day would collide; it
-- has nowhere to keep a reason; and an enum value cannot be taken back.

CREATE TYPE suspension_notice_kind AS ENUM ('suspended', 'restored');

CREATE TABLE suspension_notice (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization (id),

  kind              suspension_notice_kind NOT NULL,
  /*
   * The operator's sentence, verbatim, snapshotted: restoring clears
   * `organization.suspension_reason`, and a retry an hour later must still say
   * what the first attempt said. A restore asks for no reason (Rui, 17-11-2026).
   */
  reason            text,
  occurred_at       timestamptz NOT NULL,

  /* Every live Owner's address, frozen when the notice was recorded. */
  recipients        text[] NOT NULL DEFAULT '{}',

  delivered_at      timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0,
  last_attempt_at   timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  CONSTRAINT suspension_notice_reason_ck CHECK ((kind = 'suspended') = (reason IS NOT NULL)),
  CONSTRAINT suspension_notice_reason_len_ck CHECK (reason IS NULL OR length(reason) <= 500)
);

COMMENT ON TABLE suspension_notice IS
  'An operator suspended or restored a club, and its Owners were owed an email. '
  'Null delivered_at means recorded and not sent. POOLSE-225.';

CREATE TRIGGER suspension_notice_updated_at BEFORE UPDATE ON suspension_notice
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX suspension_notice_org_idx ON suspension_notice (organization_id, created_at DESC);

REVOKE ALL ON suspension_notice FROM poolse_app;
ALTER TABLE suspension_notice ENABLE ROW LEVEL SECURITY;

CREATE POLICY suspension_notice_operators ON suspension_notice
  FOR ALL TO poolse_platform USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON suspension_notice TO poolse_platform;

-- Down Migration

DROP TABLE IF EXISTS suspension_notice;
DROP TYPE IF EXISTS suspension_notice_kind;
