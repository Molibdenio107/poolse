-- Up Migration
--
-- Backlog story 6: a student's performances over time.
--
-- Two decisions worth spelling out, because both are the kind that are painful
-- to reverse once a season of data exists.
--
-- **Times are integer milliseconds.** Never floats, for the same reason money is
-- never a float: 27.35 seconds is not representable in binary floating point,
-- and a personal best that is 0.0000001 s slower than the identical swim is a
-- bug nobody will ever find. Milliseconds also match how timing equipment and
-- every federation record actually express a result.
--
-- **Stroke is an enum, not a lookup table.** The data model draws that line at
-- "could an operator add to it" — a club invents its own *levels* (Adaptação,
-- Iniciação) but it does not invent a sixth stroke. The set is fixed by the sport
-- and has been for decades.
--
-- The two dates are deliberately separate. `swum_on` is when the swim happened,
-- a plain calendar date with no timezone, because "the trial on 12 September" is
-- a date and not an instant. `recorded_at` is when somebody typed it in. They are
-- often different — a coach entering a week of times on a Friday evening — and
-- collapsing them loses the one an instructor actually cares about.

CREATE TYPE swim_stroke AS ENUM (
  'freestyle',
  'backstroke',
  'breaststroke',
  'butterfly',
  'medley'
);

CREATE TABLE student_record (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organization (id),
  student_id                uuid NOT NULL,

  stroke                    swim_stroke NOT NULL,
  -- Whole metres. Pool distances are 25, 50, 100, 200 and so on; nothing here is
  -- ever fractional.
  distance_m                integer NOT NULL,
  time_ms                   integer NOT NULL,

  swum_on                   date NOT NULL,
  recorded_at               timestamptz NOT NULL DEFAULT now(),
  recorded_by_membership_id uuid,
  note                      text,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  archived_at               timestamptz,

  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by_membership_id)
    REFERENCES membership (organization_id, id),

  CHECK (distance_m > 0 AND distance_m <= 10000),
  -- A tenth of a second is faster than any human has ever swum anything, and
  -- twenty-four hours is not a swim. Both ends are typos.
  CHECK (time_ms > 100 AND time_ms < 86400000),
  CHECK (swum_on > DATE '1900-01-01')
);

-- Deliberately no unique constraint. The same student may swim the same stroke
-- over the same distance twice in one day — that is a heat and a final, and both
-- are real results.

-- The personal-best query: newest first within a student, and grouped the way it
-- is read.
CREATE INDEX student_record_best_idx
  ON student_record (organization_id, student_id, stroke, distance_m, time_ms)
  WHERE archived_at IS NULL;

-- The progression chart: one student's history in date order.
CREATE INDEX student_record_history_idx
  ON student_record (organization_id, student_id, swum_on DESC)
  WHERE archived_at IS NULL;

CREATE TRIGGER student_record_updated_at BEFORE UPDATE ON student_record
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE student_record ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_record_tenant ON student_record
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- ---------------------------------------------------------------------------
-- favourite_stroke
--
-- Set by a person, never calculated, and that contrast is the point of the
-- story. A swimmer's favourite stroke is a fact about them that no amount of
-- timing data contains — plenty of people love the butterfly they are slowest at.
-- ---------------------------------------------------------------------------

ALTER TABLE student ADD COLUMN favourite_stroke swim_stroke;

COMMENT ON COLUMN student.favourite_stroke IS
  'Declared by the student or instructor. Never derived from student_record.';

-- Down Migration

ALTER TABLE student DROP COLUMN IF EXISTS favourite_stroke;

DROP POLICY IF EXISTS student_record_tenant ON student_record;
DROP TABLE IF EXISTS student_record;
DROP TYPE IF EXISTS swim_stroke;
