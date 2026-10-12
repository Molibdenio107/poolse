-- Up Migration
--
-- POOLSE-79 slice 1: support access. The club lets Poolse in, for a while, and
-- sees what it did.
--
-- Platform administration still grants nothing inside a tenant. `poolse_platform`
-- reads no more club data than before. What changes is that a club's Owner can
-- open a *support grant*, and while it is live a platform operator may enter
-- the club through the ordinary tenant path. They enter as a membership of their
-- own, so RLS, role checks and `audit_log` work unchanged and name them.
--
-- Three decisions, Rui's (12-10-2026), and one of the build plan's:
--
--   * The session is an Admin and can write.
--   * The membership is created by ONE `SECURITY DEFINER` function keyed on a
--     live grant. An emergency override (slice 2) has no Owner session to ride
--     on, and the alternative was a privilege for `poolse_platform` on
--     `membership`. This is the second definer function the migration
--     checklist tells you to stop and reconsider. It was reconsidered, and it
--     is narrower than the column grant it replaces.
--   * **The role is not a row.** A support membership holds no
--     `membership_role` rows, and `resolve_memberships` gives it `admin` only
--     while its grant is live. Every role-keyed list therefore leaves it out
--     with no edit, so a list that forgets the support filter fails closed. A
--     trigger below refuses a role row on a support membership, so that stays
--     true.
--
-- Expiry is never written. A grant past `expires_at` is simply not live, and
-- `resolve_memberships` stops returning the membership on the next request. No
-- cron has to run for a session to end.

CREATE TYPE support_grant_source AS ENUM ('owner', 'request', 'override');

-- Who ended a grant early. Expiry is not a value here, because it is derived.
CREATE TYPE support_grant_end AS ENUM ('owner', 'support');

CREATE TABLE support_grant (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id                 uuid NOT NULL REFERENCES organization (id),

  source                          support_grant_source NOT NULL,
  -- The operator who asked for it or forced it. Null when the Owner opened it
  -- unprompted.
  requested_by_platform_admin_id  uuid REFERENCES platform_admin (id),
  -- The Owner who granted it. Null only for an override.
  granted_by_membership_id        uuid,
  reason                          text,

  starts_at                       timestamptz NOT NULL DEFAULT now(),
  -- The last instant the grant is live is just before this one.
  expires_at                      timestamptz NOT NULL,
  ended_at                        timestamptz,
  ended_by                        support_grant_end,

  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, granted_by_membership_id)
    REFERENCES membership (organization_id, id),

  CONSTRAINT support_grant_window CHECK (expires_at > starts_at),
  CONSTRAINT support_grant_ended_says_who CHECK ((ended_at IS NULL) = (ended_by IS NULL)),
  -- The club's own consent, unless it is an override.
  CONSTRAINT support_grant_has_grantor CHECK (
    (source = 'override') = (granted_by_membership_id IS NULL)
  ),
  -- A request and an override say why, and who asked.
  CONSTRAINT support_grant_reasoned CHECK (
    source = 'owner'
    OR (reason IS NOT NULL AND btrim(reason) <> '' AND requested_by_platform_admin_id IS NOT NULL)
  ),
  CONSTRAINT support_grant_reason_length CHECK (reason IS NULL OR char_length(reason) <= 500)
);

COMMENT ON TABLE support_grant IS
  'A club''s consent to Poolse support entering it, for a fixed window (POOLSE-79). '
  'Live means ended_at IS NULL and starts_at <= now() < expires_at; expiry is derived, never written.';

CREATE INDEX support_grant_org_idx ON support_grant (organization_id, created_at DESC);

CREATE TRIGGER support_grant_updated_at BEFORE UPDATE ON support_grant
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE support_grant ENABLE ROW LEVEL SECURITY;

CREATE POLICY support_grant_tenant ON support_grant
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- A grant is history. The tenant role writes one and ends one, and changes
-- nothing else: not the window, not the source, never a delete.
REVOKE UPDATE, DELETE ON support_grant FROM poolse_app;
GRANT SELECT, INSERT ON support_grant TO poolse_app;
GRANT UPDATE (ended_at, ended_by) ON support_grant TO poolse_app;

