-- Up Migration

/*
 * A family records its own progress (Rui, 06-11-2026).
 *
 * **A time a family typed is marked, and is never official.** `self_reported` sits
 * on `student_record` because it is the same fact as any other time: a stroke, a
 * distance, a day. It may be a personal best, shown as such. It can never name a
 * meet, by CHECK, and `qualifying_attempts()` already reads official meets only, so
 * it cannot reach mínimos or an official best.
 *
 * **`student_measure` holds weight, height and distance swum.** A reading in
 * `numeric` with its unit, one row per measurement. Weight and height are health
 * data about, usually, a child: the office reads them, not the instructor, and they
 * go when the student's health data goes, by the trigger below rather than a line
 * in `apply_retention()` (the FPN licence's pattern). The row is deleted, which the
 * app login may not do: it holds SELECT, INSERT and `UPDATE (archived_at)`.
 */

ALTER TABLE student_record
  ADD COLUMN self_reported boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT student_record_self_reported_has_no_meet
    CHECK (NOT self_reported OR meet_id IS NULL);

COMMENT ON COLUMN student_record.self_reported IS
  'Typed by the family in the app. May be a personal best; never official, never a qualifying time.';

CREATE TYPE student_measure_kind AS ENUM ('weight', 'height', 'distance_swum');

CREATE TABLE student_measure (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organization (id),
  student_id                uuid NOT NULL,
  kind                      student_measure_kind NOT NULL,
  value                     numeric(10,3) NOT NULL,
  unit                      text NOT NULL,
  measured_on               date NOT NULL,
  entered_by_membership_id  uuid NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  archived_at               timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, entered_by_membership_id) REFERENCES membership (organization_id, id),
  CONSTRAINT student_measure_value CHECK (value > 0),
  CONSTRAINT student_measure_unit CHECK (
    (kind = 'weight' AND unit = 'kg' AND value <= 400)
    OR (kind = 'height' AND unit = 'cm' AND value <= 260)
    OR (kind = 'distance_swum' AND unit = 'm' AND value <= 1000000)
  )
);

CREATE INDEX student_measure_student_idx
  ON student_measure (organization_id, student_id, measured_on DESC)
  WHERE archived_at IS NULL;

CREATE TRIGGER student_measure_updated_at BEFORE UPDATE ON student_measure
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE student_measure ENABLE ROW LEVEL SECURITY;
CREATE POLICY student_measure_tenant ON student_measure
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- The default privileges hand the app a table-wide UPDATE and DELETE; a column
-- grant does not narrow them, so they are revoked first.
REVOKE UPDATE, DELETE ON student_measure FROM poolse_app;
GRANT SELECT, INSERT ON student_measure TO poolse_app;
GRANT UPDATE (archived_at) ON student_measure TO poolse_app;

COMMENT ON TABLE student_measure IS
  'Weight, height and distance a family recorded. Health data: office and family read it, and it is deleted with the student''s health data.';

CREATE FUNCTION student_measure_erase() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM student_measure
   WHERE organization_id = NEW.organization_id AND student_id = NEW.id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER student_health_erased_measures
  AFTER UPDATE OF health_erased_at ON student
  FOR EACH ROW
  WHEN (OLD.health_erased_at IS NULL AND NEW.health_erased_at IS NOT NULL)
  EXECUTE FUNCTION student_measure_erase();

-- Down Migration

DROP TRIGGER IF EXISTS student_health_erased_measures ON student;
DROP FUNCTION IF EXISTS student_measure_erase();
DROP TABLE IF EXISTS student_measure;
DROP TYPE IF EXISTS student_measure_kind;
ALTER TABLE student_record
  DROP CONSTRAINT IF EXISTS student_record_self_reported_has_no_meet,
  DROP COLUMN IF EXISTS self_reported;
