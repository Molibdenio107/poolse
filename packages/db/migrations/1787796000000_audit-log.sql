-- Up Migration
--
-- Phase 0.8: `audit_log`, and the property that makes it worth having.
--
-- The roadmap asks for a table and a write helper — "any mutation can record who
-- and what in one call". The part that is easy to miss is that an audit log the
-- application can edit is not an audit log. `ALTER DEFAULT PRIVILEGES` from slice
-- 0.3 hands every new table SELECT/INSERT/UPDATE/DELETE to poolse_app, so this
-- one has to give two of those back. After that the app can write entries and
-- read them, and cannot alter or remove one — enforced by grants, not by nobody
-- having written the UPDATE yet.
--
-- Why it exists now rather than in phase 1, where the interesting mutations are:
-- retrofitting it means going back through every write path already built. It is
-- cheaper to have the helper before there are twenty callers than after.
--
-- The entries themselves are operator-facing rather than user-facing, so `action`
-- is a stable machine key and the UI translates it. Nothing here is written in a
-- human language: a log that says "Convite criado" cannot be read by the English
-- support person looking at the same organization.

CREATE TABLE audit_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization (id),

  -- Null for anything the system did on nobody's behalf: a Clerk webhook, a
  -- scheduled job. "Who" is genuinely unknown there, and inventing a membership
  -- to satisfy a NOT NULL would be a lie recorded permanently.
  actor_membership_id uuid,
  -- Kept alongside the membership because memberships get archived and the
  -- question "who did this" outlives them.
  actor_app_user_id   uuid REFERENCES app_user (id),

  -- Machine key: 'invitation.created', 'organization.created'. Dotted so the UI
  -- can group by prefix without a second column to keep in step.
  action              text NOT NULL,
  entity_type         text NOT NULL,
  entity_id           uuid,

  -- Whatever the action needs to be intelligible later: the roles offered, the
  -- address invited, the previous value of a field. Deliberately schemaless —
  -- every attempt to normalise this ends up as a column per action.
  data                jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at          timestamptz NOT NULL DEFAULT now(),

  -- The composite reference, same as everywhere else: org A cannot record an
  -- action by org B's member.
  FOREIGN KEY (organization_id, actor_membership_id) REFERENCES membership (organization_id, id),
  CHECK (action <> ''),
  CHECK (entity_type <> '')
);

-- No updated_at trigger and no archived_at: entries are never edited and never
-- soft-deleted. That absence is the design, not an oversight.

-- The read this table will actually get: one organization, newest first.
CREATE INDEX audit_log_org_time_idx ON audit_log (organization_id, created_at DESC);
-- And the other one: the history of a single thing.
CREATE INDEX audit_log_entity_idx ON audit_log (organization_id, entity_type, entity_id);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_tenant ON audit_log
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Append-only, for the application. The default privileges granted all four verbs
-- when the table was created above; two of them go back.
REVOKE UPDATE, DELETE ON audit_log FROM poolse_app;

-- ---------------------------------------------------------------------------
-- The two cross-tenant writes that also deserve an entry
--
-- Both happen inside SECURITY DEFINER functions, because both happen before the
-- caller is a member of the organization in question. An unscoped INSERT from the
-- app role would be refused by the policy above — correctly — so the entry has to
-- be written where the action is.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_organization(
  p_clerk_user_id text,
  p_name          text,
  p_locale        text
) RETURNS TABLE (
  o_organization_id uuid,
  o_membership_id   uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user       uuid;
  v_org        uuid;
  v_membership uuid;
BEGIN
  IF coalesce(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'create_organization requires a name';
  END IF;

  SELECT id INTO v_user
    FROM app_user
   WHERE clerk_user_id = p_clerk_user_id
     AND deleted_at IS NULL;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'create_organization: no live app_user for %', p_clerk_user_id;
  END IF;

  INSERT INTO organization (name, locale)
  VALUES (btrim(p_name), coalesce(nullif(btrim(p_locale), ''), 'pt-PT'))
  RETURNING id INTO v_org;

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_user, 'active')
  RETURNING id INTO v_membership;

  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_membership, 'owner');

  INSERT INTO audit_log (
    organization_id, actor_membership_id, actor_app_user_id,
    action, entity_type, entity_id, data
  ) VALUES (
    v_org, v_membership, v_user,
    'organization.created', 'organization', v_org,
    jsonb_build_object('name', btrim(p_name))
  );

  RETURN QUERY SELECT v_org, v_membership;
