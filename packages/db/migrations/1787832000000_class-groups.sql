-- Up Migration
--
-- Slice 1.4 (class groups and their weekly pattern) together with 1.7
-- (enrollment), which is pulled forward from its roadmap position.
--
-- Enrollment moves because it attaches a student to a *turma*, not to a session,
-- so it has no dependency on closures (1.5) or session generation (1.6). Without
-- it, every calendar this unlocks would show classes with nobody in them.
--
-- ---------------------------------------------------------------------------
-- The one that will bite if it is got wrong: `start_time` is wall-clock, not UTC
-- ---------------------------------------------------------------------------
--
-- CLAUDE.md says times are stored UTC and displayed in the facility's timezone,
-- and names class schedules as the place that bites. Here is the distinction it
-- is pointing at.
--
-- A *session* is an instant — "the class that happened at 17:00 UTC on 15
-- December" — and belongs in `timestamptz`. That arrives in 1.6.
--
-- A *schedule* is not an instant. "Tuesdays at 18:00" means six o'clock on the
-- facility's clock, every Tuesday, in July and in January alike. Stored as UTC it
-- would be 17:00 in winter and 17:00 in summer — and Portugal changes its clocks,
-- so the class would silently move by an hour twice a year. So `start_time` is a
-- plain `time`, meaning local wall-clock at the facility, and 1.6 combines it
-- with `facility.timezone` to produce the UTC instants that sessions are made of.
--
-- Weekdays are ISO: Monday is 1, Sunday is 7. That matches `EXTRACT(ISODOW …)`,
-- so the generator in 1.6 needs no translation layer, and it matches how a week
-- is read in Portugal.

CREATE TYPE enrollment_status AS ENUM ('active', 'waiting', 'ended');

-- ---------------------------------------------------------------------------
-- class_group — a turma
-- ---------------------------------------------------------------------------

CREATE TABLE class_group (
  id                        uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organization (id),
  name                      text NOT NULL,

  pool_id                   uuid,
  level_id                  uuid,
  instructor_membership_id  uuid,

  -- Null means no limit. An operator who has not decided how many fit in a lane
  -- should not be blocked from creating the turma, and inventing a default would
  -- enforce a number nobody chose.
  capacity                  integer,
  lane                      smallint,

  -- The season. Both optional: plenty of turmas simply run.
  starts_on                 date,
  ends_on                   date,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  archived_at               timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  -- The composite references again, for the same reason as everywhere else: a
  -- turma cannot be put in another organization's pool, at another
  -- organization's level, taught by another organization's instructor.
  FOREIGN KEY (organization_id, pool_id) REFERENCES pool (organization_id, id),
  FOREIGN KEY (organization_id, level_id) REFERENCES student_level (organization_id, id),
  FOREIGN KEY (organization_id, instructor_membership_id)
    REFERENCES membership (organization_id, id),

  CHECK (btrim(name) <> ''),
  CHECK (capacity IS NULL OR capacity > 0),
  CHECK (lane IS NULL OR lane > 0),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE UNIQUE INDEX class_group_name_uq
  ON class_group (organization_id, lower(strip_accents(name)))
  WHERE archived_at IS NULL;

CREATE INDEX class_group_pool_idx
  ON class_group (organization_id, pool_id) WHERE archived_at IS NULL;
CREATE INDEX class_group_instructor_idx
  ON class_group (organization_id, instructor_membership_id) WHERE archived_at IS NULL;

CREATE TRIGGER class_group_updated_at BEFORE UPDATE ON class_group
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- class_schedule — the recurring weekly pattern
--
-- Several rows per turma: Tuesday and Thursday is two rows, not one row with a
-- list. That keeps "move Thursday to Friday" a single-row update rather than a
-- rewrite of an array, and it is what the generator will iterate in 1.6.
-- ---------------------------------------------------------------------------

CREATE TABLE class_schedule (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization (id),
  class_group_id   uuid NOT NULL,

  -- ISO weekday: Monday 1 … Sunday 7.
  weekday          smallint NOT NULL,
  -- Wall-clock at the facility. See the header.
  start_time       time NOT NULL,
  duration_minutes integer NOT NULL,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,

  FOREIGN KEY (organization_id, class_group_id) REFERENCES class_group (organization_id, id),

  CHECK (weekday BETWEEN 1 AND 7),
  -- Five minutes is not a swimming lesson and neither is eight hours.
  CHECK (duration_minutes BETWEEN 5 AND 480)
);

-- The same turma cannot be scheduled twice at the same moment on the same day.
CREATE UNIQUE INDEX class_schedule_slot_uq
  ON class_schedule (class_group_id, weekday, start_time)
  WHERE archived_at IS NULL;

CREATE INDEX class_schedule_week_idx
  ON class_schedule (organization_id, weekday, start_time)
  WHERE archived_at IS NULL;

CREATE TRIGGER class_schedule_updated_at BEFORE UPDATE ON class_schedule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Two turmas sharing one lane at one time is a real scheduling error, and it is
-- deliberately NOT constrained here. A weekly pattern cannot express "except the
-- 15th, which was cancelled", so the exclusion belongs on `class_session` where
-- the data model puts it — a cancelled session frees its lane, and a pattern has
-- no way to say so.

-- ---------------------------------------------------------------------------
-- enrollment
-- ---------------------------------------------------------------------------

CREATE TABLE enrollment (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization (id),
  class_group_id   uuid NOT NULL,
  student_id       uuid NOT NULL,

  status           enrollment_status NOT NULL DEFAULT 'active',
  -- Only meaningful while waiting. Kept rather than recomputed so the order a
  -- family joined the queue in survives somebody else leaving it.
  waiting_position integer,

  joined_on        date NOT NULL DEFAULT current_date,
  ended_on         date,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, class_group_id) REFERENCES class_group (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),

  CHECK (waiting_position IS NULL OR waiting_position > 0),
  CHECK (status <> 'ended' OR ended_on IS NOT NULL),
  CHECK (ended_on IS NULL OR ended_on >= joined_on)
);

