-- A re-invite must never retire the membership it points at — POOLSE-39, found in review.
--
-- **The bug, in one sentence:** a staff member who clicked their own re-invite
-- link while still signed in as their *old* account had their membership
-- archived and every one of their roles revoked.
--
-- How it happened is worth reading, because the design was right and one branch
-- was not.
--
-- `reinvite` deliberately attaches the invitation to the person's **existing**
-- membership rather than to a fresh placeholder. That is the whole point of
-- POOLSE-39: the login moves, and the Person, their roles, their turmas, their
-- notes and their audit trail never move at all.
--
-- `accept_invitation` has two branches. If the acceptor has no live membership
-- in the organization, it binds the invitation's membership to them — the
-- ordinary path, and the one a re-invite takes when they sign in with the *new*
-- address. If they already have one, it treats `invitation.membership_id` as a
-- placeholder to merge and retire.
--
-- That second branch never asked whether the membership it was retiring was the
-- very one the acceptor already holds. For a re-invite accepted by the old
-- account, `v_existing` **is** `inv.membership_id`: it archived their roles, then
-- archived them, then reported success and bound the invitation to the row it
-- had just killed.
--
-- The POOLSE-39 commit claimed this could not happen — "it cannot happen if no
-- second membership is ever created" — and the test asserted the surviving row
-- was the same row, which it was. Nobody accepted as the old account.
--
-- The fix is one condition: binding to a membership you already hold is a bind,
-- not a merge.

-- Up Migration

CREATE OR REPLACE FUNCTION accept_invitation(
  p_token_hash text,
  p_clerk_user_id text,
  p_now timestamptz
) RETURNS TABLE (
  o_status text,
  o_organization_id uuid,
  o_organization_name text,
  o_membership_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  inv RECORD;
  v_org_name text;
  v_user uuid;
  v_existing uuid;
  v_bound uuid;
BEGIN
  SELECT * INTO inv FROM invitation WHERE token_hash = p_token_hash;

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

  /*
   * `v_existing = inv.membership_id` is the case this migration exists for.
   *
   * It means the invitation points at a membership the acceptor already holds —
   * a POOLSE-39 re-invite, accepted by the account it was meant to replace.
   * There is nothing to merge and nothing to retire: they already have the
   * roles, and the row to archive would be their own.
   *
   * Treated as a bind, so the invitation is consumed and the person keeps
   * everything. The login does not move, which is correct — they signed in as
   * the old address, so there is no new one to move it to. Staff can issue
   * another re-invite; before this they had to reconstruct a staff record.
   */
  IF v_existing IS NULL OR v_existing = inv.membership_id THEN
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
      -- A re-invite accepted by its own account is a bind, not a merge, so this
      -- is false there — which is what makes the two tellable apart in the log.
      'merged_into_existing', v_existing IS NOT NULL AND v_existing <> inv.membership_id
    ),
    p_now
  );

  RETURN QUERY SELECT 'accepted'::text, inv.organization_id, v_org_name, v_bound;
END;
$fn$;

REVOKE ALL ON FUNCTION accept_invitation(text, text, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION accept_invitation(text, text, timestamptz) TO poolse_app;

-- Down Migration
--
-- Restores the branch that archives a membership the acceptor already holds.
-- Rolling this back re-opens the defect; it exists so the migration round-trips,
-- not because anybody should run it.

CREATE OR REPLACE FUNCTION accept_invitation(
  p_token_hash text,
  p_clerk_user_id text,
  p_now timestamptz
) RETURNS TABLE (
  o_status text,
  o_organization_id uuid,
  o_organization_name text,
  o_membership_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  inv RECORD;
  v_org_name text;
  v_user uuid;
  v_existing uuid;
  v_bound uuid;
BEGIN
  SELECT * INTO inv FROM invitation WHERE token_hash = p_token_hash;

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
    UPDATE membership
       SET app_user_id = v_user,
           status      = 'active'
     WHERE id = inv.membership_id;

    v_bound := inv.membership_id;
  ELSE
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
      'merged_into_existing', v_existing IS NOT NULL
    ),
    p_now
  );

  RETURN QUERY SELECT 'accepted'::text, inv.organization_id, v_org_name, v_bound;
END;
$fn$;
