-- Up Migration

-- POOLSE-145 slice a — a staff member belongs to the sports the club assigns
-- them (Rui, 01-11-2026: "explicit. It can be changed later by the owner/admin").
--
-- `membership.sports` holds `sport.id` keys. **Backfilled `{pool}` in the
-- statement that adds the column**, so every existing person — staff, families,
-- everybody — belongs to swimming the moment it exists, and a pool-only club
-- reads exactly as it did (rule 7). Never empty, by CHECK: a person who belongs
-- to no sport would see nobody, which is a mistake rather than a setting.
--
-- **Only a sport the club has on**, by a BEFORE trigger, because a CHECK cannot
-- read `organization`. Switching a sport off with instructors still in it is
-- refused by the platform's own path, naming them (rule 2); a sport left behind
-- on a person whose club turned it off is inert, because every reader also
-- requires the club to have it on.
--
-- Nothing reads it for a decision yet: slice b's `requireSport` does. This
-- slice carries it to `/me` (`resolve_memberships` gains `o_sports`).
--
-- `membership` is granted table-wide to `poolse_app`, so no grant is needed.

ALTER TABLE membership
  ADD COLUMN sports text[] NOT NULL DEFAULT '{pool}',
  ADD CONSTRAINT membership_sports_not_empty CHECK (cardinality(sports) >= 1);

COMMENT ON COLUMN membership.sports IS
  'POOLSE-145: the sports this person belongs to (sport.id). An instructor reads only these '
  'sports'' students; owner and admin read every sport whatever this holds. {pool} for every '
  'existing person.';

CREATE FUNCTION membership_sports_enabled() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE v_off text; v_enabled text[];
BEGIN
  SELECT o.enabled_sports::text[] INTO v_enabled FROM organization o WHERE o.id = NEW.organization_id;
  SELECT s INTO v_off
    FROM unnest(NEW.sports) AS s
   WHERE NOT (s = ANY (coalesce(v_enabled, '{pool}')))
   LIMIT 1;
  IF v_off IS NOT NULL THEN
    RAISE EXCEPTION 'sport % is not on for this club', v_off
      USING ERRCODE = 'check_violation', DETAIL = format('sport_not_enabled|%s', v_off);
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER membership_sports_enabled
  BEFORE INSERT OR UPDATE OF sports ON membership
  FOR EACH ROW EXECUTE FUNCTION membership_sports_enabled();

DROP FUNCTION IF EXISTS resolve_memberships(text);

