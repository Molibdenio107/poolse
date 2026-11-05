-- A student's ID document photograph, sealed at rest — POOLSE-179 slice 2.
--
-- Test 1: a student_id_document file without a key is refused, and an ID
-- photograph cannot be filed on a plain file (nor a sealed one as another
-- kind). Test 2: a newer copy shreds the one it replaces. Test 3: retention's
-- anonymisation shreds every ID photograph the student had. Test 4: another
-- club cannot shred ours.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('bbbbbbbb-1790-4000-8000-000000000001', 'Clube Cartão A', 'clube-cartao-a'),
  ('bbbbbbbb-1790-4000-8000-000000000002', 'Clube Cartão B', 'clube-cartao-b');

CREATE TEMP TABLE t179 (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT ON t179 TO poolse_app;

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1790-4000-8000-000000000001';
  v_member uuid; v_student uuid; v_plain uuid; v_old uuid; v_new uuid; ok boolean;
BEGIN
  INSERT INTO membership (organization_id, app_user_id, status, first_name, last_name)
  VALUES (v_org, NULL, 'active', 'Rita', 'Secretaria') RETURNING id INTO v_member;
  INSERT INTO student (organization_id, first_name, last_name, birth_date)
  VALUES (v_org, 'Mariana', 'Almeida', DATE '2016-04-02') RETURNING id INTO v_student;

  -- Test 1a: no key, no file.
  ok := false;
  BEGIN
    INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
    VALUES (v_org, 'student_id_document', v_org || '/student_id_document/x.sealed', 'image/jpeg', 900, 'CC.jpg', v_member);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1a: a child''s ID photo was stored with no key'; END IF;

  -- Test 1b: an ID photograph on a plain file is refused.
  INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
  VALUES (v_org, 'student_document', v_org || '/student_document/p.jpg', 'image/jpeg', 900, 'CC.jpg', v_member)
  RETURNING id INTO v_plain;
  ok := false;
  BEGIN
    INSERT INTO student_document (organization_id, student_id, kind, file_id, filed_by)
    VALUES (v_org, v_student, 'id_document', v_plain, v_member);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1b: an ID photo was filed on a plain file'; END IF;

  INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by, wrapped_key)
  VALUES (v_org, 'student_id_document', v_org || '/student_id_document/o.sealed', 'image/jpeg', 900, 'CC.jpg', v_member, 'v1.aa.bb.cc')
  RETURNING id INTO v_old;
  INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by, wrapped_key)
  VALUES (v_org, 'student_id_document', v_org || '/student_id_document/n.sealed', 'image/jpeg', 900, 'CC2.jpg', v_member, 'v1.dd.ee.ff')
  RETURNING id INTO v_new;

  -- Test 1c: a sealed ID photo filed as another kind is refused.
  ok := false;
  BEGIN
    INSERT INTO student_document (organization_id, student_id, kind, file_id, filed_by)
    VALUES (v_org, v_student, 'socio_form', v_old, v_member);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1c: a sealed ID photo was filed as a boletim'; END IF;

  INSERT INTO student_document (organization_id, student_id, kind, file_id, filed_by)
  VALUES (v_org, v_student, 'id_document', v_old, v_member);
  RAISE NOTICE 'PASS test 1: an ID photograph is sealed or refused';

  INSERT INTO t179 VALUES ('member', v_member), ('student', v_student), ('old', v_old), ('new', v_new);
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: as the app, a newer copy shreds the one it replaces
-- ---------------------------------------------------------------------------
SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'bbbbbbbb-1790-4000-8000-000000000001', true);

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1790-4000-8000-000000000001';
  v_member uuid := (SELECT id FROM t179 WHERE name = 'member');
  v_student uuid := (SELECT id FROM t179 WHERE name = 'student');
  v_old uuid := (SELECT id FROM t179 WHERE name = 'old');
  v_new uuid := (SELECT id FROM t179 WHERE name = 'new');
  n int;
BEGIN
  UPDATE student_document SET replaced_at = now(), replaced_by = v_member
   WHERE student_id = v_student AND kind = 'id_document' AND replaced_at IS NULL;
  INSERT INTO student_document (organization_id, student_id, kind, file_id, filed_by)
  VALUES (v_org, v_student, 'id_document', v_new, v_member);
END $$;

RESET ROLE;

DO $$
DECLARE
  v_old uuid := (SELECT id FROM t179 WHERE name = 'old');
  v_new uuid := (SELECT id FROM t179 WHERE name = 'new');
  n int;
BEGIN
  SELECT count(*) INTO n FROM stored_file WHERE id = v_old AND wrapped_key IS NULL AND key_shredded_at IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL test 2a: a replaced ID photo kept its key'; END IF;
  SELECT count(*) INTO n FROM stored_file WHERE id = v_new AND wrapped_key IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL test 2b: the current ID photo lost its key'; END IF;
  RAISE NOTICE 'PASS test 2: a replaced ID photograph is shredded';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 (before 3, while the key is still there): another club cannot shred ours
-- ---------------------------------------------------------------------------
SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'bbbbbbbb-1790-4000-8000-000000000002', true);
SELECT student_id_document_shred('bbbbbbbb-1790-4000-8000-000000000001', (SELECT id FROM t179 WHERE name = 'new'));
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM student_document) THEN
    RAISE EXCEPTION 'FAIL test 4a: another club sees our ID documents';
  END IF;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM stored_file WHERE id = (SELECT id FROM t179 WHERE name = 'new') AND wrapped_key IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL test 4b: another club shredded our ID photo';
  END IF;
  RAISE NOTICE 'PASS test 4: another club neither sees nor shreds them';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: anonymisation shreds every ID photograph
-- ---------------------------------------------------------------------------
SELECT set_config('app.organization_id', 'bbbbbbbb-1790-4000-8000-000000000001', true);
DO $$
DECLARE
  v_student uuid := (SELECT id FROM t179 WHERE name = 'student');
  v_new uuid := (SELECT id FROM t179 WHERE name = 'new');
BEGIN
  UPDATE student SET first_name = 'Aluno', last_name = 'anonimizado', anonymised_at = now() WHERE id = v_student;
  IF NOT EXISTS (SELECT 1 FROM stored_file WHERE id = v_new AND wrapped_key IS NULL AND key_shredded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL test 3: an anonymised student''s ID photo kept its key';
  END IF;
  RAISE NOTICE 'PASS test 3: anonymisation shreds the ID photograph';
END $$;

ROLLBACK;
