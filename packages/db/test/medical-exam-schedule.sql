-- A scheduled medical exam — POOLSE-192.
--
-- Test 1: one open per student, and a closed or cancelled one frees the place.
-- Test 2: a deadline has no hour, and blank words are refused.
-- Test 3: another club reads nothing and writes nothing, and a composite key
-- refuses a row that points across clubs. Test 4: the app login may not change
-- what was scheduled.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('bbbbbbbb-1920-4000-8000-000000000001', 'Clube Agenda A', 'clube-agenda-a'),
  ('bbbbbbbb-1920-4000-8000-000000000002', 'Clube Agenda B', 'clube-agenda-b');

CREATE TEMP TABLE t1920 (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT ON t1920 TO poolse_app;

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1920-4000-8000-000000000001';
  v_student uuid; v_first uuid; ok boolean;
BEGIN
  INSERT INTO student (organization_id, first_name, last_name, birth_date)
  VALUES (v_org, 'Inês', 'Silva', DATE '2016-02-02') RETURNING id INTO v_student;
  INSERT INTO t1920 VALUES ('student', v_student);

  INSERT INTO medical_exam_schedule (organization_id, student_id, kind, due_on)
  VALUES (v_org, v_student, 'deadline', DATE '2099-01-01') RETURNING id INTO v_first;
  INSERT INTO t1920 VALUES ('schedule', v_first);

  -- Test 1a: a second open one is refused.
  ok := false;
  BEGIN
    INSERT INTO medical_exam_schedule (organization_id, student_id, kind, due_on)
    VALUES (v_org, v_student, 'appointment', DATE '2099-01-02');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1a: a student has two open schedules'; END IF;

  -- Test 1b: a cancelled one frees the place.
  UPDATE medical_exam_schedule SET archived_at = now() WHERE id = v_first;
  INSERT INTO medical_exam_schedule (organization_id, student_id, kind, due_on)
  VALUES (v_org, v_student, 'appointment', DATE '2099-01-02');
  RAISE NOTICE 'PASS test 1: one open per student';

  -- Test 2a: a deadline has a day and no hour.
  ok := false;
  BEGIN
    INSERT INTO medical_exam_schedule (organization_id, student_id, kind, due_on, due_time, archived_at)
    VALUES (v_org, v_student, 'deadline', DATE '2099-01-03', TIME '10:00', now());
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2a: a deadline took an hour'; END IF;

  -- Test 2b: blank words are no words.
  ok := false;
  BEGIN
    INSERT INTO medical_exam_schedule (organization_id, student_id, kind, due_on, place, archived_at)
    VALUES (v_org, v_student, 'deadline', DATE '2099-01-03', '   ', now());
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2b: a blank place was stored'; END IF;
  RAISE NOTICE 'PASS test 2: the row keeps its shape';

  -- Test 3a: a row in club B pointing at club A's student.
  ok := false;
  BEGIN
    INSERT INTO medical_exam_schedule (organization_id, student_id, kind, due_on)
    VALUES ('bbbbbbbb-1920-4000-8000-000000000002', v_student, 'deadline', DATE '2099-01-01');
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3a: a schedule pointed across clubs'; END IF;
END $$;

SET LOCAL ROLE poolse_app;

SELECT set_config('app.organization_id', 'bbbbbbbb-1920-4000-8000-000000000002', true);
DO $$
DECLARE ok boolean;
BEGIN
  -- Test 3b: club B reads nothing of club A's.
  IF EXISTS (SELECT 1 FROM medical_exam_schedule) THEN
    RAISE EXCEPTION 'FAIL test 3b: club B read club A''s schedule';
  END IF;

  -- Test 3c: nor can it write one in club A's name.
  ok := false;
  BEGIN
    INSERT INTO medical_exam_schedule (organization_id, student_id, kind, due_on)
    VALUES ('bbbbbbbb-1920-4000-8000-000000000001', (SELECT id FROM t1920 WHERE name = 'student'),
            'deadline', DATE '2099-01-01');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3c: club B wrote into club A'; END IF;
  RAISE NOTICE 'PASS test 3: another club reads and writes nothing';
END $$;

SELECT set_config('app.organization_id', 'bbbbbbbb-1920-4000-8000-000000000001', true);
DO $$
DECLARE ok boolean;
BEGIN
  -- Test 4: a date is never edited, so a reminder sent cannot change its meaning.
  ok := false;
  BEGIN
    UPDATE medical_exam_schedule SET due_on = DATE '2099-06-01';
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4: the app login moved a scheduled date'; END IF;
  RAISE NOTICE 'PASS test 4: a schedule is cancelled, never edited';
END $$;

ROLLBACK;
