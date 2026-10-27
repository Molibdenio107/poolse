-- Up Migration

-- POOLSE-90 slice 2: *Vou / Não vou*, a family's notice to the club about one
-- lesson, and the one definition of who may answer for a child.
--
-- **A notice, never attendance.** Nothing here writes, pre-marks or reads the
-- register's marks: the instructor still marks who was in the water, and a
-- taught class is still a record, not a plan. No row means "not answered", the
-- ordinary case; `going` is the last answer, with who gave it and when. Keyed
-- by session id, never by date, so a moved week keeps its answers.
--
-- **Who answers** is `family_may_answer()` (Rui, 21-10-2026, POOLSE-90 Decided 2):
-- a live guardian of the student; or the student's own login when they are on
-- the adult path (`student_is_adult_path`) or aged `self_answer_min_age()` or
-- more. No birth date is the guardian, never a guess. POOLSE-116's lesson
-- feedback had its own copy of this rule in TypeScript, which disagreed at the
-- edge (a student with no guardian and no birth date); both read this now.

CREATE FUNCTION self_answer_min_age() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 12 $$;

COMMENT ON FUNCTION self_answer_min_age() IS
  'POOLSE-90 Decided 2: from this age a student answers for themselves with their own login. '
  'One value, not a column, until a club asks for another.';

CREATE FUNCTION family_may_answer(p_organization_id uuid, p_student_id uuid, p_membership_id uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
           SELECT 1 FROM guardian_link gl
            WHERE gl.organization_id = p_organization_id
              AND gl.student_id = p_student_id
              AND gl.guardian_membership_id = p_membership_id
              AND gl.archived_at IS NULL)
      OR EXISTS (
           SELECT 1 FROM student s
            WHERE s.organization_id = p_organization_id
              AND s.id = p_student_id
              AND s.membership_id = p_membership_id
              AND (student_is_adult_path(p_organization_id, p_student_id)
                   OR (s.birth_date IS NOT NULL
                       AND date_part('year', age(club_today(), s.birth_date)) >= self_answer_min_age())))
$$;

COMMENT ON FUNCTION family_may_answer(uuid, uuid, uuid) IS
  'POOLSE-90 / 116: whether a membership answers for a student — a live guardian, or the student '
  'themselves on the adult path or from self_answer_min_age(). Read by Vou / Não vou and by lesson feedback.';

CREATE TABLE session_notice (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            uuid NOT NULL REFERENCES organization (id),
  class_session_id           uuid NOT NULL,
  student_id                 uuid NOT NULL,
  -- true *Vou*, false *Não vou*; no row is "not answered".
  going                      boolean NOT NULL,
  answered_by_membership_id  uuid NOT NULL,
  answered_at                timestamptz NOT NULL DEFAULT now(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),
  UNIQUE (organization_id, class_session_id, student_id),
  FOREIGN KEY (organization_id, class_session_id) REFERENCES class_session (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, answered_by_membership_id) REFERENCES membership (organization_id, id)
);

CREATE TRIGGER session_notice_updated_at BEFORE UPDATE ON session_notice
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Only until the lesson starts, never on a cancelled one, a parceria or free
-- swim. Refusals carry their code in DETAIL, which the API answers as a 409.
CREATE FUNCTION session_notice_admissible() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_status   text;
  v_starts   timestamptz;
  v_group    uuid;
BEGIN
  SELECT cs.status::text, cs.starts_at, cs.class_group_id INTO v_status, v_starts, v_group
    FROM class_session cs
   WHERE cs.id = NEW.class_session_id AND cs.organization_id = NEW.organization_id;

  IF v_group IS NULL THEN
    RAISE EXCEPTION 'A notice on a lesson with no turma'
      USING ERRCODE = 'check_violation', DETAIL = 'notice_not_offered|no_turma';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'A notice on a cancelled lesson'
      USING ERRCODE = 'check_violation', DETAIL = 'notice_not_offered|cancelled';
  END IF;
  IF v_starts <= now() THEN
    RAISE EXCEPTION 'A notice after the lesson started'
      USING ERRCODE = 'check_violation',
            DETAIL = format('notice_closed|%s', to_char(v_starts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER session_notice_admissible BEFORE INSERT OR UPDATE ON session_notice
  FOR EACH ROW EXECUTE FUNCTION session_notice_admissible();

ALTER TABLE session_notice ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_notice_tenant ON session_notice
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON session_notice FROM poolse_app;
GRANT SELECT, INSERT ON session_notice TO poolse_app;
GRANT UPDATE (going, answered_by_membership_id, answered_at) ON session_notice TO poolse_app;

COMMENT ON TABLE session_notice IS
  'POOLSE-90: Vou / Não vou — a family''s notice about one lesson, never attendance. One row per '
  '(session, student), the last answer; changes are in audit_log. No row is "not answered".';

-- Down Migration

DROP TABLE IF EXISTS session_notice;
DROP FUNCTION IF EXISTS session_notice_admissible();
DROP FUNCTION IF EXISTS family_may_answer(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS self_answer_min_age();
