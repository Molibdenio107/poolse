-- Up Migration
--
-- POOLSE-218: a child's login that is really a parent's.
--
-- *Convidar aluno* used to invite the student themself, so a parent's email made
-- the parent's login the child's own. This says when a record looks like that:
-- the student's own membership has a login, the date of birth is the office's
-- (confirmed, not declared from the login), and the age is under the age a
-- person answers for themself (`self_answer_min_age()`). It returns that age,
-- for the warning to say in words, and null otherwise.
--
-- Derived once, here: the screen never computes an age (CLAUDE.md, "a derived
-- answer is derived once, on the server"). A warning, never a gate.

CREATE FUNCTION student_login_child_age(p_student_id uuid) RETURNS integer
LANGUAGE sql
STABLE
AS $fn$
  SELECT extract(YEAR FROM age(club_today(), s.birth_date))::int
    FROM student s
    JOIN membership m ON m.id = s.membership_id AND m.organization_id = s.organization_id
   WHERE s.id = p_student_id
     AND s.archived_at IS NULL
     AND m.app_user_id IS NOT NULL
     AND s.birth_date IS NOT NULL
     AND s.birth_date_declared_at IS NULL
     AND age(club_today(), s.birth_date) < make_interval(years => self_answer_min_age())
$fn$;

COMMENT ON FUNCTION student_login_child_age(uuid) IS
  'POOLSE-218: the age of a student whose own login is too young to be theirs (confirmed date under self_answer_min_age()), else null.';

GRANT EXECUTE ON FUNCTION student_login_child_age(uuid) TO poolse_app;

-- Down Migration

DROP FUNCTION student_login_child_age(uuid);
