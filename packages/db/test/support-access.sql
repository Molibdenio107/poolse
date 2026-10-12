-- Support access, proved at the database — POOLSE-79 slice 1.
--
-- What has to hold, and could quietly not:
--
--   1. A grant is history. The tenant role writes one and ends one, and cannot
--      stretch the window or delete it.
--   2. Only a live platform admin, holding a live grant, enters a club.
--   3. A support membership's role comes from its grant: `{admin}` while it is
--      live, absent the moment it is not, with no job having run. And it can
--      never hold a role row.
--   4. Entering and leaving are written to both trails.
--   5. The platform role can read grants, and still cannot write one, nor read
--      `student`.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Clube S', 'clube-s');

INSERT INTO app_user (id, clerk_user_id) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'user_test_support_owner'),
  ('e0000000-0000-0000-0000-000000000002', 'user_test_support_operator'),
  ('e0000000-0000-0000-0000-000000000003', 'user_test_support_stranger');

INSERT INTO platform_admin (clerk_user_id, note) VALUES ('user_test_support_operator', 'Teste');

INSERT INTO membership (id, organization_id, app_user_id, status) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'e0000000-0000-0000-0000-000000000001', 'active');
INSERT INTO membership_role (organization_id, membership_id, role) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'e1000000-0000-0000-0000-000000000001', 'owner');

-- ---------------------------------------------------------------------------
-- Test 1 — the Owner opens a grant; the window cannot be stretched, nor the
-- row deleted
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true);

INSERT INTO support_grant (id, organization_id, source, granted_by_membership_id, expires_at)
VALUES ('e2000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        'owner', 'e1000000-0000-0000-0000-000000000001', now() + interval '24 hours');

DO $$
BEGIN
  BEGIN
    UPDATE support_grant SET expires_at = now() + interval '1 year';
    RAISE EXCEPTION 'FAIL test 1a: the tenant role stretched a grant';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 1a: a grant''s window is not the tenant''s to change';
  END;

  BEGIN
    DELETE FROM support_grant;
    RAISE EXCEPTION 'FAIL test 1b: the tenant role deleted a grant';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 1b: a grant is never deleted';
  END;

  BEGIN
    INSERT INTO support_grant (organization_id, source, expires_at)
    VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'owner', now() + interval '1 day');
    RAISE EXCEPTION 'FAIL test 1c: an owner grant with no grantor was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS test 1c: an Owner''s grant names who granted it';
  END;
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 2 — only a live platform admin enters, and only on a live grant
-- ---------------------------------------------------------------------------

-- The club's own owner is also an operator, for 2c.
INSERT INTO platform_admin (clerk_user_id, note) VALUES ('user_test_support_owner', 'Teste');

SET LOCAL ROLE poolse_platform;

DO $$
BEGIN
  BEGIN
    PERFORM support_session('user_test_support_stranger', 'e2000000-0000-0000-0000-000000000001', 'enter');
    RAISE EXCEPTION 'FAIL test 2a: somebody who is not a platform admin entered';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 2a: only a platform admin enters';
  END;

  BEGIN
    PERFORM support_session('user_test_support_operator', gen_random_uuid(), 'enter');
    RAISE EXCEPTION 'FAIL test 2b: an unknown grant let somebody in';
  EXCEPTION WHEN no_data_found THEN
    RAISE NOTICE 'PASS test 2b: no grant, no entry';
  END;

  BEGIN
    PERFORM support_session('user_test_support_owner', 'e2000000-0000-0000-0000-000000000001', 'enter');
    RAISE EXCEPTION 'FAIL test 2c: the club''s own owner entered as support';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS test 2c: being a member is not being support';
  END;
END $$;

SELECT support_session('user_test_support_operator', 'e2000000-0000-0000-0000-000000000001', 'enter');

