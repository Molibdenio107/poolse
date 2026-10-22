-- Where families pay the club, at the database — POOLSE-94.
--
--   1. **The stored shape is held here.** An IBAN is PT50 and twenty-one digits,
--      an MB WAY number +3519 and eight; a holder is not blank. The checksum is
--      the API's, but no path can store a shape the screens would mis-render.
--   2. **The app may write the three columns** — POOLSE-87 made organization a
--      column-by-column grant, and a column the club writes needs its own.
--   3. **A change notice is written once.** Its delivery may move; who changed
--      what, and whom it told, may not, and nothing deletes it.
--   4. **Another club reads none of it.**
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('f9400000-0000-0000-0000-000000000001', 'Clube IBAN', 'clube-iban'),
  ('f9400000-0000-0000-0000-000000000002', 'Clube Vizinho', 'clube-vizinho-iban');

INSERT INTO membership (id, organization_id, status, email, first_name, last_name) VALUES
  ('f9400000-0000-0000-0000-0000000000a1', 'f9400000-0000-0000-0000-000000000001', 'active', 'dono@clube-iban.pt', 'Dona', 'Clube');

-- ---------------------------------------------------------------------------
-- Test 1 — the shapes
-- ---------------------------------------------------------------------------

DO $$
DECLARE bad text;
BEGIN
  FOREACH bad IN ARRAY ARRAY[
    'PT50 0002 0123 1234 5678 9015 4',  -- spaces are the screen's, never stored
    'ES9121000418450200051332',          -- another country
    'PT5000020123123456789015'           -- a digit short
  ] LOOP
    BEGIN
      UPDATE organization SET payment_iban = bad WHERE id = 'f9400000-0000-0000-0000-000000000001';
      RAISE EXCEPTION 'FAIL test 1a: stored the IBAN %', bad;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;

  FOREACH bad IN ARRAY ARRAY['912345678', '+351212345678', '+3519123456'] LOOP
    BEGIN
      UPDATE organization SET payment_mbway_phone = bad WHERE id = 'f9400000-0000-0000-0000-000000000001';
      RAISE EXCEPTION 'FAIL test 1b: stored the MB WAY number %', bad;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;

  BEGIN
    UPDATE organization SET payment_account_holder = '   ' WHERE id = 'f9400000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'FAIL test 1c: stored a blank account holder';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 1: an IBAN, an MB WAY number and a holder are stored in one shape only';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — the app writes them; Test 3 — a notice is written once
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'f9400000-0000-0000-0000-000000000001', true);

DO $$
DECLARE v_notice uuid; ok boolean;
BEGIN
  UPDATE organization
     SET payment_iban = 'PT50000201231234567890154',
         payment_account_holder = 'Clube IBAN, Lda.',
         payment_mbway_phone = '+351912345678'
   WHERE id = 'f9400000-0000-0000-0000-000000000001';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL test 2: the app could not write its own payment details';
  END IF;
  RAISE NOTICE 'PASS test 2: the app writes the three columns';

  INSERT INTO payment_change_notice (organization_id, changed_by, old_iban_end, new_iban_end, recipients)
  VALUES ('f9400000-0000-0000-0000-000000000001', 'f9400000-0000-0000-0000-0000000000a1',
          NULL, '0154', ARRAY['dono@clube-iban.pt'])
  RETURNING id INTO v_notice;

  -- Its delivery may move.
  UPDATE payment_change_notice
     SET delivered_at = now(), delivery_attempts = 1, last_attempt_at = now()
   WHERE id = v_notice;

  -- What it says may not.
  ok := false;
  BEGIN
    UPDATE payment_change_notice SET new_iban_end = '9999' WHERE id = v_notice;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3a: a notice was rewritten'; END IF;

  ok := false;
  BEGIN
    UPDATE payment_change_notice SET recipients = '{}' WHERE id = v_notice;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3b: a notice''s recipients were rewritten'; END IF;

  ok := false;
  BEGIN
    DELETE FROM payment_change_notice WHERE id = v_notice;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3c: a notice was deleted'; END IF;

  RAISE NOTICE 'PASS test 3: a change notice is written once; only its delivery moves';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — another club reads none of it
-- ---------------------------------------------------------------------------

SELECT set_config('app.organization_id', 'f9400000-0000-0000-0000-000000000002', true);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM payment_change_notice;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 4a: another club read % change notice(s)', n;
  END IF;
  SELECT count(*) INTO n FROM organization WHERE payment_iban IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 4b: another club read an IBAN';
  END IF;
  RAISE NOTICE 'PASS test 4: another club reads neither the account nor its notices';
END $$;

ROLLBACK;
