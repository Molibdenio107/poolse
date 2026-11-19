-- Onboarding progress — POOLSE-228.
--
-- Test 1 holds the wizard's shape: a step only while it is under way. Test 2 is
-- the tenant boundary, the one a new table must earn: a row naming another club's
-- membership is refused by the composite key, and each club sees only its own.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('99999999-a228-4444-8888-999999999999', 'Clube Onboarding', 'clube-onboarding'),
  ('99999999-b228-4444-8888-999999999999', 'Clube Vizinho OB', 'clube-vizinho-ob');

INSERT INTO membership (id, organization_id, status, first_name, last_name) VALUES
  ('99999999-a228-4444-8888-000000000001', '99999999-a228-4444-8888-999999999999', 'active', 'Olga', 'Dona'),
  ('99999999-b228-4444-8888-000000000001', '99999999-b228-4444-8888-999999999999', 'active', 'Vasco', 'Vizinho'),
  ('99999999-b228-4444-8888-000000000002', '99999999-b228-4444-8888-999999999999', 'active', 'Vera', 'Vizinha');

-- ---------------------------------------------------------------------------
-- Test 1 — a step only while the wizard is under way
-- ---------------------------------------------------------------------------

DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO onboarding_progress (organization_id, membership_id, wizard_step)
    VALUES ('99999999-a228-4444-8888-999999999999', '99999999-a228-4444-8888-000000000001', 'club');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1: a step was set on a wizard never started'; END IF;

  INSERT INTO onboarding_progress (organization_id, membership_id, wizard_started_at, wizard_step, wizard_skipped)
  VALUES ('99999999-a228-4444-8888-999999999999', '99999999-a228-4444-8888-000000000001', now(), 'places', '{club}');

  ok := false;
  BEGIN
    INSERT INTO onboarding_progress (organization_id, membership_id)
    VALUES ('99999999-a228-4444-8888-999999999999', '99999999-a228-4444-8888-000000000001');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1b: a second row for one person in one club'; END IF;

  RAISE NOTICE 'PASS test 1: one row per person, a step only once started';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — the tenant boundary
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_seen int; ok boolean := false;
BEGIN
  -- Club B's row naming club A's Owner: only the composite key stands in the way.
  BEGIN
    INSERT INTO onboarding_progress (organization_id, membership_id)
    VALUES ('99999999-b228-4444-8888-999999999999', '99999999-a228-4444-8888-000000000001');
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2: a club wrote progress for another club''s member'; END IF;

  INSERT INTO onboarding_progress (organization_id, membership_id)
  VALUES ('99999999-b228-4444-8888-999999999999', '99999999-b228-4444-8888-000000000001');

  -- As the app, which is the role the question has to be asked as (the owner bypasses RLS).
  SET LOCAL ROLE poolse_app;
  PERFORM set_config('app.organization_id', '99999999-a228-4444-8888-999999999999', true);
  SELECT count(*) INTO v_seen FROM onboarding_progress;
  IF v_seen <> 1 THEN RAISE EXCEPTION 'FAIL test 2b: club A saw % rows instead of 1', v_seen; END IF;

  -- Moving B's row from A's session touches nothing.
  UPDATE onboarding_progress SET wizard_finished_at = now()
   WHERE membership_id = '99999999-b228-4444-8888-000000000001';
  GET DIAGNOSTICS v_seen = ROW_COUNT;
  IF v_seen <> 0 THEN RAISE EXCEPTION 'FAIL test 2c: club A updated club B''s row'; END IF;

  -- Writing a row into B from A's session is refused by WITH CHECK.
  ok := false;
  BEGIN
    INSERT INTO onboarding_progress (organization_id, membership_id)
    VALUES ('99999999-b228-4444-8888-999999999999', '99999999-b228-4444-8888-000000000002');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2d: club A wrote a row into club B'; END IF;

  PERFORM set_config('app.organization_id', '', true);
  SELECT count(*) INTO v_seen FROM onboarding_progress;
  IF v_seen <> 0 THEN RAISE EXCEPTION 'FAIL test 2e: no tenant saw % rows instead of none', v_seen; END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS test 2: each club sees and writes only its own progress';
END $$;

ROLLBACK;