-- ---------------------------------------------------------------------------
-- Test 5 — the platform reads grants, writes none, and still cannot read a
-- student
-- ---------------------------------------------------------------------------

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM support_grant WHERE organization_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL test 5a: the platform sees % grants, not 1', n; END IF;
  RAISE NOTICE 'PASS test 5a: the platform reads where it has been let in';

  BEGIN
    INSERT INTO support_grant (organization_id, source, granted_by_membership_id, expires_at)
    VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'owner',
            'e1000000-0000-0000-0000-000000000001', now() + interval '1 day');
    RAISE EXCEPTION 'FAIL test 5b: the platform wrote a grant on the club''s behalf';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 5b: only the club grants';
  END;

  BEGIN
    SELECT count(*) INTO n FROM student;
    RAISE EXCEPTION 'FAIL test 5c: the platform read student';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 5c: support access widened nothing on student';
  END;
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 3 — the role is the grant's: admin while live, gone when not, never a row
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_roles   text[];
  v_expires timestamptz;
  v_member  uuid;
BEGIN
  SELECT o_roles, o_support_expires_at, o_membership_id INTO v_roles, v_expires, v_member
    FROM resolve_memberships('user_test_support_operator')
   WHERE o_organization_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  IF v_roles IS DISTINCT FROM ARRAY['admin']::text[] THEN
    RAISE EXCEPTION 'FAIL test 3a: a support membership resolved to %', v_roles;
  END IF;
  IF v_expires IS NULL THEN
    RAISE EXCEPTION 'FAIL test 3a: the banner has no end time';
  END IF;
  RAISE NOTICE 'PASS test 3a: a live grant resolves to admin, with its end time';

  IF EXISTS (SELECT 1 FROM membership_role WHERE membership_id = v_member) THEN
    RAISE EXCEPTION 'FAIL test 3b: the support membership holds a role row';
  END IF;
  BEGIN
    INSERT INTO membership_role (organization_id, membership_id, role)
    VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', v_member, 'owner');
    RAISE EXCEPTION 'FAIL test 3b: a role row was written on a support membership';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS test 3b: a support membership never holds a role row';
  END;

  -- Revoked by the Owner: gone on the next resolve, nothing else having run.
  UPDATE support_grant SET ended_at = now(), ended_by = 'owner'
   WHERE id = 'e2000000-0000-0000-0000-000000000001';
  IF EXISTS (
    SELECT 1 FROM resolve_memberships('user_test_support_operator')
     WHERE o_organization_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
  ) THEN
    RAISE EXCEPTION 'FAIL test 3c: a revoked grant still resolves';
  END IF;
  RAISE NOTICE 'PASS test 3c: revoking ends the session at the next request';
END $$;

-- An expired grant: never written as ended, simply past its window.
INSERT INTO support_grant (id, organization_id, source, granted_by_membership_id, starts_at, expires_at)
VALUES ('e2000000-0000-0000-0000-000000000002', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'owner',
        'e1000000-0000-0000-0000-000000000001', now() - interval '2 days', now() - interval '1 day');
UPDATE membership SET support_grant_id = 'e2000000-0000-0000-0000-000000000002'
 WHERE app_user_id = 'e0000000-0000-0000-0000-000000000002';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM resolve_memberships('user_test_support_operator')
     WHERE o_organization_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
  ) THEN
    RAISE EXCEPTION 'FAIL test 3d: an expired grant still resolves';
  END IF;
  RAISE NOTICE 'PASS test 3d: an expired grant ends the session with no cron';

  BEGIN
    PERFORM support_session('user_test_support_operator', 'e2000000-0000-0000-0000-000000000002', 'enter');
    RAISE EXCEPTION 'FAIL test 3e: an expired grant let somebody in';
  EXCEPTION WHEN no_data_found THEN
    RAISE NOTICE 'PASS test 3e: an expired grant is no way in';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — entering and leaving are on both trails
-- ---------------------------------------------------------------------------

