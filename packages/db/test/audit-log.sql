-- Audit log proof — slice 0.8.
--
-- Test 2 is the one that makes this table an audit log rather than a table named
-- one. Slice 0.3 left `ALTER DEFAULT PRIVILEGES` granting the app role all four
-- verbs on every table created afterwards, so `audit_log` arrived writable and
-- deletable and had to give both back. If someone later adds a table expecting
-- append-only behaviour and forgets the REVOKE, this is the test that says so.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_owner', 'owner@clube.pt', 'Rui',  'Fonseca', NULL, '2026-08-26 09:00:00+00');
SELECT provision_app_user('user_join',  'ana@clube.pt',   'Ana',  'Martins', NULL, '2026-08-26 09:00:00+00');
SELECT provision_app_user('user_other', 'carla@outro.pt', 'Carla','Nunes',   NULL, '2026-08-26 09:00:00+00');

-- ---------------------------------------------------------------------------
-- Test 1 — creating an organization records who created it
--
-- Written inside provision_organization, because at that moment the caller is not
-- yet a member of anything and an unscoped INSERT would be refused by the policy.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_membership uuid; r record; n int;
BEGIN
  SELECT o_organization_id, o_membership_id INTO v_org, v_membership
    FROM provision_organization('user_owner', 'Clube A', 'pt-PT', 'Piscina Principal');

  SELECT action, entity_type, entity_id, actor_membership_id, data INTO r
    FROM audit_log
   WHERE organization_id = v_org AND action = 'organization.created';

  IF r.action <> 'organization.created' OR r.entity_type <> 'organization' THEN
    RAISE EXCEPTION 'FAIL test 1a: recorded % on %', r.action, r.entity_type;
  END IF;
  IF r.entity_id <> v_org OR r.actor_membership_id <> v_membership THEN
    RAISE EXCEPTION 'FAIL test 1b: the entry points at the wrong rows';
  END IF;
  IF r.data ->> 'name' <> 'Clube A' THEN
    RAISE EXCEPTION 'FAIL test 1c: the entry lost its detail (%)', r.data;
  END IF;

  -- Signup also creates the first facility, and records that too.
  SELECT count(*) INTO n FROM audit_log
   WHERE organization_id = v_org AND action = 'facility.created';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 1d: signup recorded % facility entries, expected 1', n;
  END IF;

  RAISE NOTICE 'PASS test 1: creating an organization records who did it and what it was called';
END $$;

-- A second organization, so the isolation claim below has somewhere to leak to.
DO $$
BEGIN
  PERFORM provision_organization('user_other', 'Clube B', 'pt-PT', 'Piscina Principal');
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — the application can append and read, and cannot rewrite history
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE v_a uuid; v_membership uuid; n int;
BEGIN
  SET LOCAL ROLE postgres;
  SELECT id INTO v_a FROM organization WHERE name = 'Clube A';
  SELECT m.id INTO v_membership FROM membership m
   WHERE m.organization_id = v_a AND m.app_user_id IS NOT NULL;
  SET LOCAL ROLE poolse_app;

  PERFORM set_config('app.organization_id', v_a::text, true);

  -- What recordAudit does, from the app role, scoped to its own tenant.
  INSERT INTO audit_log (organization_id, actor_membership_id, action, entity_type, data)
  VALUES (v_a, v_membership, 'pool.created', 'pool', '{"name": "Tanque Norte"}'::jsonb);

  SELECT count(*) INTO n FROM audit_log WHERE action = 'pool.created';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 2a: the app role could not append (% rows)', n;
  END IF;

  BEGIN
    UPDATE audit_log SET action = 'pool.deleted' WHERE action = 'pool.created';
    RAISE EXCEPTION 'FAIL test 2b: the app role rewrote an audit entry';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    DELETE FROM audit_log WHERE action = 'pool.created';
    RAISE EXCEPTION 'FAIL test 2c: the app role deleted an audit entry';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'PASS test 2: the app role can append and read entries, never alter or remove one';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — entries are tenant-scoped like everything else
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_a uuid; v_b uuid; n int;
BEGIN
  SET LOCAL ROLE postgres;
  SELECT id INTO v_a FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_b FROM organization WHERE name = 'Clube B';
  SET LOCAL ROLE poolse_app;

  PERFORM set_config('app.organization_id', v_b::text, true);
  SELECT count(*) INTO n FROM audit_log WHERE organization_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 3a: Clube B read % of Clube A entries', n;
  END IF;

  -- And the unscoped read that the join route runs with.
  PERFORM set_config('app.organization_id', '', true);
  SELECT count(*) INTO n FROM audit_log;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 3b: an unscoped read returned % entries', n;
  END IF;

  RAISE NOTICE 'PASS test 3: an organization sees only its own history';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 4 — an organization cannot record an action by another organization
--
-- The composite foreign key, doing here what it does everywhere else.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_a uuid; v_b_membership uuid;
BEGIN
  SELECT id INTO v_a FROM organization WHERE name = 'Clube A';
  SELECT m.id INTO v_b_membership
    FROM membership m JOIN organization o ON o.id = m.organization_id
   WHERE o.name = 'Clube B';

  BEGIN
    INSERT INTO audit_log (organization_id, actor_membership_id, action, entity_type)
    VALUES (v_a, v_b_membership, 'forged.action', 'organization');
    RAISE EXCEPTION 'FAIL test 4: an entry credited another tenant''s member';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 4: an action cannot be credited to another organization''s member';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — accepting an invitation is recorded, including the merge case
--
-- Written inside accept_invitation for the same reason as test 1: the person is
-- not a member of that organization until the statement above it runs.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_membership uuid; r record;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  INSERT INTO membership (organization_id, status) VALUES (v_org, 'invited')
  RETURNING id INTO v_membership;
  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_membership, 'instructor');
  INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at, membership_id)
  VALUES (
    v_org, 'ana@clube.pt', ARRAY['instructor']::member_role[],
    encode(sha256(convert_to('token-audit', 'utf8')), 'hex'),
    '2026-09-02 09:00:00+00', v_membership
  );

  PERFORM accept_invitation(
    encode(sha256(convert_to('token-audit', 'utf8')), 'hex'),
    'user_join', '2026-08-26 10:00:00+00'
  );

  SELECT action, entity_type, actor_membership_id, data INTO r
    FROM audit_log WHERE action = 'invitation.accepted';

  IF r.action IS NULL THEN
    RAISE EXCEPTION 'FAIL test 5a: acceptance was not recorded';
  END IF;
  IF r.actor_membership_id <> v_membership THEN
    RAISE EXCEPTION 'FAIL test 5b: the entry credits the wrong membership';
  END IF;
  IF r.data ->> 'email' <> 'ana@clube.pt' THEN
    RAISE EXCEPTION 'FAIL test 5c: the entry lost the invited address (%)', r.data;
  END IF;
  IF (r.data ->> 'merged_into_existing')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL test 5d: a first-time join was recorded as a merge';
  END IF;

  RAISE NOTICE 'PASS test 5: accepting an invitation is recorded with who, what and how';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — the token never reaches the log
--
-- An audit log every admin can read is not a place to keep a working credential,
-- and the log is exactly where a careless `data: {...input}` would put one.
-- ---------------------------------------------------------------------------

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM audit_log
   WHERE data::text LIKE '%token%'
      OR data::text LIKE '%' || encode(sha256(convert_to('token-audit', 'utf8')), 'hex') || '%';

  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6: % entries carry an invitation token', n;
  END IF;
  RAISE NOTICE 'PASS test 6: no invitation token, hashed or otherwise, is written to the log';
END $$;

ROLLBACK;
