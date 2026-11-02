-- A staff member's contract — POOLSE-149 slice C.
--
-- Test 1: the facts hold together (a fixed term ends, an open-ended contract
-- does not, the end is not before the start). Test 2: a Word file is accepted
-- for a staff contract. Test 3: one current version per person, and the app's
-- login can close a version but never rewrite or delete one, nor delete the
-- facts. Test 4: another club sees none of it.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('bbbbbbbb-1490-4000-8000-000000000001', 'Clube Contrato Staff A', 'clube-contrato-staff-a'),
  ('bbbbbbbb-1490-4000-8000-000000000002', 'Clube Contrato Staff B', 'clube-contrato-staff-b');

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1490-4000-8000-000000000001';
  v_coach uuid; v_office uuid; v_docx uuid; v_pdf uuid; ok boolean;
BEGIN
  INSERT INTO membership (organization_id, app_user_id, status, first_name, last_name)
  VALUES (v_org, NULL, 'active', 'Ana', 'Treinadora') RETURNING id INTO v_coach;
  INSERT INTO membership (organization_id, app_user_id, status, first_name, last_name)
  VALUES (v_org, NULL, 'active', 'Rita', 'Secretaria') RETURNING id INTO v_office;

  -- -------------------------------------------------------------------------
  -- Test 1: the facts hold together
  -- -------------------------------------------------------------------------
  ok := false;
  BEGIN
    INSERT INTO staff_contract (organization_id, membership_id, kind, starts_on)
    VALUES (v_org, v_coach, 'fixed_term', DATE '2026-09-01');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1a: a fixed term with no end was accepted'; END IF;

  ok := false;
  BEGIN
    INSERT INTO staff_contract (organization_id, membership_id, kind, starts_on, ends_on)
    VALUES (v_org, v_coach, 'open_ended', DATE '2026-09-01', DATE '2027-08-31');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1b: an open-ended contract with an end was accepted'; END IF;

  ok := false;
  BEGIN
    INSERT INTO staff_contract (organization_id, membership_id, kind, starts_on, ends_on)
    VALUES (v_org, v_coach, 'fixed_term', DATE '2026-09-01', DATE '2026-08-31');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1c: an end before the start was accepted'; END IF;

  INSERT INTO staff_contract (organization_id, membership_id, kind, starts_on, ends_on)
  VALUES (v_org, v_coach, 'fixed_term', DATE '2026-09-01', DATE '2027-08-31');
  RAISE NOTICE 'PASS test 1: a contract''s facts hold together';

  -- -------------------------------------------------------------------------
  -- Test 2: Word is a staff contract's too
  -- -------------------------------------------------------------------------
  INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
  VALUES (v_org, 'staff_contract', v_org || '/staff_contract/a.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1200, 'Contrato.docx', v_office)
  RETURNING id INTO v_docx;
  INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
  VALUES (v_org, 'staff_contract', v_org || '/staff_contract/b.pdf', 'application/pdf', 900, 'Contrato.pdf', v_office)
  RETURNING id INTO v_pdf;
  RAISE NOTICE 'PASS test 2: a staff contract may be PDF or Word';

  -- -------------------------------------------------------------------------
  -- Test 3: one current version per person
  -- -------------------------------------------------------------------------
  INSERT INTO staff_contract_version (organization_id, membership_id, file_id, attached_by)
  VALUES (v_org, v_coach, v_docx, v_office);

  ok := false;
  BEGIN
    INSERT INTO staff_contract_version (organization_id, membership_id, file_id, attached_by)
    VALUES (v_org, v_coach, v_pdf, v_office);
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3a: two current contracts for one person'; END IF;

  ok := false;
  BEGIN
    UPDATE staff_contract_version SET replaced_at = now() WHERE membership_id = v_coach;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3b: a version was closed without saying who'; END IF;
END $$;

-- The app's login: close a version, open the next, change the facts; nothing else.
SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'bbbbbbbb-1490-4000-8000-000000000001', true);

DO $$
DECLARE v_coach uuid; v_office uuid; v_pdf uuid; ok boolean; n int;
BEGIN
  SELECT membership_id, attached_by INTO v_coach, v_office FROM staff_contract_version LIMIT 1;
  SELECT id INTO v_pdf FROM stored_file WHERE original_name = 'Contrato.pdf'
     AND organization_id = 'bbbbbbbb-1490-4000-8000-000000000001';

  UPDATE staff_contract_version SET replaced_at = now(), replaced_by = v_office
   WHERE membership_id = v_coach AND replaced_at IS NULL;
  INSERT INTO staff_contract_version (organization_id, membership_id, file_id, attached_by)
  VALUES ('bbbbbbbb-1490-4000-8000-000000000001', v_coach, v_pdf, v_office);
  SELECT count(*) INTO n FROM staff_contract_version WHERE membership_id = v_coach;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL test 3c: % versions after a replace', n; END IF;

  UPDATE staff_contract SET kind = 'uncertain_term', ends_on = NULL WHERE membership_id = v_coach;

  ok := false;
  BEGIN
    UPDATE staff_contract_version SET file_id = v_pdf;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3d: the app rewrote which file a version was'; END IF;

  ok := false;
  BEGIN
    DELETE FROM staff_contract_version;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3e: the app deleted a version'; END IF;

  ok := false;
  BEGIN
    DELETE FROM staff_contract;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3f: the app deleted a contract''s facts'; END IF;

  ok := false;
  BEGIN
    UPDATE staff_contract SET membership_id = v_office;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3g: the app moved a contract to somebody else'; END IF;
  RAISE NOTICE 'PASS test 3: one current contract, and history is written once';
END $$;

-- Another club sees no contract and no history.
SELECT set_config('app.organization_id', 'bbbbbbbb-1490-4000-8000-000000000002', true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM staff_contract_version;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 4a: another club saw % versions', n; END IF;
  SELECT count(*) INTO n FROM staff_contract;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 4b: another club saw % contracts', n; END IF;
  RAISE NOTICE 'PASS test 4: another club sees no staff contract';
END $$;

RESET ROLE;
ROLLBACK;
