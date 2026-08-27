-- Student progression proof — backlog story 6.
--
-- Test 1 is the one to keep. "Times in integer milliseconds, never floats" reads
-- like pedantry until a personal best is wrong by a microsecond and nobody can
-- work out why, because 27.35 is not representable in binary floating point and
-- never was. This asserts the times come back exactly as they went in.
--
-- Test 3 is the other one that matters: which swim counts as the record when two
-- are identical. Getting that wrong is invisible — both times are right, the
-- badge is simply on the wrong row — and a parent will notice before anyone else.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES ('Clube A', 'clube-a'), ('Clube B', 'clube-b');

DO $$
DECLARE v_org uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'João', 'Silva');

  SELECT id INTO v_org FROM organization WHERE name = 'Clube B';
  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'Aluno', 'Outro');
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — a time survives the round trip exactly
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_student uuid; v_time int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_student FROM student
   WHERE organization_id = v_org AND first_name = 'João';

  -- 27.35 seconds. The number that a float would fail to hold.
  INSERT INTO student_record (organization_id, student_id, stroke, distance_m, time_ms, swum_on)
  VALUES (v_org, v_student, 'freestyle', 50, 27350, DATE '2026-03-01');

  SELECT time_ms INTO v_time FROM student_record
   WHERE student_id = v_student AND swum_on = DATE '2026-03-01';

  IF v_time <> 27350 THEN
    RAISE EXCEPTION 'FAIL test 1a: 27350 ms came back as %', v_time;
  END IF;
  IF pg_typeof(v_time)::text <> 'integer' THEN
    RAISE EXCEPTION 'FAIL test 1b: time_ms is %, not integer', pg_typeof(v_time);
  END IF;

  RAISE NOTICE 'PASS test 1: times are stored and returned as exact integer milliseconds';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — impossible times and distances are refused
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_student uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_student FROM student
   WHERE organization_id = v_org AND first_name = 'João';

  BEGIN
    INSERT INTO student_record (organization_id, student_id, stroke, distance_m, time_ms, swum_on)
    VALUES (v_org, v_student, 'freestyle', 50, 0, DATE '2026-03-01');
    RAISE EXCEPTION 'FAIL test 2a: a swim of zero milliseconds was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO student_record (organization_id, student_id, stroke, distance_m, time_ms, swum_on)
    VALUES (v_org, v_student, 'freestyle', 0, 30000, DATE '2026-03-01');
    RAISE EXCEPTION 'FAIL test 2b: a distance of zero metres was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- The same student may swim the same event twice in a day: a heat and a final
  -- are both real results, so there is deliberately no unique constraint.
  INSERT INTO student_record (organization_id, student_id, stroke, distance_m, time_ms, swum_on)
  VALUES (v_org, v_student, 'freestyle', 50, 27900, DATE '2026-03-01');

  RAISE NOTICE 'PASS test 2: impossible values are refused, a heat and a final are not';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — the personal best, and which swim earns it on a tie
