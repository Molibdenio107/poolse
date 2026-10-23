-- The signed contract on a partnership — POOLSE-105.
--
-- Test 1: an agreement has all its terms or none, so a contract can come
-- first and a half-typed price cannot exist. Test 2: a Word file is a contract
-- and nothing else. Test 3: the version history — one current file per
-- agreement, and the app's login can close a version but never rewrite or
-- delete one. Test 4: another club sees none of it.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('bbbbbbbb-1050-4000-8000-000000000001', 'Clube Contrato A', 'clube-contrato-a'),
  ('bbbbbbbb-1050-4000-8000-000000000002', 'Clube Contrato B', 'clube-contrato-b');

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1050-4000-8000-000000000001';
  v_fac uuid; v_partner uuid; v_member uuid; v_pending uuid;
  v_pdf uuid; v_docx uuid; ok boolean;
BEGIN
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina') RETURNING id INTO v_fac;
  INSERT INTO partner (organization_id, facility_id, name, type)
  VALUES (v_org, v_fac, 'Escola Básica', 'escola') RETURNING id INTO v_partner;
  INSERT INTO membership (organization_id, app_user_id, status, first_name, last_name) VALUES (v_org, NULL, 'active', 'Rita', 'Secretaria')
  RETURNING id INTO v_member;

  -- -------------------------------------------------------------------------
  -- Test 1: all the terms, or none
  -- -------------------------------------------------------------------------
  INSERT INTO partner_agreement (organization_id, partner_id) VALUES (v_org, v_partner)
  RETURNING id INTO v_pending;

  ok := false;
  BEGIN
    INSERT INTO partner_agreement (organization_id, partner_id, start_date)
    VALUES (v_org, v_partner, DATE '2026-09-01');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1: an agreement with a date and no price was accepted'; END IF;

  -- Filling the pending row in is one update with the three together.
  UPDATE partner_agreement
     SET start_date = DATE '2026-09-01', billing_model = 'por_hora_pista', unit_price = 14.375
   WHERE id = v_pending;
  RAISE NOTICE 'PASS test 1: an agreement has all its terms or none';

  -- -------------------------------------------------------------------------
  -- Test 2: Word for a contract, and only for a contract
  -- -------------------------------------------------------------------------
  INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
  VALUES (v_org, 'agreement_document', v_org || '/agreement_document/a.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1200, 'Contrato.docx', v_member)
  RETURNING id INTO v_docx;
  INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
  VALUES (v_org, 'agreement_document', v_org || '/agreement_document/b.pdf', 'application/pdf', 900, 'Contrato.pdf', v_member)
  RETURNING id INTO v_pdf;

  ok := false;
  BEGIN
    INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
    VALUES (v_org, 'logo', v_org || '/logo/c.docx',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1200, 'logo.docx', v_member);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2: a Word file was stored as a logo'; END IF;
  RAISE NOTICE 'PASS test 2: a Word file is a contract and nothing else';

  -- -------------------------------------------------------------------------
  -- Test 3: one current version per agreement
  -- -------------------------------------------------------------------------
  INSERT INTO partner_contract_version (organization_id, agreement_id, file_id, attached_by)
  VALUES (v_org, v_pending, v_docx, v_member);

  ok := false;
  BEGIN
    INSERT INTO partner_contract_version (organization_id, agreement_id, file_id, attached_by)
    VALUES (v_org, v_pending, v_pdf, v_member);
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3a: two current contracts on one agreement'; END IF;

  ok := false;
  BEGIN
    UPDATE partner_contract_version SET replaced_at = now() WHERE agreement_id = v_pending;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3b: a version was closed without saying who'; END IF;
END $$;

-- The app's login: close a version, open the next; nothing else.
SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'bbbbbbbb-1050-4000-8000-000000000001', true);

DO $$
DECLARE v_agreement uuid; v_member uuid; v_pdf uuid; ok boolean; n int;
BEGIN
  SELECT agreement_id, attached_by INTO v_agreement, v_member FROM partner_contract_version LIMIT 1;
  SELECT id INTO v_pdf FROM stored_file WHERE original_name = 'Contrato.pdf';

  UPDATE partner_contract_version SET replaced_at = now(), replaced_by = v_member
   WHERE agreement_id = v_agreement AND replaced_at IS NULL;
  INSERT INTO partner_contract_version (organization_id, agreement_id, file_id, attached_by)
  VALUES ('bbbbbbbb-1050-4000-8000-000000000001', v_agreement, v_pdf, v_member);
  SELECT count(*) INTO n FROM partner_contract_version WHERE agreement_id = v_agreement;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL test 3c: % versions after a replace', n; END IF;

  ok := false;
  BEGIN
    UPDATE partner_contract_version SET file_id = v_pdf;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3d: the app rewrote which file a version was'; END IF;

  ok := false;
  BEGIN
    DELETE FROM partner_contract_version;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3e: the app deleted a version'; END IF;
  RAISE NOTICE 'PASS test 3: one current contract, and history is written once';
END $$;

-- Another club sees no version and can attach nothing to ours.
SELECT set_config('app.organization_id', 'bbbbbbbb-1050-4000-8000-000000000002', true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM partner_contract_version;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 4: another club saw % versions', n; END IF;
  RAISE NOTICE 'PASS test 4: another club sees no contract history';
END $$;

RESET ROLE;
ROLLBACK;
