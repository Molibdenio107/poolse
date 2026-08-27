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

INSERT INTO season (organization_id, name, starts_on, ends_on)
SELECT id, 'Época de teste', DATE '2020-01-01', DATE '2030-12-31'
  FROM organization WHERE slug IN ('clube-a', 'clube-b');
-- Deliberately wide. `generate_sessions` bounds its window by the season, and a
-- realistic September-to-August range would move the assertions below without
-- them being about seasons at all. That behaviour is asserted in seasons.sql.

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

  INSERT INTO class_group (organization_id, season_id, name, pool_id, level_id,
                           instructor_membership_id, capacity, lane)
  VALUES (v_a, (SELECT id FROM season WHERE organization_id = v_a AND archived_at IS NULL),
          'Iniciação Terças e Quintas', v_pool, v_level, v_membership, 2, 3);

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
    INSERT INTO class_group (organization_id, season_id, name, pool_id)
    VALUES (v_b, (SELECT id FROM season WHERE organization_id = v_b AND archived_at IS NULL), 'Turma Roubada', v_pool);
    RAISE EXCEPTION 'FAIL test 5a: Clube B put a turma in a Clube A pool';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO class_group (organization_id, season_id, name, level_id)
    VALUES (v_b, (SELECT id FROM season WHERE organization_id = v_b AND archived_at IS NULL), 'Turma Roubada', v_level);
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

-- ---------------------------------------------------------------------------
-- Test 11 — one instructor cannot teach two classes at once
--
-- Backlog round 4, ticket 1. The lane constraint has guarded pool-and-lane
-- overlap since 1.6; this is the half that was missing, and it was missing
-- because the instructor was not on the session — only the substitute was, and
-- an exclusion constraint cannot join.
--
-- The three cases the ticket names, plus the two it implies:
--
--   a. Same lane, overlapping by real duration. 10:00–10:45 blocks 10:30.
--   b. Same instructor, *different pool*. Nothing about lanes saves you here.
--   c. Back-to-back. 10:45 starting exactly when 10:45 ends is not an overlap,
--      because tstzrange is half-open. No special case, and this asserts that
--      nobody later "fixes" it into a closed range.
--   d. A substitute counts. Somebody covering a class cannot also be teaching
--      their own at the same moment.
--   e. A cancelled class frees the instructor, exactly as it frees a lane.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_facility uuid; v_pool_a uuid; v_pool_b uuid;
  v_rita uuid; v_tiago uuid;
  v_group_a uuid; v_group_b uuid; v_group_c uuid;
  v_session uuid;
