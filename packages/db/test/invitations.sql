-- Invitations proof — slice 0.5.
--
-- The roadmap sets one bar for this slice: "a second person joins an organization
-- as an instructor". Test 3 is that bar. The rest are the ways the flow can be
-- wrong in a way nobody notices until it matters — a link that works twice, a
-- link that outlives its expiry, a revoked address that can never be re-invited,
-- and an invitation visible to the wrong tenant.
--
-- Test 8 is the one to keep forever, alongside test 6 of the clerk-provisioning
-- suite: it holds the line that the redemption path opened. An invitation has to
-- be findable before any organization is known, which is exactly the shape that
-- could re-open cross-tenant reads if it were done with a permissive policy
-- instead of a reviewed function.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- Seed — four people, no organizations. This is the true starting state of the
-- product: everyone who signs up belongs to nothing until test 1.
-- ---------------------------------------------------------------------------

SELECT provision_app_user('user_rui',   'rui@clube.pt',   'Rui',   'Fonseca', NULL, '2026-08-26 09:00:00+00');
SELECT provision_app_user('user_ana',   'ana@clube.pt',   'Ana',   'Martins', NULL, '2026-08-26 09:00:00+00');
SELECT provision_app_user('user_bruno', 'bruno@clube.pt', 'Bruno', 'Silva',   NULL, '2026-08-26 09:00:00+00');
SELECT provision_app_user('user_carla', 'carla@outro.pt', 'Carla', 'Nunes',   NULL, '2026-08-26 09:00:00+00');

-- ---------------------------------------------------------------------------
-- Test 1 — creating an organization makes exactly one owner
--
-- The organization, the membership and the owner role are one call because an
-- organization that ends up without an owner is unreachable forever.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_membership uuid; r record; n int;
BEGIN
  SELECT o_organization_id, o_membership_id INTO v_org, v_membership
    FROM provision_organization('user_rui', 'Clube A', 'pt-PT', 'Piscina Principal');

  SELECT m.status::text AS status, u.clerk_user_id AS clerk_id INTO r
    FROM membership m JOIN app_user u ON u.id = m.app_user_id
   WHERE m.id = v_membership;

  IF r.status <> 'active' OR r.clerk_id <> 'user_rui' THEN
    RAISE EXCEPTION 'FAIL test 1a: creator got % membership for %', r.status, r.clerk_id;
  END IF;

  SELECT count(*) INTO n FROM membership_role
   WHERE membership_id = v_membership AND role = 'owner' AND archived_at IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 1b: creator holds % owner roles', n;
  END IF;

  SELECT count(*) INTO n FROM resolve_memberships('user_rui');
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 1c: the owner resolves to % organizations', n;
  END IF;

  RAISE NOTICE 'PASS test 1: creating an organization makes the creator its owner';
END $$;

