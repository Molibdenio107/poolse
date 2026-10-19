-- Up Migration
--
-- POOLSE-81, slice 1 — the competition pathway's foundations.
--
-- **A time states its pool length.** `student_record.course` is `scm` (25 m) or
-- `lcm` (50 m); every existing row stays null, which the screens say as "piscina
-- não indicada", and nothing ever guesses it. Times from the two pools are never
-- converted, so a personal best is per stroke, distance *and* course — the B6
-- index gains the column.
--
-- **A meet is a record and its results are times.** `swim_meet` is the meet; a
-- result is an ordinary `student_record` that names it, so it reaches the
-- history, the bests, the chart and the family's Progress tab with nothing new.
-- `official` is the meet's: a result counts as an official best when its meet
-- is official. A meet comes from a results file (slice 2) or is named by hand on
-- the time form (Rui, 19-10-2026: a coach may mark a typed time official by
-- naming a meet), so the import columns are nullable.
--
-- **The re-import key** is meet, student, LENEX event number and round — a heat
-- and a final are two real results — held by a partial unique index.
--
-- **The pathway is the existing ladder.** `student_level.competitive` marks the
-- levels whose swimmers compete; POOLSE-19's advancement already proposes the
-- next level, so no second mechanism. The FPN's age groups ("escalões") are a
-- different thing and are never `student_level` rows.
--
-- **`student.federation_licence`** is the FPN licence: optional, text (its
-- format is the FPN's), unique per club among live students. It is identity, so
-- retention clears it — by a trigger on `anonymised_at` rather than a copy of
-- the whole `apply_retention()`, the same choice the lead scrub made.

CREATE TYPE swim_course AS ENUM ('scm', 'lcm');

-- ---------------------------------------------------------------------------
-- swim_meet
-- ---------------------------------------------------------------------------

CREATE TABLE swim_meet (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            uuid NOT NULL REFERENCES organization (id),
  name                       text NOT NULL,
  city                       text,
  -- The meet's own course. A session in a results file may override it, so a
  -- result's course is on the result, never read from here.
  course                     swim_course,
  starts_on                  date NOT NULL,
  ends_on                    date NOT NULL,
  official                   boolean NOT NULL DEFAULT false,
  -- Set when it came from a results file (slice 2); null for one named by hand.
  source_file_name           text,
  imported_by_membership_id  uuid,
  imported_at                timestamptz,
  created_by_membership_id   uuid,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  archived_at                timestamptz,

  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, imported_by_membership_id) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, created_by_membership_id) REFERENCES membership (organization_id, id),
  CONSTRAINT swim_meet_name_present CHECK (btrim(name) <> '' AND length(name) <= 200),
  CONSTRAINT swim_meet_city_bounded CHECK (city IS NULL OR length(city) <= 120),
  CONSTRAINT swim_meet_days CHECK (ends_on >= starts_on),
  CONSTRAINT swim_meet_imported_together
    CHECK ((source_file_name IS NULL) = (imported_at IS NULL))
);

COMMENT ON TABLE swim_meet IS
  'POOLSE-81: a swimming meet. Its results are student_record rows naming it. '
  'official decides whether they count as official bests.';

-- A meet is identified by its name and first day — what makes a second import
-- of the same file find the first.
CREATE UNIQUE INDEX swim_meet_identity_uq
  ON swim_meet (organization_id, lower(btrim(name)), starts_on)
  WHERE archived_at IS NULL;

CREATE INDEX swim_meet_recent_idx
  ON swim_meet (organization_id, starts_on DESC) WHERE archived_at IS NULL;

CREATE TRIGGER swim_meet_updated_at BEFORE UPDATE ON swim_meet
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE swim_meet ENABLE ROW LEVEL SECURITY;
CREATE POLICY swim_meet_tenant ON swim_meet
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE ON swim_meet TO poolse_app;

-- ---------------------------------------------------------------------------
-- student_record: course, meet, and the re-import key
-- ---------------------------------------------------------------------------

ALTER TABLE student_record
  ADD COLUMN course swim_course,
  ADD COLUMN meet_id uuid,
  ADD COLUMN lenex_event_number integer,
  ADD COLUMN lenex_round text,
  ADD CONSTRAINT student_record_meet_fkey
    FOREIGN KEY (organization_id, meet_id) REFERENCES swim_meet (organization_id, id),
  -- The LENEX key only on a result that names a meet.
  ADD CONSTRAINT student_record_lenex_on_meet
    CHECK (meet_id IS NOT NULL OR (lenex_event_number IS NULL AND lenex_round IS NULL)),
  ADD CONSTRAINT student_record_lenex_round_bounded
    CHECK (lenex_round IS NULL OR length(lenex_round) <= 20);

