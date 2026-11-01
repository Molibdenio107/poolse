-- A student cannot be in two turmas that meet at the same time — POOLSE-144.
--
-- The trigger judges the *pattern* (`class_schedule`), new rows only, and is
-- indifferent to sport. What would be easy to get wrong, and is asserted here:
-- touching windows are not a clash; a waiting enrolment is not one either until
-- it becomes active; a refusal carries the other turma, the weekday and the hour
-- in DETAIL; and nothing reaches across tenants.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug, enabled_sports) VALUES
  ('14400000-0000-4444-8888-000000000001', 'Clube Sobreposto', 'clube-sobreposto', '{pool,tennis}'),
  ('14400000-0000-4444-8888-000000000002', 'Clube Vizinho', 'clube-vizinho', '{pool}');

DO $$
DECLARE
  v_org uuid := '14400000-0000-4444-8888-000000000001';
  v_other uuid := '14400000-0000-4444-8888-000000000002';
  v_fac uuid; v_fac2 uuid; v_ofac uuid; v_season uuid; v_oseason uuid; v_court uuid;
BEGIN
  UPDATE organization SET max_facilities = 2 WHERE id = v_org;
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina') RETURNING id INTO v_fac;
  -- A second building of the same club: one body, one hour, whatever the site.
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Pavilhão') RETURNING id INTO v_fac2;
  INSERT INTO facility (organization_id, name) VALUES (v_other, 'Outra') RETURNING id INTO v_ofac;

  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_org, '2026/2027', '2026-09-01', '2027-07-31', 'published') RETURNING id INTO v_season;
  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_other, '2026/2027', '2026-09-01', '2027-07-31', 'published') RETURNING id INTO v_oseason;

  INSERT INTO playing_area (organization_id, facility_id, sport_id, name)
  VALUES (v_org, v_fac2, 'tennis', 'Campo 1') RETURNING id INTO v_court;

  INSERT INTO class_group (organization_id, season_id, facility_id, name)
  VALUES (v_org, v_season, v_fac, 'T144 A'),        -- Mon 18:00–18:45
         (v_org, v_season, v_fac, 'T144 B'),        -- Mon 18:30–19:15, overlaps A
         (v_org, v_season, v_fac, 'T144 C'),        -- Tue 18:00, another day
         (v_org, v_season, v_fac, 'T144 D'),        -- Mon 18:45–19:30, touches A
         (v_org, v_season, v_fac, 'T144 E');        -- Mon 18:15, for the waiting case
  INSERT INTO class_group (organization_id, season_id, facility_id, name, playing_area_id)
  VALUES (v_org, v_season, v_fac2, 'T144 Ténis', v_court);  -- Mon 18:00, another sport and site
  INSERT INTO class_group (organization_id, season_id, facility_id, name)
  VALUES (v_other, v_oseason, v_ofac, 'T144 Vizinha');     -- Mon 18:00, another club

  INSERT INTO class_schedule (organization_id, facility_id, class_group_id, weekday, start_time, duration_minutes)
  SELECT g.organization_id, g.facility_id, g.id, s.weekday, s.start_time::time, s.minutes
    FROM class_group g
    JOIN (VALUES ('T144 A', 1, '18:00', 45), ('T144 B', 1, '18:30', 45), ('T144 C', 2, '18:00', 45),
                 ('T144 D', 1, '18:45', 45), ('T144 E', 1, '18:15', 30), ('T144 Ténis', 1, '18:00', 60),
                 ('T144 Vizinha', 1, '18:00', 45))
      AS s(name, weekday, start_time, minutes) ON s.name = g.name
   WHERE g.organization_id IN (v_org, v_other);

  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'Ana144', 'Sobreposta'), (v_org, 'Beto144', 'Espera');
  INSERT INTO student (organization_id, first_name, last_name) VALUES (v_other, 'Vera144', 'T144 Vizinha');

  -- Ana is in A, Mon 18:00–18:45.
  INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
  SELECT v_org, g.id, s.id, 'active' FROM class_group g, student s
   WHERE g.organization_id = v_org AND g.name = 'T144 A' AND s.first_name = 'Ana144';
END $$;

CREATE FUNCTION pg_temp.enrol(p_group text, p_student text, p_status text DEFAULT 'active')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_detail text;
BEGIN
  INSERT INTO enrollment (organization_id, class_group_id, student_id, status, waiting_position)
  SELECT g.organization_id, g.id, s.id, p_status::enrollment_status,
         CASE WHEN p_status = 'waiting' THEN 1 END
    FROM class_group g JOIN student s ON s.organization_id = g.organization_id
   WHERE g.name = p_group AND s.first_name = p_student;
  RETURN 'ok';
EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  RETURN v_detail;
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — an overlap on the same day is refused, naming A, Monday, 18:00 (QA 1)
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_answer text; v_a uuid;
BEGIN
  SELECT id INTO v_a FROM class_group WHERE name = 'T144 A' AND organization_id = '14400000-0000-4444-8888-000000000001';
  v_answer := pg_temp.enrol('T144 B', 'Ana144');
  IF v_answer <> format('enrollment_clash|%s|1|18:00', v_a) THEN
    RAISE EXCEPTION 'FAIL test 1: expected the clash with A, got %', v_answer;
  END IF;
  RAISE NOTICE 'PASS test 1: Mon 18:30 against Mon 18:00–18:45 is refused, naming A, 1, 18:00';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — another day, and touching windows, are not clashes (QA 2, 3)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF pg_temp.enrol('T144 C', 'Ana144') <> 'ok' THEN
    RAISE EXCEPTION 'FAIL test 2: Tuesday was refused';
  END IF;
  IF pg_temp.enrol('T144 D', 'Ana144') <> 'ok' THEN
    RAISE EXCEPTION 'FAIL test 2b: 18:45 after a lesson ending at 18:45 was refused';
  END IF;
  RAISE NOTICE 'PASS test 2: another day and back-to-back lessons are allowed';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — sport and site play no part (QA 4)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF pg_temp.enrol('T144 Ténis', 'Ana144') NOT LIKE 'enrollment_clash|%' THEN
    RAISE EXCEPTION 'FAIL test 3: tennis at the same hour, in another building, was accepted';
  END IF;
  RAISE NOTICE 'PASS test 3: a tennis turma at the same hour in another site is refused';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — waiting never clashes; becoming active does, and the row stays (QA 5)
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_ok boolean := false; v_status text;
BEGIN
  IF pg_temp.enrol('T144 E', 'Ana144', 'waiting') <> 'ok' THEN
    RAISE EXCEPTION 'FAIL test 4: a waiting enrolment was refused';
  END IF;

  BEGIN
    UPDATE enrollment SET status = 'active', waiting_position = NULL
     WHERE class_group_id = (SELECT id FROM class_group WHERE name = 'T144 E')
       AND student_id = (SELECT id FROM student WHERE first_name = 'Ana144');
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'FAIL test 4b: promoting a clashing waiting enrolment was allowed';
  END IF;

  SELECT status::text INTO v_status FROM enrollment
   WHERE class_group_id = (SELECT id FROM class_group WHERE name = 'T144 E')
     AND student_id = (SELECT id FROM student WHERE first_name = 'Ana144');
  IF v_status <> 'waiting' THEN
    RAISE EXCEPTION 'FAIL test 4c: the waiting place was lost (%)', v_status;
  END IF;
  RAISE NOTICE 'PASS test 4: waiting is allowed; the promotion is refused and the place is kept';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — existing clashes are kept; an unrelated edit does not trip on them
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_count integer;
BEGIN
  -- Beto was put in A and B before the rule existed.
  ALTER TABLE enrollment DISABLE TRIGGER enrollment_time_clash;
  INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
  SELECT g.organization_id, g.id, s.id, 'active' FROM class_group g JOIN student s ON s.organization_id = g.organization_id
   WHERE g.name IN ('T144 A', 'T144 B') AND s.first_name = 'Beto144';
  ALTER TABLE enrollment ENABLE TRIGGER enrollment_time_clash;

  -- An edit that is not about status passes.
  UPDATE enrollment SET joined_on = joined_on
   WHERE student_id = (SELECT id FROM student WHERE first_name = 'Beto144');

  SELECT count(DISTINCT e.student_id) INTO v_count
    FROM enrollment e
   WHERE e.organization_id = '14400000-0000-4444-8888-000000000001'
     AND e.status = 'active'
     AND EXISTS (SELECT 1 FROM enrollment_clashes(e.student_id, e.class_group_id));
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL test 5: expected 1 student with overlapping lessons, counted %', v_count;
  END IF;
  RAISE NOTICE 'PASS test 5: an existing clash is kept, counted once, and does not block other edits';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — another club's turma at the same hour is no clash (QA 9)
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_n integer;
BEGIN
  IF pg_temp.enrol('T144 Vizinha', 'Vera144') <> 'ok' THEN
    RAISE EXCEPTION 'FAIL test 6: the other club could not enrol its own student';
  END IF;
  -- Asked directly with a student of one club and a turma of the other: nothing.
  SELECT count(*) INTO v_n FROM enrollment_clashes(
    (SELECT id FROM student WHERE first_name = 'Ana144'),
    (SELECT id FROM class_group WHERE name = 'T144 Vizinha'));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6b: a clash was found across tenants';
  END IF;
  RAISE NOTICE 'PASS test 6: nothing crosses tenants';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — a series move is written, and the clash it creates is reported (QA 7)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- C's Tuesday slot is archived and a new Monday 18:00 one is written: a
  -- series move onto A's hour. The move is written (it is a class_schedule
  -- write, not an enrolment), and the function now reports Ana's clash.
  UPDATE class_schedule SET archived_at = now()
   WHERE class_group_id = (SELECT id FROM class_group WHERE name = 'T144 C');
  INSERT INTO class_schedule (organization_id, facility_id, class_group_id, weekday, start_time, duration_minutes)
  SELECT organization_id, facility_id, id, 1, '18:00', 45 FROM class_group WHERE name = 'T144 C';

  IF NOT EXISTS (SELECT 1 FROM enrollment_clashes(
       (SELECT id FROM student WHERE first_name = 'Ana144'),
       (SELECT id FROM class_group WHERE name = 'T144 C'))) THEN
    RAISE EXCEPTION 'FAIL test 7: a series move onto A''s hour reported no clash';
  END IF;
  RAISE NOTICE 'PASS test 7: a series move is written, and the clash it creates is reported, not refused';
END $$;

ROLLBACK;
