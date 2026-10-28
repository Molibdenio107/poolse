-- Results by email — POOLSE-114.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('f1140000-0000-0000-0000-000000000001', 'Clube Inbox A', 'clube-inbox-a'),
  ('f1140000-0000-0000-0000-000000000002', 'Clube Inbox B', 'clube-inbox-b');

DO $$
DECLARE v_ma uuid; v_mb uuid; v_ta text; v_tb text;
BEGIN
  INSERT INTO membership (organization_id, status, email, first_name, last_name)
  VALUES ('f1140000-0000-0000-0000-000000000001', 'active', 'treinador@inbox-a.pt', 'Ana', 'Sousa')
  RETURNING id INTO v_ma;
  INSERT INTO membership (organization_id, status, email, first_name, last_name)
  VALUES ('f1140000-0000-0000-0000-000000000002', 'active', 'treinador@inbox-b.pt', 'Bruno', 'Reis')
  RETURNING id INTO v_mb;
  SELECT meet_inbox_token INTO v_ta FROM organization WHERE id = 'f1140000-0000-0000-0000-000000000001';
  SELECT meet_inbox_token INTO v_tb FROM organization WHERE id = 'f1140000-0000-0000-0000-000000000002';
  CREATE TEMP TABLE fixture AS SELECT v_ma AS ma, v_mb AS mb, v_ta AS ta, v_tb AS tb;
  GRANT SELECT ON fixture TO poolse_app;

  IF v_ta !~ '^[a-z0-9]{20}$' OR v_ta = v_tb THEN
    RAISE EXCEPTION 'FAIL test 1: a club was not given its own 20-character token (% / %)', v_ta, v_tb;
  END IF;
  RAISE NOTICE 'PASS test 1: every club has its own lowercase 20-character token';
END $$;

SET LOCAL ROLE poolse_app;

DO $$
DECLARE f RECORD;
BEGIN
  SELECT * INTO f FROM fixture;
  IF meet_inbox_organization(f.ta) IS DISTINCT FROM 'f1140000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'FAIL test 2: the token did not find its club';
  END IF;
  IF meet_inbox_organization(upper(f.ta)) IS NOT NULL OR meet_inbox_organization('nope') IS NOT NULL
     OR meet_inbox_organization(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 2: a malformed token found a club';
  END IF;
  RAISE NOTICE 'PASS test 2: the app login finds a club by its token, and by nothing else';
END $$;

RESET ROLE;
UPDATE organization SET disabled_modules = '{competition}' WHERE id = 'f1140000-0000-0000-0000-000000000002';
SET LOCAL ROLE poolse_app;

DO $$
DECLARE f RECORD;
BEGIN
  SELECT * INTO f FROM fixture;
  IF meet_inbox_organization(f.tb) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 3: a club without the competition module was found';
  END IF;
  RAISE NOTICE 'PASS test 3: a club with the module off has no working address';
END $$;

SELECT set_config('app.organization_id', 'f1140000-0000-0000-0000-000000000001', true);

DO $$
DECLARE f RECORD; v_msg uuid; v_file uuid; v_row uuid; v_meet uuid; v_old text; v_new text;
BEGIN
  SELECT * INTO f FROM fixture;

  -- Regeneration is a club write the app may make.
  SELECT meet_inbox_token INTO v_old FROM organization WHERE id = 'f1140000-0000-0000-0000-000000000001';
  UPDATE organization SET meet_inbox_token = new_inbox_token() WHERE id = 'f1140000-0000-0000-0000-000000000001'
  RETURNING meet_inbox_token INTO v_new;
  IF v_new = v_old OR meet_inbox_organization(v_old) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 4: the old address still worked after regeneration';
  END IF;
  RAISE NOTICE 'PASS test 4: a regenerated address stops the old one at once';

  INSERT INTO meet_inbox_message (organization_id, provider_message_id, sender_membership_id, received_from, file_count)
  VALUES ('f1140000-0000-0000-0000-000000000001', 'msg-1', f.ma, 'treinador@inbox-a.pt', 1)
  RETURNING id INTO v_msg;

  BEGIN
    INSERT INTO meet_inbox_message (organization_id, provider_message_id, sender_membership_id, received_from, file_count)
    VALUES ('f1140000-0000-0000-0000-000000000001', 'msg-1', f.ma, 'treinador@inbox-a.pt', 1);
    RAISE EXCEPTION 'FAIL test 5: one message was recorded twice';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS test 5: a message is recorded once per club';
  END;

  BEGIN
    INSERT INTO meet_inbox_message (organization_id, provider_message_id, sender_membership_id, received_from, file_count)
    VALUES ('f1140000-0000-0000-0000-000000000001', 'msg-2', f.mb, 'treinador@inbox-b.pt', 0);
    RAISE EXCEPTION 'FAIL test 6: a message named another club''s person as its sender';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS test 6: the sender is the club''s own';
  END;

  INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
  VALUES ('f1140000-0000-0000-0000-000000000001', 'meet_results',
          'f1140000-0000-0000-0000-000000000001/meet_results/x.lxf', 'application/zip', 900, 'resultados.lxf', f.ma)
  RETURNING id INTO v_file;

  BEGIN
    INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
    VALUES ('f1140000-0000-0000-0000-000000000001', 'logo',
            'f1140000-0000-0000-0000-000000000001/logo/x.zip', 'application/zip', 900, 'logo.zip', f.ma);
    RAISE EXCEPTION 'FAIL test 7: a zip was stored as a logo';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS test 7: only a results file may be XML or a zip';
  END;

  INSERT INTO meet_inbox (organization_id, message_id, file_id, file_name, meet_name, meet_starts_on)
  VALUES ('f1140000-0000-0000-0000-000000000001', v_msg, v_file, 'resultados.lxf', 'Regional', DATE '2026-11-01')
  RETURNING id INTO v_row;

  BEGIN
    UPDATE meet_inbox SET status = 'imported' WHERE id = v_row;
    RAISE EXCEPTION 'FAIL test 8: a row read imported with no meet';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS test 8: imported carries its meet';
  END;

  INSERT INTO swim_meet (organization_id, name, starts_on, ends_on)
  VALUES ('f1140000-0000-0000-0000-000000000001', 'Regional', DATE '2026-11-01', DATE '2026-11-01')
  RETURNING id INTO v_meet;
  UPDATE meet_inbox SET status = 'imported', meet_id = v_meet, imported_at = now(), imported_by_membership_id = f.ma
   WHERE id = v_row;
  RAISE NOTICE 'PASS test 9: a row is marked imported with its meet';

  BEGIN
    UPDATE meet_inbox SET meet_name = 'Outro' WHERE id = v_row;
    RAISE EXCEPTION 'FAIL test 10: what the file said was edited';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 10: only the status columns may change';
  END;

  BEGIN
    DELETE FROM meet_inbox;
    RAISE EXCEPTION 'FAIL test 11: the app deleted an inbox row';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 11: an inbox row is discarded, never deleted';
  END;
END $$;

SELECT set_config('app.organization_id', 'f1140000-0000-0000-0000-000000000002', true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM meet_inbox) OR EXISTS (SELECT 1 FROM meet_inbox_message) THEN
    RAISE EXCEPTION 'FAIL test 12: another club''s inbox was visible';
  END IF;
  RAISE NOTICE 'PASS test 12: a club sees only its own inbox';
END $$;

RESET ROLE;

ROLLBACK;
