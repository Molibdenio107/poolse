-- Up Migration
--
-- POOLSE-124 — sports as paid modules: pool on by default, each other sport
-- switched on per club by Rui.
--
-- **Stored as what is switched on**, the other way round from
-- `disabled_modules`: a module is part of the product a trial gets whole, a
-- sport is an add-on a club pays for. `{pool}` is the default, so every signup
-- through any provisioning function is a pool club with nothing to set.
--
-- **Pool cannot be switched off** (Decided 8): the pilot is a pool. A CHECK, to
-- be lifted the day a tennis-only club appears.
--
-- **Keys, not ids**: the array holds `sport.id`, which is the readable key
-- ('tennis'), so `/me` carries it with no join. An array cannot carry a foreign
-- key, so `organization_sports_known` refuses a key the catalogue does not have.
--
-- **Switching a sport off with live recintos is refused, naming them** — archive
-- them first. Switching off hides and refuses; it never archives on the
-- operator's behalf, which is POOLSE-87's rule for module dependencies. And a
-- recinto may be made, or restored from the bin, only for a sport that is on.
--
-- **Written by the platform only**, through `changeTenant`. Since POOLSE-87
-- `poolse_app` holds UPDATE on `organization` column by column, so a new column
-- is not app-writable unless a migration says so — and this one does not.
--
-- **The platform reads `playing_area`** — one more tenant table on its SELECT
-- policy, taken out loud (docs/decisions.md, 29-10-2026). The refusal above is a
-- trigger that runs as whoever writes `enabled_sports`, which is the platform,
-- and the /admin block shows the recinto count beside each sport. A recinto is a
-- court's name and its sport — nothing about a person.
--
-- **An add-on's price is a platform setting** (`sport.addon_monthly_cents`),
-- null meaning not priced yet, which is every sport today. Nothing is charged
-- from it; the subscription page and /admin list it beside the sport.

ALTER TABLE organization
  ADD COLUMN enabled_sports text[] NOT NULL DEFAULT '{pool}',
  ADD CONSTRAINT organization_pool_always_on CHECK ('pool' = ANY (enabled_sports));

COMMENT ON COLUMN organization.enabled_sports IS
  'POOLSE-124: the sports this club has switched on, by sport.id. Always holds pool (CHECK). Written by poolse_platform through changeTenant only. A sport with live recintos cannot leave it.';

-- The array's foreign key, and the refusal that names the recintos in the way.
CREATE FUNCTION organization_sports_known() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unknown text;
  v_sport   text;
  v_names   text;
BEGIN
  SELECT s INTO v_unknown
    FROM unnest(NEW.enabled_sports) AS s
   WHERE NOT EXISTS (SELECT 1 FROM sport WHERE sport.id = s)
   LIMIT 1;
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'unknown sport %', v_unknown
      USING ERRCODE = 'foreign_key_violation', DETAIL = format('sport_unknown|%s', v_unknown);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT a.sport_id, string_agg(a.name, ', ' ORDER BY a.name)
      INTO v_sport, v_names
      FROM playing_area a
     WHERE a.organization_id = NEW.id
       AND a.archived_at IS NULL
       AND a.sport_id = ANY (OLD.enabled_sports)
       AND NOT (a.sport_id = ANY (NEW.enabled_sports))
     GROUP BY a.sport_id
     ORDER BY a.sport_id
     LIMIT 1;
    IF v_sport IS NOT NULL THEN
      RAISE EXCEPTION 'sport % still has live recintos', v_sport
        USING ERRCODE = 'check_violation', DETAIL = format('sport_in_use|%s|%s', v_sport, v_names);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_sports_known
  BEFORE INSERT OR UPDATE OF enabled_sports ON organization
  FOR EACH ROW EXECUTE FUNCTION organization_sports_known();

