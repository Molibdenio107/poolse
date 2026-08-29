-- Up Migration
--
-- When a site is open — round 4.
--
-- The ask was small and specific: "let me disable Sunday as a day classes can be
-- scheduled on". What it actually names is the thing Poolse did not have — a
-- place where a site's standing operating rules live, so that the rest of the
-- app can be right by default instead of by the operator remembering. Turmas,
-- reposições and, later, maintenance windows all want the same answer to "is the
-- pool open then", and asking it seven different ways is how they end up
-- disagreeing.
--
-- **Per facility, not per organization and not per pool.** A club with a
-- municipal pool and a hotel pool keeps two sets of doors and two sets of hours;
-- the two pools inside one building do not. Per pool would mean configuring the
-- same seven rows twice for the same building, which is the kind of duplication
-- that drifts. If a pool ever genuinely needs to differ, this table gains a
-- nullable `pool_id` and the lookup falls back to the facility row — cheaper to
-- add later than to collapse a per-pool table into a per-facility one.
--
-- **Seven rows, not a bitmask or an array.** "Tuesday opens at 07:00" is then an
-- ordinary UPDATE of one row rather than a rewrite of a packed value, the CHECK
-- constraints are per day where the rules are, and the table reads in psql. It
-- is the same reasoning `class_schedule` already used for a turma's weekly
-- pattern, and consistency between the two is worth more here than seven bytes.
--
-- **ISO weekday, Monday 1 … Sunday 7**, matching `class_schedule.weekday` and
-- `extract(ISODOW …)`. Two weekday conventions in one schema is a bug that
-- appears once a week.
--
-- **The default is "open, all day".** Not 08:00–22:00: a default that is a real
-- restriction silently invalidates data that already exists — this repo has a
-- 23:30 lane-hire class in the Azores in its own test suite — and an operator
-- cannot tell a default from a decision somebody made. 00:00–24:00 means "nobody
-- has narrowed this yet", which is true, and the hours only start refusing
-- anything once a person sets them.

CREATE TABLE facility_hours (
  organization_id uuid    NOT NULL REFERENCES organization (id),
  facility_id     uuid    NOT NULL,

  -- ISO weekday: Monday 1 … Sunday 7. Same convention as class_schedule.
  weekday         smallint NOT NULL,

  -- Whether classes may be scheduled on this day at this site.
  available       boolean NOT NULL DEFAULT true,

  -- Wall-clock at the facility, like every other time in this schema. `24:00` is
  -- a real `time` in Postgres and is how "to the end of the day" is written.
  opens_at        time    NOT NULL DEFAULT TIME '00:00',
  closes_at       time    NOT NULL DEFAULT TIME '24:00',

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- One row per day per site, and the tenant key is part of the identity rather
  -- than a column beside it.
  PRIMARY KEY (organization_id, facility_id, weekday),

  -- The composite reference, as everywhere: a day's hours cannot be attached to
  -- another organization's site. ON DELETE CASCADE because these rows describe
  -- the facility and mean nothing without it — and a facility is archived rather
  -- than deleted in ordinary use, so this fires only when one is genuinely gone.
  FOREIGN KEY (organization_id, facility_id)
    REFERENCES facility (organization_id, id) ON DELETE CASCADE,

  CHECK (weekday BETWEEN 1 AND 7),
  CHECK (closes_at > opens_at)
);

COMMENT ON TABLE facility_hours IS
  'A site''s standing weekly opening rules. One row per ISO weekday, always seven.';
COMMENT ON COLUMN facility_hours.available IS
  'False disables new class scheduling on this day. Existing classes are untouched — see class_schedule_within_facility_hours().';
COMMENT ON COLUMN facility_hours.closes_at IS
  'Exclusive. A class must start before it; a class may still run past it (lane hire after the last lesson).';

CREATE TRIGGER facility_hours_updated_at BEFORE UPDATE ON facility_hours
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Every facility has seven rows, always
--
-- The alternative — create rows lazily on first edit, and treat "no row" as
-- "open" — puts the same defaulting rule in the API, in the UI and in the
-- scheduling check, and the day one of the three forgets it is the day a
-- disabled Sunday quietly accepts a class. Seven rows per site is nothing, and
-- it makes every reader of this table a plain SELECT.
-- ---------------------------------------------------------------------------

