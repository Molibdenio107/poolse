-- Skills, in four states — POOLSE-20.
--
-- A level says what a student is working towards; until now it said nothing
-- about what that consists of. This is the list, and where each student stands
-- against it.
--
-- **Four states, not a checkbox.** Assessment poolside is not binary: an
-- instructor introduces a skill, watches it a few times, tests it, and only then
-- signs it off. A boolean collapses those into "done or not", which loses the
-- two states an instructor actually spends the term in and makes the register
-- lie about how far a child has got.
--
-- **Absence means Não iniciado.** A club with 6 levels × 10 skills × 300
-- students is 18 000 rows to say "nothing has happened yet". A row appears the
-- first time somebody marks the skill, and the grid reads a missing row as the
-- first state. The enum still names all four, because an instructor putting
-- somebody *back* to Não iniciado is a real correction and it should be a value
-- rather than a delete that loses who did it.
--
-- **Skills belong to a level, and levels are the class levels.** Criterion 8 is
-- explicit and it is the whole reason POOLSE-19 can work: one set of objects, so
-- "finished this level" and "ready for the next turma" are the same question.
-- Two parallel systems would need mapping by hand, which is what every
-- competitor does.

-- Up Migration

CREATE TYPE skill_state AS ENUM ('not_started', 'started', 'tested', 'attained');

COMMENT ON TYPE skill_state IS
  'Não iniciado, Iniciado, Avaliado, Adquirido. Absence of a row means '
  'not_started; the value exists so a correction back to it is recorded rather '
  'than deleted — POOLSE-20.';

-- ---------------------------------------------------------------------------
-- skill — what a level consists of
-- ---------------------------------------------------------------------------

CREATE TABLE skill (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  level_id        uuid NOT NULL,
  name            text NOT NULL,
  /* Ordered like levels are: the order they are taught in, set by the club. */
  sort_order      integer NOT NULL DEFAULT 0,

  /*
   * The thresholds from criterion 2, both optional.
   *
   * A club that does not work this way sets neither and nothing changes. Where
   * they are set, they stop a skill being signed off the first day it is tried —
   * which is the failure they exist to prevent, and which no amount of training
   * reliably fixes on a busy poolside.
   */
  min_days        smallint,
  min_lessons     smallint,

  /** Shown to the student and their encarregado in the mobile app. */
  video_url       text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, level_id)
    REFERENCES student_level (organization_id, id),

  CONSTRAINT skill_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT skill_thresholds_sane CHECK (
    (min_days IS NULL OR min_days BETWEEN 0 AND 3650)
    AND (min_lessons IS NULL OR min_lessons BETWEEN 0 AND 500)
  ),
  -- Loose on purpose. A link that works is more use than a link that passed a
  -- regex, and the only thing worth refusing is something that is not a link.
  CONSTRAINT skill_video_url_shape CHECK (
    video_url IS NULL OR video_url ~ '^https?://[^[:space:]]+$'
  )
);

-- Partial, so archiving a skill and re-adding it next season does not collide
-- with the dead row.
CREATE UNIQUE INDEX skill_name_uq
  ON skill (organization_id, level_id, lower(name))
  WHERE archived_at IS NULL;

CREATE INDEX skill_level_idx
  ON skill (organization_id, level_id, sort_order)
  WHERE archived_at IS NULL;

CREATE TRIGGER skill_updated_at BEFORE UPDATE ON skill
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE skill ENABLE ROW LEVEL SECURITY;
CREATE POLICY skill_tenant ON skill
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON skill TO poolse_app;

-- ---------------------------------------------------------------------------
-- skill_progress — where one student stands on one skill
-- ---------------------------------------------------------------------------

CREATE TABLE skill_progress (
  id                        uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organization (id),
  student_id                uuid NOT NULL,
  skill_id                  uuid NOT NULL,

  state                     skill_state NOT NULL DEFAULT 'not_started',

  /*
   * When work on this skill began — what `min_days` counts from.
   *
   * Stamped when the state first leaves not_started, and kept afterwards. A
   * student moved back to Iniciado has not started again from scratch.
   */
  started_on                date,
  attained_at               timestamptz,

  /** Criterion 7. Every change is attributed and timed. */
  recorded_by_membership_id uuid,
  recorded_at               timestamptz NOT NULL DEFAULT now(),

  /*
   * Criterion 2's escape hatch, and the reason it is safe to have thresholds.
   *
   * A child who has plainly got it should not be held back by a counter, so the
   * override exists — and it records who used it, which is what stops it
   * becoming the normal path.
   */
  override_by_membership_id uuid,
  override_reason           text,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, skill_id) REFERENCES skill (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by_membership_id)
    REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, override_by_membership_id)
    REFERENCES membership (organization_id, id),

  CONSTRAINT skill_progress_override_has_a_reason CHECK (
    override_by_membership_id IS NULL OR btrim(coalesce(override_reason, '')) <> ''
  ),
  CONSTRAINT skill_progress_attained_when_attained CHECK (
    (state = 'attained') = (attained_at IS NOT NULL)
  )
);