INSERT INTO support_grant (id, organization_id, source, granted_by_membership_id, expires_at)
VALUES ('e2000000-0000-0000-0000-000000000003', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'owner',
        'e1000000-0000-0000-0000-000000000001', now() + interval '3 days');

SET LOCAL ROLE poolse_platform;
SELECT support_session('user_test_support_operator', 'e2000000-0000-0000-0000-000000000003', 'enter');
SELECT support_session('user_test_support_operator', 'e2000000-0000-0000-0000-000000000003', 'leave');
RESET ROLE;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM membership
   WHERE organization_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
     AND app_user_id = 'e0000000-0000-0000-0000-000000000002';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 4a: % support memberships, not one re-pointed', n;
  END IF;
  RAISE NOTICE 'PASS test 4a: one support membership per operator per club';

  SELECT count(*) INTO n FROM audit_log
   WHERE organization_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
     AND action IN ('support.entered', 'support.ended');
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL test 4b: % entries in the club''s log, not 3', n; END IF;

  SELECT count(*) INTO n FROM platform_audit_log
   WHERE organization_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
     AND action IN ('support.entered', 'support.ended');
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL test 4b: % entries in the platform''s log, not 3', n; END IF;
  RAISE NOTICE 'PASS test 4b: entering and leaving are on both trails';

  IF NOT EXISTS (
    SELECT 1 FROM support_grant
     WHERE id = 'e2000000-0000-0000-0000-000000000003' AND ended_by = 'support'
  ) THEN
    RAISE EXCEPTION 'FAIL test 4c: leaving did not end the grant';
  END IF;
  RAISE NOTICE 'PASS test 4c: leaving ends the grant, said as support';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — slice 2: the platform writes an override and a request, and only so
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_platform;

DO $$
DECLARE v_admin uuid;
BEGIN
  SELECT id INTO v_admin FROM platform_admin WHERE clerk_user_id = 'user_test_support_operator';

  BEGIN
    INSERT INTO support_grant (organization_id, source, requested_by_platform_admin_id, reason,
                               starts_at, expires_at, notice_recipients)
    VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'override', v_admin, 'Teste',
            now(), now() + interval '5 hours', ARRAY[]::text[]);
    RAISE EXCEPTION 'FAIL test 6a: a five-hour override was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS test 6a: an override is exactly four hours';
  END;

  BEGIN
    INSERT INTO support_grant (organization_id, source, requested_by_platform_admin_id, reason,
                               starts_at, expires_at)
    VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'override', v_admin, 'Teste',
            now(), now() + interval '4 hours');
    RAISE EXCEPTION 'FAIL test 6b: an override owed nobody a notice';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS test 6b: an override records who it owes a notice';
  END;

  INSERT INTO support_grant (organization_id, source, requested_by_platform_admin_id, reason,
                             starts_at, expires_at, notice_recipients)
  VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'override', v_admin, 'Teste',
          now(), now() + interval '4 hours', ARRAY['dono@example.test']);
  RAISE NOTICE 'PASS test 6c: a well-formed override is the platform''s to write';

  INSERT INTO support_request (organization_id, requested_by_platform_admin_id, reason)
  VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', v_admin, 'Pedido de teste');

  BEGIN
    UPDATE support_request SET answer = 'approved';
    RAISE EXCEPTION 'FAIL test 6d: the platform answered its own request';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 6d: only the club answers a request';
  END;
END $$;

RESET ROLE;

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true);

DO $$
BEGIN
  BEGIN
    INSERT INTO support_request (organization_id, requested_by_platform_admin_id, reason)
    SELECT 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', requested_by_platform_admin_id, 'Forjado'
      FROM support_request LIMIT 1;
    RAISE EXCEPTION 'FAIL test 6e: the club wrote a request in Poolse''s name';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 6e: a request is Poolse''s to make';
  END;
END $$;

RESET ROLE;

ROLLBACK;