-- A second organization, so every isolation claim below has something to leak to.
DO $$
BEGIN
  PERFORM provision_organization('user_carla', 'Clube B', 'pt-PT', 'Piscina Principal');
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — an invitation puts the person in the organization before they accept
--
-- membership.app_user_id is nullable precisely so this row can exist (see
-- docs/data-model.md). It carries the roles, it shows up in the people list, and
-- it must NOT count as a live membership for anyone.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_inviter uuid; v_membership uuid; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT m.id INTO v_inviter FROM membership m
    JOIN app_user u ON u.id = m.app_user_id
   WHERE m.organization_id = v_org AND u.clerk_user_id = 'user_rui';

  INSERT INTO membership (organization_id, status) VALUES (v_org, 'invited')
  RETURNING id INTO v_membership;

  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_membership, 'instructor');

  INSERT INTO invitation (
    organization_id, email, roles, token_hash, expires_at, membership_id,
    invited_by_membership_id
  ) VALUES (
    v_org, 'ana@clube.pt', ARRAY['instructor']::member_role[],
    encode(sha256(convert_to('token-ana', 'utf8')), 'hex'),
    '2026-09-02 09:00:00+00', v_membership, v_inviter
  );

  SELECT count(*) INTO n FROM membership
   WHERE id = v_membership AND app_user_id IS NULL AND status = 'invited';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 2a: the pending membership was not created unbound';
  END IF;

  -- Ana has an account, but has not accepted. She must not be in the organization.
  SELECT count(*) INTO n FROM resolve_memberships('user_ana');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 2b: an unaccepted invitation resolved as % memberships', n;
  END IF;

  RAISE NOTICE 'PASS test 2: an invitation creates a pending membership that resolves for nobody';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — the slice: a second person joins as an instructor
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record; m record;
BEGIN
  SELECT o_status AS status, o_organization_name AS org_name, o_membership_id AS membership_id
    INTO r
    FROM accept_invitation(
      encode(sha256(convert_to('token-ana', 'utf8')), 'hex'),
      'user_ana',
      '2026-08-26 10:00:00+00'
    );

  IF r.status <> 'accepted' THEN
    RAISE EXCEPTION 'FAIL test 3a: acceptance returned %', r.status;
  END IF;

  SELECT o_organization_name AS org_name, o_roles AS roles INTO m
    FROM resolve_memberships('user_ana');

  IF m.org_name IS DISTINCT FROM 'Clube A' THEN
    RAISE EXCEPTION 'FAIL test 3b: Ana resolved to % instead of Clube A', m.org_name;
  END IF;
  IF m.roles <> ARRAY['instructor']::text[] THEN
    RAISE EXCEPTION 'FAIL test 3c: Ana holds % instead of instructor', m.roles;
  END IF;

  -- The invitation now points at the membership it produced.
  IF NOT EXISTS (
    SELECT 1 FROM invitation
     WHERE email = 'ana@clube.pt'
       AND accepted_at IS NOT NULL
       AND accepted_membership_id = r.membership_id
  ) THEN
    RAISE EXCEPTION 'FAIL test 3d: the invitation was not bound to the membership';
  END IF;

  RAISE NOTICE 'PASS test 3: a second person joined the organization as an instructor';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — a link is single-use
--
-- Not hypothetical: the invitee forwards the mail, or opens it twice. A second
-- redemption must not produce a second membership.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_status text; n int;
BEGIN
  SELECT o_status INTO v_status
    FROM accept_invitation(
      encode(sha256(convert_to('token-ana', 'utf8')), 'hex'),
      'user_bruno',
      '2026-08-26 10:05:00+00'
    );

  IF v_status <> 'already_accepted' THEN
    RAISE EXCEPTION 'FAIL test 4a: a spent link returned %', v_status;
  END IF;

  SELECT count(*) INTO n FROM resolve_memberships('user_bruno');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 4b: a spent link let Bruno into % organizations', n;
  END IF;

  RAISE NOTICE 'PASS test 4: an accepted invitation cannot be redeemed again';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — an expired link does not bind
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_membership uuid; v_status text; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  INSERT INTO membership (organization_id, status) VALUES (v_org, 'invited')
  RETURNING id INTO v_membership;
  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_membership, 'maintenance');
  INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at, membership_id)
  VALUES (
    v_org, 'antigo@clube.pt', ARRAY['maintenance']::member_role[],
    encode(sha256(convert_to('token-expirado', 'utf8')), 'hex'),
    '2026-08-01 09:00:00+00', v_membership
  );

  SELECT o_status INTO v_status
    FROM accept_invitation(
      encode(sha256(convert_to('token-expirado', 'utf8')), 'hex'),
      'user_bruno',
      '2026-08-26 10:10:00+00'
    );

  IF v_status <> 'expired' THEN
    RAISE EXCEPTION 'FAIL test 5a: an expired link returned %', v_status;
  END IF;

  SELECT count(*) INTO n FROM membership WHERE id = v_membership AND app_user_id IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 5b: an expired link bound the membership anyway';
  END IF;

  -- And the preview screen has to be able to say so.
  SELECT o_status INTO v_status
    FROM find_invitation_by_token(
      encode(sha256(convert_to('token-expirado', 'utf8')), 'hex'),
      '2026-08-26 10:10:00+00'
    );
  IF v_status <> 'expired' THEN
    RAISE EXCEPTION 'FAIL test 5c: the preview reported % for an expired link', v_status;
  END IF;

  RAISE NOTICE 'PASS test 5: an expired invitation binds nobody and says why';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — revoking frees the address to be invited again
