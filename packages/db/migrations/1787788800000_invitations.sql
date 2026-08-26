-- Up Migration
--
-- Phase 0.5: invitations — and the organization that has to exist before there is
-- anything to be invited into.
--
-- Three things happen here.
--
-- 1. `invitation.token` becomes `token_hash`. The column always held a secret; it
--    now holds a SHA-256 of one. A database dump, a log line or a backup restored
--    onto a laptop no longer hands over working join links. The raw token exists
--    in exactly two places: the URL the inviter copies, and the request redeeming it.
--
-- 2. `invitation` gains `membership_id` and `revoked_at`. The first is the
--    membership created *with* the invitation — see the comment on the column.
--    The second is what makes a mistyped email recoverable: without it a typo
--    holds the one-live-invite-per-email slot until it expires.
--
-- 3. Two more cross-tenant reads, and they are the last ones this phase needs:
--    creating an organization when you belong to none, and finding an invitation
--    by its token before any organization is known. Both are questions that must
--    be answered *before* a tenant exists, which is precisely the shape RLS
--    correctly answers "no rows" to. Same rule as the `clerk-provisioning`
--    migration: a reviewed SECURITY DEFINER function with a fixed body, never a
--    general escape hatch.
--
-- What is NOT here: sending the email. The notification providers are still an
-- open phase 0 decision and delivery is slice 3.0. Until then the inviter copies
-- the link. That is a missing feature, not a missing design — the token, the
-- expiry and the redemption path are all real.

-- ---------------------------------------------------------------------------
-- invitation
-- ---------------------------------------------------------------------------

ALTER TABLE invitation RENAME COLUMN token TO token_hash;

COMMENT ON COLUMN invitation.token_hash IS
  'SHA-256 (hex) of the invitation token. The raw token is never stored.';

ALTER TABLE invitation ADD COLUMN revoked_at timestamptz;

-- The membership created at invite time, holding status = 'invited' and a NULL
-- app_user_id until someone accepts. Distinct from accepted_membership_id, which
-- records what the acceptance actually bound to. They are the same row in the
-- normal case and differ in exactly one: the invitee already had a live
-- membership here, so the placeholder is retired and the offered roles are merged
-- into the membership they already had. Binding the placeholder instead would
-- collide with membership_org_user_uq, which is that constraint doing its job.
--
-- NOT NULL with no backfill is safe: no invitation has ever been issued.
ALTER TABLE invitation ADD COLUMN membership_id uuid NOT NULL;

ALTER TABLE invitation
  ADD CONSTRAINT invitation_membership_fk
  FOREIGN KEY (organization_id, membership_id) REFERENCES membership (organization_id, id);

-- One *live* invite per email per organization. Revoked ones step out of the way
-- so the same address can be invited again after a typo.
DROP INDEX invitation_pending_uq;
CREATE UNIQUE INDEX invitation_pending_uq
  ON invitation (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Redemption looks up by token and nothing else.
CREATE UNIQUE INDEX invitation_token_hash_uq ON invitation (token_hash);

-- ---------------------------------------------------------------------------
-- create_organization — the first membership, which nobody can invite you to
--
-- Cross-tenant by necessity: the caller belongs to no organization yet, so there
-- is no GUC to set and every ordinary INSERT would fail its WITH CHECK. Creating
-- the organization, the membership and the owner role in one function also makes
-- the three inseparable — an organization with no owner is unreachable forever.
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

  RETURN QUERY SELECT v_org, v_membership;
END;
$$;

-- ---------------------------------------------------------------------------
-- find_invitation_by_token — what the acceptance screen shows before deciding
--
-- Returns a status rather than raising, because every one of these outcomes is a
-- normal thing for someone holding a link to run into, and each needs its own
-- sentence on screen in their own language. Exceptions are for the impossible.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION find_invitation_by_token(
  p_token_hash text,
  p_now        timestamptz
) RETURNS TABLE (
  o_status            text,
  o_organization_name text,
  o_email             text,
  o_roles             text[],
  o_expires_at        timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
           WHEN i.accepted_at IS NOT NULL THEN 'already_accepted'
           WHEN i.revoked_at  IS NOT NULL THEN 'revoked'
           WHEN i.expires_at <= p_now     THEN 'expired'
           ELSE 'pending'
         END,
         o.name,
         i.email::text,
         (SELECT array_agg(r::text ORDER BY r::text) FROM unnest(i.roles) AS r),
         i.expires_at
    FROM invitation i
    JOIN organization o ON o.id = i.organization_id
   WHERE i.token_hash = p_token_hash;
$$;

-- ---------------------------------------------------------------------------
-- accept_invitation — the slice, in one transaction
--
-- The token is the credential, deliberately: single-use, expiring, revocable.
-- Matching the accepting account against the invited email address was the
-- alternative, and it breaks the ordinary case where someone signs up with a
-- different address than the one their employer had for them — while buying
-- little, since no email delivery exists yet to bind that address to anything.
-- Revisit at slice 3.0, when a link actually arrives by email.
-- ---------------------------------------------------------------------------

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

  RETURN QUERY SELECT 'accepted'::text, inv.organization_id, v_org_name, v_bound;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants — EXECUTE defaults to PUBLIC, so revoke before granting.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION create_organization(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION find_invitation_by_token(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION accept_invitation(text, text, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION create_organization(text, text, text) TO poolse_app;
GRANT EXECUTE ON FUNCTION find_invitation_by_token(text, timestamptz) TO poolse_app;
GRANT EXECUTE ON FUNCTION accept_invitation(text, text, timestamptz) TO poolse_app;

-- Down Migration

DROP FUNCTION IF EXISTS accept_invitation(text, text, timestamptz);
DROP FUNCTION IF EXISTS find_invitation_by_token(text, timestamptz);
DROP FUNCTION IF EXISTS create_organization(text, text, text);

DROP INDEX IF EXISTS invitation_token_hash_uq;
DROP INDEX IF EXISTS invitation_pending_uq;
CREATE UNIQUE INDEX invitation_pending_uq
  ON invitation (organization_id, email)
  WHERE accepted_at IS NULL;

ALTER TABLE invitation DROP CONSTRAINT IF EXISTS invitation_membership_fk;
ALTER TABLE invitation DROP COLUMN IF EXISTS membership_id;
ALTER TABLE invitation DROP COLUMN IF EXISTS revoked_at;
ALTER TABLE invitation RENAME COLUMN token_hash TO token;