CREATE FUNCTION seed_facility_hours() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO facility_hours (organization_id, facility_id, weekday)
  SELECT NEW.organization_id, NEW.id, d
    FROM generate_series(1, 7) AS d
  -- A facility restored from a backup may already have its days.
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER facility_seed_hours AFTER INSERT ON facility
  FOR EACH ROW EXECUTE FUNCTION seed_facility_hours();

-- Backfill. Archived facilities included: archiving is reversible here, and a
-- restored site with no hours would be a site that cannot be scheduled at all.
INSERT INTO facility_hours (organization_id, facility_id, weekday)
SELECT f.organization_id, f.id, d
  FROM facility f
  CROSS JOIN generate_series(1, 7) AS d
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- The rule this table exists to enforce
--
-- **Disabling a day blocks new classes and leaves existing ones alone** — the
-- decision taken in round 4. A trigger on `class_schedule` gives exactly that
-- shape for free: it fires when somebody schedules or moves a class, and never
-- when somebody edits the site's hours. So an operator who closes Sunday is told
-- how many Sunday classes already exist and can move them deliberately, rather
-- than having the change refused or having sessions vanish underneath them.
--
-- This is deliberately *not* enforced in `generate_sessions()`. That function
-- materialises the pattern that already exists; making it skip a newly-disabled
-- day would delete the very sessions this decision says to keep.
--
-- Hours check the *start* only. A lesson that runs past closing is ordinary —
-- the last one of the night ends when it ends — and the repo's own tests carry a
-- 23:30 class whose end crosses midnight, which a weekly pattern has no way to
-- express against a closing time anyway.
-- ---------------------------------------------------------------------------

CREATE FUNCTION class_schedule_within_facility_hours() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_available boolean;
  v_opens_at  time;
  v_closes_at time;
  v_site      text;
BEGIN
  SELECT h.available, h.opens_at, h.closes_at, f.name
    INTO v_available, v_opens_at, v_closes_at, v_site
    FROM class_group g
    JOIN pool p
      ON p.id = g.pool_id
     AND p.organization_id = g.organization_id
    JOIN facility f
      ON f.id = p.facility_id
     AND f.organization_id = p.organization_id
    JOIN facility_hours h
      ON h.facility_id = f.id
     AND h.organization_id = f.organization_id
     AND h.weekday = NEW.weekday
   WHERE g.id = NEW.class_group_id
     AND g.organization_id = NEW.organization_id;

  -- A turma with no pool yet has no site, so there is nothing to check against.
  -- `pool_id` is nullable on purpose: a turma can be sketched before the lane is
  -- decided, and refusing to schedule it would make this table decide that.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NOT v_available THEN
    RAISE EXCEPTION
      'facility_closed_on_weekday: % does not open on ISO weekday %', v_site, NEW.weekday
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.start_time < v_opens_at OR NEW.start_time >= v_closes_at THEN
    RAISE EXCEPTION
      'outside_facility_hours: % opens % to % on ISO weekday %, class starts %',
      v_site, v_opens_at, v_closes_at, NEW.weekday, NEW.start_time
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Archiving a schedule row must not be refused because the day has since been
-- closed — that is the "leave existing alone" half of the decision, and an
-- UPDATE that only sets `archived_at` is how a class is taken off a closed day.
CREATE TRIGGER class_schedule_hours
  BEFORE INSERT OR UPDATE OF weekday, start_time, class_group_id ON class_schedule
  FOR EACH ROW
  WHEN (NEW.archived_at IS NULL)
  EXECUTE FUNCTION class_schedule_within_facility_hours();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE facility_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY facility_hours_tenant ON facility_hours
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Down Migration

DROP TRIGGER IF EXISTS class_schedule_hours ON class_schedule;
DROP FUNCTION IF EXISTS class_schedule_within_facility_hours();

DROP TRIGGER IF EXISTS facility_seed_hours ON facility;
DROP FUNCTION IF EXISTS seed_facility_hours();

DROP POLICY IF EXISTS facility_hours_tenant ON facility_hours;
DROP TABLE IF EXISTS facility_hours;
