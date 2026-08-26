-- Up Migration
--
-- Phase 0.6 + 0.7: make `app_user.locale` and `app_user.theme_preference` mean
-- something.
--
-- Both columns have existed since slice 0.2 and nothing has ever read or written
-- them. The application resolves neither: every request renders `pt-PT`, and the
-- theme lives in one browser's localStorage. That is the gap this closes — the
-- preference follows the person to a second device, which is the only reason to
-- store it server-side at all.
--
-- Two things happen here.
--
-- 1. CHECK constraints, so the set of valid values is a property of the database
--    rather than a convention. Adding a locale then costs a migration — correct,
--    because it also costs a translation file, and a row holding 'fr' with no
--    `fr.json` behind it is a crash on somebody's next sign-in.
--
-- 2. A reviewed function to write them. This one is less obvious than the others
--    and worth spelling out: `app_user` carries no organization_id, so its RLS
--    policy scopes it *through membership* — you can see a person only if they
--    are a member of the organization you are scoped to. A user who belongs to no
--    organization therefore cannot see, let alone update, their own row. Since
--    that is the state every account starts in, "change my language" is a
--    cross-tenant write, however strange that reads.

-- ---------------------------------------------------------------------------
-- Constrain what the columns may hold
--
-- Existing rows all carry the defaults, so neither constraint needs a backfill.
-- ---------------------------------------------------------------------------

ALTER TABLE app_user
  ADD CONSTRAINT app_user_locale_supported
  CHECK (locale IN ('pt-PT', 'en'));

ALTER TABLE app_user
  ADD CONSTRAINT app_user_theme_supported
  CHECK (theme_preference IN ('light', 'dark', 'system'));

COMMENT ON COLUMN app_user.locale IS
  'Interface language. Kept in step with apps/web/src/messages/<locale>.json.';
COMMENT ON COLUMN app_user.theme_preference IS
  'light | dark | system. system means follow the operating system.';

-- ---------------------------------------------------------------------------
-- set_app_user_preferences
--
-- NULL means "leave this one alone", so the locale switch and the theme toggle
-- can share an endpoint without either clobbering the other. Clerk owns the name
-- and the email; these two belong to the person inside Poolse and are the only
-- things about themselves they can change here.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_app_user_preferences(
  p_clerk_user_id text,
  p_locale        text,
  p_theme         text
) RETURNS TABLE (
  o_locale text,
  o_theme  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_locale text;
  v_theme  text;
BEGIN
  -- Checked here as well as by the constraint: a bad value should come back as a
  -- clear message, not as a constraint name the API would have to parse.
  IF p_locale IS NOT NULL AND p_locale NOT IN ('pt-PT', 'en') THEN
    RAISE EXCEPTION 'Unsupported locale: %', p_locale;
  END IF;
  IF p_theme IS NOT NULL AND p_theme NOT IN ('light', 'dark', 'system') THEN
    RAISE EXCEPTION 'Unsupported theme: %', p_theme;
  END IF;

  UPDATE app_user
     SET locale           = coalesce(p_locale, locale),
         theme_preference = coalesce(p_theme, theme_preference)
   WHERE clerk_user_id = p_clerk_user_id
     AND deleted_at IS NULL
  RETURNING locale, theme_preference INTO v_locale, v_theme;

  IF v_locale IS NULL THEN
    RAISE EXCEPTION 'set_app_user_preferences: no live app_user for %', p_clerk_user_id;
  END IF;

  RETURN QUERY SELECT v_locale, v_theme;
END;
$$;

REVOKE ALL ON FUNCTION set_app_user_preferences(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_app_user_preferences(text, text, text) TO poolse_app;

-- Down Migration

DROP FUNCTION IF EXISTS set_app_user_preferences(text, text, text);

ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_theme_supported;
ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_locale_supported;