-- The platform reads grants across clubs, to list where it has been let in.
-- One more table on its grant, and it holds no club data: who consented,
-- when, until when. Slice 2 adds INSERT for requests and overrides.
CREATE POLICY support_grant_operators ON support_grant
  FOR SELECT TO poolse_platform USING (true);
GRANT SELECT ON support_grant TO poolse_platform;

-- ---------------------------------------------------------------------------
-- The support membership
-- ---------------------------------------------------------------------------

ALTER TABLE membership ADD COLUMN support_grant_id uuid;
ALTER TABLE membership ADD CONSTRAINT membership_support_grant_fk
  FOREIGN KEY (organization_id, support_grant_id) REFERENCES support_grant (organization_id, id);
-- A support membership is a person with a login, always.
ALTER TABLE membership ADD CONSTRAINT membership_support_has_login
  CHECK (support_grant_id IS NULL OR app_user_id IS NOT NULL);

COMMENT ON COLUMN membership.support_grant_id IS
  'Set: a Poolse support membership (POOLSE-79). It holds no membership_role rows; '
  'resolve_memberships gives it admin while this grant is live and drops it otherwise.';

CREATE FUNCTION membership_role_not_on_support() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM membership
     WHERE id = NEW.membership_id AND organization_id = NEW.organization_id
       AND support_grant_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'support_membership_has_no_roles'
      USING ERRCODE = 'check_violation',
            HINT = 'A support membership''s role comes from its grant, never from a row.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER membership_role_not_on_support
  BEFORE INSERT OR UPDATE ON membership_role
  FOR EACH ROW EXECUTE FUNCTION membership_role_not_on_support();

-- ---------------------------------------------------------------------------
-- resolve_memberships: a support membership is live only while its grant is
-- ---------------------------------------------------------------------------

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
     -- A support membership only while its grant is live. Read at every
     -- request, so expiry and revocation need nothing to run.
     AND (
       m.support_grant_id IS NULL
       OR (sg.ended_at IS NULL AND sg.starts_at <= now() AND sg.expires_at > now())
     )
GROUP BY u.id, m.organization_id, o.name, o.slug, o.kind, m.id, m.created_at,
         m.support_grant_id, o.subscription_status, o.trial_ends_at, o.suspended_at,
         o.suspension_reason, o.read_only_at, o.pending_delete_at, sg.expires_at
ORDER BY m.created_at;
$$;

REVOKE ALL ON FUNCTION resolve_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;

-- ---------------------------------------------------------------------------
-- support_session: entering and leaving, the one way in
-- ---------------------------------------------------------------------------
--
-- Called by the platform API for an authenticated operator. It re-checks
-- everything itself, because a definer function trusts nobody's word:
--
--   * the caller is a live platform admin with an app_user;
--   * the grant is live;
--   * they are not already an ordinary member of that club. An operator who
--     is also somebody's coach does not need support access there, and one
--     person with two live memberships in one club is a shape
--     `membership_org_user_uq` forbids.
--
-- One support membership per operator per club, re-pointed at each new grant,
-- for the same reason. Entering and leaving are written to both trails: the
-- club's `audit_log`, under the support membership, and `platform_audit_log`.

