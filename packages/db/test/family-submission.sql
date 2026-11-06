-- What a family sends — POOLSE-179 slice 2, part 2.
--
-- Test 1: the file's purpose follows the kind, an exam needs its date, a form
-- its season. Test 2: one pending per child and kind; the office's records are
-- untouched by a sending; a decision, once taken, stands. Test 3: a rejected
-- sealed file is shredded, a plain one is not touched. Test 4: anonymisation
-- shreds what was sent. Test 5: another club sees nothing and shreds nothing.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('bbbbbbbb-1791-4000-8000-000000000001', 'Clube Envio A', 'clube-envio-a'),
  ('bbbbbbbb-1791-4000-8000-000000000002', 'Clube Envio B', 'clube-envio-b');

CREATE TEMP TABLE t1791 (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT ON t1791 TO poolse_app;

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1791-4000-8000-000000000001';
  v_office uuid; v_parent uuid; v_student uuid; v_id uuid; v_exam uuid; v_form uuid; v_season uuid; ok boolean;
BEGIN
  INSERT INTO membership (organization_id, status, first_name, last_name)
  VALUES (v_org, 'active', 'Rita', 'Secretaria') RETURNING id INTO v_office;
  INSERT INTO membership (organization_id, status, first_name, last_name)
  VALUES (v_org, 'active', 'Paulo', 'Pai') RETURNING id INTO v_parent;
  INSERT INTO student (organization_id, first_name, last_name, birth_date)
  VALUES (v_org, 'Inês', 'Pai', DATE '2016-02-02') RETURNING id INTO v_student;
  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_org, '2026/27', DATE '2026-09-01', DATE '2027-07-31', 'published') RETURNING id INTO v_season;

  INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by, wrapped_key)
  VALUES (v_org, 'student_id_document', v_org || '/student_id_document/i.sealed', 'image/jpeg', 900, 'cc.jpg', v_parent, 'v1.a.b.c')
  RETURNING id INTO v_id;
  INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by, wrapped_key)
  VALUES (v_org, 'medical_certificate', v_org || '/medical_certificate/e.sealed', 'application/pdf', 900, 'exame.pdf', v_parent, 'v1.d.e.f')
  RETURNING id INTO v_exam;
  INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
  VALUES (v_org, 'student_document', v_org || '/student_document/f.pdf', 'application/pdf', 900, 'fpn.pdf', v_parent)
  RETURNING id INTO v_form;

  -- Test 1a: an ID photo on a plain file is refused.
  ok := false;
  BEGIN
    INSERT INTO family_submission (organization_id, student_id, kind, file_id, submitted_by)
    VALUES (v_org, v_student, 'id_document', v_form, v_parent);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1a: an ID photo was sent on a plain file'; END IF;

  -- Test 1b: an exam needs the date the family read; a declaration its season.
  ok := false;
  BEGIN
    INSERT INTO family_submission (organization_id, student_id, kind, file_id, submitted_by)
    VALUES (v_org, v_student, 'medical_exam', v_exam, v_parent);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1b: an exam was sent with no date'; END IF;
  ok := false;
  BEGIN
    INSERT INTO family_submission (organization_id, student_id, kind, file_id, submitted_by)
    VALUES (v_org, v_student, 'fpn_declaration_minor', v_form, v_parent);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1c: a declaration was sent with no season'; END IF;
  RAISE NOTICE 'PASS test 1: the file and the fields follow the kind';

  INSERT INTO t1791 VALUES ('office', v_office), ('parent', v_parent), ('student', v_student),
    ('id', v_id), ('exam', v_exam), ('form', v_form), ('season', v_season);
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 and 3, as the app
-- ---------------------------------------------------------------------------
SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'bbbbbbbb-1791-4000-8000-000000000001', true);

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1791-4000-8000-000000000001';
  v_office uuid := (SELECT id FROM t1791 WHERE name = 'office');
  v_parent uuid := (SELECT id FROM t1791 WHERE name = 'parent');
  v_student uuid := (SELECT id FROM t1791 WHERE name = 'student');
  v_id uuid := (SELECT id FROM t1791 WHERE name = 'id');
  v_exam uuid := (SELECT id FROM t1791 WHERE name = 'exam');
  v_form uuid := (SELECT id FROM t1791 WHERE name = 'form');
  v_season uuid := (SELECT id FROM t1791 WHERE name = 'season');
  v_sub uuid; v_form_sub uuid; ok boolean; n int;