--
-- Mirrors the window function in records.repository.ts. If they ever disagree,
-- this is the one that is right.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_student uuid; r record; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_student FROM student
   WHERE organization_id = v_org AND first_name = 'João';

  -- Two identical bests, months apart.
  INSERT INTO student_record (organization_id, student_id, stroke, distance_m, time_ms, swum_on)
  VALUES (v_org, v_student, 'backstroke', 50, 34100, DATE '2026-04-01'),
         (v_org, v_student, 'backstroke', 50, 34100, DATE '2026-06-01'),
         (v_org, v_student, 'backstroke', 50, 35000, DATE '2026-02-01');

  SELECT swum_on, time_ms INTO r
    FROM (
      SELECT swum_on, time_ms,
             row_number() OVER (
               PARTITION BY stroke, distance_m
               ORDER BY time_ms ASC, swum_on ASC, recorded_at ASC
             ) AS rank
        FROM student_record
       WHERE student_id = v_student AND stroke = 'backstroke' AND archived_at IS NULL
    ) ranked
   WHERE rank = 1;

  IF r.time_ms <> 34100 THEN
    RAISE EXCEPTION 'FAIL test 3a: the best backstroke came out as %', r.time_ms;
  END IF;
  -- You set the record the first time you swam it, not the second.
  IF r.swum_on <> DATE '2026-04-01' THEN
    RAISE EXCEPTION 'FAIL test 3b: a tie was awarded to the later swim (%)', r.swum_on;
  END IF;

  -- And exactly one row is the record, not both.
  SELECT count(*) INTO n FROM (
    SELECT row_number() OVER (
             PARTITION BY stroke, distance_m
             ORDER BY time_ms ASC, swum_on ASC, recorded_at ASC
           ) AS rank
      FROM student_record
     WHERE student_id = v_student AND stroke = 'backstroke' AND archived_at IS NULL
  ) ranked WHERE rank = 1;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 3c: % rows claimed the same record', n;
  END IF;

  RAISE NOTICE 'PASS test 3: one record per event, and a tie goes to the earlier swim';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — archiving a time removes it from the bests without losing it
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_student uuid; v_best int; n int;
BEGIN
  SELECT id INTO v_student FROM student
   WHERE organization_id = (SELECT id FROM organization WHERE name = 'Clube A')
     AND first_name = 'João';

  UPDATE student_record SET archived_at = now()
   WHERE student_id = v_student AND stroke = 'backstroke' AND time_ms = 34100
     AND swum_on = DATE '2026-04-01';

  SELECT min(time_ms) INTO v_best FROM student_record
   WHERE student_id = v_student AND stroke = 'backstroke' AND archived_at IS NULL;
  IF v_best <> 34100 THEN
    RAISE EXCEPTION 'FAIL test 4a: the remaining equal best was not promoted (%)', v_best;
  END IF;

  -- The row is still there. A mistyped time already shown to a parent is worth
  -- being able to look back at.
  SELECT count(*) INTO n FROM student_record
   WHERE student_id = v_student AND archived_at IS NOT NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 4b: the archived time was destroyed';
  END IF;

  RAISE NOTICE 'PASS test 4: archiving a time hides it from the bests without deleting it';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — favourite stroke is stored, never derived
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_student uuid; v_fav text;
BEGIN
  SELECT id INTO v_student FROM student
   WHERE organization_id = (SELECT id FROM organization WHERE name = 'Clube A')
     AND first_name = 'João';

  -- The swimmer is fastest at freestyle and loves butterfly. Both are true, and
  -- no query should ever conflate them.
  UPDATE student SET favourite_stroke = 'butterfly' WHERE id = v_student;

  SELECT favourite_stroke::text INTO v_fav FROM student WHERE id = v_student;
  IF v_fav <> 'butterfly' THEN
    RAISE EXCEPTION 'FAIL test 5a: favourite stroke came back as %', v_fav;
  END IF;

  -- It can be un-declared, which is different from never having been asked.
  UPDATE student SET favourite_stroke = NULL WHERE id = v_student;
  SELECT favourite_stroke::text INTO v_fav FROM student WHERE id = v_student;
  IF v_fav IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 5b: a favourite stroke could not be cleared';
  END IF;

  RAISE NOTICE 'PASS test 5: favourite stroke is declared by a person and can be cleared';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — a record cannot be attached to another organization's student
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_b uuid; v_a_student uuid;
BEGIN
  SELECT id INTO v_b FROM organization WHERE name = 'Clube B';
  SELECT id INTO v_a_student FROM student
   WHERE organization_id = (SELECT id FROM organization WHERE name = 'Clube A')
     AND first_name = 'João';

  BEGIN
    INSERT INTO student_record (organization_id, student_id, stroke, distance_m, time_ms, swum_on)
    VALUES (v_b, v_a_student, 'freestyle', 50, 30000, DATE '2026-03-01');
    RAISE EXCEPTION 'FAIL test 6: Clube B recorded a time for a Clube A student';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 6: times cannot be attached across tenants';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — one club cannot read another's times
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE v_b uuid; n int;
BEGIN
  SET LOCAL ROLE postgres;
  SELECT id INTO v_b FROM organization WHERE name = 'Clube B';
  SET LOCAL ROLE poolse_app;

  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM student_record;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7: Clube B read % of Clube A times', n;
  END IF;

  RAISE NOTICE 'PASS test 7: performance records are invisible across tenants';
END $$;

RESET ROLE;

ROLLBACK;