-- One row per student per skill. Not partial: progress is corrected in place
-- rather than archived, because "where is this child now" has one answer.
CREATE UNIQUE INDEX skill_progress_uq ON skill_progress (student_id, skill_id);

CREATE INDEX skill_progress_skill_idx ON skill_progress (organization_id, skill_id);

CREATE TRIGGER skill_progress_updated_at BEFORE UPDATE ON skill_progress
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE skill_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY skill_progress_tenant ON skill_progress
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON skill_progress TO poolse_app;

-- ---------------------------------------------------------------------------
-- Keeping started_on and attained_at honest
--
-- In a trigger rather than in the repository, because these are facts about the
-- row and every write path — the grid, a single correction, an import — must
-- produce the same ones. Getting this wrong is how a level's completion date
-- ends up being the day somebody happened to edit a note.
-- ---------------------------------------------------------------------------

CREATE FUNCTION skill_progress_stamps() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.state <> 'not_started' AND NEW.started_on IS NULL THEN
    NEW.started_on := current_date;
  END IF;

  IF NEW.state = 'attained' THEN
    -- Kept if it is already set: re-saving an attained skill must not move the
    -- date it was signed off.
    NEW.attained_at := coalesce(NEW.attained_at, now());
  ELSE
    NEW.attained_at := NULL;
  END IF;

  NEW.recorded_at := now();
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER skill_progress_stamps
  BEFORE INSERT OR UPDATE ON skill_progress
  FOR EACH ROW EXECUTE FUNCTION skill_progress_stamps();

-- ---------------------------------------------------------------------------
-- skill_thresholds_met — may this be signed off yet?
--
-- Criterion 2. Answered in the database because both numbers are questions about
-- stored data: how long since the skill was started, and how many classes the
-- student has actually attended since. The API asks before writing `attained`
-- and demands an override when the answer is no.
--
-- Attendance is counted as `present`, not as sessions that existed. A child who
-- was absent for six weeks has not had six lessons.
-- ---------------------------------------------------------------------------

CREATE FUNCTION skill_thresholds_met(
  p_organization_id uuid,
  p_student_id      uuid,
  p_skill_id        uuid
) RETURNS boolean
LANGUAGE sql STABLE
AS $fn$
  SELECT
    coalesce(
      current_date - p.started_on >= s.min_days,
      s.min_days IS NULL
    )
    AND coalesce(
      (
        SELECT count(*)
          FROM attendance a
          JOIN class_session cs
            ON cs.id = a.class_session_id
           AND cs.organization_id = a.organization_id
         WHERE a.organization_id = p_organization_id
           AND a.student_id = p_student_id
           AND a.status = 'present'
           AND session_local_date(p_organization_id, cs.pool_id, cs.starts_at)
                 >= coalesce(p.started_on, current_date)
      ) >= s.min_lessons,
      s.min_lessons IS NULL
    )
    FROM skill s
    LEFT JOIN skill_progress p
           ON p.skill_id = s.id
          AND p.student_id = p_student_id
   WHERE s.id = p_skill_id
     AND s.organization_id = p_organization_id;
$fn$;

COMMENT ON FUNCTION skill_thresholds_met(uuid, uuid, uuid) IS
  'Whether dias mínimos and aulas mínimas are satisfied for this student and '
  'skill. A skill with neither threshold is always true — POOLSE-20.';

-- Down Migration

DROP FUNCTION IF EXISTS skill_thresholds_met(uuid, uuid, uuid);
DROP TRIGGER IF EXISTS skill_progress_stamps ON skill_progress;
DROP FUNCTION IF EXISTS skill_progress_stamps();
DROP TABLE IF EXISTS skill_progress;
DROP TABLE IF EXISTS skill;
DROP TYPE IF EXISTS skill_state;
