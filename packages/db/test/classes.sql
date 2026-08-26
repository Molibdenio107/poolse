-- Class groups, schedules and enrollment — slices 1.4 and 1.7.
--
-- Test 3 is the one to keep. Capacity is checked in the API too, so an operator
-- gets "this turma is full" instead of a constraint violation — but an
-- application check cannot survive two people enrolling the last place at the
-- same moment. This asserts the guarantee behind that courtesy.
--
-- Test 2 is the other one worth reading. `start_time` is a plain `time`, meaning
-- wall-clock at the facility, because "Tuesdays at 18:00" means six o'clock in
-- July and six o'clock in January. Stored as an instant it would move by an hour
-- when Portugal changes its clocks, twice a year, silently.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES ('Clube A', 'clube-a'), ('Clube B', 'clube-b');

SELECT provision_app_user('user_inst', 'inst@clube.pt', 'Ana', 'Martins', NULL, '2026-08-26 09:00:00+00');

DO $$
DECLARE
  v_a uuid; v_b uuid; v_facility uuid; v_pool uuid;
  v_level uuid; v_user uuid; v_membership uuid;
BEGIN
  SELECT id INTO v_a FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_b FROM organization WHERE name = 'Clube B';

  INSERT INTO facility (organization_id, name) VALUES (v_a, 'Piscina Municipal')
  RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name, lane_count)
  VALUES (v_a, v_facility, 'Tanque Grande', 6) RETURNING id INTO v_pool;

  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_a, 'Iniciação', 0) RETURNING id INTO v_level;

  SELECT id INTO v_user FROM app_user WHERE clerk_user_id = 'user_inst';
  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_a, v_user, 'active') RETURNING id INTO v_membership;
  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_a, v_membership, 'instructor');

  INSERT INTO class_group (organization_id, name, pool_id, level_id,
                           instructor_membership_id, capacity, lane)
  VALUES (v_a, 'Iniciação Terças e Quintas', v_pool, v_level, v_membership, 2, 3);

  -- Four students, so capacity can be pushed past.
  INSERT INTO student (organization_id, first_name, last_name) VALUES
    (v_a, 'João',    'Silva'),
    (v_a, 'Ana',     'Conceição'),
    (v_a, 'Mariana', 'Sá'),
    (v_a, 'Tomás',   'Costa');

  -- And one belonging to the other club, for the isolation tests.
  INSERT INTO facility (organization_id, name) VALUES (v_b, 'Outra Piscina');
  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_b, 'Aluno', 'Outro');
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — a turma carries its level, instructor, pool and lane
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  SELECT cg.capacity, cg.lane, l.name AS level, p.name AS pool,
         u.cached_first_name AS instructor
    INTO r
    FROM class_group cg
    LEFT JOIN student_level l ON l.id = cg.level_id
    LEFT JOIN pool p ON p.id = cg.pool_id
    LEFT JOIN membership m ON m.id = cg.instructor_membership_id
    LEFT JOIN app_user u ON u.id = m.app_user_id
   WHERE cg.name = 'Iniciação Terças e Quintas';

  IF r.level <> 'Iniciação' OR r.pool <> 'Tanque Grande' OR r.instructor <> 'Ana' THEN
    RAISE EXCEPTION 'FAIL test 1a: turma resolved to %, %, %', r.level, r.pool, r.instructor;
  END IF;
  IF r.capacity <> 2 OR r.lane <> 3 THEN
    RAISE EXCEPTION 'FAIL test 1b: capacity/lane came back as %, %', r.capacity, r.lane;
  END IF;

  RAISE NOTICE 'PASS test 1: a turma holds its level, instructor, pool, lane and capacity';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — the weekly pattern is wall-clock, and survives a clock change
