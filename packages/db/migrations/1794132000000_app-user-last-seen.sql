-- Up Migration
--
-- POOLSE-130 — when each person last used Poolse (Rui, 30-10-2026: "add a log
-- for record, for last logged in at"). *Usa a app* says somebody joined once;
-- the office's question is whether a family still opens it.
--
-- Poolse's own column, not a Clerk cache, written by `/me` at most once every
-- fifteen minutes per login: a busy afternoon must not be a write per request.
-- `/me` runs before any club is chosen, so the write is a definer function keyed
-- on the Clerk id — the `set_app_user_preferences` pattern — and touches the
-- caller's own row and that one column, nothing else.

ALTER TABLE app_user ADD COLUMN last_seen_at timestamptz;

COMMENT ON COLUMN app_user.last_seen_at IS
  'The last time this login opened Poolse, to within 15 minutes (POOLSE-130). Ours, not Clerk''s.';

CREATE OR REPLACE FUNCTION touch_app_user_seen(p_clerk_user_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE app_user
     SET last_seen_at = now()
   WHERE clerk_user_id = p_clerk_user_id
     AND deleted_at IS NULL
     AND (last_seen_at IS NULL OR last_seen_at < now() - interval '15 minutes');
$$;

REVOKE ALL ON FUNCTION touch_app_user_seen(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION touch_app_user_seen(text) TO poolse_app;

-- Down Migration

DROP FUNCTION touch_app_user_seen(text);
ALTER TABLE app_user DROP COLUMN last_seen_at;
