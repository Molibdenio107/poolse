-- Up Migration
--
-- POOLSE-87 slice 1 — modules switched on and off per club, from /admin.
--
-- The pilot goes live scoped to the teaching operation (Rui, 20-10-2026), and
-- every other module is already built. This lets Rui hide a module from one
-- club without deleting code or data, and switch it on when the club is ready.
--
-- **Stored as what is switched off.** An empty list is the full product, so a
-- trial is uncapped with nobody remembering to set it, and every signup —
-- through any of the provisioning functions — gets the default.
--
-- **Switching off hides and refuses; it never deletes.** Nothing here touches a
-- row in any module's tables.
--
-- **Written by the platform only.** `poolse_platform` gets `UPDATE
-- (disabled_modules)`, the ninth column of its organization grant, and writes it
-- through `changeTenant`, which audits and alerts. `poolse_app` held a
-- table-wide UPDATE on `organization`, which a column grant cannot narrow
-- (POOLSE-73's rule), so it is revoked and re-granted column by column — every
-- column the app could write before, and not this one. A column added to
-- `organization` later is therefore not app-writable until a migration says so.

CREATE TYPE poolse_module AS ENUM (
  'messages',
  'incidents',
  'reception',
  'competition',
  'water_quality',
  'invoicing',
  'maintenance',
  'energy',
  'salaries',
  'vacations',
  'qualifications'
);

COMMENT ON TYPE poolse_module IS
  'POOLSE-87: the switchable parts of Poolse. Spelled exactly as POOLSE_MODULES in @poolse/rules; modules.integration.test.ts compares them.';

-- Dependencies are refused, never resolved: a module may not stay on while
-- something it needs is off. The one known today: reception needs invoicing,
-- because a free-swim sale is an invoice_line (Rui, 20-10-2026). The same map
-- is MODULE_REQUIRES in @poolse/rules, and the integration test proves the two
-- agree over every pair.
CREATE FUNCTION modules_consistent(p_disabled poolse_module[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT NOT (
    'invoicing' = ANY (p_disabled) AND NOT ('reception' = ANY (p_disabled))
  );
$$;

ALTER TABLE organization
  ADD COLUMN disabled_modules poolse_module[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT organization_modules_consistent CHECK (modules_consistent(disabled_modules));

COMMENT ON COLUMN organization.disabled_modules IS
  'POOLSE-87: the modules switched off for this club; empty is everything on. Written by poolse_platform through changeTenant only. Hides and refuses, never deletes. Read it ::text[].';

-- The app's write reach, column by column, minus the new one.
REVOKE UPDATE ON organization FROM poolse_app;

DO $do$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    INTO cols
    FROM pg_attribute
   WHERE attrelid = 'organization'::regclass
     AND attnum > 0
     AND NOT attisdropped
     AND attname <> 'disabled_modules';
  EXECUTE format('GRANT UPDATE (%s) ON organization TO poolse_app', cols);
END
$do$;

GRANT UPDATE (disabled_modules) ON organization TO poolse_platform;

-- The membership carries the list, so the API's module guard costs no query.
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
         o.disabled_modules
ORDER BY m.created_at;
$$;

REVOKE ALL ON FUNCTION resolve_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;

-- The public water page of a club with water quality off answers like any
-- other miss. One more condition on the lookup, rewritten in place rather than
-- copying the whole function (the shape the 15-10-2026 sweep used), and refused
-- loudly if the text it expects has moved.
DO $do$
DECLARE
  def text;
  rewritten text;
BEGIN
  def := pg_get_functiondef('public_water_page(text)'::regprocedure);
  rewritten := replace(
    def,
    'AND o.archived_at IS NULL;',
    'AND o.archived_at IS NULL' || chr(10) ||
    '     AND NOT (''water_quality'' = ANY (o.disabled_modules));'
  );
  IF rewritten = def THEN
    RAISE EXCEPTION 'public_water_page: the organization filter was not found';
  END IF;
  EXECUTE rewritten;
END
$do$;

-- Down Migration

DO $do$
DECLARE
  def text;
  rewritten text;
BEGIN
  def := pg_get_functiondef('public_water_page(text)'::regprocedure);
  rewritten := replace(
    def,
    chr(10) || '     AND NOT (''water_quality'' = ANY (o.disabled_modules));',
    ';'
  );
  IF rewritten = def THEN
    RAISE EXCEPTION 'public_water_page: the module filter was not found';
  END IF;
  EXECUTE rewritten;
END
$do$;

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
  o_support_expires_at  timestamptz
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
         sg.expires_at
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
         o.suspension_reason, o.read_only_at, o.pending_delete_at, sg.expires_at
ORDER BY m.created_at;
$$;

REVOKE ALL ON FUNCTION resolve_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;

REVOKE UPDATE (disabled_modules) ON organization FROM poolse_platform;

ALTER TABLE organization
  DROP CONSTRAINT organization_modules_consistent,
  DROP COLUMN disabled_modules;

-- Back to the table-wide grant the app held before, without the column grants
-- the Up left beside it.
DO $do$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    INTO cols
    FROM pg_attribute
   WHERE attrelid = 'organization'::regclass
     AND attnum > 0
     AND NOT attisdropped;
  EXECUTE format('REVOKE UPDATE (%s) ON organization FROM poolse_app', cols);
END
$do$;

GRANT UPDATE ON organization TO poolse_app;

DROP FUNCTION modules_consistent(poolse_module[]);
DROP TYPE poolse_module;
