-- Up Migration
--
-- "O meu perfil" — backlog round 3, story 1.
--
-- Two new columns and one new function, and the interesting part is what is NOT
-- here: the name and the email.
--
-- Clerk owns those. `cached_first_name`, `cached_last_name` and `cached_email`
-- are a cache of Clerk's copy, refreshed by the webhook and stamped with
-- `synced_at` so a late-arriving event cannot revert a newer one. Writing a name
-- straight into the cache would appear to work and then be silently overwritten
-- the next time Clerk syncs — a bug that reproduces only sometimes, which is the
-- expensive kind. So the save path for a name is: write to Clerk, let the cache
-- catch up. Nothing in this migration lets the application do otherwise.
--
-- `birth_date` and `contact_phone` are ours. Clerk has never heard of either, and
-- they sit beside `locale` and `theme_preference`, which are ours for the same
-- reason.

ALTER TABLE app_user
  ADD COLUMN birth_date    date,
  ADD COLUMN contact_phone text;

COMMENT ON COLUMN app_user.birth_date IS
  'The person''s own date of birth. Poolse''s, not Clerk''s.';
COMMENT ON COLUMN app_user.contact_phone IS
  'Free text on purpose: an international number has no single shape worth enforcing.';

-- A lower bound only. "Not in the future" is the check that actually catches
-- typos, and it cannot live here — CHECK constraints must be immutable and
-- current_date is not. It is enforced in set_app_user_profile below, which is
-- plpgsql and may ask what day it is.
ALTER TABLE app_user
  ADD CONSTRAINT app_user_birth_date_range
  CHECK (birth_date IS NULL OR birth_date >= DATE '1900-01-01');

-- Absent is a real answer and so is a number. An empty string is neither, and it
-- is what an untouched form field sends.
ALTER TABLE app_user
  ADD CONSTRAINT app_user_contact_phone_not_blank
  CHECK (contact_phone IS NULL OR btrim(contact_phone) <> '');

-- ---------------------------------------------------------------------------
-- find_app_user — now carrying the two new columns
--
-- Dropped and recreated rather than replaced: CREATE OR REPLACE cannot change
-- the return type of a set-returning function, and this one gains two output
-- columns. The down migration puts the seven-column version back.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS find_app_user(text);

CREATE FUNCTION find_app_user(p_clerk_user_id text)
RETURNS TABLE (
  o_id            uuid,
  o_email         text,
  o_first_name    text,
  o_last_name     text,
  o_avatar_url    text,
  o_locale        text,
  o_theme         text,
  o_birth_date    date,
  o_contact_phone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id,
         u.cached_email::text,
         u.cached_first_name,
         u.cached_last_name,
         u.cached_avatar_url,
         u.locale,
         u.theme_preference,
         u.birth_date,
         u.contact_phone
    FROM app_user u
   WHERE u.clerk_user_id = p_clerk_user_id
     AND u.deleted_at IS NULL;
$$;

-- ---------------------------------------------------------------------------
-- set_app_user_profile
--
-- Cross-tenant for the same reason set_app_user_preferences is, and it is worth
-- restating because it looks wrong every time: `app_user` carries no
-- organization_id, so its RLS policy scopes it *through membership*. An account
-- belonging to no organization cannot see its own row — the state every account
-- starts in — which makes "change my own phone number" a cross-tenant write.
--
-- Every parameter here is the new value, including NULL. That is the opposite of
-- set_app_user_preferences, where NULL means "leave this one alone", and the
-- difference is deliberate: that function backs two independent switches that
-- must not clobber each other, while this one backs a form that submits every
-- field at once. A person clearing their phone number sends NULL and means it.
--
-- locale and theme are the exception within the exception: the columns are NOT
-- NULL, there is no such thing as "no language", and the form always sends both.
-- Passing NULL for either is a caller bug and says so.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_app_user_profile(
  p_clerk_user_id text,
  p_locale        text,
  p_theme         text,
  p_birth_date    date,
  p_contact_phone text
) RETURNS TABLE (
  o_locale        text,
  o_theme         text,
  o_birth_date    date,
  o_contact_phone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_found boolean;
BEGIN
  IF p_locale IS NULL OR p_theme IS NULL THEN
    RAISE EXCEPTION 'set_app_user_profile: locale and theme are required';
  END IF;

  -- Checked here as well as by the constraints, so a bad value comes back as a
  -- sentence rather than as a constraint name the API would have to parse.
  IF p_locale NOT IN ('pt-PT', 'en') THEN
    RAISE EXCEPTION 'Unsupported locale: %', p_locale;
  END IF;
  IF p_theme NOT IN ('light', 'dark', 'system') THEN
    RAISE EXCEPTION 'Unsupported theme: %', p_theme;
  END IF;
  IF p_birth_date IS NOT NULL AND p_birth_date > current_date THEN
    RAISE EXCEPTION 'Birth date is in the future: %', p_birth_date;
  END IF;

  UPDATE app_user
     SET locale           = p_locale,
         theme_preference = p_theme,
         birth_date       = p_birth_date,
         contact_phone    = nullif(btrim(p_contact_phone), '')
   WHERE clerk_user_id = p_clerk_user_id
     AND deleted_at IS NULL
  RETURNING true INTO v_found;

  IF v_found IS NULL THEN
    RAISE EXCEPTION 'set_app_user_profile: no live app_user for %', p_clerk_user_id;
  END IF;

  RETURN QUERY
    SELECT u.locale, u.theme_preference, u.birth_date, u.contact_phone
      FROM app_user u
     WHERE u.clerk_user_id = p_clerk_user_id;
END;
$$;

REVOKE ALL ON FUNCTION find_app_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_app_user(text) TO poolse_app;

REVOKE ALL ON FUNCTION set_app_user_profile(text, text, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_app_user_profile(text, text, text, date, text) TO poolse_app;

-- Down Migration

DROP FUNCTION IF EXISTS set_app_user_profile(text, text, text, date, text);

DROP FUNCTION IF EXISTS find_app_user(text);

CREATE FUNCTION find_app_user(p_clerk_user_id text)
RETURNS TABLE (
  o_id         uuid,
  o_email      text,
  o_first_name text,
  o_last_name  text,
  o_avatar_url text,
  o_locale     text,
  o_theme      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id,
         u.cached_email::text,
         u.cached_first_name,
         u.cached_last_name,
         u.cached_avatar_url,
         u.locale,
         u.theme_preference
    FROM app_user u
   WHERE u.clerk_user_id = p_clerk_user_id
     AND u.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION find_app_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_app_user(text) TO poolse_app;

ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_contact_phone_not_blank;
ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_birth_date_range;

ALTER TABLE app_user
  DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS birth_date;
