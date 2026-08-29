-- Up Migration
--
-- A student who is injured — round 5.
--
-- A broken wrist keeps a child out of the water for six weeks, and every one of
-- those absences is justified. Today an instructor marks each session by hand and
-- has to remember why; the ones they forget become unjustified absences, which
-- under POOLSE-21 quietly costs the family a reposição credit they were owed.
--
-- **It defaults the register; it does not write attendance ahead of time.** The
-- tempting shape is a job that inserts `excused` rows for every future session in
-- the range. It is the wrong one: sessions are generated a month at a time, so
-- half the range would have nothing to write to, and rows written by nobody, for
-- a class that had not happened, would be a register somebody has to trust
-- without an instructor ever having looked at the pool. Instead a live leave
-- makes `excused` the *offered* mark, flagged and visible, and the instructor
-- saves it like any other register. That is also exactly what the round-5
-- decision asks for — future sessions only, and removing the leave simply stops
-- offering it. Nothing already marked moves, and no credit is ever revoked.
--
-- **Dates, not instants.** "Out from the 3rd to the 14th" is a calendar fact in
-- the club's own timezone, the same as `closure`. An instant would put the
-- boundary an hour out for a 23:30 class in the Azores, which this repo has
-- already been bitten by once.
--
-- **The reason is optional and is not a diagnosis.** Medical detail belongs in
-- `student_sensitive`, behind its own access rules and its own audit trail. This
-- column is for "lesão no ombro" or "cirurgia", the sentence an instructor needs
-- to understand an empty lane. The interface says so, exactly as the attendance
-- note does.

CREATE TABLE student_medical_leave (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  student_id      uuid NOT NULL,

  starts_on       date NOT NULL,
  -- Null means "until further notice", which is the honest state on the day a
  -- child breaks a wrist: nobody knows yet, and forcing a guess would put a
  -- return date in the record that everybody then treats as a fact.
  ends_on         date,

  -- Short, optional, and not medical. See the header.
  reason          text,

  recorded_by     uuid,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, student_id)
    REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by)
    REFERENCES membership (organization_id, id),

  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CHECK (reason IS NULL OR btrim(reason) <> ''),
  CHECK (starts_on > DATE '2000-01-01')
);

COMMENT ON TABLE student_medical_leave IS
  'A period a student is medically unable to swim. Offers "falta justificada" on the register; never writes attendance itself.';
COMMENT ON COLUMN student_medical_leave.ends_on IS
  'Null means open-ended — the honest answer on the day of the injury.';
COMMENT ON COLUMN student_medical_leave.reason IS
  'Short, optional, and not a diagnosis. Medical detail belongs in student_sensitive.';

-- The register's question, asked once per session: "is this student on leave on
-- this date". Partial, because an archived leave answers nothing.
CREATE INDEX student_medical_leave_window_idx
  ON student_medical_leave (organization_id, student_id, starts_on, ends_on)
  WHERE archived_at IS NULL;

/*
 * Overlapping leaves for one student are refused.
 *
 * Two live leaves covering the same week is not extra information, it is a
 * duplicate somebody created by editing the wrong row — and it makes "why is
 * this student excused" have two answers. `daterange` with an exclusion
 * constraint is the only way to say this without a race between two people
 * saving at once.
 *
 * `[)` — half open. A leave ending on the 14th and another starting on the 15th
 * do not overlap, which is what an operator means by "back on the 15th".
 * `'infinity'` stands in for an open-ended leave so the range is still a range.
 */
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE student_medical_leave
  ADD CONSTRAINT student_medical_leave_no_overlap
  EXCLUDE USING gist (
    student_id WITH =,
    daterange(starts_on, coalesce(ends_on + 1, 'infinity'::date), '[)') WITH &&
  ) WHERE (archived_at IS NULL);

CREATE TRIGGER student_medical_leave_updated_at BEFORE UPDATE ON student_medical_leave
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE student_medical_leave ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_medical_leave_tenant ON student_medical_leave
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON student_medical_leave TO poolse_app;

-- Down Migration

DROP POLICY IF EXISTS student_medical_leave_tenant ON student_medical_leave;
DROP TABLE IF EXISTS student_medical_leave;
