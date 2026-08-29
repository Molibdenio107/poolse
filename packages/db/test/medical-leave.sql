-- Medical leave — round 5.
--
-- Three things here are worth asserting rather than trusting.
--
-- The exclusion constraint. Two live leaves covering one week for one student is
-- a duplicate somebody made by editing the wrong row, and it makes "why is this
-- student excused" have two answers. An application check cannot survive two
-- people saving at once; this can.
--
-- Its boundary. A leave ending on the 14th and one starting on the 15th are
-- adjacent, not overlapping — which is what an operator means by "back on the
-- 15th". `+ 1` and a half-open range are what make that true, and getting it
-- wrong refuses a perfectly ordinary pair of records.
--
-- And that archiving frees the window: a leave entered against the wrong dates
-- must be replaceable, which a non-partial constraint would prevent.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_ml', 'ml@clube.pt', 'Rui', 'Fonseca', NULL, '2026-08-29 09:00:00+00');

INSERT INTO organization (id, name, slug) VALUES
  ('77777777-7777-7777-7777-777777777777', 'Clube Lesão', 'clube-lesao'),
  ('88888888-8888-8888-8888-888888888888', 'Clube Vizinho L', 'clube-vizinho-l');

DO $$
DECLARE v_org uuid; v_other uuid;
BEGIN
  v_org   := '77777777-7777-7777-7777-777777777777';
  v_other := '88888888-8888-8888-8888-888888888888';

  INSERT INTO student (organization_id, first_name, last_name, birth_date)
  VALUES (v_org, 'Mariana', 'Almeida', DATE '2016-04-02'),
         (v_org, 'Tiago', 'Freitas', DATE '2015-09-11');

  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_other, 'Aluno', 'Vizinho');
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — a leave is a range, and open-ended is a real answer
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_student uuid; n int;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_student FROM student WHERE organization_id = v_org AND first_name = 'Mariana';

  INSERT INTO student_medical_leave (organization_id, student_id, starts_on, ends_on, reason)
  VALUES (v_org, v_student, DATE '2026-09-01', DATE '2026-10-15', 'Lesão no ombro');

  SELECT count(*) INTO n
    FROM student_medical_leave WHERE student_id = v_student AND archived_at IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 1a: expected one leave, got %', n;
  END IF;

  -- Open-ended, on a different student: nobody knows the return date on the day
  -- of the injury, and forcing a guess puts a fact in the record that is not one.
  INSERT INTO student_medical_leave (organization_id, student_id, starts_on)
  SELECT v_org, id, DATE '2026-09-01'
    FROM student WHERE organization_id = v_org AND first_name = 'Tiago';

  -- Backwards is a typo.
  BEGIN
    INSERT INTO student_medical_leave (organization_id, student_id, starts_on, ends_on)
    VALUES (v_org, v_student, DATE '2027-03-10', DATE '2027-03-01');
    RAISE EXCEPTION 'FAIL test 1b: a leave ending before it starts was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 1: a leave is a dated range, and open-ended is allowed';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — two live leaves cannot overlap for one student
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_student uuid;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_student FROM student WHERE organization_id = v_org AND first_name = 'Mariana';

  BEGIN
    INSERT INTO student_medical_leave (organization_id, student_id, starts_on, ends_on)
    VALUES (v_org, v_student, DATE '2026-10-01', DATE '2026-11-30');
    RAISE EXCEPTION 'FAIL test 2a: an overlapping leave was accepted';
  EXCEPTION WHEN exclusion_violation THEN
    NULL;
  END;

  -- Entirely inside the first one is still an overlap.
  BEGIN
    INSERT INTO student_medical_leave (organization_id, student_id, starts_on, ends_on)
    VALUES (v_org, v_student, DATE '2026-09-10', DATE '2026-09-12');
    RAISE EXCEPTION 'FAIL test 2b: a leave nested inside another was accepted';
  EXCEPTION WHEN exclusion_violation THEN
    NULL;
  END;

  -- An open-ended leave swallows everything after it starts.
  BEGIN
    INSERT INTO student_medical_leave (organization_id, student_id, starts_on)
    VALUES (v_org, v_student, DATE '2026-10-10');
    RAISE EXCEPTION 'FAIL test 2c: a leave overlapping an open-ended one was accepted';
  EXCEPTION WHEN exclusion_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 2: one live leave per student per day';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — adjacent is not overlapping
--
-- The half-open range and the `+ 1`. "Back on the 15th" is the ordinary way a
-- club records a return, and a constraint that refused it would be unusable.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_student uuid; n int;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_student FROM student WHERE organization_id = v_org AND first_name = 'Mariana';

  INSERT INTO student_medical_leave (organization_id, student_id, starts_on, ends_on, reason)
  VALUES (v_org, v_student, DATE '2026-10-16', DATE '2026-10-31', 'Recuperação');

  SELECT count(*) INTO n
    FROM student_medical_leave WHERE student_id = v_student AND archived_at IS NULL;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 3: two adjacent leaves should coexist, got %', n;
  END IF;

  RAISE NOTICE 'PASS test 3: a leave starting the day after another ends is not an overlap';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — archiving frees the window
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_student uuid; n int;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_student FROM student WHERE organization_id = v_org AND first_name = 'Mariana';

  UPDATE student_medical_leave SET archived_at = now()
   WHERE student_id = v_student AND starts_on = DATE '2026-09-01';

  -- The same dates again, now that the first is archived.
  INSERT INTO student_medical_leave (organization_id, student_id, starts_on, ends_on)
  VALUES (v_org, v_student, DATE '2026-09-01', DATE '2026-10-15');

  -- History is soft-deleted, never destroyed.
  SELECT count(*) INTO n FROM student_medical_leave WHERE student_id = v_student;
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL test 4: expected the archived leave to survive, got % rows', n;
  END IF;

  RAISE NOTICE 'PASS test 4: an archived leave does not hold its dates hostage';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — a leave cannot be attached to another tenant's student
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_their_student uuid;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_their_student
    FROM student WHERE organization_id = '88888888-8888-8888-8888-888888888888';

  BEGIN
    INSERT INTO student_medical_leave (organization_id, student_id, starts_on)
    VALUES (v_org, v_their_student, DATE '2026-09-01');
    RAISE EXCEPTION 'FAIL test 5: our leave was attached to the neighbour''s student';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 5: the composite key refuses a cross-tenant student';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — medical leave is the tenant's own
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_a uuid := '77777777-7777-7777-7777-777777777777';
  v_b uuid := '88888888-8888-8888-8888-888888888888';
  n int;
BEGIN
  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM student_medical_leave WHERE organization_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6a: the neighbouring club could read % of our leaves', n;
  END IF;

  PERFORM set_config('app.organization_id', v_a::text, true);

  SELECT count(*) INTO n
    FROM student_medical_leave WHERE organization_id = v_a AND archived_at IS NULL;
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL test 6b: our own leaves were not visible to us';
  END IF;

  RAISE NOTICE 'PASS test 6: medical leave is visible only to its own tenant';
END $$;

RESET ROLE;

ROLLBACK;
