-- User preferences proof — slices 0.6 and 0.7.
--
-- Small suite, one test in it that matters more than the rest. Test 4 is the
-- reason `set_app_user_preferences` exists at all: `app_user` is scoped through
-- membership, so an account belonging to no organization cannot see its own row.
-- Every account starts in that state, which makes "change my language" a
-- cross-tenant write — a sentence that reads wrong until you follow the policy.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_pref', 'pref@clube.pt', 'Rita', 'Lopes', NULL, '2026-08-26 09:00:00+00');

-- ---------------------------------------------------------------------------
-- Test 1 — the defaults are the Portuguese product, following the system theme
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  SELECT locale, theme_preference AS theme INTO r
    FROM app_user WHERE clerk_user_id = 'user_pref';

  IF r.locale <> 'pt-PT' OR r.theme <> 'system' THEN
    RAISE EXCEPTION 'FAIL test 1: new account defaulted to %, %', r.locale, r.theme;
  END IF;
  RAISE NOTICE 'PASS test 1: a new account defaults to pt-PT and the system theme';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — one switch does not clobber the other
--
-- The locale switcher and the theme toggle are separate controls sharing one
-- endpoint. NULL means "leave it alone"; a PUT-shaped write would have the
-- language reset every time somebody changed the theme.
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  SELECT o_locale AS locale, o_theme AS theme INTO r
    FROM set_app_user_preferences('user_pref', 'en', NULL);
  IF r.locale <> 'en' OR r.theme <> 'system' THEN
    RAISE EXCEPTION 'FAIL test 2a: locale change returned %, %', r.locale, r.theme;
  END IF;

  SELECT o_locale AS locale, o_theme AS theme INTO r
    FROM set_app_user_preferences('user_pref', NULL, 'dark');
  IF r.locale <> 'en' OR r.theme <> 'dark' THEN
    RAISE EXCEPTION 'FAIL test 2b: theme change reset the locale (%, %)', r.locale, r.theme;
  END IF;

  RAISE NOTICE 'PASS test 2: changing one preference leaves the other alone';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — a locale with no translation file behind it cannot be stored
--
-- The CHECK constraint is the point: a row holding 'fr' with no fr.json is a
-- crash on that person's next sign-in, and it would be stored by whichever code
-- path forgot to validate.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  BEGIN
    UPDATE app_user SET locale = 'fr' WHERE clerk_user_id = 'user_pref';
    RAISE EXCEPTION 'FAIL test 3a: an unsupported locale was stored';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    PERFORM set_app_user_preferences('user_pref', 'fr', NULL);
    RAISE EXCEPTION 'FAIL test 3b: the function accepted an unsupported locale';
  EXCEPTION
    WHEN raise_exception THEN NULL;
  END;

  BEGIN
    UPDATE app_user SET theme_preference = 'neon' WHERE clerk_user_id = 'user_pref';
    RAISE EXCEPTION 'FAIL test 3c: an unsupported theme was stored';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 3: only locales and themes the app can render are storable';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — an account in no organization can still change its own language
--
-- Keep this one. `app_user` has no organization_id, so its policy scopes it
-- through membership: you see a person only if they are a member of the
-- organization you are scoped to. Nobody is a member of anything here, so the
-- ordinary UPDATE quietly touches zero rows — no error, no change, exactly the
-- kind of failure that reaches production. The function is the way through.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE n int; v_locale text;
BEGIN
  PERFORM set_config('app.organization_id', '', true);

  UPDATE app_user SET locale = 'pt-PT' WHERE clerk_user_id = 'user_pref';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 4a: the ordinary path updated % rows it should not see', n;
  END IF;

  SELECT o_locale INTO v_locale FROM set_app_user_preferences('user_pref', 'pt-PT', NULL);
  IF v_locale <> 'pt-PT' THEN
    RAISE EXCEPTION 'FAIL test 4b: the reviewed function returned %', v_locale;
  END IF;

  RAISE NOTICE 'PASS test 4: an orgless account changes its own preferences only through the function';
END $$;

RESET ROLE;

ROLLBACK;