CREATE FUNCTION resolve_memberships(p_clerk_user_id text)
RETURNS TABLE (
  o_app_user_id         uuid,
  o_organization_id     uuid,
  o_organization_name   text,
  o_organization_slug   text,
  o_organization_kind   text,
  o_membership_id       uuid,
  o_roles               text[],
  o_subscription_status text,
  o_trial_ends_at       timestamptz,
  o_suspended_at        timestamptz,
  o_suspension_reason   text,
  o_read_only_at        timestamptz,
  o_pending_delete_at   timestamptz,
  -- Set only on a support membership: when its session ends, for the banner.
  o_support_expires_at  timestamptz,
  -- POOLSE-87: what this club has switched off.
  o_disabled_modules    text[],
  -- POOLSE-124: the sports this club has switched on.
  o_enabled_sports      text[],
  -- POOLSE-145: the sports this person belongs to.
  o_sports              text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id,
         m.organization_id,
         o.name,
         o.slug,
         o.kind::text,
         m.id,
         CASE
           WHEN m.support_grant_id IS NOT NULL THEN ARRAY['admin']::text[]
           ELSE coalesce(
             array_agg(mr.role::text ORDER BY mr.role::text)
               FILTER (WHERE mr.archived_at IS NULL),
             '{}'::text[]
           )
         END,
         o.subscription_status::text,
         o.trial_ends_at,
         o.suspended_at,
         o.suspension_reason,
         o.read_only_at,
         o.pending_delete_at,
         sg.expires_at,
         o.disabled_modules::text[],
         o.enabled_sports,
         m.sports
    FROM app_user u
    JOIN membership m    ON m.app_user_id = u.id
                        AND m.archived_at IS NULL
                        AND m.status = 'active'
    JOIN organization o  ON o.id = m.organization_id
                        AND o.archived_at IS NULL
    LEFT JOIN support_grant sg ON sg.organization_id = m.organization_id
                              AND sg.id = m.support_grant_id
    LEFT JOIN membership_role mr ON mr.organization_id = m.organization_id
                                AND mr.membership_id = m.id
   WHERE u.clerk_user_id = p_clerk_user_id
     AND u.deleted_at IS NULL
     -- A support membership only while its grant is live. Read at every
     -- request, so expiry and revocation need nothing to run.
     AND (
       m.support_grant_id IS NULL
       OR (
         sg.ended_at IS NULL AND sg.starts_at <= now() AND sg.expires_at > now()
         -- And only while the operator is still a platform admin — sweep of
         -- 15-10-2026: removing one left them an admin of every club they had
         -- entered until the grant ran out.
         AND EXISTS (
           SELECT 1 FROM platform_admin pa
            WHERE pa.clerk_user_id = u.clerk_user_id AND pa.archived_at IS NULL
         )
       )
     )
GROUP BY u.id, m.organization_id, o.name, o.slug, o.kind, m.id, m.created_at,
         m.support_grant_id, o.subscription_status, o.trial_ends_at, o.suspended_at,
         o.suspension_reason, o.read_only_at, o.pending_delete_at, sg.expires_at,
         o.disabled_modules, o.enabled_sports, m.sports
ORDER BY m.created_at;
$$;

REVOKE ALL ON FUNCTION resolve_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;

-- Down Migration

DROP FUNCTION IF EXISTS resolve_memberships(text);

CREATE FUNCTION resolve_memberships(p_clerk_user_id text)
RETURNS TABLE (
  o_app_user_id         uuid,
  o_organization_id     uuid,
  o_organization_name   text,
  o_organization_slug   text,
  o_organization_kind   text,
  o_membership_id       uuid,
  o_roles               text[],
  o_subscription_status text,
  o_trial_ends_at       timestamptz,
  o_suspended_at        timestamptz,
  o_suspension_reason   text,
  o_read_only_at        timestamptz,
  o_pending_delete_at   timestamptz,
  -- Set only on a support membership: when its session ends, for the banner.
  o_support_expires_at  timestamptz,
  -- POOLSE-87: what this club has switched off.
  o_disabled_modules    text[],
  -- POOLSE-124: the sports this club has switched on.
  o_enabled_sports      text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id,
         m.organization_id,
         o.name,
         o.slug,
         o.kind::text,
         m.id,
         CASE
           WHEN m.support_grant_id IS NOT NULL THEN ARRAY['admin']::text[]
           ELSE coalesce(
             array_agg(mr.role::text ORDER BY mr.role::text)
               FILTER (WHERE mr.archived_at IS NULL),
             '{}'::text[]
           )
         END,
         o.subscription_status::text,
         o.trial_ends_at,
         o.suspended_at,
         o.suspension_reason,
         o.read_only_at,
         o.pending_delete_at,
         sg.expires_at,
         o.disabled_modules::text[],
         o.enabled_sports
    FROM app_user u
    JOIN membership m    ON m.app_user_id = u.id
                        AND m.archived_at IS NULL
                        AND m.status = 'active'
    JOIN organization o  ON o.id = m.organization_id
                        AND o.archived_at IS NULL
    LEFT JOIN support_grant sg ON sg.organization_id = m.organization_id
                              AND sg.id = m.support_grant_id
    LEFT JOIN membership_role mr ON mr.organization_id = m.organization_id
                                AND mr.membership_id = m.id
   WHERE u.clerk_user_id = p_clerk_user_id
     AND u.deleted_at IS NULL
     -- A support membership only while its grant is live. Read at every
     -- request, so expiry and revocation need nothing to run.
     AND (
       m.support_grant_id IS NULL
       OR (
         sg.ended_at IS NULL AND sg.starts_at <= now() AND sg.expires_at > now()
         -- And only while the operator is still a platform admin — sweep of
         -- 15-10-2026: removing one left them an admin of every club they had
         -- entered until the grant ran out.
         AND EXISTS (
           SELECT 1 FROM platform_admin pa
            WHERE pa.clerk_user_id = u.clerk_user_id AND pa.archived_at IS NULL
         )
       )
     )
GROUP BY u.id, m.organization_id, o.name, o.slug, o.kind, m.id, m.created_at,
         m.support_grant_id, o.subscription_status, o.trial_ends_at, o.suspended_at,
         o.suspension_reason, o.read_only_at, o.pending_delete_at, sg.expires_at,
         o.disabled_modules, o.enabled_sports
ORDER BY m.created_at;
$$;

REVOKE ALL ON FUNCTION resolve_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;

DROP TRIGGER IF EXISTS membership_sports_enabled ON membership;
DROP FUNCTION IF EXISTS membership_sports_enabled();
ALTER TABLE membership
  DROP CONSTRAINT IF EXISTS membership_sports_not_empty,
  DROP COLUMN IF EXISTS sports;