--
-- This is what the partial unique index is for. A live invite holds the address;
-- a revoked one steps out of the way, so a typo is recoverable instead of being
-- a week-long wait.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_first uuid; v_second uuid; v_status text;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  INSERT INTO membership (organization_id, status) VALUES (v_org, 'invited')
  RETURNING id INTO v_first;
  INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at, membership_id)
  VALUES (
    v_org, 'engano@clube.pt', ARRAY['instructor']::member_role[],
    encode(sha256(convert_to('token-engano', 'utf8')), 'hex'),
    '2026-09-02 09:00:00+00', v_first
  );

  -- A second live invite to the same address is refused while the first stands.
  BEGIN
    INSERT INTO membership (organization_id, status) VALUES (v_org, 'invited')
    RETURNING id INTO v_second;
    INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at, membership_id)
    VALUES (
      v_org, 'engano@clube.pt', ARRAY['instructor']::member_role[],
      encode(sha256(convert_to('token-engano-2', 'utf8')), 'hex'),
      '2026-09-02 09:00:00+00', v_second
    );
    RAISE EXCEPTION 'FAIL test 6a: two live invitations to one address were allowed';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  -- Revoke, the way the API does: the invitation and the membership it made.
  UPDATE invitation SET revoked_at = '2026-08-26 10:20:00+00'
   WHERE token_hash = encode(sha256(convert_to('token-engano', 'utf8')), 'hex');
  UPDATE membership SET archived_at = '2026-08-26 10:20:00+00' WHERE id = v_first;

  SELECT o_status INTO v_status
    FROM accept_invitation(
      encode(sha256(convert_to('token-engano', 'utf8')), 'hex'),
      'user_bruno',
      '2026-08-26 10:25:00+00'
    );
  IF v_status <> 'revoked' THEN
    RAISE EXCEPTION 'FAIL test 6b: a revoked link returned %', v_status;
  END IF;

  -- And now the address is free.
  INSERT INTO membership (organization_id, status) VALUES (v_org, 'invited')
  RETURNING id INTO v_second;
  INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at, membership_id)
  VALUES (
    v_org, 'engano@clube.pt', ARRAY['instructor']::member_role[],
    encode(sha256(convert_to('token-engano-3', 'utf8')), 'hex'),
    '2026-09-02 09:00:00+00', v_second
  );

  RAISE NOTICE 'PASS test 6: revoking releases the address for a fresh invitation';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — inviting someone who is already a member tops up their roles
