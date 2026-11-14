-- Up Migration
--
-- The tank's capacity: a warning on the timetable, a limit on people (Rui, 14-11-2026).
--
-- Since round 5 (ticket 4.2) the turmas sharing a tank at overlapping hours could
-- not, between them, *promise* more places than `pool.max_capacity`: a turma save
-- was refused on the sum of capacities. Rui: two turmas of 12 in a tank of 20 are
-- refused even when eight people would be in the water, and the office could not
-- save the timetable it then wanted to adjust on the calendar.
--
-- So the promise becomes a warning and the limit moves to the people:
--
-- 1. **A turma save is never refused by the tank.** The two triggers go.
--    `pool_places_over()` answers, for one turma, each of its hours where the
--    places promised exceed the tank, and the API says so after the save.
-- 2. **An enrolment is refused when the people actually enrolled at that hour,
--    across every turma in the tank that season, would exceed it** — and only
--    when the tank has a capacity (`max_capacity` null enforces nothing, as
--    before). `pool_people|<max>|<people>` in DETAIL, check_violation, the shape
--    the other capacity refusals use.
--
-- Only an enrolment that newly becomes active is judged: editing a student who
-- is already in the water at an hour that is over (because the timetable moved)
-- is not refused for a problem it did not cause.

DROP TRIGGER IF EXISTS class_group_pool_capacity ON class_group;
DROP FUNCTION IF EXISTS class_group_pool_capacity();
DROP TRIGGER IF EXISTS class_schedule_pool_capacity ON class_schedule;
DROP FUNCTION IF EXISTS class_schedule_pool_capacity();
DROP FUNCTION IF EXISTS pool_capacity_respected(uuid, uuid);

-- Each hour of one turma where the turmas in the tank promise more than it holds.
CREATE FUNCTION pool_places_over(p_organization_id uuid, p_class_group_id uuid)
RETURNS TABLE (weekday smallint, start_time text, max_capacity integer, taken integer, own integer)
LANGUAGE sql STABLE AS $$
  WITH me AS (
    SELECT cg.id, cg.pool_id, cg.season_id, cg.capacity, p.max_capacity
      FROM class_group cg
      JOIN pool p ON p.id = cg.pool_id AND p.organization_id = cg.organization_id
     WHERE cg.id = p_class_group_id AND cg.organization_id = p_organization_id
       AND cg.archived_at IS NULL AND cg.capacity IS NOT NULL AND p.max_capacity IS NOT NULL
  ),
  slots AS (
    SELECT cs.weekday, cs.start_time, cs.duration_minutes
      FROM class_schedule cs JOIN me ON me.id = cs.class_group_id
     WHERE cs.organization_id = p_organization_id AND cs.archived_at IS NULL
  )
  SELECT s.weekday, to_char(s.start_time, 'HH24:MI'), me.max_capacity,
         others.taken, me.capacity
    FROM slots s
   CROSS JOIN me
   CROSS JOIN LATERAL (
     SELECT coalesce(sum(per_group.capacity), 0)::int AS taken
       FROM (
         SELECT DISTINCT other.id, other.capacity
           FROM class_schedule ocs
           JOIN class_group other ON other.id = ocs.class_group_id AND other.organization_id = ocs.organization_id
          WHERE ocs.organization_id = p_organization_id
            AND ocs.archived_at IS NULL AND ocs.subject_type = 'turma' AND ocs.weekday = s.weekday
            AND other.archived_at IS NULL AND other.pool_id = me.pool_id AND other.season_id = me.season_id
            AND other.capacity IS NOT NULL AND other.id <> me.id
            AND (s.start_time, s.start_time + make_interval(mins => s.duration_minutes))
                OVERLAPS (ocs.start_time, ocs.start_time + make_interval(mins => ocs.duration_minutes))
       ) per_group
   ) others
   WHERE others.taken + me.capacity > me.max_capacity
   ORDER BY s.weekday, s.start_time;
$$;

CREATE FUNCTION enrollment_pool_people() RETURNS trigger AS $$
DECLARE
  v_pool    uuid;
  v_season  uuid;
  v_max     integer;
  v_weekday smallint;
  v_start   time;
  v_minutes integer;
  v_people  integer;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' AND OLD.class_group_id = NEW.class_group_id THEN
    RETURN NEW;
  END IF;

  SELECT cg.pool_id, cg.season_id INTO v_pool, v_season
    FROM class_group cg
   WHERE cg.id = NEW.class_group_id AND cg.organization_id = NEW.organization_id AND cg.archived_at IS NULL;
  IF v_pool IS NULL THEN
    RETURN NEW;
  END IF;

  -- Locked, as the old rule did, so two enrolments at once cannot both see room.
  SELECT p.max_capacity INTO v_max
    FROM pool p WHERE p.id = v_pool AND p.organization_id = NEW.organization_id
     FOR UPDATE;
  IF v_max IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_weekday, v_start, v_minutes IN
    SELECT cs.weekday, cs.start_time, cs.duration_minutes
      FROM class_schedule cs
     WHERE cs.class_group_id = NEW.class_group_id AND cs.organization_id = NEW.organization_id
       AND cs.archived_at IS NULL
  LOOP
    SELECT count(DISTINCT e.student_id)::int INTO v_people
      FROM enrollment e
      JOIN class_group other ON other.id = e.class_group_id AND other.organization_id = e.organization_id
     WHERE e.organization_id = NEW.organization_id AND e.status = 'active'
       AND other.archived_at IS NULL AND other.pool_id = v_pool AND other.season_id = v_season
       AND EXISTS (
         SELECT 1 FROM class_schedule ocs
          WHERE ocs.class_group_id = other.id AND ocs.organization_id = other.organization_id
            AND ocs.archived_at IS NULL AND ocs.subject_type = 'turma' AND ocs.weekday = v_weekday
            AND (v_start, v_start + make_interval(mins => v_minutes))
                OVERLAPS (ocs.start_time, ocs.start_time + make_interval(mins => ocs.duration_minutes))
       );
    IF v_people > v_max THEN
      RAISE EXCEPTION 'Pool full at that hour: % holds %, % enrolled', v_pool, v_max, v_people
        USING ERRCODE = 'check_violation',
              DETAIL = format('pool_people|%s|%s', v_max, v_people);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enrollment_pool_people
  AFTER INSERT OR UPDATE OF status, class_group_id ON enrollment
  FOR EACH ROW EXECUTE FUNCTION enrollment_pool_people();

-- Down Migration

DROP TRIGGER IF EXISTS enrollment_pool_people ON enrollment;
DROP FUNCTION IF EXISTS enrollment_pool_people();
DROP FUNCTION IF EXISTS pool_places_over(uuid, uuid);
-- The round-5 refusal is restored by re-running 1788030000000_pool-capacity-rule's Up section.
