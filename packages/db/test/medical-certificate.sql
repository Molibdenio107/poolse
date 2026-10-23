-- The atestado on a medical leave — POOLSE-109.
--
-- Test 1: the database refuses a health file it could read (no wrapped key) and
-- a key on a file that is not health data. Test 2: one current atestado per
-- leave, and the app's login can close a version but never rewrite or delete
-- one, nor touch a file's key. Test 3: retention — a leave archived more than
-- 24 months ago loses its atestados, a recent one keeps them, and erasing a
-- student's health data shreds theirs. Test 4: another club sees none of it.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('bbbbbbbb-1090-4000-8000-000000000001', 'Clube Atestado A', 'clube-atestado-a'),
  ('bbbbbbbb-1090-4000-8000-000000000002', 'Clube Atestado B', 'clube-atestado-b');

CREATE TEMP TABLE t109 (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT ON t109 TO poolse_app;

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1090-4000-8000-000000000001';
  v_member uuid; v_student uuid; v_old_student uuid; v_leave uuid; v_old_leave uuid;
  v_a uuid; v_b uuid; v_old uuid; ok boolean;
BEGIN
  INSERT INTO membership (organization_id, app_user_id, status, first_name, last_name)
  VALUES (v_org, NULL, 'active', 'Rita', 'Secretaria') RETURNING id INTO v_member;
  INSERT INTO student (organization_id, first_name, last_name, birth_date)
  VALUES (v_org, 'Mariana', 'Almeida', DATE '2016-04-02') RETURNING id INTO v_student;
  INSERT INTO student (organization_id, first_name, last_name, birth_date)
  VALUES (v_org, 'Tiago', 'Freitas', DATE '2015-09-11') RETURNING id INTO v_old_student;

  INSERT INTO student_medical_leave (organization_id, student_id, starts_on, ends_on)
  VALUES (v_org, v_student, DATE '2026-09-01', DATE '2026-10-15') RETURNING id INTO v_leave;
  INSERT INTO student_medical_leave (organization_id, student_id, starts_on, ends_on)
  VALUES (v_org, v_old_student, DATE '2024-01-08', DATE '2024-02-08') RETURNING id INTO v_old_leave;

  -- -------------------------------------------------------------------------
  -- Test 1: sealed or nothing
  -- -------------------------------------------------------------------------
  ok := false;
  BEGIN
    INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
    VALUES (v_org, 'medical_certificate', v_org || '/medical_certificate/x.pdf', 'application/pdf', 900, 'Atestado.pdf', v_member);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1a: an atestado was stored with no key, readable by anyone with the bucket'; END IF;

  ok := false;
  BEGIN
    INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by, wrapped_key)
    VALUES (v_org, 'logo', v_org || '/logo/x.png', 'image/png', 900, 'logo.png', v_member, 'v1.aa.bb.cc');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1b: a logo carried a data key'; END IF;

  INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by, wrapped_key)
  VALUES (v_org, 'medical_certificate', v_org || '/medical_certificate/a.pdf', 'application/pdf', 900, 'Atestado A.pdf', v_member, 'v1.aa.bb.cc')
  RETURNING id INTO v_a;
  INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by, wrapped_key)
  VALUES (v_org, 'medical_certificate', v_org || '/medical_certificate/b.pdf', 'application/pdf', 900, 'Atestado B.pdf', v_member, 'v1.dd.ee.ff')
  RETURNING id INTO v_b;
  INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by, wrapped_key)
  VALUES (v_org, 'medical_certificate', v_org || '/medical_certificate/old.pdf', 'application/pdf', 900, 'Antigo.pdf', v_member, 'v1.gg.hh.ii')
  RETURNING id INTO v_old;
  RAISE NOTICE 'PASS test 1: a health file is sealed, and nothing else carries a key';

  INSERT INTO medical_leave_certificate (organization_id, leave_id, file_id, attached_by)
  VALUES (v_org, v_leave, v_a, v_member);
  UPDATE student_medical_leave SET document_file_id = v_a WHERE id = v_leave;
  INSERT INTO medical_leave_certificate (organization_id, leave_id, file_id, attached_by)
  VALUES (v_org, v_old_leave, v_old, v_member);
  UPDATE student_medical_leave SET document_file_id = v_old WHERE id = v_old_leave;

  INSERT INTO t109 VALUES ('member', v_member), ('student', v_student), ('old_student', v_old_student),
    ('leave', v_leave), ('old_leave', v_old_leave), ('a', v_a), ('b', v_b), ('old', v_old);
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: one current atestado, history written once, keys out of reach
-- ---------------------------------------------------------------------------
SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'bbbbbbbb-1090-4000-8000-000000000001', true);

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1090-4000-8000-000000000001';
  v_member uuid := (SELECT id FROM t109 WHERE name = 'member');
  v_leave uuid := (SELECT id FROM t109 WHERE name = 'leave');
  v_b uuid := (SELECT id FROM t109 WHERE name = 'b');
  ok boolean; n int;