--
-- The case that would otherwise be a constraint violation in production: binding
-- the placeholder would collide with membership_org_user_uq, so the roles merge
-- into the membership they already have and the placeholder is retired.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_membership uuid; r record; v_roles text[]; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  -- Bruno joins as an instructor first.
  INSERT INTO membership (organization_id, status) VALUES (v_org, 'invited')
  RETURNING id INTO v_membership;
  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_membership, 'instructor');
  INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at, membership_id)
  VALUES (
    v_org, 'bruno@clube.pt', ARRAY['instructor']::member_role[],
    encode(sha256(convert_to('token-bruno-1', 'utf8')), 'hex'),
    '2026-09-02 09:00:00+00', v_membership
  );
  PERFORM accept_invitation(
    encode(sha256(convert_to('token-bruno-1', 'utf8')), 'hex'),
    'user_bruno', '2026-08-26 11:00:00+00'
  );

  -- Later he also takes on maintenance, and is invited again.
  INSERT INTO membership (organization_id, status) VALUES (v_org, 'invited')
  RETURNING id INTO v_membership;
  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_membership, 'maintenance');
  INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at, membership_id)
  VALUES (
    v_org, 'bruno@clube.pt', ARRAY['maintenance']::member_role[],
    encode(sha256(convert_to('token-bruno-2', 'utf8')), 'hex'),
    '2026-09-02 09:00:00+00', v_membership
  );

  SELECT o_status AS status, o_membership_id AS membership_id INTO r
    FROM accept_invitation(
      encode(sha256(convert_to('token-bruno-2', 'utf8')), 'hex'),
      'user_bruno', '2026-08-26 11:05:00+00'
    );

  IF r.status <> 'accepted' THEN
    RAISE EXCEPTION 'FAIL test 7a: the top-up invitation returned %', r.status;
  END IF;
  IF r.membership_id = v_membership THEN
    RAISE EXCEPTION 'FAIL test 7b: the placeholder was bound instead of the live membership';
  END IF;

  SELECT count(*) INTO n FROM membership
   WHERE organization_id = v_org AND app_user_id = (
     SELECT id FROM app_user WHERE clerk_user_id = 'user_bruno'
   ) AND archived_at IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 7c: Bruno ended up with % live memberships', n;
  END IF;

  SELECT o_roles INTO v_roles FROM resolve_memberships('user_bruno');
  IF v_roles <> ARRAY['instructor', 'maintenance']::text[] THEN
    RAISE EXCEPTION 'FAIL test 7d: Bruno holds % instead of both roles', v_roles;
  END IF;

  SELECT count(*) INTO n FROM membership WHERE id = v_membership AND archived_at IS NOT NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 7e: the placeholder membership was left live';
  END IF;

  RAISE NOTICE 'PASS test 7: re-inviting a member merges roles instead of duplicating them';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8 — redemption did not re-open cross-tenant reads
--
-- Keep this one. Finding an invitation by token is a read that has to happen
-- before any organization is known — the same shape as resolve_memberships, and
-- the same thing that would quietly undo slice 0.3 if it were ever done with a
-- permissive policy. As the app role: scoped to Clube A, Clube B invitations are
-- invisible; scoped to nothing, all of them are; and the reviewed function still
-- answers, because that is the only door.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_membership uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube B';
  INSERT INTO membership (organization_id, status) VALUES (v_org, 'invited')
  RETURNING id INTO v_membership;
  INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at, membership_id)
  VALUES (
    v_org, 'convidado@outro.pt', ARRAY['instructor']::member_role[],
    encode(sha256(convert_to('token-clube-b', 'utf8')), 'hex'),
    '2026-09-02 09:00:00+00', v_membership
  );
END $$;

SET LOCAL ROLE poolse_app;

DO $$
DECLARE v_a uuid; n int; v_status text; v_name text;
BEGIN
  SET LOCAL ROLE postgres;
  SELECT id INTO v_a FROM organization WHERE name = 'Clube A';
  SET LOCAL ROLE poolse_app;

  -- Scoped to Clube A: Clube B invitations do not exist.
  PERFORM set_config('app.organization_id', v_a::text, true);

  SELECT count(*) INTO n FROM invitation
   WHERE token_hash = encode(sha256(convert_to('token-clube-b', 'utf8')), 'hex');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8a: Clube A read % of Clube B invitations', n;
  END IF;

  -- Scoped to nothing — what the join route actually has: no rows at all.
  PERFORM set_config('app.organization_id', '', true);

  SELECT count(*) INTO n FROM invitation;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8b: an unscoped app role read % invitations directly', n;
  END IF;

  -- And yet the reviewed function answers, which is what makes the link work.
  SELECT o_status, o_organization_name INTO v_status, v_name
    FROM find_invitation_by_token(
      encode(sha256(convert_to('token-clube-b', 'utf8')), 'hex'),
      '2026-08-26 12:00:00+00'
    );
  IF v_status <> 'pending' OR v_name <> 'Clube B' THEN
    RAISE EXCEPTION 'FAIL test 8c: the reviewed lookup returned %, %', v_status, v_name;
  END IF;

  RAISE NOTICE 'PASS test 8: invitations stay tenant-scoped; only the reviewed lookup crosses';
END $$;

