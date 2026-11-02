-- The sports a person belongs to — POOLSE-145 slice a.
--
-- Test 1: a new person belongs to swimming, and nobody may belong to none.
-- Test 2: only a sport the club has switched on, as the app's login.
-- Test 3: `resolve_memberships` carries the person's sports beside the club's.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('bbbbbbbb-1450-4000-8000-000000000001', 'Clube Modalidades', 'clube-modalidades');
UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = 'bbbbbbbb-1450-4000-8000-000000000001';

INSERT INTO app_user (id, clerk_user_id, cached_email)
VALUES ('bbbbbbbb-1450-4000-8000-0000000000a1', 'user_tenis_145', 'tenis@clube.pt');

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1450-4000-8000-000000000001';
  v_coach uuid; v_sports text[]; ok boolean;
BEGIN
  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, 'bbbbbbbb-1450-4000-8000-0000000000a1', 'active') RETURNING id, sports INTO v_coach, v_sports;
  INSERT INTO membership_role (organization_id, membership_id, role) VALUES (v_org, v_coach, 'instructor');
  IF v_sports <> '{pool}' THEN RAISE EXCEPTION 'FAIL test 1a: a new person belongs to %', v_sports; END IF;

  ok := false;
  BEGIN
    UPDATE membership SET sports = '{}' WHERE id = v_coach;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1b: a person was left in no sport'; END IF;
  RAISE NOTICE 'PASS test 1: a person belongs to swimming by default, and never to none';
END $$;

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'bbbbbbbb-1450-4000-8000-000000000001', true);

DO $$
DECLARE v_coach uuid; ok boolean;
BEGIN
  SELECT id INTO v_coach FROM membership WHERE app_user_id = 'bbbbbbbb-1450-4000-8000-0000000000a1';
  UPDATE membership SET sports = '{tennis}' WHERE id = v_coach;

  ok := false;
  BEGIN
    UPDATE membership SET sports = '{tennis,padel}' WHERE id = v_coach;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2: a person was put in a sport the club has off'; END IF;
  RAISE NOTICE 'PASS test 2: only a sport the club has switched on';
END $$;

RESET ROLE;

DO $$
DECLARE r record;
BEGIN
  SELECT o_sports, o_enabled_sports INTO r FROM resolve_memberships('user_tenis_145')
   WHERE o_organization_id = 'bbbbbbbb-1450-4000-8000-000000000001';
  IF r.o_sports <> '{tennis}' OR r.o_enabled_sports <> '{pool,tennis}' THEN
    RAISE EXCEPTION 'FAIL test 3: resolved % of %', r.o_sports, r.o_enabled_sports;
  END IF;
  RAISE NOTICE 'PASS test 3: resolve_memberships carries the person''s sports beside the club''s';
END $$;

ROLLBACK;