END;
$$;

CREATE OR REPLACE FUNCTION accept_invitation(
  p_token_hash    text,
  p_clerk_user_id text,
  p_now           timestamptz
) RETURNS TABLE (
  o_status            text,
  o_organization_id   uuid,
  o_organization_name text,
  o_membership_id     uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inv        invitation%ROWTYPE;
  v_org_name text;
  v_user     uuid;
  v_existing uuid;
  v_bound    uuid;
BEGIN
  -- FOR UPDATE so two tabs racing on the same link cannot both redeem it.
  SELECT * INTO inv FROM invitation WHERE token_hash = p_token_hash FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT name INTO v_org_name FROM organization WHERE id = inv.organization_id;

  IF inv.accepted_at IS NOT NULL THEN
    RETURN QUERY SELECT 'already_accepted'::text, inv.organization_id, v_org_name,
                        inv.accepted_membership_id;
    RETURN;
  END IF;

  IF inv.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'revoked'::text, inv.organization_id, v_org_name, NULL::uuid;
    RETURN;
  END IF;

  IF inv.expires_at <= p_now THEN
    RETURN QUERY SELECT 'expired'::text, inv.organization_id, v_org_name, NULL::uuid;
    RETURN;
  END IF;

  SELECT id INTO v_user
    FROM app_user
   WHERE clerk_user_id = p_clerk_user_id
     AND deleted_at IS NULL;

  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'unknown_account'::text, inv.organization_id, v_org_name, NULL::uuid;
    RETURN;
  END IF;

  SELECT id INTO v_existing
    FROM membership
   WHERE organization_id = inv.organization_id
     AND app_user_id = v_user
     AND archived_at IS NULL;

  IF v_existing IS NULL THEN
    -- The normal path: bind the placeholder made when the invite was issued. Its
    -- membership_role rows are already in place, so the roles arrive with it.
    UPDATE membership
       SET app_user_id = v_user,
           status      = 'active'
     WHERE id = inv.membership_id;

    v_bound := inv.membership_id;
  ELSE
    -- Already a member — an invitation topping up someone, or sent twice. Merge
    -- what was offered into the membership they already have, and retire the
    -- placeholder; see the comment on invitation.membership_id.
    INSERT INTO membership_role (organization_id, membership_id, role)
    SELECT inv.organization_id, v_existing, t.offered
      FROM unnest(inv.roles) AS t(offered)
     WHERE NOT EXISTS (
       SELECT 1 FROM membership_role mr
        WHERE mr.membership_id = v_existing
          AND mr.role = t.offered
          AND mr.archived_at IS NULL
     );

    UPDATE membership_role
       SET archived_at = p_now
     WHERE membership_id = inv.membership_id
       AND archived_at IS NULL;

    UPDATE membership
       SET archived_at = p_now
     WHERE id = inv.membership_id
       AND archived_at IS NULL;

    v_bound := v_existing;
  END IF;

  UPDATE invitation
     SET accepted_at            = p_now,
         accepted_membership_id = v_bound
   WHERE id = inv.id;

  INSERT INTO audit_log (
    organization_id, actor_membership_id, actor_app_user_id,
    action, entity_type, entity_id, data, created_at
  ) VALUES (
    inv.organization_id, v_bound, v_user,
    'invitation.accepted', 'invitation', inv.id,
    jsonb_build_object(
      'email', inv.email::text,
      'roles', to_jsonb(inv.roles::text[]),
      -- True when they were already a member and the roles merged instead.
      'merged_into_existing', v_existing IS NOT NULL
    ),
    p_now
  );

  RETURN QUERY SELECT 'accepted'::text, inv.organization_id, v_org_name, v_bound;
END;
$$;

-- Down Migration

-- Restores both functions to their pre-audit bodies. Kept as full definitions
-- rather than a DROP, because dropping them would take the invitation flow with
-- them and a rollback should undo one migration, not two.

CREATE OR REPLACE FUNCTION create_organization(
  p_clerk_user_id text,
  p_name          text,
  p_locale        text
) RETURNS TABLE (
  o_organization_id uuid,
  o_membership_id   uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user       uuid;
  v_org        uuid;
  v_membership uuid;
BEGIN
  IF coalesce(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'create_organization requires a name';
  END IF;

  SELECT id INTO v_user FROM app_user
   WHERE clerk_user_id = p_clerk_user_id AND deleted_at IS NULL;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'create_organization: no live app_user for %', p_clerk_user_id;
  END IF;

  INSERT INTO organization (name, locale)
  VALUES (btrim(p_name), coalesce(nullif(btrim(p_locale), ''), 'pt-PT'))
  RETURNING id INTO v_org;

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_user, 'active')
  RETURNING id INTO v_membership;

  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_membership, 'owner');

  RETURN QUERY SELECT v_org, v_membership;
END;
$$;

CREATE OR REPLACE FUNCTION accept_invitation(
  p_token_hash    text,
  p_clerk_user_id text,
  p_now           timestamptz
) RETURNS TABLE (
  o_status            text,
  o_organization_id   uuid,
  o_organization_name text,
  o_membership_id     uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inv        invitation%ROWTYPE;
  v_org_name text;
  v_user     uuid;
  v_existing uuid;
  v_bound    uuid;
BEGIN
  SELECT * INTO inv FROM invitation WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT name INTO v_org_name FROM organization WHERE id = inv.organization_id;

  IF inv.accepted_at IS NOT NULL THEN
    RETURN QUERY SELECT 'already_accepted'::text, inv.organization_id, v_org_name,
                        inv.accepted_membership_id;
    RETURN;
  END IF;
  IF inv.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'revoked'::text, inv.organization_id, v_org_name, NULL::uuid;
    RETURN;
  END IF;
  IF inv.expires_at <= p_now THEN
    RETURN QUERY SELECT 'expired'::text, inv.organization_id, v_org_name, NULL::uuid;
    RETURN;
  END IF;

  SELECT id INTO v_user FROM app_user
   WHERE clerk_user_id = p_clerk_user_id AND deleted_at IS NULL;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'unknown_account'::text, inv.organization_id, v_org_name, NULL::uuid;
    RETURN;
  END IF;

  SELECT id INTO v_existing FROM membership
   WHERE organization_id = inv.organization_id
     AND app_user_id = v_user AND archived_at IS NULL;

  IF v_existing IS NULL THEN
    UPDATE membership SET app_user_id = v_user, status = 'active'
     WHERE id = inv.membership_id;
    v_bound := inv.membership_id;
  ELSE
    INSERT INTO membership_role (organization_id, membership_id, role)
    SELECT inv.organization_id, v_existing, t.offered
      FROM unnest(inv.roles) AS t(offered)
     WHERE NOT EXISTS (
       SELECT 1 FROM membership_role mr
        WHERE mr.membership_id = v_existing AND mr.role = t.offered
          AND mr.archived_at IS NULL
     );
    UPDATE membership_role SET archived_at = p_now
     WHERE membership_id = inv.membership_id AND archived_at IS NULL;
    UPDATE membership SET archived_at = p_now
     WHERE id = inv.membership_id AND archived_at IS NULL;
    v_bound := v_existing;
  END IF;

  UPDATE invitation
     SET accepted_at = p_now, accepted_membership_id = v_bound
   WHERE id = inv.id;

  RETURN QUERY SELECT 'accepted'::text, inv.organization_id, v_org_name, v_bound;
END;
$$;

DROP TABLE IF EXISTS audit_log;