BEGIN
  INSERT INTO family_submission (organization_id, student_id, kind, file_id, submitted_by)
  VALUES (v_org, v_student, 'id_document', v_id, v_parent) RETURNING id INTO v_sub;
  INSERT INTO family_submission (organization_id, student_id, kind, file_id, examined_on, submitted_by)
  VALUES (v_org, v_student, 'medical_exam', v_exam, DATE '2026-10-01', v_parent);
  INSERT INTO family_submission (organization_id, student_id, kind, season_id, file_id, submitted_by)
  VALUES (v_org, v_student, 'fpn_declaration_minor', v_season, v_form, v_parent) RETURNING id INTO v_form_sub;

  -- Test 2a: a second pending ID photo waits for the first.
  ok := false;
  BEGIN
    INSERT INTO family_submission (organization_id, student_id, kind, file_id, submitted_by)
    VALUES (v_org, v_student, 'id_document', v_id, v_parent);
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2a: two pending ID photos for one child'; END IF;

  -- Test 2b: nothing the office holds changed.
  SELECT count(*) INTO n FROM student_document WHERE student_id = v_student;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 2b: a sending filed a document'; END IF;
  SELECT count(*) INTO n FROM medical_exam WHERE student_id = v_student;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 2c: a sending recorded an exam'; END IF;

  -- Test 2d: the app cannot rewrite what was sent.
  ok := false;
  BEGIN
    UPDATE family_submission SET file_id = v_form WHERE id = v_sub;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2d: the app rewrote a sending'; END IF;

  -- Test 3: rejected — the sealed ID photo's key goes; the plain form is untouched.
  UPDATE family_submission SET decision = 'rejected', decided_by = v_office, decided_at = now() WHERE id = v_sub;
  UPDATE family_submission SET decision = 'rejected', decided_by = v_office, decided_at = now() WHERE id = v_form_sub;

  -- Test 2e: a decision stands.
  ok := false;
  BEGIN
    UPDATE family_submission SET decision = 'accepted' WHERE id = v_sub;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2e: a decision was changed'; END IF;
  RAISE NOTICE 'PASS test 2: one pending per kind, the record untouched, a decision stands';
END $$;

RESET ROLE;

DO $$
DECLARE
  v_id uuid := (SELECT id FROM t1791 WHERE name = 'id');
  v_form uuid := (SELECT id FROM t1791 WHERE name = 'form');
  v_exam uuid := (SELECT id FROM t1791 WHERE name = 'exam');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM stored_file WHERE id = v_id AND wrapped_key IS NULL AND key_shredded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL test 3a: a rejected ID photo kept its key';
  END IF;
  IF EXISTS (SELECT 1 FROM stored_file WHERE id = v_form AND (archived_at IS NOT NULL OR key_shredded_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'FAIL test 3b: a rejected plain form was touched';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stored_file WHERE id = v_exam AND wrapped_key IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL test 3c: a pending exam lost its key';
  END IF;
  RAISE NOTICE 'PASS test 3: rejecting shreds a sealed sending, and only that';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 (before 4): another club
-- ---------------------------------------------------------------------------
SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'bbbbbbbb-1791-4000-8000-000000000002', true);
SELECT family_submission_shred('bbbbbbbb-1791-4000-8000-000000000001', id) FROM family_submission;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM family_submission) THEN
    RAISE EXCEPTION 'FAIL test 5a: another club sees our sendings';
  END IF;
END $$;
RESET ROLE;
DO $$
DECLARE
  v_exam uuid := (SELECT id FROM t1791 WHERE name = 'exam');
  v_sub uuid := (SELECT id FROM family_submission WHERE file_id = (SELECT id FROM t1791 WHERE name = 'exam'));
BEGIN
  PERFORM set_config('app.organization_id', 'bbbbbbbb-1791-4000-8000-000000000002', true);
  PERFORM family_submission_shred('bbbbbbbb-1791-4000-8000-000000000001', v_sub);
  IF NOT EXISTS (SELECT 1 FROM stored_file WHERE id = v_exam AND wrapped_key IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL test 5b: another club shredded our exam';
  END IF;
  RAISE NOTICE 'PASS test 5: another club neither sees nor shreds them';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: anonymisation shreds what was sent
-- ---------------------------------------------------------------------------
SELECT set_config('app.organization_id', 'bbbbbbbb-1791-4000-8000-000000000001', true);
DO $$
DECLARE
  v_student uuid := (SELECT id FROM t1791 WHERE name = 'student');
  v_exam uuid := (SELECT id FROM t1791 WHERE name = 'exam');
BEGIN
  UPDATE student SET first_name = 'Aluno', last_name = 'anonimizado', anonymised_at = now() WHERE id = v_student;
  IF NOT EXISTS (SELECT 1 FROM stored_file WHERE id = v_exam AND wrapped_key IS NULL AND key_shredded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL test 4: an anonymised child''s pending exam kept its key';
  END IF;
  RAISE NOTICE 'PASS test 4: anonymisation shreds what a family sent';
END $$;

ROLLBACK;
