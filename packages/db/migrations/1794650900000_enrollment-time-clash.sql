-- Up Migration

-- A student cannot be in two turmas that meet at the same time — POOLSE-144.
--
-- `enrollment` had a capacity trigger and a quota trigger and nothing about time,
-- so a child in two pool turmas on Monday at 18:00 was accepted. Multi-sport only
-- makes it likelier; the rule is about one person and one hour, and sport plays
-- no part in it.
--
-- ---------------------------------------------------------------------------
-- What clashes
-- ---------------------------------------------------------------------------
--
-- Two of a student's **active** enrolments, in turmas of the **same season**,
-- whose live **patterns** (`class_schedule`) fall on the same weekday with
-- overlapping `[start, start + duration)` windows. Touching is not overlapping:
-- 18:00–18:45 and 18:45–19:30 are two lessons one after the other.
--
-- **The pattern, never `class_session`.** A one-week move of one lesson does not
-- invalidate an enrolment; a student whose two turmas meet only on a hand-moved
-- week is simply absent from one register that week (Rui, 01-11-2026).
--
-- **Pattern × pattern, not turma × turma.** A turma can meet on several days, and
-- the answer names the pattern that clashed, so a refusal can say "segunda às
-- 18:00" rather than "somewhere in the week".
--
-- **Any site of the club.** One body, one hour, whatever the building — the
-- ticket's open question, answered by its default.
--
-- **Windows as intervals, not times.** `time + interval` wraps at midnight, so a
-- 23:30 lesson of 60 minutes would end at 00:30 and overlap nothing. Comparing
-- `start::interval` keeps the arithmetic on a line that does not wrap.
--
-- **One definition.** The trigger below, the calendar's warning (`readGrid`) and
-- the Turmas page's list all read this function; there is no TypeScript copy.
-- Callers inside a trigger name it `public.enrollment_clashes`, the restore rule
-- (`pg_restore` runs with an empty `search_path`).

CREATE FUNCTION enrollment_clashes(p_student_id uuid, p_class_group_id uuid)
RETURNS TABLE (
  schedule_id          uuid,
  other_class_group_id uuid,
  other_schedule_id    uuid,
  weekday              smallint,
  start_time           time
)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT mine.id, other_e.class_group_id, theirs.id, theirs.weekday, theirs.start_time
    FROM class_group g
    JOIN class_schedule mine
      ON mine.class_group_id = g.id AND mine.organization_id = g.organization_id
     AND mine.archived_at IS NULL
    JOIN enrollment other_e
      ON other_e.organization_id = g.organization_id
     AND other_e.student_id = p_student_id
     AND other_e.status = 'active'
     AND other_e.class_group_id <> g.id
    JOIN class_group og
      ON og.id = other_e.class_group_id AND og.organization_id = other_e.organization_id
     AND og.archived_at IS NULL
     AND og.season_id = g.season_id
    JOIN class_schedule theirs
      ON theirs.class_group_id = og.id AND theirs.organization_id = og.organization_id
     AND theirs.archived_at IS NULL
     AND theirs.weekday = mine.weekday
   WHERE g.id = p_class_group_id
     AND mine.start_time::interval
         < theirs.start_time::interval + make_interval(mins => theirs.duration_minutes)
     AND theirs.start_time::interval
         < mine.start_time::interval + make_interval(mins => mine.duration_minutes)
   ORDER BY theirs.weekday, theirs.start_time, mine.weekday, mine.start_time
$$;

COMMENT ON FUNCTION enrollment_clashes(uuid, uuid) IS
  'POOLSE-144. The patterns of p_class_group_id that overlap a pattern of another turma the student is actively in, same season, same weekday. One definition: the enrolment trigger, readGrid and the Turmas list read it.';

-- ---------------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------------
--
-- Beside `enrollment_capacity`, and every way in goes through it: the turma's
-- enrol form, a lead placed from Pedidos (the app's request included), the
-- advancement queue and the bin's restore. A `waiting` enrolment never clashes;
-- the check runs when a row *becomes* active, which is where the club finds out.
--
-- **New rows only.** It fires on INSERT and on a change of `status`, so the
-- clashes already in a club's data stay exactly as they are until somebody
-- touches them — counted below and listed on Turmas, never ended.
--
-- **The student row is locked first**, so two enrolments of one child made at
-- the same moment are judged one after the other instead of both passing.
-- `FOR NO KEY UPDATE`, not `FOR UPDATE`: the enrolment's foreign key already
-- holds `KEY SHARE` on the same row, which `FOR UPDATE` conflicts with — two
-- such inserts would each wait for the other.
--
-- **The refusal carries its figures** — `enrollment_clash|<the other turma>|
-- <weekday>|<HH:MM>` in DETAIL, the `pool_capacity` shape — so the API names the
-- turma, the day and the hour without re-deriving any of them. `check_violation`
-- with no constraint name, like the capacity trigger; the API tells the two
-- apart by DETAIL, which this one always carries and that one never does.

CREATE FUNCTION enrollment_no_time_clash() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clash record;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NULL;
  END IF;
  -- Already active and still in the same turma: nothing new is being asked for.
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' AND OLD.class_group_id = NEW.class_group_id THEN
    RETURN NULL;
  END IF;

  PERFORM 1 FROM student
    WHERE id = NEW.student_id AND organization_id = NEW.organization_id
    FOR NO KEY UPDATE;

  SELECT * INTO v_clash
    FROM public.enrollment_clashes(NEW.student_id, NEW.class_group_id)
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'enrollment_clash: this student already has a lesson at that time'
      USING ERRCODE = 'check_violation',
            DETAIL = format('enrollment_clash|%s|%s|%s',
                            v_clash.other_class_group_id,
                            v_clash.weekday,
                            to_char(v_clash.start_time, 'HH24:MI'));
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER enrollment_time_clash
  AFTER INSERT OR UPDATE OF status ON enrollment
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION enrollment_no_time_clash();

-- ---------------------------------------------------------------------------
-- What is already there
-- ---------------------------------------------------------------------------
--
-- Counted and reported, never changed (BA 5). The figure per club is what the
-- Turmas page will show its owner and admins; the migration log says it once,
-- so whoever deploys knows before the clubs do.

DO $$
DECLARE
  v_row record;
  v_total integer := 0;
BEGIN
  FOR v_row IN
    SELECT e.organization_id, count(DISTINCT e.student_id) AS students
      FROM enrollment e
      JOIN class_group g ON g.id = e.class_group_id AND g.organization_id = e.organization_id
     WHERE e.status = 'active'
       AND g.archived_at IS NULL
       AND EXISTS (SELECT 1 FROM enrollment_clashes(e.student_id, e.class_group_id))
     GROUP BY e.organization_id
  LOOP
    RAISE NOTICE 'POOLSE-144: organization % has % student(s) with overlapping lessons',
      v_row.organization_id, v_row.students;
    v_total := v_total + v_row.students;
  END LOOP;
  RAISE NOTICE 'POOLSE-144: % student(s) with overlapping lessons across all clubs; none changed', v_total;
END $$;

-- Down Migration

DROP TRIGGER IF EXISTS enrollment_time_clash ON enrollment;
DROP FUNCTION IF EXISTS enrollment_no_time_clash();
DROP FUNCTION IF EXISTS enrollment_clashes(uuid, uuid);