-- ---------------------------------------------------------------------------
-- Test 9 — the app role cannot mint itself a membership
--
-- The organization/membership/owner triple is a SECURITY DEFINER function partly
-- so this is true: the write path into membership for a tenant you are not in
-- does not exist.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_b uuid; v_status text;
BEGIN
  -- Read the target id as the owner. Asking the app role for it would only prove
  -- it cannot see Clube B, and the INSERT would then insert nothing and "pass"
  -- for the wrong reason — the row has to be one it genuinely wants to write.
  SET LOCAL ROLE postgres;
  SELECT id INTO v_b FROM organization WHERE name = 'Clube B';
  SET LOCAL ROLE poolse_app;

  PERFORM set_config('app.organization_id', '', true);

  BEGIN
    INSERT INTO membership (organization_id, status) VALUES (v_b, 'active');
    RAISE EXCEPTION 'FAIL test 9a: the unscoped app role inserted a membership';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  -- A garbage token is a status, not a stack trace: the join screen renders it.
  SELECT o_status INTO v_status
    FROM accept_invitation(
      encode(sha256(convert_to('token-inventado', 'utf8')), 'hex'),
      'user_carla', '2026-08-26 12:00:00+00'
    );
  IF v_status <> 'not_found' THEN
    RAISE EXCEPTION 'FAIL test 9b: an unknown token returned %', v_status;
  END IF;

  RAISE NOTICE 'PASS test 9: no membership can be minted outside the reviewed functions';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 10 — a family member can be invited, and accepting binds them clean
--
-- 29-10-2026. A bare placeholder offering `guardian` was refused at commit (no
-- NIF, no email), so no family invitation could ever be sent; and a placeholder
-- carrying a club-typed name or address could not be bound to a login. Both are
-- deferred or checked at commit, which a ROLLBACK test never reaches — hence
-- SET CONSTRAINTS ALL IMMEDIATE here.
-- ---------------------------------------------------------------------------

SELECT provision_app_user('user_dora', 'dora@familia.pt', 'Dora', 'Reis', NULL, '2026-08-26 09:00:00+00');

DO $$
DECLARE v_org uuid; v_inviter uuid; v_membership uuid; r record; got record; n int;
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT m.id INTO v_inviter FROM membership m
    JOIN app_user u ON u.id = m.app_user_id
   WHERE m.organization_id = v_org AND u.clerk_user_id = 'user_rui';

  -- As createInvitation does it: the placeholder, its role, then the invitation.
  -- Here with a club-typed name and address too, the case a seed or a prepared
  -- record brings.
  INSERT INTO membership (organization_id, status, first_name, last_name, email)
  VALUES (v_org, 'invited', 'Dora', 'Reis', 'dora@familia.pt')
  RETURNING id INTO v_membership;
  INSERT INTO invitation (
    organization_id, email, roles, token_hash, expires_at, membership_id, invited_by_membership_id
  ) VALUES (
    v_org, 'dora@familia.pt', ARRAY['guardian']::member_role[],
    encode(sha256(convert_to('token-dora', 'utf8')), 'hex'),
    '2026-09-02 09:00:00+00', v_membership, v_inviter
  );
  -- And a bare one, as the API makes it: the pending invitation is its key.
  UPDATE membership SET first_name = NULL, last_name = NULL, email = NULL WHERE id = v_membership;
  INSERT INTO membership_role (organization_id, membership_id, role) VALUES (v_org, v_membership, 'guardian');
  UPDATE membership SET first_name = 'Dora', last_name = 'Reis', email = 'dora@familia.pt' WHERE id = v_membership;

  SELECT o_status AS status INTO r
    FROM accept_invitation(encode(sha256(convert_to('token-dora', 'utf8')), 'hex'), 'user_dora', '2026-08-26 10:00:00+00');
  IF r.status <> 'accepted' THEN
    RAISE EXCEPTION 'FAIL test 10a: acceptance returned %', r.status;
  END IF;

  SELECT count(*) INTO n FROM membership
   WHERE id = v_membership AND app_user_id IS NOT NULL
     AND first_name IS NULL AND last_name IS NULL AND email IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 10b: the bound membership kept a club-held name or address';
  END IF;

  SELECT o_roles AS roles INTO got FROM resolve_memberships('user_dora');
  IF got.roles <> ARRAY['guardian']::text[] THEN
    RAISE EXCEPTION 'FAIL test 10c: Dora holds % instead of guardian', got.roles;
  END IF;

  RAISE NOTICE 'PASS test 10: a family member is invited and bound, Clerk owning the name';
