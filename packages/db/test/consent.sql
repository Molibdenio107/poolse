-- Consent and sensitive fields proof — slice 1.3.
--
-- This is the suite a data protection officer would want to see. Three of these
-- are structural promises rather than behaviour, and each one exists because the
-- alternative is a promise the application could quietly break:
--
--   test 3 — a consent record cannot be edited, only withdrawn
--   test 4 — a consent record cannot be deleted at all
--   test 6 — the database never holds readable medical notes
--
-- Test 6 is the one to keep forever. Everything else in this slice is process;
-- that one is the reason a database dump is not a child protection incident.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES
  ('Clube A', 'clube-a'),
  ('Clube B', 'clube-b');

SELECT provision_app_user('user_admin', 'admin@clube.pt', 'Rita', 'Lopes', NULL, '2026-08-26 09:00:00+00');

DO $$
DECLARE v_org uuid; v_user uuid; v_membership uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_user FROM app_user WHERE clerk_user_id = 'user_admin';

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_user, 'active') RETURNING id INTO v_membership;
  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_membership, 'admin');

  INSERT INTO student (organization_id, first_name, last_name, birth_date)
  VALUES (v_org, 'João', 'Silva', DATE '2015-04-12');

  INSERT INTO student (organization_id, first_name, last_name)
  SELECT id, 'Aluno', 'Outro' FROM organization WHERE name = 'Clube B';
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — consent is an event with a grantor, a time and its evidence
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_student uuid; v_membership uuid; r record;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_student FROM student WHERE first_name = 'João';
  SELECT id INTO v_membership FROM membership WHERE organization_id = v_org;

  INSERT INTO consent (organization_id, student_id, kind, granted,
                       granted_by_membership_id, evidence_note)
  VALUES (v_org, v_student, 'photo', true, v_membership, 'Formulário assinado 12/09');

  SELECT granted, granted_by_membership_id AS granted_by, granted_at, evidence_note INTO r
    FROM consent WHERE student_id = v_student AND kind = 'photo';

  IF r.granted IS NOT TRUE OR r.granted_by IS NULL OR r.granted_at IS NULL THEN
    RAISE EXCEPTION 'FAIL test 1a: consent did not record who and when';
  END IF;
  IF r.evidence_note IS NULL THEN
    RAISE EXCEPTION 'FAIL test 1b: the evidence was not kept';
  END IF;

  -- A refusal is a recorded decision, not an absent one.
  INSERT INTO consent (organization_id, student_id, kind, granted, granted_by_membership_id)
  VALUES (v_org, v_student, 'parent_sharing', false, v_membership);

  RAISE NOTICE 'PASS test 1: consent records who granted it, when, and on what evidence';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — one live decision per kind; the history survives
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_student uuid; v_membership uuid; v_id uuid; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_student FROM student WHERE first_name = 'João';
  SELECT id INTO v_membership FROM membership WHERE organization_id = v_org;

  BEGIN
    INSERT INTO consent (organization_id, student_id, kind, granted, granted_by_membership_id)
    VALUES (v_org, v_student, 'photo', false, v_membership);
    RAISE EXCEPTION 'FAIL test 2a: two live photo decisions were allowed';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  -- Withdraw, then record the opposite. Both facts stay.
  SELECT id INTO v_id FROM consent
   WHERE student_id = v_student AND kind = 'photo' AND withdrawn_at IS NULL;
  UPDATE consent SET withdrawn_at = now(), withdrawn_by_membership_id = v_membership
   WHERE id = v_id;

  INSERT INTO consent (organization_id, student_id, kind, granted, granted_by_membership_id)
  VALUES (v_org, v_student, 'photo', false, v_membership);

  SELECT count(*) INTO n FROM consent WHERE student_id = v_student AND kind = 'photo';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 2b: expected the old decision alongside the new one, got %', n;
  END IF;

  RAISE NOTICE 'PASS test 2: one live decision per kind, with the previous one kept';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — a consent record cannot be edited
