-- Up Migration

-- POOLSE-195 — a lesson's *Desafio* (Rui, 06-11-2026): a short text the instructor
-- sets, read below the plan, and answered in the lesson's feedback.
--
-- **Its own table, keyed as the plan is**, on the turma and the date, because a
-- session is regenerated when a turma moves. Not a column on `lesson_plan`: the plan
-- refuses a blank body and its row is deleted when emptied, and a Desafio may stand
-- with no plan. A turma's only: a partnership has no family reader.
--
-- **The answer is on `lesson_feedback`**, with the words it answered, so removing a
-- Desafio takes nothing from those who answered it. `challenge_done` null is not
-- answered.

CREATE TABLE lesson_challenge (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  class_group_id  uuid NOT NULL,
  on_date         date NOT NULL,
  body            text NOT NULL,
  updated_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, class_group_id) REFERENCES class_group (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, updated_by) REFERENCES membership (organization_id, id),
  CONSTRAINT lesson_challenge_body_shape CHECK (btrim(body) <> '' AND char_length(body) <= 200)
);

COMMENT ON TABLE lesson_challenge IS
  'POOLSE-195: the instructor''s short challenge for one lesson of a turma. Optional.';

CREATE UNIQUE INDEX lesson_challenge_occurrence_uq
  ON lesson_challenge (organization_id, class_group_id, on_date)
  WHERE archived_at IS NULL;

CREATE TRIGGER lesson_challenge_updated_at BEFORE UPDATE ON lesson_challenge
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE lesson_challenge ENABLE ROW LEVEL SECURITY;
CREATE POLICY lesson_challenge_tenant ON lesson_challenge
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE ON lesson_challenge TO poolse_app;

ALTER TABLE lesson_feedback
  ADD COLUMN challenge_done boolean,
  ADD COLUMN challenge_text text,
  ADD CONSTRAINT lesson_feedback_challenge_shape CHECK (
    (challenge_done IS NULL) = (challenge_text IS NULL)
    AND (challenge_text IS NULL OR char_length(challenge_text) <= 200)
  );

COMMENT ON COLUMN lesson_feedback.challenge_done IS
  'POOLSE-195: Consegui or Não consegui. The student''s own word, never a grade. Null: not answered.';

GRANT UPDATE (challenge_done, challenge_text) ON lesson_feedback TO poolse_app;

-- Down Migration

ALTER TABLE lesson_feedback
  DROP CONSTRAINT lesson_feedback_challenge_shape,
  DROP COLUMN challenge_done,
  DROP COLUMN challenge_text;

DROP TABLE lesson_challenge;
