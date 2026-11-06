-- A declared date of birth — POOLSE-186.
--
-- Test 1: linking a login fills a blank date, as declared, and never overwrites
-- the club's. Test 2: a live guardian keeps the record the club's. Test 3: a
-- declared date lets the person answer and does not open the adult path; the
-- office confirming it does. Test 4: the office changing the date clears the
-- state. Test 5: a login joining the person, and a profile saved through the app
-- login, each fill it.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('cccccccc-1860-4000-8000-000000000001', 'Clube Data', 'clube-data');

INSERT INTO app_user (id, clerk_user_id, birth_date) VALUES
  ('cccccccc-1860-4000-8000-0000000000a1', 'user_186_adult', '1990-09-05'),
  ('cccccccc-1860-4000-8000-0000000000a2', 'user_186_joins', '1985-01-02'),
  ('cccccccc-1860-4000-8000-0000000000a3', 'user_186_later', NULL);

INSERT INTO membership (id, organization_id, app_user_id, status, first_name, last_name) VALUES
  ('cccccccc-1860-4000-8000-0000000000b1', 'cccccccc-1860-4000-8000-000000000001', 'cccccccc-1860-4000-8000-0000000000a1', 'active', NULL, NULL),
  ('cccccccc-1860-4000-8000-0000000000b3', 'cccccccc-1860-4000-8000-000000000001', 'cccccccc-1860-4000-8000-0000000000a3', 'active', NULL, NULL),
  ('cccccccc-1860-4000-8000-0000000000b4', 'cccccccc-1860-4000-8000-000000000001', NULL, 'active', 'Mãe', 'Data'),
  ('cccccccc-1860-4000-8000-0000000000b5', 'cccccccc-1860-4000-8000-000000000001', NULL, 'active', 'Junta', 'Depois'),
  ('cccccccc-1860-4000-8000-0000000000b6', 'cccccccc-1860-4000-8000-000000000001', NULL, 'active', 'Outro', 'Data');

INSERT INTO student (id, organization_id, first_name, last_name, birth_date) VALUES
  ('cccccccc-1860-4000-8000-0000000000c1', 'cccccccc-1860-4000-8000-000000000001', 'Blank', 'Adult', NULL),
  ('cccccccc-1860-4000-8000-0000000000c2', 'cccccccc-1860-4000-8000-000000000001', 'Dated', 'Club', '2001-03-04'),
  ('cccccccc-1860-4000-8000-0000000000c3', 'cccccccc-1860-4000-8000-000000000001', 'Has', 'Guardian', NULL),
  ('cccccccc-1860-4000-8000-0000000000c4', 'cccccccc-1860-4000-8000-000000000001', 'Joins', 'Later', NULL),
  ('cccccccc-1860-4000-8000-0000000000c5', 'cccccccc-1860-4000-8000-000000000001', 'Saves', 'Profile', NULL);

DO $$
DECLARE
  v_org   uuid := 'cccccccc-1860-4000-8000-000000000001';
  v_blank uuid := 'cccccccc-1860-4000-8000-0000000000c1';
  v_row   student%ROWTYPE;