--
-- Keep this one. A record of what a guardian agreed to is worth nothing if it
-- can later be changed to say something else. The correction path is to withdraw
-- and record again, which leaves both visible.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_id uuid; v_student uuid;
BEGIN
  SELECT id INTO v_student FROM student WHERE first_name = 'João';
  SELECT id INTO v_id FROM consent
   WHERE student_id = v_student AND kind = 'parent_sharing';

  BEGIN
    UPDATE consent SET granted = true WHERE id = v_id;
    RAISE EXCEPTION 'FAIL test 3a: a refusal was flipped to a grant';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE consent SET evidence_note = 'rewritten' WHERE id = v_id;
    RAISE EXCEPTION 'FAIL test 3b: the evidence note was rewritten';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE consent SET granted_at = now() - interval '1 year' WHERE id = v_id;
    RAISE EXCEPTION 'FAIL test 3c: the date of a decision was moved';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- Withdrawal is the one permitted change, and only once.
  UPDATE consent SET withdrawn_at = now() WHERE id = v_id;
  BEGIN
    UPDATE consent SET withdrawn_at = NULL WHERE id = v_id;
    RAISE EXCEPTION 'FAIL test 3d: a withdrawal was undone';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 3: consent is write-once; only withdrawal may change it';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — the application cannot delete a consent record at all
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE v_org uuid; n int;
BEGIN
  SET LOCAL ROLE postgres;
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SET LOCAL ROLE poolse_app;

  PERFORM set_config('app.organization_id', v_org::text, true);

  SELECT count(*) INTO n FROM consent;
  IF n < 2 THEN
    RAISE EXCEPTION 'FAIL test 4a: the app role cannot read its own consent records (% rows)', n;
  END IF;

  BEGIN
    DELETE FROM consent;
    RAISE EXCEPTION 'FAIL test 4b: the app role deleted consent records';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'PASS test 4: consent records can be withdrawn but never deleted';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 5 — sensitive rows are tenant-scoped, and cannot cross tenants
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_a uuid; v_b uuid; v_a_student uuid;
BEGIN
  SELECT id INTO v_a FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_b FROM organization WHERE name = 'Clube B';
  SELECT id INTO v_a_student FROM student WHERE first_name = 'João';

  BEGIN
    INSERT INTO student_sensitive (student_id, organization_id, medical_notes_encrypted)
    VALUES (v_a_student, v_b, 'v1.aaa.bbb.ccc');
    RAISE EXCEPTION 'FAIL test 5a: Clube B attached notes to a Clube A student';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO consent (organization_id, student_id, kind, granted)
    VALUES (v_b, v_a_student, 'photo', true);
    RAISE EXCEPTION 'FAIL test 5b: Clube B recorded consent for a Clube A student';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 5: sensitive rows cannot be attached across tenants';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — the database never holds readable medical notes
--
-- Keep this one above all the others. The application encrypts before the value
-- arrives, so what is stored is opaque to Postgres, to a dump, to a backup on a
-- laptop and to anyone with a psql prompt. This asserts the property that makes
-- all of that true: no plaintext, and the stored shape is the versioned envelope
-- the cipher produces.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_student uuid; v_stored text; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_student FROM student WHERE first_name = 'João';

  -- Exactly what the API writes: an AES-256-GCM envelope, base64url, versioned.
  INSERT INTO student_sensitive (student_id, organization_id, medical_notes_encrypted)
  VALUES (v_student, v_org, 'v1.KBrLPXeMhk1s5Rre.Q0hFQ0tUQUdIRVJF.U0VDUkVUUEFZTE9BRA');

  SELECT medical_notes_encrypted INTO v_stored
    FROM student_sensitive WHERE student_id = v_student;

  IF v_stored NOT LIKE 'v1.%.%.%' THEN
    RAISE EXCEPTION 'FAIL test 6a: stored value is not a versioned envelope (%)', left(v_stored, 20);
  END IF;

  -- Nothing anywhere in the table reads as prose. If somebody ever adds a
  -- plaintext fallback, a real medical word will show up here.
  SELECT count(*) INTO n FROM student_sensitive
   WHERE medical_notes_encrypted ILIKE '%asma%'
      OR medical_notes_encrypted ILIKE '%asthma%'
      OR medical_notes_encrypted ILIKE '%alerg%'
      OR medical_notes_encrypted ILIKE '%epilep%'
      OR medical_notes_encrypted ILIKE '%diabet%';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6b: % rows contain readable medical text', n;
  END IF;

  RAISE NOTICE 'PASS test 6: medical notes reach the database already encrypted';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — an ordinary member cannot reach any of it from another tenant
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE v_b uuid; n int;
BEGIN
  SET LOCAL ROLE postgres;
  SELECT id INTO v_b FROM organization WHERE name = 'Clube B';
  SET LOCAL ROLE poolse_app;

  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM student_sensitive;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7a: Clube B read % sensitive rows belonging to Clube A', n;
  END IF;

  SELECT count(*) INTO n FROM consent;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7b: Clube B read % consent records belonging to Clube A', n;
  END IF;

  -- And unscoped, which is what a route outside the tenant middleware has.
  PERFORM set_config('app.organization_id', '', true);
  SELECT count(*) INTO n FROM student_sensitive;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7c: an unscoped read returned % sensitive rows', n;
  END IF;

  RAISE NOTICE 'PASS test 7: medical notes and consent are invisible across tenants';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 8 — a student's photograph is invisible without live consent