BEGIN
  ok := false;
  BEGIN
    INSERT INTO medical_leave_certificate (organization_id, leave_id, file_id, attached_by)
    VALUES (v_org, v_leave, v_b, v_member);
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2a: two current atestados on one leave'; END IF;

  -- Replacing: close the current one, open the next.
  UPDATE medical_leave_certificate SET replaced_at = now(), replaced_by = v_member
   WHERE leave_id = v_leave AND replaced_at IS NULL;
  INSERT INTO medical_leave_certificate (organization_id, leave_id, file_id, attached_by)
  VALUES (v_org, v_leave, v_b, v_member);
  UPDATE student_medical_leave SET document_file_id = v_b WHERE id = v_leave;
  SELECT count(*) INTO n FROM medical_leave_certificate WHERE leave_id = v_leave;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL test 2b: % versions after a replace', n; END IF;

  ok := false;
  BEGIN
    UPDATE medical_leave_certificate SET file_id = v_b;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2c: the app rewrote which file a version was'; END IF;

  ok := false;
  BEGIN
    DELETE FROM medical_leave_certificate;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2d: the app deleted an atestado''s history'; END IF;

  ok := false;
  BEGIN
    UPDATE stored_file SET wrapped_key = NULL WHERE id = v_b;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2e: the app touched a file''s data key'; END IF;
  RAISE NOTICE 'PASS test 2: one current atestado, and its history is written once';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 3: retention shreds
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_old_leave uuid := (SELECT id FROM t109 WHERE name = 'old_leave');
  v_student uuid := (SELECT id FROM t109 WHERE name = 'student');
  v_old uuid := (SELECT id FROM t109 WHERE name = 'old');
  v_a uuid := (SELECT id FROM t109 WHERE name = 'a');
  v_b uuid := (SELECT id FROM t109 WHERE name = 'b');
  v_key text; v_shredded timestamptz; n int;
BEGIN
  -- The old leave was archived 25 months ago; the current one is live.
  UPDATE student_medical_leave SET archived_at = now() - interval '25 months' WHERE id = v_old_leave;
  PERFORM * FROM apply_retention();

  SELECT wrapped_key, key_shredded_at INTO v_key, v_shredded FROM stored_file WHERE id = v_old;
  IF v_key IS NOT NULL OR v_shredded IS NULL THEN
    RAISE EXCEPTION 'FAIL test 3a: an atestado 25 months past its leave still has its key';
  END IF;
  SELECT count(*) INTO n FROM audit_log
   WHERE entity_id = v_old_leave AND action = 'retention.certificate_shredded';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL test 3b: the shredding was not recorded (% entries)', n; END IF;

  SELECT count(*) INTO n FROM stored_file WHERE id IN (v_a, v_b) AND wrapped_key IS NOT NULL;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL test 3c: a live leave''s atestado was shredded'; END IF;

  -- Erasing a student's health data takes every atestado they ever had.
  UPDATE student SET health_erased_at = now() WHERE id = v_student;
  SELECT count(*) INTO n FROM stored_file WHERE id IN (v_a, v_b) AND key_shredded_at IS NOT NULL AND wrapped_key IS NULL;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL test 3d: % of 2 atestados shredded with the student''s health data', n; END IF;
  RAISE NOTICE 'PASS test 3: retention shreds an atestado, and only the ones it should';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: another club sees nothing, and cannot shred ours
-- ---------------------------------------------------------------------------
SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'bbbbbbbb-1090-4000-8000-000000000002', true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM medical_leave_certificate;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 4a: another club saw % atestado versions', n; END IF;
  SELECT count(*) INTO n FROM stored_file WHERE purpose = 'medical_certificate';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 4b: another club saw % atestados', n; END IF;
  RAISE NOTICE 'PASS test 4: another club sees no atestado';
END $$;
RESET ROLE;

ROLLBACK;