END $$;

-- ---------------------------------------------------------------------------
-- Test 11 — a family invitation names the guardian the club already has
--
-- POOLSE-129. The link may carry no address (shared from the club's phone), a
-- staff invitation may not, and accepting binds the login to the guardian's own
-- record, so the child's guardian_link is the login's. Accepted by somebody who
-- is already in the club (a parent who also teaches), the guardian record is
-- merged into theirs rather than archived, and the link follows.
-- ---------------------------------------------------------------------------

SELECT provision_app_user('user_eva', 'eva@familia.pt', 'Eva', 'Lopes', NULL, '2026-08-26 09:00:00+00');

DO $$
DECLARE v_org uuid; v_inviter uuid; v_guardian uuid; v_guardian2 uuid; v_child uuid;
        v_ana uuid; r record; n int; refused boolean := false;
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT m.id INTO v_inviter FROM membership m
    JOIN app_user u ON u.id = m.app_user_id
   WHERE m.organization_id = v_org AND u.clerk_user_id = 'user_rui';


  -- The guardian as the student form makes one: active, a name, a NIF, no login.
  INSERT INTO membership (organization_id, status, first_name, last_name, tax_number, phone)
  VALUES (v_org, 'active', 'Eva', 'Lopes', '123456789', '+351912345678') RETURNING id INTO v_guardian;
  INSERT INTO membership_role (organization_id, membership_id, role) VALUES (v_org, v_guardian, 'guardian');
  INSERT INTO student (organization_id, first_name, last_name) VALUES (v_org, 'Tomás', 'Lopes')
  RETURNING id INTO v_child;
  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
  VALUES (v_org, v_child, v_guardian, 'mother', true);

  -- Shared by hand: no address.
  INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at,
                          membership_id, invited_by_membership_id)
  VALUES (v_org, NULL, ARRAY['guardian']::member_role[],
          encode(sha256(convert_to('token-eva', 'utf8')), 'hex'),
          '2026-09-02 09:00:00+00', v_guardian, v_inviter);

  -- One live invitation per person.
  refused := false;
  BEGIN
    INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at,
                            membership_id, invited_by_membership_id)
    VALUES (v_org, NULL, ARRAY['guardian']::member_role[], 'h-eva-twice',
            '2026-09-02 09:00:00+00', v_guardian, v_inviter);
  EXCEPTION WHEN unique_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'FAIL test 11b: a guardian held two live links'; END IF;

  SELECT o_status AS status, o_email AS email INTO r
    FROM find_invitation_by_token(encode(sha256(convert_to('token-eva', 'utf8')), 'hex'), '2026-08-26 10:00:00+00');
  IF r.status <> 'pending' OR r.email IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 11c: the preview read % / %', r.status, r.email;
  END IF;

  SELECT o_status AS status, o_membership_id AS bound INTO r
    FROM accept_invitation(encode(sha256(convert_to('token-eva', 'utf8')), 'hex'), 'user_eva', '2026-08-26 10:00:00+00');
  IF r.status <> 'accepted' OR r.bound <> v_guardian THEN
    RAISE EXCEPTION 'FAIL test 11d: accepted % onto % rather than the guardian', r.status, r.bound;
  END IF;
  SELECT count(*) INTO n FROM membership
   WHERE organization_id = v_org
     AND app_user_id = (SELECT id FROM app_user WHERE clerk_user_id = 'user_eva')
     AND archived_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL test 11e: Eva has % memberships, not one', n; END IF;
  SELECT count(*) INTO n FROM guardian_link WHERE guardian_membership_id = v_guardian AND archived_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL test 11f: the child lost the guardian link'; END IF;

  -- Ana is already staff in Clube A. Invited as a second child's guardian, her
  -- guardian record is merged into her membership and the link follows her.
  SELECT m.id INTO v_ana FROM membership m JOIN app_user u ON u.id = m.app_user_id
   WHERE m.organization_id = v_org AND u.clerk_user_id = 'user_ana' AND m.archived_at IS NULL;
  INSERT INTO membership (organization_id, status, first_name, last_name, tax_number)
  VALUES (v_org, 'active', 'Ana', 'Martins', '234567899') RETURNING id INTO v_guardian2;
  INSERT INTO membership_role (organization_id, membership_id, role) VALUES (v_org, v_guardian2, 'guardian');
  INSERT INTO student (organization_id, first_name, last_name) VALUES (v_org, 'Rita', 'Martins')
  RETURNING id INTO v_child;
  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
  VALUES (v_org, v_child, v_guardian2, 'mother', true);
  INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at,
                          membership_id, invited_by_membership_id)
  VALUES (v_org, NULL, ARRAY['guardian']::member_role[],
          encode(sha256(convert_to('token-ana-mother', 'utf8')), 'hex'),
          '2026-09-02 09:00:00+00', v_guardian2, v_inviter);

  SELECT o_status AS status, o_membership_id AS bound INTO r
    FROM accept_invitation(encode(sha256(convert_to('token-ana-mother', 'utf8')), 'hex'), 'user_ana', '2026-08-26 10:00:00+00');
  IF r.status <> 'accepted' OR r.bound <> v_ana THEN
    RAISE EXCEPTION 'FAIL test 11g: accepted % onto % rather than Ana''s own membership', r.status, r.bound;
  END IF;
  SELECT count(*) INTO n FROM guardian_link
   WHERE student_id = v_child AND guardian_membership_id = v_ana AND archived_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL test 11h: Rita''s guardian link did not follow Ana'; END IF;
  SELECT count(*) INTO n FROM membership_role
   WHERE membership_id = v_ana AND role = 'guardian' AND archived_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL test 11i: Ana is not a guardian after accepting'; END IF;

  -- 30-10-2026: a staff invitation by phone names Eva's own record, with no
  -- address. She holds no instructor role until she accepts — and she already
  -- has a login here, so a fresh guardian record stands in for "no login yet".
  INSERT INTO membership (organization_id, status, first_name, last_name, tax_number, phone)
  VALUES (v_org, 'active', 'Zé', 'Pais', '345678902', '+351917000111') RETURNING id INTO v_guardian;
  INSERT INTO membership_role (organization_id, membership_id, role) VALUES (v_org, v_guardian, 'guardian');
  INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at,
                          membership_id, invited_by_membership_id)
  VALUES (v_org, NULL, ARRAY['instructor']::member_role[],
          encode(sha256(convert_to('token-ze', 'utf8')), 'hex'),
          '2026-09-02 09:00:00+00', v_guardian, v_inviter);
  SELECT count(*) INTO n FROM membership_role
   WHERE membership_id = v_guardian AND role = 'instructor' AND archived_at IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 11j: the role arrived before the login'; END IF;
  PERFORM provision_app_user('user_ze', 'ze@familia.pt', 'Zé', 'Pais', NULL, '2026-08-26 09:00:00+00');
  SELECT o_status AS status, o_membership_id AS bound INTO r
    FROM accept_invitation(encode(sha256(convert_to('token-ze', 'utf8')), 'hex'), 'user_ze', '2026-08-26 10:00:00+00');
  IF r.status <> 'accepted' OR r.bound <> v_guardian THEN
    RAISE EXCEPTION 'FAIL test 11k: accepted % onto % rather than Zé''s record', r.status, r.bound;
  END IF;
  SELECT count(*) INTO n FROM membership_role
   WHERE membership_id = v_guardian AND role IN ('instructor', 'guardian') AND archived_at IS NULL;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL test 11l: Zé is not instructor and guardian on one record'; END IF;

  RAISE NOTICE 'PASS test 11: an invitation binds to the person the club has, or merges it into the login, roles arriving with it';
END $$;

ROLLBACK;