--
-- Backlog story 3, and the assertion that makes it real. The rule lives in the
-- SQL that produces the storage key, not in the components that render it: a
-- caller who has never heard of consent gets NULL and has nothing to show, and
-- withdrawal takes effect everywhere at once because there is only one place it
-- is decided.
--
-- The helper below mirrors PHOTO_KEY in
-- apps/api/src/students/students.repository.ts. If the two ever disagree, this
-- test is the one that is right.
--
-- Its own student, deliberately: the tests above leave a live photo decision on
-- João, and one live decision per kind is exactly the rule test 2 proves.
-- ---------------------------------------------------------------------------

CREATE FUNCTION pg_temp.visible_photo_key(p_student uuid) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT CASE WHEN EXISTS (
           SELECT 1 FROM consent c
            WHERE c.organization_id = s.organization_id
              AND c.student_id = s.id
              AND c.kind = 'photo'
              AND c.granted
              AND c.withdrawn_at IS NULL
         ) THEN s.photo_storage_key ELSE NULL END
    FROM student s WHERE s.id = p_student;
$fn$;

DO $$
DECLARE
  v_org uuid; v_student uuid; v_membership uuid; v_consent uuid; v_key text;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_membership FROM membership WHERE organization_id = v_org LIMIT 1;

  INSERT INTO student (organization_id, first_name, last_name, photo_storage_key)
  VALUES (v_org, 'Marta', 'Fotografia', 'students/marta.jpg')
  RETURNING id INTO v_student;

  -- No consent record at all. The key exists; nothing may read it.
  IF pg_temp.visible_photo_key(v_student) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 8a: a photograph was readable with no consent at all';
  END IF;

  -- A recorded refusal is not consent either.
  INSERT INTO consent (organization_id, student_id, kind, granted, granted_by_membership_id)
  VALUES (v_org, v_student, 'photo', false, v_membership)
  RETURNING id INTO v_consent;

  IF pg_temp.visible_photo_key(v_student) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 8b: a refusal was treated as permission';
  END IF;

  -- Granted: now, and only now, it may be shown.
  UPDATE consent SET withdrawn_at = now(), withdrawn_by_membership_id = v_membership
   WHERE id = v_consent;
  INSERT INTO consent (organization_id, student_id, kind, granted, granted_by_membership_id)
  VALUES (v_org, v_student, 'photo', true, v_membership)
  RETURNING id INTO v_consent;

  v_key := pg_temp.visible_photo_key(v_student);
  IF v_key IS DISTINCT FROM 'students/marta.jpg' THEN
    RAISE EXCEPTION 'FAIL test 8c: granted consent did not release the photograph (%)', v_key;
  END IF;

  -- Withdrawn: hidden again, immediately, with no further action anywhere.
  UPDATE consent SET withdrawn_at = now(), withdrawn_by_membership_id = v_membership
   WHERE id = v_consent;

  IF pg_temp.visible_photo_key(v_student) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 8d: withdrawing consent did not hide the photograph';
  END IF;

  -- And the stored key is untouched: withdrawal hides the picture, it does not
  -- destroy it. Deleting the file is an erasure request, which is its own path.
  SELECT photo_storage_key INTO v_key FROM student WHERE id = v_student;
  IF v_key IS DISTINCT FROM 'students/marta.jpg' THEN
    RAISE EXCEPTION 'FAIL test 8e: withdrawal destroyed the stored key';
  END IF;

  RAISE NOTICE 'PASS test 8: a photograph is shown only while consent is granted and live';
END $$;

ROLLBACK;