CREATE FUNCTION support_session(p_clerk_user_id text, p_grant_id uuid, p_action text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user        uuid;
  v_grant       support_grant%ROWTYPE;
  v_membership  uuid;
BEGIN
  IF p_action NOT IN ('enter', 'leave') THEN
    RAISE EXCEPTION 'support_action_unknown: %', p_action USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT u.id INTO v_user
    FROM app_user u
    JOIN platform_admin pa ON pa.clerk_user_id = u.clerk_user_id AND pa.archived_at IS NULL
   WHERE u.clerk_user_id = p_clerk_user_id AND u.deleted_at IS NULL;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'support_not_platform_admin' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_grant FROM support_grant WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND
     OR v_grant.ended_at IS NOT NULL
     OR now() < v_grant.starts_at
     OR now() >= v_grant.expires_at THEN
    RAISE EXCEPTION 'support_grant_not_live' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_action = 'enter' THEN
    IF EXISTS (
      SELECT 1 FROM membership
       WHERE organization_id = v_grant.organization_id AND app_user_id = v_user
         AND archived_at IS NULL AND support_grant_id IS NULL
    ) THEN
      RAISE EXCEPTION 'support_already_member' USING ERRCODE = 'unique_violation';
    END IF;

    UPDATE membership
       SET support_grant_id = v_grant.id, status = 'active'
     WHERE organization_id = v_grant.organization_id AND app_user_id = v_user
       AND archived_at IS NULL AND support_grant_id IS NOT NULL
    RETURNING id INTO v_membership;

    IF v_membership IS NULL THEN
      INSERT INTO membership (organization_id, app_user_id, status, support_grant_id)
      VALUES (v_grant.organization_id, v_user, 'active', v_grant.id)
      RETURNING id INTO v_membership;
    END IF;
  ELSE
    SELECT id INTO v_membership
      FROM membership
     WHERE organization_id = v_grant.organization_id AND app_user_id = v_user
       AND archived_at IS NULL AND support_grant_id = v_grant.id;
    IF v_membership IS NULL THEN
      RAISE EXCEPTION 'support_not_entered' USING ERRCODE = 'no_data_found';
    END IF;

    UPDATE support_grant SET ended_at = now(), ended_by = 'support' WHERE id = v_grant.id;
  END IF;

  INSERT INTO audit_log (
    organization_id, actor_membership_id, actor_app_user_id, action, entity_type, entity_id, data
  ) VALUES (
    v_grant.organization_id, v_membership, v_user,
    CASE p_action WHEN 'enter' THEN 'support.entered' ELSE 'support.ended' END,
    'support_grant', v_grant.id,
    jsonb_build_object('source', v_grant.source, 'expiresAt', v_grant.expires_at)
  );

  INSERT INTO platform_audit_log (clerk_user_id, action, organization_id, detail)
  VALUES (
    p_clerk_user_id,
    CASE p_action WHEN 'enter' THEN 'support.entered' ELSE 'support.ended' END,
    v_grant.organization_id,
    jsonb_build_object('grantId', v_grant.id, 'membershipId', v_membership)
  );

  RETURN v_membership;
END;
$$;

REVOKE ALL ON FUNCTION support_session(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_session(text, uuid, text) TO poolse_platform;

-- Down Migration

DROP FUNCTION IF EXISTS support_session(text, uuid, text);

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
  o_pending_delete_at   timestamptz
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
         coalesce(
           array_agg(mr.role::text ORDER BY mr.role::text)
             FILTER (WHERE mr.archived_at IS NULL),
           '{}'::text[]
         ),
         o.subscription_status::text,
         o.trial_ends_at,
         o.suspended_at,
         o.suspension_reason,
         o.read_only_at,
         o.pending_delete_at
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
GROUP BY u.id, m.organization_id, o.name, o.slug, o.kind, m.id, m.created_at,
         o.subscription_status, o.trial_ends_at, o.suspended_at, o.suspension_reason,
         o.read_only_at, o.pending_delete_at
ORDER BY m.created_at;
$$;

REVOKE ALL ON FUNCTION resolve_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;

DROP TRIGGER IF EXISTS membership_role_not_on_support ON membership_role;
DROP FUNCTION IF EXISTS membership_role_not_on_support();

-- Support memberships cannot outlive the column that marks them.
UPDATE membership SET archived_at = now() WHERE support_grant_id IS NOT NULL AND archived_at IS NULL;
ALTER TABLE membership DROP CONSTRAINT IF EXISTS membership_support_has_login;
ALTER TABLE membership DROP CONSTRAINT IF EXISTS membership_support_grant_fk;
ALTER TABLE membership DROP COLUMN IF EXISTS support_grant_id;

DROP TABLE IF EXISTS support_grant;
DROP TYPE IF EXISTS support_grant_end;
DROP TYPE IF EXISTS support_grant_source;
