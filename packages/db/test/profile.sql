-- Profile proof — backlog round 3, story 1.
--
-- Two properties are worth a suite of their own here, and neither is visible
-- from the API.
--
-- The first is test 5: an account belonging to no organization can still edit
-- its own profile. `app_user` carries no organization_id, so its policy scopes it
-- through membership — the ordinary UPDATE touches zero rows and raises nothing,
-- which is the failure mode that reaches production looking like "the save button
-- does nothing sometimes".
--
-- The second is test 6, and it is the one to keep forever: there is no way to
-- write a name through this function. Clerk owns the name; `cached_first_name` is
-- a cache with an event-ordering guard. A profile screen that wrote the cache
-- directly would work in the demo and be silently reverted the next time Clerk
-- synced.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_profile', 'perfil@clube.pt', 'Rita', 'Lopes', NULL,
                          '2026-08-26 09:00:00+00');

-- ---------------------------------------------------------------------------
-- Test 1 — a new account has no birth date and no phone
--
-- Absent is a real answer and the one everybody starts with. Neither column may
-- arrive with an invented default.
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  SELECT birth_date, contact_phone INTO r
    FROM app_user WHERE clerk_user_id = 'user_profile';

  IF r.birth_date IS NOT NULL OR r.contact_phone IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 1: a new account arrived with % and %',
      r.birth_date, r.contact_phone;
  END IF;
  RAISE NOTICE 'PASS test 1: a new account has neither a birth date nor a phone';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — every field is the new value, including NULL
--
-- The opposite of set_app_user_preferences, deliberately: this one backs a form
-- that submits everything at once, so a person who empties their phone number
-- means it. If NULL meant "leave alone" here, a cleared field would silently
-- come back.
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  SELECT o_birth_date AS birth, o_contact_phone AS phone INTO r
    FROM set_app_user_profile('user_profile', 'pt-PT', 'system',
                              DATE '1990-05-12', '+351 912 345 678');
  IF r.birth <> DATE '1990-05-12' OR r.phone <> '+351 912 345 678' THEN
    RAISE EXCEPTION 'FAIL test 2a: stored % and %', r.birth, r.phone;
  END IF;

  SELECT o_birth_date AS birth, o_contact_phone AS phone INTO r
    FROM set_app_user_profile('user_profile', 'pt-PT', 'system', NULL, NULL);
  IF r.birth IS NOT NULL OR r.phone IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 2b: clearing left % and %', r.birth, r.phone;
  END IF;

  RAISE NOTICE 'PASS test 2: a field can be set and then genuinely cleared';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — a blank phone is stored as absent, not as an empty string
--
-- An untouched form field submits ''. Two ways of saying "no phone number" in
-- one column is how a list ends up rendering an empty badge for half its rows.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_phone text;
BEGIN
  SELECT o_contact_phone INTO v_phone
    FROM set_app_user_profile('user_profile', 'pt-PT', 'system', NULL, '   ');
  IF v_phone IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 3a: a blank phone was stored as %', quote_literal(v_phone);
  END IF;

  BEGIN
    UPDATE app_user SET contact_phone = '' WHERE clerk_user_id = 'user_profile';
    RAISE EXCEPTION 'FAIL test 3b: an empty phone was stored by the ordinary path';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 3: blank and absent are the same answer, stored one way';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — a birth date that cannot be right is refused
--
-- The future check lives in the function rather than in a CHECK constraint,
-- because a constraint must be immutable and current_date is not. Both halves
-- are asserted so that neither can be dropped unnoticed.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  BEGIN
    PERFORM set_app_user_profile('user_profile', 'pt-PT', 'system',
                                 current_date + 1, NULL);
    RAISE EXCEPTION 'FAIL test 4a: a birth date in the future was accepted';
  EXCEPTION
    WHEN raise_exception THEN NULL;
  END;

  BEGIN
    UPDATE app_user SET birth_date = DATE '1899-12-31'
     WHERE clerk_user_id = 'user_profile';
    RAISE EXCEPTION 'FAIL test 4b: a birth date before 1900 was stored';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    PERFORM set_app_user_profile('user_profile', 'fr', 'system', NULL, NULL);
    RAISE EXCEPTION 'FAIL test 4c: an unsupported locale was accepted';
  EXCEPTION
    WHEN raise_exception THEN NULL;
  END;

  RAISE NOTICE 'PASS test 4: impossible dates and unrenderable locales are refused';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — an account in no organization can still edit its own profile
