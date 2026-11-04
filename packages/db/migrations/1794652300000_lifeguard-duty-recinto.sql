-- Up Migration

-- POOLSE-156 (Rui, 04-11-2026) — a lifeguard duty sits on a recinto.
--
-- Lifeguards are planned per sport: the week asks the sport first and lists that
-- sport's recintos. A pool duty still names its pool, and the trigger every other
-- pool-carrying table uses (`area_from_pool`, POOLSE-122) fills the recinto from
-- it. A duty on a court names only the recinto. Exactly one is the source:
-- `pool_id` for a pool, `playing_area_id` for anything else.
--
-- **Readers of `pool_id` are untouched**: `lifeguard_gaps()` stays a pool
-- question (a court has no required cover), the incident form's "who was on
-- duty" joins by pool, and so does a vigilance period.
--
-- **The same-person overlap is now also refused per recinto.** The pool
-- exclusion stays until its readers move (a follow-up drops it); it ignores a
-- court duty, whose `pool_id` is null and so never equal to anything.

ALTER TABLE lifeguard_duty ADD COLUMN playing_area_id uuid;

-- The backfill must not fire the table's own triggers (updated_at would move on
-- every duty in history). Foreign keys are system triggers and stay on.
ALTER TABLE lifeguard_duty DISABLE TRIGGER USER;
UPDATE lifeguard_duty d SET playing_area_id = p.playing_area_id
  FROM pool p WHERE p.organization_id = d.organization_id AND p.id = d.pool_id;
ALTER TABLE lifeguard_duty ENABLE TRIGGER USER;

ALTER TABLE lifeguard_duty
  ALTER COLUMN pool_id DROP NOT NULL,
  ALTER COLUMN playing_area_id SET NOT NULL,
  ADD CONSTRAINT lifeguard_duty_playing_area_fk
    FOREIGN KEY (organization_id, playing_area_id) REFERENCES playing_area (organization_id, id),
  ADD CONSTRAINT lifeguard_duty_no_double_on_area EXCLUDE USING gist (
    playing_area_id WITH =,
    membership_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (archived_at IS NULL);

COMMENT ON COLUMN lifeguard_duty.playing_area_id IS
  'POOLSE-156: the recinto the duty covers. Filled from pool_id by area_from_pool() for a pool; '
  'named directly for a court or a pitch, whose pool_id is null.';

CREATE INDEX lifeguard_duty_area_idx
  ON lifeguard_duty (organization_id, playing_area_id, starts_at)
  WHERE archived_at IS NULL;

-- Before the NOT NULL is checked on insert: a pool duty arrives with its pool only.
CREATE TRIGGER lifeguard_duty_area_from_pool
  BEFORE INSERT OR UPDATE OF pool_id, playing_area_id ON lifeguard_duty
  FOR EACH ROW EXECUTE FUNCTION area_from_pool();

-- Down Migration

DROP TRIGGER IF EXISTS lifeguard_duty_area_from_pool ON lifeguard_duty;
DROP INDEX IF EXISTS lifeguard_duty_area_idx;
-- A court duty has no pool and cannot survive the old shape.
DELETE FROM lifeguard_duty WHERE pool_id IS NULL;
ALTER TABLE lifeguard_duty
  DROP CONSTRAINT IF EXISTS lifeguard_duty_no_double_on_area,
  DROP CONSTRAINT IF EXISTS lifeguard_duty_playing_area_fk,
  DROP COLUMN IF EXISTS playing_area_id,
  ALTER COLUMN pool_id SET NOT NULL;
