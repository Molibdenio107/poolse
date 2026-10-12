-- Up Migration
--
-- Vigilance periods — 12 October 2026, Rui: "define periods of vigilance, not
-- select one day 1 by 1".
--
-- A period says who watches which tanks, between two dates, on which weekdays,
-- and in which hours: the site's opening hours of each day, or a window typed
-- once (Rui's three answers: either hours, several tanks, end from a date on).
--
-- **A period writes ordinary duties, one per day per tank, tagged with it.**
-- The week view, `lifeguard_gaps`, `lifeguard_valid_on` and the incident's
-- "who was on duty" all read `lifeguard_duty` and none of them changes. A sick
-- Wednesday is still one duty removed, and the record of who was on duty last
-- Saturday is still a row, not a rule re-evaluated after the period changed.
--
-- The tanks are not stored on the period: they are the tanks its duties are
-- on, so there is one home for that fact.

CREATE TABLE lifeguard_period (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization (id),
  facility_id      uuid NOT NULL,
  membership_id    uuid NOT NULL,
  starts_on        date NOT NULL,
  ends_on          date NOT NULL,
  -- ISO weekdays, 1 = Monday … 7 = Sunday.
  weekdays         smallint[] NOT NULL,
  -- Both null: the site's opening hours of each day. Both set: a fixed window,
  -- a `to_time` before `from_time` running past midnight.
  from_time        time,
  to_time          time,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, membership_id) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES membership (organization_id, id),

  CONSTRAINT lifeguard_period_ordered CHECK (ends_on >= starts_on),
  -- A season and a little: a typo of 2062 for 2026 must not write forty years.
  CONSTRAINT lifeguard_period_length CHECK (ends_on - starts_on <= 400),
  CONSTRAINT lifeguard_period_weekdays CHECK (
    cardinality(weekdays) BETWEEN 1 AND 7
    AND weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
  ),
  CONSTRAINT lifeguard_period_hours CHECK (
    (from_time IS NULL AND to_time IS NULL)
    OR (from_time IS NOT NULL AND to_time IS NOT NULL AND from_time <> to_time)
  )
);

COMMENT ON TABLE lifeguard_period IS
  'A vigilance period: who watches, from when to when, which weekdays, which hours. '
  'Writes one lifeguard_duty per day per tank (period_id); ending it archives the '
  'duties from a date on.';

CREATE INDEX lifeguard_period_facility_idx
  ON lifeguard_period (organization_id, facility_id, ends_on)
  WHERE archived_at IS NULL;

CREATE TRIGGER lifeguard_period_updated_at BEFORE UPDATE ON lifeguard_period
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE lifeguard_period ENABLE ROW LEVEL SECURITY;
CREATE POLICY lifeguard_period_tenant ON lifeguard_period
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE ON lifeguard_period TO poolse_app;
REVOKE DELETE ON lifeguard_period FROM poolse_app;

ALTER TABLE lifeguard_duty
  ADD COLUMN period_id uuid,
  ADD FOREIGN KEY (organization_id, period_id) REFERENCES lifeguard_period (organization_id, id);

COMMENT ON COLUMN lifeguard_duty.period_id IS
  'The vigilance period that wrote this duty; null for a duty added on its own.';

CREATE INDEX lifeguard_duty_period_idx
  ON lifeguard_duty (organization_id, period_id)
  WHERE period_id IS NOT NULL AND archived_at IS NULL;

-- Down Migration

DROP INDEX IF EXISTS lifeguard_duty_period_idx;
ALTER TABLE lifeguard_duty DROP COLUMN IF EXISTS period_id;
DROP TABLE IF EXISTS lifeguard_period;