COMMENT ON COLUMN student_record.course IS
  'POOLSE-81: scm (25 m) or lcm (50 m). Null is "piscina não indicada" and is never counted '
  'as either; bests are per stroke, distance and course.';
COMMENT ON COLUMN student_record.meet_id IS
  'POOLSE-81: the meet this time was swum at. Official when the meet is.';

CREATE UNIQUE INDEX student_record_lenex_uq
  ON student_record (organization_id, meet_id, student_id, lenex_event_number, lenex_round)
  WHERE meet_id IS NOT NULL AND lenex_event_number IS NOT NULL AND archived_at IS NULL;

CREATE INDEX student_record_meet_idx
  ON student_record (organization_id, meet_id) WHERE meet_id IS NOT NULL AND archived_at IS NULL;

DROP INDEX student_record_best_idx;
CREATE INDEX student_record_best_idx
  ON student_record (organization_id, student_id, stroke, distance_m, course, time_ms)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- The pathway and the licence
-- ---------------------------------------------------------------------------

ALTER TABLE student_level ADD COLUMN competitive boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN student_level.competitive IS
  'POOLSE-81: the level''s swimmers compete (pré-competição, competição). Drives the '
  'missing-licence warning and the Provas team filter. Never an FPN age group.';

ALTER TABLE student
  ADD COLUMN federation_licence text,
  ADD CONSTRAINT student_federation_licence_shape
    CHECK (federation_licence IS NULL
           OR (btrim(federation_licence) <> '' AND length(federation_licence) <= 40));
COMMENT ON COLUMN student.federation_licence IS
  'POOLSE-81: the FPN licence number. Optional, the FPN''s format (not validated here), '
  'unique per club among live students. Identity: cleared when the student is anonymised.';

CREATE UNIQUE INDEX student_federation_licence_uq
  ON student (organization_id, federation_licence)
  WHERE archived_at IS NULL AND federation_licence IS NOT NULL;

ALTER TABLE organization ADD COLUMN federation_club_code text;
COMMENT ON COLUMN organization.federation_club_code IS
  'POOLSE-81: this club''s code in LENEX results files, remembered from the last import.';

-- Retention: an anonymised student's licence goes with the rest of their identity.
CREATE FUNCTION student_anonymised_clears_licence() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.federation_licence := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER student_anonymised_clears_licence
  BEFORE UPDATE OF anonymised_at ON student
  FOR EACH ROW
  WHEN (OLD.anonymised_at IS NULL AND NEW.anonymised_at IS NOT NULL)
  EXECUTE FUNCTION student_anonymised_clears_licence();

-- Down Migration

DROP TRIGGER IF EXISTS student_anonymised_clears_licence ON student;
DROP FUNCTION IF EXISTS student_anonymised_clears_licence();
ALTER TABLE organization DROP COLUMN IF EXISTS federation_club_code;
DROP INDEX IF EXISTS student_federation_licence_uq;
ALTER TABLE student DROP CONSTRAINT IF EXISTS student_federation_licence_shape,
  DROP COLUMN IF EXISTS federation_licence;
ALTER TABLE student_level DROP COLUMN IF EXISTS competitive;

DROP INDEX IF EXISTS student_record_best_idx;
CREATE INDEX student_record_best_idx
  ON student_record (organization_id, student_id, stroke, distance_m, time_ms)
  WHERE archived_at IS NULL;
DROP INDEX IF EXISTS student_record_meet_idx;
DROP INDEX IF EXISTS student_record_lenex_uq;
ALTER TABLE student_record
  DROP CONSTRAINT IF EXISTS student_record_lenex_round_bounded,
  DROP CONSTRAINT IF EXISTS student_record_lenex_on_meet,
  DROP CONSTRAINT IF EXISTS student_record_meet_fkey,
  DROP COLUMN IF EXISTS lenex_round,
  DROP COLUMN IF EXISTS lenex_event_number,
  DROP COLUMN IF EXISTS meet_id,
  DROP COLUMN IF EXISTS course;

DROP TABLE IF EXISTS swim_meet;
DROP TYPE IF EXISTS swim_course;