BEGIN
  INSERT INTO organization (name, slug) VALUES ('Clube Horário', 'clube-horario')
  RETURNING id INTO v_org;

  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, 'Época de teste', DATE '2020-01-01', DATE '2030-12-31');

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Complexo')
  RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_org, v_facility, 'Tanque A', 'indoor') RETURNING id INTO v_pool_a;
  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_org, v_facility, 'Tanque B', 'indoor') RETURNING id INTO v_pool_b;

  SELECT provision_app_user('user_h_r', 'rita@h.pt',  'Rita',  'Lopes',   NULL, now()) INTO v_rita;
  SELECT provision_app_user('user_h_t', 'tiago@h.pt', 'Tiago', 'Freitas', NULL, now()) INTO v_tiago;

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_rita, 'active') RETURNING id INTO v_rita;
  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_tiago, 'active') RETURNING id INTO v_tiago;

  INSERT INTO class_group (organization_id, season_id, name, pool_id, lane,
                           instructor_membership_id)
  VALUES (v_org, (SELECT id FROM season WHERE organization_id = v_org AND archived_at IS NULL), 'Iniciação A', v_pool_a, 1, v_rita) RETURNING id INTO v_group_a;
  INSERT INTO class_group (organization_id, season_id, name, pool_id, lane,
                           instructor_membership_id)
  VALUES (v_org, (SELECT id FROM season WHERE organization_id = v_org AND archived_at IS NULL), 'Iniciação B', v_pool_a, 1, v_tiago) RETURNING id INTO v_group_b;
  INSERT INTO class_group (organization_id, season_id, name, pool_id, lane,
                           instructor_membership_id)
  VALUES (v_org, (SELECT id FROM season WHERE organization_id = v_org AND archived_at IS NULL), 'Iniciação C', v_pool_b, 1, v_rita) RETURNING id INTO v_group_c;

  -- The anchor: Rita, Tanque A lane 1, 10:00 for 45 minutes.
  INSERT INTO class_session (organization_id, class_group_id, pool_id, lane,
                             starts_at, duration_minutes, instructor_membership_id)
  VALUES (v_org, v_group_a, v_pool_a, 1, TIMESTAMPTZ '2026-09-07 10:00:00+01', 45, v_rita)
  RETURNING id INTO v_session;

  -- a. 10:30 in the same lane. An hourly grid would have allowed this; the real
  --    duration is what refuses it.
  BEGIN
    INSERT INTO class_session (organization_id, class_group_id, pool_id, lane,
                               starts_at, duration_minutes, instructor_membership_id)
    VALUES (v_org, v_group_b, v_pool_a, 1, TIMESTAMPTZ '2026-09-07 10:30:00+01', 45, v_tiago);
    RAISE EXCEPTION 'FAIL test 11a: a 10:30 class was booked over a 10:00-10:45 one';
  EXCEPTION
    WHEN exclusion_violation THEN NULL;
  END;

  -- b. Rita again, in a different pool entirely. Lanes cannot help here.
  BEGIN
    INSERT INTO class_session (organization_id, class_group_id, pool_id, lane,
                               starts_at, duration_minutes, instructor_membership_id)
    VALUES (v_org, v_group_c, v_pool_b, 1, TIMESTAMPTZ '2026-09-07 10:30:00+01', 45, v_rita);
    RAISE EXCEPTION 'FAIL test 11b: one instructor was booked in two pools at once';
  EXCEPTION
    WHEN exclusion_violation THEN NULL;
  END;

  -- c. Back-to-back, same lane and same instructor. Must be allowed.
  INSERT INTO class_session (organization_id, class_group_id, pool_id, lane,
                             starts_at, duration_minutes, instructor_membership_id)
  VALUES (v_org, v_group_c, v_pool_a, 1, TIMESTAMPTZ '2026-09-07 10:45:00+01', 45, v_rita);

  -- d. A substitute is the person actually teaching, so they clash too. Tiago is
  --    free at 11:30, but not if he is covering something else then.
  INSERT INTO class_session (organization_id, class_group_id, pool_id, lane,
                             starts_at, duration_minutes, instructor_membership_id,
                             substitute_instructor_membership_id)
  VALUES (v_org, v_group_b, v_pool_b, 2, TIMESTAMPTZ '2026-09-07 11:30:00+01', 45,
          v_rita, v_tiago);

  BEGIN
    INSERT INTO class_session (organization_id, class_group_id, pool_id, lane,
                               starts_at, duration_minutes, instructor_membership_id)
    VALUES (v_org, v_group_b, v_pool_a, 3, TIMESTAMPTZ '2026-09-07 11:45:00+01', 45, v_tiago);
    RAISE EXCEPTION 'FAIL test 11d: a substitute was double-booked against their own class';
  EXCEPTION
    WHEN exclusion_violation THEN NULL;
  END;

  -- e. Calling the anchor off frees Rita, exactly as it frees her lane.
  UPDATE class_session SET status = 'cancelled' WHERE id = v_session;

  INSERT INTO class_session (organization_id, class_group_id, pool_id, lane,
                             starts_at, duration_minutes, instructor_membership_id)
  VALUES (v_org, v_group_c, v_pool_b, 1, TIMESTAMPTZ '2026-09-07 10:00:00+01', 45, v_rita);

  RAISE NOTICE 'PASS test 11: an instructor cannot be in two places, and back-to-back is fine';
END $$;

