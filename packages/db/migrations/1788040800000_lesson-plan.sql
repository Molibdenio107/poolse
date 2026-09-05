-- Up Migration
--
-- The plan for one lesson — round 6, ticket 4.3.
--
-- What an instructor writes before Tuesday: the drills, the distances, which
-- skill the group is working on. Poolse had nowhere for it, so it lived in a
-- notebook or a WhatsApp message and the club had no record that a level was
-- actually being taught.
--
-- **Keyed on the turma and the date, not on the session row.** A lesson
-- occurrence is `(class_group_id, on_date)` and that is the natural key here,
-- for two reasons. Sessions are regenerated: `generateSeason` rebuilds the clean
-- future when a turma moves, and a plan hanging off a row that gets rebuilt is
-- a plan that disappears when somebody changes the pool. And a plan is a
-- teacher's preparation for a date, which outlives whatever the timetable did
-- with that date afterwards — a class moved from Tuesday to Wednesday keeps its
-- Tuesday plan on Tuesday, which is where it was written.
--
-- **One row per occurrence, replaced in place.** No history: this is a working
-- note somebody edits until the lesson happens, not a record anybody audits.
-- `updated_by` and `updated_at` say who last touched it, which is the whole of
-- what a colleague needs to know.
--
-- **A cancelled lesson keeps its plan and hides it with the class.** Nothing
-- here knows about cancellation; the API reads the session's status, so a class
-- that comes back through Undo comes back with its plan intact.

CREATE TABLE lesson_plan (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  class_group_id  uuid NOT NULL,

  -- The lesson's own day, in the facility's calendar. A `date` rather than a
  -- `timestamptz`, because "the plan for Tuesday" does not move when a class is
  -- rescheduled from 18:00 to 19:00 — `class_session.occurs_on` is the same
  -- shape for the same reason.
  on_date         date NOT NULL,

  -- Plain text, per the ticket. Rich text is a decision with a schema and an
  -- editor behind it, and nobody has asked for one yet.
  body            text NOT NULL,

  -- Who last wrote it. Not null: every write goes through a membership, and a
  -- plan whose author is unknown is a plan a colleague cannot ask about.
  updated_by      uuid NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, class_group_id)
    REFERENCES class_group (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, updated_by) REFERENCES membership (organization_id, id),

  -- An empty plan is a deleted plan, and the API removes the row rather than
  -- storing a blank. This stops one arriving another way.
  CHECK (btrim(body) <> '')
);

COMMENT ON TABLE lesson_plan IS
  'What an instructor plans to teach in one lesson, keyed on the turma and the date.';

-- Partial, because the table is soft-deletable: a plan cleared in March must not
-- block a new one for the same Tuesday next season.
CREATE UNIQUE INDEX lesson_plan_occurrence_uq
  ON lesson_plan (organization_id, class_group_id, on_date)
  WHERE archived_at IS NULL;

-- "Copy from the previous lesson" walks backwards from a date within one turma,
-- which is exactly this index read in reverse.
CREATE INDEX lesson_plan_previous_idx
  ON lesson_plan (organization_id, class_group_id, on_date DESC)
  WHERE archived_at IS NULL;

CREATE TRIGGER lesson_plan_updated_at BEFORE UPDATE ON lesson_plan
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE lesson_plan ENABLE ROW LEVEL SECURITY;

CREATE POLICY lesson_plan_tenant ON lesson_plan
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON lesson_plan TO poolse_app;

-- Down Migration

DROP POLICY IF EXISTS lesson_plan_tenant ON lesson_plan;
DROP TABLE IF EXISTS lesson_plan;
