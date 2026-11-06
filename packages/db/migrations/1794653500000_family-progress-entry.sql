-- Up Migration

/*
 * A family records its own swim times (Rui, 06-11-2026).
 *
 * **A time a family typed is marked, and is never official.** `self_reported` sits
 * on `student_record` because it is the same fact as any other time: a stroke, a
 * distance, a day. It may be a personal best, shown as such. It can never name a
 * meet, by CHECK, and `qualifying_attempts()` already reads official meets only, so
 * it cannot reach mínimos or an official best.
 */

ALTER TABLE student_record
  ADD COLUMN self_reported boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT student_record_self_reported_has_no_meet
    CHECK (NOT self_reported OR meet_id IS NULL),
  ADD COLUMN class_session_id uuid,
  ADD CONSTRAINT student_record_class_session
    FOREIGN KEY (organization_id, class_session_id) REFERENCES class_session (organization_id, id);

COMMENT ON COLUMN student_record.class_session_id IS
  'The lesson a time was swum in, when the family says so. Informative.';

COMMENT ON COLUMN student_record.self_reported IS
  'Typed by the family in the app. May be a personal best; never official, never a qualifying time.';

-- Down Migration

ALTER TABLE student_record
  DROP CONSTRAINT IF EXISTS student_record_class_session,
  DROP COLUMN IF EXISTS class_session_id,
  DROP CONSTRAINT IF EXISTS student_record_self_reported_has_no_meet,
  DROP COLUMN IF EXISTS self_reported;