-- One live enrollment per student per turma. Ended ones step out of the way, so
-- a student who left in March and came back in September is two rows and a
-- history rather than a conflict.
CREATE UNIQUE INDEX enrollment_live_uq
  ON enrollment (class_group_id, student_id)
  WHERE status <> 'ended';

CREATE INDEX enrollment_student_idx
  ON enrollment (organization_id, student_id) WHERE status = 'active';
CREATE INDEX enrollment_group_idx
  ON enrollment (organization_id, class_group_id, status);

CREATE TRIGGER enrollment_updated_at BEFORE UPDATE ON enrollment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Capacity, enforced where it cannot be raced
--
-- The API checks capacity too, so an operator gets "this turma is full" rather
-- than a constraint violation. This is the guarantee behind that courtesy: two
-- people enrolling the last place at the same moment would both pass an
-- application check and both be written.
--
-- The lock is the important line. Without `FOR UPDATE` on the turma, two
-- concurrent transactions each count the same nine enrollments, each decide
-- there is room for a tenth, and the trigger becomes decoration.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enrollment_respects_capacity() RETURNS trigger AS $$
DECLARE
  v_capacity integer;
  v_taken    integer;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  -- A student who is already in this turma is not asking for another place, so
  -- capacity has nothing to say about them. Without this the trigger fires first
  -- and a duplicate enrollment into a full turma is reported as "this class is
  -- full" — true, and not the reason the row was refused. Stepping aside lets
  -- `enrollment_live_uq` give the answer that helps: they are already enrolled.
  IF EXISTS (
    SELECT 1 FROM enrollment
     WHERE class_group_id = NEW.class_group_id
       AND organization_id = NEW.organization_id
       AND student_id = NEW.student_id
       AND status <> 'ended'
       AND id <> NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  -- Scoped by organization, like every other query in this schema. Without it
  -- the trigger reaches across tenants: an enrollment naming another club's
  -- turma would be counted against that club's capacity and refused as "full",
  -- which is both wrong and a small leak — the caller learns the turma exists
  -- and is full. Scoped, no row matches, and the composite foreign key gives the
  -- honest answer instead.
  SELECT capacity INTO v_capacity
    FROM class_group
   WHERE id = NEW.class_group_id
     AND organization_id = NEW.organization_id
     FOR UPDATE;

  -- Either no capacity was recorded, or the turma is not this organization's. In
  -- both cases this trigger has nothing to say, and something else — the foreign
  -- key, in the second case — will.
  IF v_capacity IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_taken
    FROM enrollment
   WHERE class_group_id = NEW.class_group_id
     AND organization_id = NEW.organization_id
     AND status = 'active'
     AND id <> NEW.id;

  IF v_taken >= v_capacity THEN
    RAISE EXCEPTION 'This class group is full (% of %)', v_taken, v_capacity
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enrollment_capacity
  BEFORE INSERT OR UPDATE ON enrollment
  FOR EACH ROW EXECUTE FUNCTION enrollment_respects_capacity();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE class_group    ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment     ENABLE ROW LEVEL SECURITY;

CREATE POLICY class_group_tenant ON class_group
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY class_schedule_tenant ON class_schedule
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY enrollment_tenant ON enrollment
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Down Migration

DROP TRIGGER IF EXISTS enrollment_capacity ON enrollment;
DROP FUNCTION IF EXISTS enrollment_respects_capacity();

DROP POLICY IF EXISTS enrollment_tenant ON enrollment;
DROP POLICY IF EXISTS class_schedule_tenant ON class_schedule;
DROP POLICY IF EXISTS class_group_tenant ON class_group;

DROP TABLE IF EXISTS enrollment;
DROP TABLE IF EXISTS class_schedule;
DROP TABLE IF EXISTS class_group;
DROP TYPE IF EXISTS enrollment_status;