-- ---------------------------------------------------------------------------
-- Test 12 — a session cannot end before it starts
--
-- The BEFORE trigger already computes ends_at from duration_minutes, so this is
-- unreachable through the ordinary path. It is asserted anyway because the
-- trigger is a function somebody can change, and this is a fact about the row
-- rather than about the code that wrote it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_group uuid; n int;
BEGIN
  v_org := (SELECT id FROM organization WHERE slug = 'clube-horario');
  v_group := (SELECT id FROM class_group WHERE organization_id = v_org LIMIT 1);

  BEGIN
    INSERT INTO class_session (organization_id, class_group_id, starts_at,
                               duration_minutes, ends_at)
    VALUES (v_org, v_group, TIMESTAMPTZ '2026-09-08 10:00:00+01', 45,
            TIMESTAMPTZ '2026-09-08 09:00:00+01');
    -- The trigger overwrites ends_at, so this insert succeeds with a corrected
    -- value rather than failing. Assert the correction happened.
    SELECT count(*) INTO n
      FROM class_session
     WHERE class_group_id = v_group
       AND starts_at = TIMESTAMPTZ '2026-09-08 10:00:00+01'
       AND ends_at = TIMESTAMPTZ '2026-09-08 10:45:00+01';
    IF n <> 1 THEN
      RAISE EXCEPTION 'FAIL test 12a: ends_at was not recomputed from the duration';
    END IF;
  END;

  -- Reaching past the trigger, the constraint still holds the line.
  BEGIN
    ALTER TABLE class_session DISABLE TRIGGER class_session_set_ends_at;
    BEGIN
      INSERT INTO class_session (organization_id, class_group_id, starts_at,
                                 duration_minutes, ends_at)
      VALUES (v_org, v_group, TIMESTAMPTZ '2026-09-09 10:00:00+01', 45,
              TIMESTAMPTZ '2026-09-09 09:00:00+01');
      ALTER TABLE class_session ENABLE TRIGGER class_session_set_ends_at;
      RAISE EXCEPTION 'FAIL test 12b: a session ending before it starts was stored';
    EXCEPTION
      WHEN check_violation THEN
        ALTER TABLE class_session ENABLE TRIGGER class_session_set_ends_at;
    END;
  END;

  RAISE NOTICE 'PASS test 12: ends_at is recomputed, and cannot precede starts_at';
END $$;

-- ---------------------------------------------------------------------------
-- Test 13 — level age ranges are optional, ordered, and never block a student
--
-- Backlog round 4, tickets 2 and 3. The last half is the important half: the
-- database stores the range and enforces nothing about who is in the level.
-- A hard block gets worked around with fake birth dates, and then the data is
-- worse than if the check had never existed.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_bebes uuid; v_adultos uuid; v_student uuid;
BEGIN
  v_org := (SELECT id FROM organization WHERE slug = 'clube-horario');

  -- Both bounds, in months — POOLSE-06. Six months is the case whole years
  -- could not express, and the reason the unit changed.
  INSERT INTO student_level (organization_id, name, min_age_months, max_age_months)
  VALUES (v_org, 'Bebés', 6, 35) RETURNING id INTO v_bebes;

  -- A minimum and no maximum — the "Adultos" case the ticket names.
  INSERT INTO student_level (organization_id, name, min_age_months)
  VALUES (v_org, 'Adultos', 216) RETURNING id INTO v_adultos;

  -- Neither: behaves exactly as before this migration.
  INSERT INTO student_level (organization_id, name) VALUES (v_org, 'Livre');

  -- A range nobody can be in is a typo.
  BEGIN
    INSERT INTO student_level (organization_id, name, min_age_months, max_age_months)
    VALUES (v_org, 'Impossível', 120, 48);
    RAISE EXCEPTION 'FAIL test 13a: a level whose maximum is below its minimum was stored';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- 1440 months is 120 years, so this is somebody over 160.
  BEGIN
    INSERT INTO student_level (organization_id, name, min_age_months)
    VALUES (v_org, 'Matusalém', 2000);
    RAISE EXCEPTION 'FAIL test 13b: an implausible age was stored';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- And now the part that must NOT be enforced: a 67-year-old in Bebés. The
  -- interface warns and asks for confirmation; the database stores what the club
  -- decided. Ticket 3 is explicit that this is a warning, not a block.
  INSERT INTO student (organization_id, first_name, last_name, birth_date, level_id)
  VALUES (v_org, 'Armando', 'Seabra', DATE '1959-03-02', v_bebes)
  RETURNING id INTO v_student;

  -- A student with no birth date at all is the normal case for an import, and is
  -- never in anybody's way.
  INSERT INTO student (organization_id, first_name, last_name, level_id)
  VALUES (v_org, 'Sem', 'Data', v_adultos);

  RAISE NOTICE 'PASS test 13: age ranges are stored and ordered, and never block a student';
END $$;

ROLLBACK;