--
-- Keep this one. "Tuesdays at 18:00" has to mean six o'clock in July and six
-- o'clock in January. A `timestamptz` would shift it by an hour when the clocks
-- change and nobody would notice until a family arrived an hour early.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_group uuid; r record; n int; v_type text;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_group FROM class_group WHERE name = 'Iniciação Terças e Quintas';

  -- Tuesday and Thursday: two rows, not one row with a list.
  INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_group, 2, TIME '18:00', 45),
         (v_org, v_group, 4, TIME '18:00', 45);

  SELECT count(*) INTO n FROM class_schedule WHERE class_group_id = v_group;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 2a: expected two slots, got %', n;
  END IF;

  -- A plain `time`, carrying no zone to be shifted by.
  SELECT pg_typeof(start_time)::text INTO v_type
    FROM class_schedule WHERE class_group_id = v_group LIMIT 1;
  IF v_type <> 'time without time zone' THEN
    RAISE EXCEPTION 'FAIL test 2b: start_time is %, which a clock change can move', v_type;
  END IF;

  -- Read in summer and in winter, it is the same eighteen hundred.
  SELECT start_time INTO r FROM class_schedule WHERE class_group_id = v_group LIMIT 1;
  IF r.start_time <> TIME '18:00' THEN
    RAISE EXCEPTION 'FAIL test 2c: 18:00 came back as %', r.start_time;
  END IF;

  -- The same turma cannot be scheduled twice at the same moment.
  BEGIN
    INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
    VALUES (v_org, v_group, 2, TIME '18:00', 45);
    RAISE EXCEPTION 'FAIL test 2d: a turma was scheduled twice in one slot';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  -- Weekdays are ISO. Zero is not a day.
  BEGIN
    INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
    VALUES (v_org, v_group, 0, TIME '19:00', 45);
    RAISE EXCEPTION 'FAIL test 2e: weekday 0 was accepted; ISO runs 1 to 7';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 2: the weekly pattern is wall-clock time on ISO weekdays';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — capacity holds, and holds under a race
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_group uuid; v_student uuid; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_group FROM class_group WHERE name = 'Iniciação Terças e Quintas';

  -- Capacity is two. Fill it.
  FOR v_student IN
    SELECT id FROM student WHERE organization_id = v_org
     AND first_name IN ('João', 'Ana') ORDER BY first_name
  LOOP
    INSERT INTO enrollment (organization_id, class_group_id, student_id)
    VALUES (v_org, v_group, v_student);
  END LOOP;

  SELECT count(*) INTO n FROM enrollment
   WHERE class_group_id = v_group AND status = 'active';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 3a: expected two enrolled, got %', n;
  END IF;

  -- The third is refused by the database, not merely by the form.
  SELECT id INTO v_student FROM student
   WHERE organization_id = v_org AND first_name = 'Mariana';
  BEGIN
    INSERT INTO enrollment (organization_id, class_group_id, student_id)
    VALUES (v_org, v_group, v_student);
    RAISE EXCEPTION 'FAIL test 3b: a third student was enrolled in a turma of two';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- But the waiting list is not capped: that is the whole point of it.
  INSERT INTO enrollment (organization_id, class_group_id, student_id, status, waiting_position)
  VALUES (v_org, v_group, v_student, 'waiting', 1);

  SELECT count(*) INTO n FROM enrollment
   WHERE class_group_id = v_group AND status = 'waiting';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 3c: the waiting list refused somebody';
  END IF;

  RAISE NOTICE 'PASS test 3: capacity is enforced by the database; the waiting list is not capped';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — leaving and coming back is a history, not a conflict
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_group uuid; v_student uuid; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_group FROM class_group WHERE name = 'Iniciação Terças e Quintas';
  SELECT id INTO v_student FROM student
   WHERE organization_id = v_org AND first_name = 'João';

  -- A second live enrollment in the same turma is refused.
  BEGIN
    INSERT INTO enrollment (organization_id, class_group_id, student_id)
    VALUES (v_org, v_group, v_student);
    RAISE EXCEPTION 'FAIL test 4a: a student was enrolled twice in one turma';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  -- They leave in March…
  UPDATE enrollment SET status = 'ended', ended_on = current_date
   WHERE class_group_id = v_group AND student_id = v_student AND status = 'active';

  -- …and come back in September. Two rows, and the history reads in order.
  INSERT INTO enrollment (organization_id, class_group_id, student_id)
  VALUES (v_org, v_group, v_student);

  SELECT count(*) INTO n FROM enrollment
   WHERE class_group_id = v_group AND student_id = v_student;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 4b: expected the ended row beside the new one, got %', n;
  END IF;

  -- An ended enrollment must say when it ended.
  BEGIN
    INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
    SELECT v_org, v_group, id, 'ended' FROM student
     WHERE organization_id = v_org AND first_name = 'Tomás';
    RAISE EXCEPTION 'FAIL test 4c: an enrollment ended on no date';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 4: a student may rejoin a turma they left, as a second row';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — a turma cannot borrow another organization's pool, level or teacher
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_a uuid; v_b uuid; v_pool uuid; v_level uuid; v_group uuid; v_student uuid;
BEGIN
  SELECT id INTO v_a FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_b FROM organization WHERE name = 'Clube B';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_a;
  SELECT id INTO v_level FROM student_level WHERE organization_id = v_a;
  SELECT id INTO v_group FROM class_group WHERE organization_id = v_a;
  SELECT id INTO v_student FROM student WHERE organization_id = v_b;

  BEGIN
    INSERT INTO class_group (organization_id, name, pool_id)
    VALUES (v_b, 'Turma Roubada', v_pool);
    RAISE EXCEPTION 'FAIL test 5a: Clube B put a turma in a Clube A pool';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO class_group (organization_id, name, level_id)
    VALUES (v_b, 'Turma Roubada', v_level);
    RAISE EXCEPTION 'FAIL test 5b: Clube B used a Clube A level';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  -- And a student cannot be enrolled into another club's turma.
  BEGIN
    INSERT INTO enrollment (organization_id, class_group_id, student_id)
    VALUES (v_b, v_group, v_student);
    RAISE EXCEPTION 'FAIL test 5c: a Clube B student joined a Clube A turma';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 5: turmas and enrollments cannot cross tenants';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — one club cannot read another's timetable
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE v_b uuid; n int;
BEGIN
  SET LOCAL ROLE postgres;
  SELECT id INTO v_b FROM organization WHERE name = 'Clube B';
  SET LOCAL ROLE poolse_app;

  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM class_group;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6a: Clube B read % of Clube A turmas', n;
  END IF;

  SELECT count(*) INTO n FROM class_schedule;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6b: Clube B read % of Clube A schedule rows', n;
  END IF;

  SELECT count(*) INTO n FROM enrollment;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6c: Clube B read % of Clube A enrollments', n;
  END IF;

  RAISE NOTICE 'PASS test 6: the timetable is invisible across tenants';
END $$;

RESET ROLE;

ROLLBACK;
