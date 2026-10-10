-- Up Migration
--
-- POOLSE-66 slice 3 — the instructor band's one index.
--
-- Three of the band's four widgets ask the same question: "which sessions does
-- this person teach, from about now?" The person is `resolved_instructor_id` —
-- the generated `coalesce(substitute, instructor)` POOLSE-51 added for the
-- one-person-one-building exclusion — so a stand-in sees the class they are
-- covering and the regular instructor does not, by the one definition that
-- cannot drift from the columns behind it.
--
-- Nothing indexed it as a range: the exclusion constraint's gist index carries
-- the column but answers overlap, not "the next one after now, in order". This
-- is that btree. Not partial on status, because the week strip shows a
-- cancelled class too — it is part of the week and saying so is the point.

CREATE INDEX class_session_instructor_when_idx
  ON class_session (organization_id, resolved_instructor_id, starts_at)
  WHERE resolved_instructor_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS class_session_instructor_when_idx;