--
-- Keep this one, for the same reason as its twin in preferences.sql. Nobody here
-- is a member of anything, so the ordinary UPDATE quietly touches zero rows: no
-- error, no change, no symptom. The reviewed function is the way through.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE n int; v_phone text;
BEGIN
  PERFORM set_config('app.organization_id', '', true);

  UPDATE app_user SET contact_phone = '911111111' WHERE clerk_user_id = 'user_profile';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 5a: the ordinary path updated % rows it should not see', n;
  END IF;

  SELECT o_contact_phone INTO v_phone
    FROM set_app_user_profile('user_profile', 'pt-PT', 'system', NULL, '911111111');
  IF v_phone <> '911111111' THEN
    RAISE EXCEPTION 'FAIL test 5b: the reviewed function returned %', v_phone;
  END IF;

  RAISE NOTICE 'PASS test 5: an orgless account edits its own profile only through the function';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 6 — the profile function cannot touch the name, and the cache defends
--          itself against a stale sync
--
-- The one to keep forever. Two halves:
--
--   a. `set_app_user_profile` takes no name parameter, so there is no argument
--      order that writes one. Asserted against pg_proc rather than by trying,
--      because "it did not work" is weaker than "it does not exist".
--   b. The cache still discards an older Clerk event. That guard is what makes
--      "write to Clerk, then re-read" safe: a webhook for a stale event landing
--      after our re-read cannot revert the name.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_args text; v_name text;
BEGIN
  SELECT pg_get_function_arguments(oid) INTO v_args
    FROM pg_proc WHERE proname = 'set_app_user_profile';

  IF v_args ILIKE '%name%' THEN
    RAISE EXCEPTION 'FAIL test 6a: set_app_user_profile takes a name parameter: %', v_args;
  END IF;

  -- Clerk says the name is now Rita Ferreira, at a later moment than the seed.
  PERFORM provision_app_user('user_profile', 'perfil@clube.pt', 'Rita', 'Ferreira', NULL,
                             '2026-08-27 09:00:00+00');

  SELECT cached_last_name INTO v_name FROM app_user WHERE clerk_user_id = 'user_profile';
  IF v_name <> 'Ferreira' THEN
    RAISE EXCEPTION 'FAIL test 6b: a newer Clerk event did not land: %', v_name;
  END IF;

  -- A retry of the older event arrives afterwards. It must change nothing.
  PERFORM provision_app_user('user_profile', 'perfil@clube.pt', 'Rita', 'Lopes', NULL,
                             '2026-08-26 09:00:00+00');

  SELECT cached_last_name INTO v_name FROM app_user WHERE clerk_user_id = 'user_profile';
  IF v_name <> 'Ferreira' THEN
    RAISE EXCEPTION 'FAIL test 6c: a stale Clerk event reverted the name to %', v_name;
  END IF;

  RAISE NOTICE 'PASS test 6: the name is Clerk''s alone, and a stale sync cannot revert it';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — the profile is invisible across tenants
--
-- A phone number is contact data about a person. It carries no organization_id
-- of its own, so the only thing standing between two tenants is the policy that
-- scopes app_user through membership.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org_a uuid; v_org_b uuid; v_user uuid; n int;
BEGIN
  v_user := (SELECT id FROM app_user WHERE clerk_user_id = 'user_profile');

  INSERT INTO organization (name, slug) VALUES ('Clube A', 'clube-a-profile')
    RETURNING id INTO v_org_a;
  INSERT INTO organization (name, slug) VALUES ('Clube B', 'clube-b-profile')
    RETURNING id INTO v_org_b;

  INSERT INTO membership (organization_id, app_user_id, status)
    VALUES (v_org_a, v_user, 'active');

  PERFORM set_app_user_profile('user_profile', 'pt-PT', 'system', NULL, '912222222');

  SET LOCAL ROLE poolse_app;

  -- Scoped to the organization this person belongs to: visible.
  PERFORM set_config('app.organization_id', v_org_a::text, true);
  SELECT count(*) INTO n FROM app_user WHERE contact_phone = '912222222';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 7a: their own organization saw % rows', n;
  END IF;

  -- Scoped to a different organization: gone.
  PERFORM set_config('app.organization_id', v_org_b::text, true);
  SELECT count(*) INTO n FROM app_user WHERE contact_phone = '912222222';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7b: another tenant read % contact numbers', n;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS test 7: a contact number is invisible to another tenant';
END $$;

ROLLBACK;
