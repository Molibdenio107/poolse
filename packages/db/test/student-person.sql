-- A student read through their login — POOLSE-177.
--
-- Test 1 is the guard on the view's shape: reads swap `FROM student s` for
-- `FROM student_person s`, so a new `student` column missing from the view would
-- otherwise surface as a runtime 42703 on whichever screen asked for it first.
--
-- Tests 3 and 4 are the two ways this could go wrong quietly: a child's account
-- deciding the name on the club's record, and a login bringing back a name
-- retention erased.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES ('Clube Leitura', 'clube-leitura'),
                                             ('Clube Vizinho', 'clube-vizinho');

SELECT provision_app_user('user_adult', 'ines@app.pt', 'Inês', 'Da App', NULL,
                          '2026-08-26 09:00:00+00');
SELECT provision_app_user('user_minor', 'tomas@app.pt', 'Tomás', 'Da App', NULL,
                          '2026-08-26 09:00:00+00');
SELECT provision_app_user('user_guardian', 'mae@app.pt', 'Marta', 'Da App', NULL,
                          '2026-08-26 09:00:00+00');

UPDATE app_user SET contact_phone = '911111111', birth_date = DATE '1990-01-02'
 WHERE clerk_user_id = 'user_adult';
UPDATE app_user SET contact_phone = '922222222', birth_date = DATE '2014-01-02'
 WHERE clerk_user_id = 'user_minor';
UPDATE app_user SET contact_phone = '933333333'
 WHERE clerk_user_id = 'user_guardian';

-- ---------------------------------------------------------------------------
-- Test 1: the view carries every column of student, under the same name
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(c.column_name, ', ') INTO v_missing
    FROM information_schema.columns c
   WHERE c.table_name = 'student' AND c.table_schema = 'public'
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns v
        WHERE v.table_name = 'student_person' AND v.table_schema = 'public'
          AND v.column_name = c.column_name
     );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 1: student_person lacks %', v_missing;
  END IF;
  RAISE NOTICE 'PASS test 1: student_person carries every student column';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: an adult with a login reads through, and the record stays beneath
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_m uuid; v_s uuid; r record;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-leitura';
  INSERT INTO membership (organization_id, status, app_user_id)
  SELECT v_org, 'active', id FROM app_user WHERE clerk_user_id = 'user_adult'
  RETURNING id INTO v_m;
  INSERT INTO student (organization_id, first_name, last_name, birth_date,
                       contact_phone, contact_email, membership_id)
  VALUES (v_org, 'Ines', 'Do Clube', DATE '1991-05-05', '900000000', 'ines@clube.pt', v_m)
  RETURNING id INTO v_s;

  SELECT * INTO r FROM student_person WHERE id = v_s;
  IF r.first_name <> 'Inês' OR r.last_name <> 'Da App' OR r.contact_phone <> '911111111'
     OR r.contact_email <> 'ines@app.pt' OR r.birth_date <> DATE '1990-01-02'
     OR NOT r.identity_from_login THEN
    RAISE EXCEPTION 'FAIL test 2: did not read through: %', r;
  END IF;

  IF (SELECT first_name FROM student WHERE id = v_s) <> 'Ines' THEN
    RAISE EXCEPTION 'FAIL test 2: the club''s record moved';
  END IF;
  RAISE NOTICE 'PASS test 2: an adult with a login reads through';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: a minor with a login keeps the club's record, and so does a student
-- with no login, and an adult with a guardian link
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_m uuid; v_g uuid; v_minor uuid; v_plain uuid; v_guarded uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-leitura';

  INSERT INTO membership (organization_id, status, app_user_id)
  SELECT v_org, 'active', id FROM app_user WHERE clerk_user_id = 'user_minor'
  RETURNING id INTO v_m;
  INSERT INTO student (organization_id, first_name, last_name, birth_date, contact_phone, membership_id)
  VALUES (v_org, 'Tomas', 'Do Clube', club_today() - interval '13 years', '900000001', v_m)
  RETURNING id INTO v_minor;
  IF (SELECT first_name FROM student_person WHERE id = v_minor) <> 'Tomas'
     OR (SELECT contact_phone FROM student_person WHERE id = v_minor) <> '900000001' THEN
    RAISE EXCEPTION 'FAIL test 3: a minor read through their account';
  END IF;

  INSERT INTO student (organization_id, first_name, last_name, birth_date)
  VALUES (v_org, 'Sem', 'Login', DATE '1980-01-01') RETURNING id INTO v_plain;
  IF (SELECT first_name FROM student_person WHERE id = v_plain) <> 'Sem'
     OR (SELECT identity_from_login FROM student_person WHERE id = v_plain) THEN
    RAISE EXCEPTION 'FAIL test 3: no login, yet something changed';
  END IF;

  INSERT INTO membership (organization_id, status, first_name, last_name)
  VALUES (v_org, 'active', 'Tutora', 'Legal') RETURNING id INTO v_g;
  INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
  VALUES (v_org, 'Adulta', 'Tutelada', DATE '1985-01-01', v_m) RETURNING id INTO v_guarded;
  -- An adult's guardian is an acompanhante (POOLSE-206); a parental link would not count.
  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, kind)
  VALUES (v_org, v_guarded, v_g, 'tutor', 'accompanying');
  IF (SELECT identity_from_login FROM student_person WHERE id = v_guarded) THEN
    RAISE EXCEPTION 'FAIL test 3: a student with a guardian read through';
  END IF;

  RAISE NOTICE 'PASS test 3: only the adult path reads through';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3b: no birth date on the club's record. Rui's own account, 05-11-2026.