-- A recinto only for a sport that is on — made, or brought back from the bin.
CREATE FUNCTION playing_area_sport_enabled() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_enabled text[];
BEGIN
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.archived_at IS NULL THEN
    RETURN NEW;
  END IF;
  -- A club this caller cannot see is left to the tenant policy to refuse, so a
  -- cross-tenant write fails as one rather than as a sport that is off.
  SELECT o.enabled_sports INTO v_enabled FROM organization o WHERE o.id = NEW.organization_id;
  IF FOUND AND NOT (NEW.sport_id = ANY (v_enabled)) THEN
    RAISE EXCEPTION 'sport % is not enabled for this club', NEW.sport_id
      USING ERRCODE = 'check_violation', DETAIL = format('sport_not_enabled|%s', NEW.sport_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER playing_area_sport_enabled
  BEFORE INSERT OR UPDATE OF archived_at ON playing_area
  FOR EACH ROW EXECUTE FUNCTION playing_area_sport_enabled();

-- The add-on's price: Poolse's own, per sport, null until Rui decides it.
ALTER TABLE sport
  ADD COLUMN addon_monthly_cents integer,
  ADD COLUMN addon_currency      char(3) NOT NULL DEFAULT 'EUR',
  ADD COLUMN addon_provenance    money_provenance NOT NULL DEFAULT 'contracted',
  ADD CONSTRAINT sport_addon_not_negative CHECK (addon_monthly_cents IS NULL OR addon_monthly_cents >= 0),
  -- The pool is the subscription itself, never an add-on line.
  ADD CONSTRAINT sport_pool_not_addon CHECK (id <> 'pool' OR addon_monthly_cents IS NULL);

COMMENT ON COLUMN sport.addon_monthly_cents IS
  'POOLSE-124: what switching this sport on adds to a subscription, per month, gross. Null is not priced yet. Platform-set; nothing is charged from it.';

-- The platform's reach: write the switch, read the catalogue and the recintos.
GRANT UPDATE (enabled_sports) ON organization TO poolse_platform;
GRANT SELECT ON sport TO poolse_platform;
GRANT SELECT ON playing_area TO poolse_platform;
CREATE POLICY playing_area_platform ON playing_area FOR SELECT TO poolse_platform USING (true);

-- `/me` carries the switched-on list beside the modules.
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
  o_support_expires_at  timestamptz,
  o_disabled_modules    text[]
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
         o.disabled_modules::text[]
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
     AND (
       m.support_grant_id IS NULL
       OR (
         sg.ended_at IS NULL AND sg.starts_at <= now() AND sg.expires_at > now()
         AND EXISTS (
           SELECT 1 FROM platform_admin pa
            WHERE pa.clerk_user_id = u.clerk_user_id AND pa.archived_at IS NULL
         )
       )
     )
GROUP BY u.id, m.organization_id, o.name, o.slug, o.kind, m.id, m.created_at,
         m.support_grant_id, o.subscription_status, o.trial_ends_at, o.suspended_at,
         o.suspension_reason, o.read_only_at, o.pending_delete_at, sg.expires_at,
         o.disabled_modules
ORDER BY m.created_at;
$$;

REVOKE ALL ON FUNCTION resolve_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;

DROP POLICY playing_area_platform ON playing_area;
REVOKE SELECT ON playing_area FROM poolse_platform;
REVOKE SELECT ON sport FROM poolse_platform;
REVOKE UPDATE (enabled_sports) ON organization FROM poolse_platform;

ALTER TABLE sport
  DROP CONSTRAINT sport_pool_not_addon,
  DROP CONSTRAINT sport_addon_not_negative,
  DROP COLUMN addon_provenance,
  DROP COLUMN addon_currency,
  DROP COLUMN addon_monthly_cents;

DROP TRIGGER playing_area_sport_enabled ON playing_area;
DROP FUNCTION playing_area_sport_enabled();
DROP TRIGGER organization_sports_known ON organization;
DROP FUNCTION organization_sports_known();

ALTER TABLE organization
  DROP CONSTRAINT organization_pool_always_on,
  DROP COLUMN enabled_sports;