BEGIN
  -- Test 1.
  UPDATE student SET membership_id = 'cccccccc-1860-4000-8000-0000000000b1' WHERE id = v_blank;
  SELECT * INTO v_row FROM student WHERE id = v_blank;
  IF v_row.birth_date IS DISTINCT FROM '1990-09-05'::date OR v_row.birth_date_declared_at IS NULL THEN
    RAISE EXCEPTION 'test 1: a blank date did not take the login''s';
  END IF;
  UPDATE student SET membership_id = 'cccccccc-1860-4000-8000-0000000000b6'
   WHERE id = 'cccccccc-1860-4000-8000-0000000000c2';
  SELECT * INTO v_row FROM student WHERE id = 'cccccccc-1860-4000-8000-0000000000c2';
  IF v_row.birth_date <> '2001-03-04'::date OR v_row.birth_date_declared_at IS NOT NULL THEN
    RAISE EXCEPTION 'test 1: the club''s date was touched';
  END IF;
  RAISE NOTICE 'test 1: a blank date fills, as declared, and the club''s stands';

  -- Test 2.
  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
  VALUES (v_org, 'cccccccc-1860-4000-8000-0000000000c3', 'cccccccc-1860-4000-8000-0000000000b4', 'mother', true);
  UPDATE student SET membership_id = 'cccccccc-1860-4000-8000-0000000000b3'
   WHERE id = 'cccccccc-1860-4000-8000-0000000000c3';
  UPDATE app_user SET birth_date = '1999-09-09' WHERE id = 'cccccccc-1860-4000-8000-0000000000a3';
  SELECT * INTO v_row FROM student WHERE id = 'cccccccc-1860-4000-8000-0000000000c3';
  IF v_row.birth_date IS NOT NULL THEN
    RAISE EXCEPTION 'test 2: a student with a guardian took a typed date';
  END IF;
  UPDATE app_user SET birth_date = NULL WHERE id = 'cccccccc-1860-4000-8000-0000000000a3';
  RAISE NOTICE 'test 2: a live guardian keeps the record the club''s';

  -- Test 3.
  IF NOT family_may_answer(v_org, v_blank, 'cccccccc-1860-4000-8000-0000000000b1') THEN
    RAISE EXCEPTION 'test 3: a declared date did not let the person answer';
  END IF;
  IF student_is_adult_path(v_org, v_blank) THEN
    RAISE EXCEPTION 'test 3: a declared date opened the adult path';
  END IF;
  IF (SELECT first_name FROM student_person WHERE id = v_blank) IS NULL THEN
    RAISE EXCEPTION 'test 3: the view lost the student';
  END IF;
  UPDATE student
     SET birth_date_declared_at = NULL, birth_date_verified_at = now(),
         birth_date_verified_by = 'cccccccc-1860-4000-8000-0000000000b4'
   WHERE id = v_blank;
  IF NOT student_is_adult_path(v_org, v_blank) THEN
    RAISE EXCEPTION 'test 3: a confirmed date did not open the adult path';
  END IF;
  RAISE NOTICE 'test 3: declared answers, and only confirmed is the adult path';

  -- Test 4.
  UPDATE student SET birth_date = '1990-09-06' WHERE id = v_blank;
  SELECT * INTO v_row FROM student WHERE id = v_blank;
  IF v_row.birth_date_verified_at IS NOT NULL OR v_row.birth_date_verified_by IS NOT NULL THEN
    RAISE EXCEPTION 'test 4: a confirmation outlived its date';
  END IF;
  RAISE NOTICE 'test 4: changing the date clears the confirmation';
END $$;

-- Test 5: a login joining the person, then a profile saved as the app.
UPDATE student SET membership_id = 'cccccccc-1860-4000-8000-0000000000b5'
 WHERE id = 'cccccccc-1860-4000-8000-0000000000c4';
UPDATE membership SET app_user_id = 'cccccccc-1860-4000-8000-0000000000a2', first_name = NULL, last_name = NULL
 WHERE id = 'cccccccc-1860-4000-8000-0000000000b5';

UPDATE student SET membership_id = 'cccccccc-1860-4000-8000-0000000000b3'
 WHERE id = 'cccccccc-1860-4000-8000-0000000000c5';

SET LOCAL ROLE poolse_app;
SELECT count(*) FROM set_app_user_profile('user_186_later', 'pt-PT', 'system', '1991-02-03', NULL);
RESET ROLE;

DO $$
BEGIN
  IF (SELECT birth_date FROM student WHERE id = 'cccccccc-1860-4000-8000-0000000000c4') IS DISTINCT FROM '1985-01-02'::date THEN
    RAISE EXCEPTION 'test 5: a login joining the person did not fill the date';
  END IF;
  IF (SELECT birth_date FROM student WHERE id = 'cccccccc-1860-4000-8000-0000000000c5') IS DISTINCT FROM '1991-02-03'::date THEN
    RAISE EXCEPTION 'test 5: a saved profile did not fill the date';
  END IF;
  RAISE NOTICE 'test 5: joining and saving a profile each fill it';
END $$;

ROLLBACK;