-- The login's date decides the display, and never the adult path.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_m uuid; v_s uuid; v_g uuid; r record;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-leitura';
  PERFORM provision_app_user('user_blank', 'blank@app.pt', 'Carla', 'Da App', NULL, '2026-08-26 09:00:00+00');
  UPDATE app_user SET contact_phone = '955555555', birth_date = DATE '1990-09-05'
   WHERE clerk_user_id = 'user_blank';
  INSERT INTO membership (organization_id, status, app_user_id)
  SELECT v_org, 'active', id FROM app_user WHERE clerk_user_id = 'user_blank'
  RETURNING id INTO v_m;
  INSERT INTO student (organization_id, first_name, last_name, membership_id)
  VALUES (v_org, 'Carla', 'Do Clube', v_m) RETURNING id INTO v_s;

  SELECT * INTO r FROM student_person WHERE id = v_s;
  IF NOT r.identity_from_login OR r.birth_date <> DATE '1990-09-05' OR r.contact_phone <> '955555555' THEN
    RAISE EXCEPTION 'FAIL test 3b: a blank date kept an adult from reading through: %', r;
  END IF;
  IF student_is_adult_path(v_org, v_s) THEN
    RAISE EXCEPTION 'FAIL test 3b: a date a person typed decided the adult path';
  END IF;

  -- A guardian on the record: the club's record, whatever the account says.
  INSERT INTO membership (organization_id, status, first_name, last_name)
  VALUES (v_org, 'active', 'Mae', 'Doutra') RETURNING id INTO v_g;
  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship)
  VALUES (v_org, v_s, v_g, 'tutor');
  IF (SELECT identity_from_login FROM student_person WHERE id = v_s) THEN
    RAISE EXCEPTION 'FAIL test 3b: a student with a guardian read through';
  END IF;
  UPDATE guardian_link SET archived_at = now() WHERE student_id = v_s;

  -- An account that says child, and one that says nothing.
  UPDATE app_user SET birth_date = club_today() - interval '13 years' WHERE clerk_user_id = 'user_blank';
  IF (SELECT identity_from_login FROM student_person WHERE id = v_s) THEN
    RAISE EXCEPTION 'FAIL test 3b: a minor by their account read through';
  END IF;
  UPDATE app_user SET birth_date = NULL WHERE clerk_user_id = 'user_blank';
  IF (SELECT identity_from_login FROM student_person WHERE id = v_s) THEN
    RAISE EXCEPTION 'FAIL test 3b: an unknown age read through';
  END IF;

  -- A minor the office has dated stays one, whatever their account claims.
  UPDATE app_user SET birth_date = DATE '1990-09-05' WHERE clerk_user_id = 'user_blank';
  UPDATE student SET birth_date = club_today() - interval '13 years' WHERE id = v_s;
  IF (SELECT identity_from_login FROM student_person WHERE id = v_s) THEN
    RAISE EXCEPTION 'FAIL test 3b: an account overruled the club''s date';
  END IF;

  RAISE NOTICE 'PASS test 3b: a blank date reads through only for an adult by their own account';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: an anonymised student never reads through
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_s uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-leitura';
  SELECT id INTO v_s FROM student WHERE organization_id = v_org AND first_name = 'Ines';

  UPDATE student SET first_name = 'Anonimizado', last_name = '-', anonymised_at = now()
   WHERE id = v_s;

  IF (SELECT first_name FROM student_person WHERE id = v_s) <> 'Anonimizado' THEN
    RAISE EXCEPTION 'FAIL test 4: a login brought an erased name back';
  END IF;

  UPDATE student SET first_name = 'Ines', last_name = 'Do Clube', anonymised_at = NULL
   WHERE id = v_s;
  RAISE NOTICE 'PASS test 4: an anonymised student stays anonymised';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: person_phone is the login's own, else the club's record
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_login uuid; v_plain uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-leitura';
  INSERT INTO membership (organization_id, status, app_user_id)
  SELECT v_org, 'active', id FROM app_user WHERE clerk_user_id = 'user_guardian'
  RETURNING id INTO v_login;
  INSERT INTO membership (organization_id, status, first_name, last_name, phone)
  VALUES (v_org, 'active', 'Sem', 'Conta', '944444444') RETURNING id INTO v_plain;

  IF person_phone(v_login) <> '933333333' OR person_phone(v_plain) <> '944444444' THEN
    RAISE EXCEPTION 'FAIL test 5: person_phone answered % and %',
      person_phone(v_login), person_phone(v_plain);
  END IF;
  RAISE NOTICE 'PASS test 5: person_phone resolves both kinds of person';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: cross-tenant (QA 7). A student cannot reach another club's person,
-- so no club reads through to a login it has no membership for.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_other uuid; v_theirs uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-leitura';
  SELECT id INTO v_other FROM organization WHERE slug = 'clube-vizinho';
  INSERT INTO membership (organization_id, status, first_name, last_name)
  VALUES (v_other, 'active', 'Doutro', 'Clube') RETURNING id INTO v_theirs;

  BEGIN
    INSERT INTO student (organization_id, first_name, last_name, membership_id)
    VALUES (v_org, 'Atravessa', 'Clubes', v_theirs);
    RAISE EXCEPTION 'FAIL test 6: a student reached another club''s person';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS test 6: the composite key refuses another club''s person';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7: RLS applies through the view, as the app's own login
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-vizinho';
  PERFORM set_config('app.organization_id', v_org::text, true);
END $$;

SET LOCAL ROLE poolse_app;

DO $$
BEGIN
  IF (SELECT count(*) FROM student_person) <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7: another club''s students came through the view';
  END IF;
  RAISE NOTICE 'PASS test 7: the view returns nothing across tenants';
END $$;

RESET ROLE;

ROLLBACK;
