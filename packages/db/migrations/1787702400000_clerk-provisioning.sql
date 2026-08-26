-- Up Migration
--
-- Phase 0.4: the database side of Clerk wiring.
--
-- Two things happen here, and the second one is a correction to slice 0.3.
--
-- 1. `app_user` gains `deleted_at`, and the Clerk webhook gets the only sanctioned
--    way to write the name/email cache.
--
-- 2. Cross-tenant lookups move into SECURITY DEFINER functions.
--
--    Slice 0.3 assumed `withoutTenantScope` could read across tenants. It cannot:
--    it skips the GUC but still connects as poolse_app, so every RLS policy sees
--    `current_organization_id() = NULL`, evaluates false, and returns nothing. That
--    is the correct behaviour — it is the whole point of the design — but it means
--    "which organizations does this person belong to?" is unanswerable through
--    normal queries, and that question has to be answered *before* a tenant is known.
--
--    The alternative fixes were worse. Granting poolse_app BYPASSRLS or adding
--    permissive policies would re-open exactly the hole slice 0.3 closed: a query
--    that forgets its WHERE clause would see everything again. A SECURITY DEFINER
--    function runs as the owner, so it bypasses RLS — but only inside a function
--    whose body is fixed, reviewable, and takes the Clerk user id as its only
--    input. The exception is narrow and visible instead of ambient.
--
--    Rule that follows from this: if request-path code needs to cross tenants, it
--    calls one of these functions. There is no general escape hatch.

-- ---------------------------------------------------------------------------
-- app_user.deleted_at
--
-- Clerk's user.deleted cannot become a DELETE here: memberships reference the row,
-- and so will attendance, invoices and audit entries. The account is marked dead
-- and its cached personal data cleared, which is also the right answer for an
-- erasure request — the tombstone keeps referential integrity, the cache does not
-- keep the person's name.
-- ---------------------------------------------------------------------------

ALTER TABLE app_user ADD COLUMN deleted_at timestamptz;

-- ---------------------------------------------------------------------------
-- provision_app_user — the Clerk webhook's only write path
--
-- `p_event_at` is the Clerk event timestamp, not now(). Webhooks are delivered at
-- least once and in no guaranteed order, so a retried user.created can land after
-- a user.updated; comparing against synced_at makes a stale event a no-op instead
-- of a silent revert to older data.
--
-- locale and theme_preference are deliberately not touched: those belong to the
-- user inside Poolse, and Clerk knows nothing about them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION provision_app_user(
  p_clerk_user_id text,
  p_email         text,
  p_first_name    text,
  p_last_name     text,
  p_avatar_url    text,
  p_event_at      timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_clerk_user_id IS NULL OR p_clerk_user_id = '' THEN
    RAISE EXCEPTION 'provision_app_user requires a clerk_user_id';
  END IF;

  INSERT INTO app_user (
    clerk_user_id, cached_email, cached_first_name, cached_last_name,
    cached_avatar_url, synced_at
  )
  VALUES (
    p_clerk_user_id,
    nullif(p_email, '')::citext,
    nullif(p_first_name, ''),
    nullif(p_last_name, ''),
    nullif(p_avatar_url, ''),
    p_event_at
  )
  ON CONFLICT (clerk_user_id) DO UPDATE
     SET cached_email      = excluded.cached_email,
         cached_first_name = excluded.cached_first_name,
         cached_last_name  = excluded.cached_last_name,
         cached_avatar_url = excluded.cached_avatar_url,
         synced_at         = excluded.synced_at,
         -- A live event about a user Clerk still has means they are not deleted.
         deleted_at        = NULL
   WHERE app_user.synced_at IS NULL OR app_user.synced_at <= excluded.synced_at
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- The row exists but the guard above skipped the update: a stale event
    -- arriving after a newer one. Return the row unchanged rather than failing —
    -- the webhook succeeded in the only sense that matters.
    SELECT id INTO v_id FROM app_user WHERE clerk_user_id = p_clerk_user_id;
  END IF;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- deactivate_app_user — Clerk's user.deleted
--
-- Memberships are archived with the account. An organization cannot have an active
-- member whose identity provider no longer has an account for them, and leaving the
-- membership live would leave an instructor on a turma who can never sign in again.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION deactivate_app_user(
  p_clerk_user_id text,
  p_event_at      timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE app_user
     SET deleted_at        = coalesce(deleted_at, p_event_at),
         cached_email      = NULL,
         cached_first_name = NULL,
         cached_last_name  = NULL,
         cached_avatar_url = NULL,
         synced_at         = p_event_at
   WHERE clerk_user_id = p_clerk_user_id
     AND (synced_at IS NULL OR synced_at <= p_event_at)
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    UPDATE membership
       SET archived_at = coalesce(archived_at, p_event_at)
     WHERE app_user_id = v_id
       AND archived_at IS NULL;
  END IF;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- resolve_memberships — "who is this person, and where do they belong?"
--
-- Called by the tenant middleware on every request, before any organization is
-- known. Output columns are prefixed so nothing in the body can silently resolve
-- to an output parameter instead of a table column.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION resolve_memberships(p_clerk_user_id text)
RETURNS TABLE (
  o_app_user_id      uuid,
  o_organization_id  uuid,
  o_organization_name text,
  o_membership_id    uuid,
  o_roles            text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id,
         m.organization_id,
         o.name,
         m.id,
         coalesce(
           array_agg(mr.role::text ORDER BY mr.role::text)
             FILTER (WHERE mr.archived_at IS NULL),
           '{}'::text[]
         )
    FROM app_user u
    JOIN membership m    ON m.app_user_id = u.id
                        AND m.archived_at IS NULL
                        AND m.status = 'active'
    JOIN organization o  ON o.id = m.organization_id
                        AND o.archived_at IS NULL
    LEFT JOIN membership_role mr ON mr.organization_id = m.organization_id
                                AND mr.membership_id = m.id
   WHERE u.clerk_user_id = p_clerk_user_id
     AND u.deleted_at IS NULL
GROUP BY u.id, m.organization_id, o.name, m.id, m.created_at
ORDER BY m.created_at;
$$;

-- ---------------------------------------------------------------------------
-- find_app_user — identity without a tenant
--
-- A person who has signed up but holds no membership yet is the normal state
-- between slice 0.4 and slice 0.5. They still need to see who they are signed in
-- as, so this is separate from resolve_memberships rather than a join with it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION find_app_user(p_clerk_user_id text)
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

-- ---------------------------------------------------------------------------
-- Grants
--
-- EXECUTE defaults to PUBLIC, which would hand these to any future role. Revoked
-- first, then granted to exactly the one role that needs them.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION provision_app_user(text, text, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION deactivate_app_user(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_memberships(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION find_app_user(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION provision_app_user(text, text, text, text, text, timestamptz) TO poolse_app;
GRANT EXECUTE ON FUNCTION deactivate_app_user(text, timestamptz) TO poolse_app;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;
GRANT EXECUTE ON FUNCTION find_app_user(text) TO poolse_app;

-- Down Migration

DROP FUNCTION IF EXISTS find_app_user(text);
DROP FUNCTION IF EXISTS resolve_memberships(text);
DROP FUNCTION IF EXISTS deactivate_app_user(text, timestamptz);
DROP FUNCTION IF EXISTS provision_app_user(text, text, text, text, text, timestamptz);

ALTER TABLE app_user DROP COLUMN IF EXISTS deleted_at;
