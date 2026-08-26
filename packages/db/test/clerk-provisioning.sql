-- Clerk provisioning proof — slice 0.4's "done when", plus the correction it makes
-- to slice 0.3.
--
-- Two things are under test. The first is that the webhook's writes behave: an
-- upsert that is idempotent, and that discards an event older than what it already
-- has. The second matters more: that the SECURITY DEFINER functions are the ONLY
-- way to read across tenants, and that the ordinary path is still blind without a
-- tenant set. Test 6 is the one to keep forever.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- Seed, as the owner
-- ---------------------------------------------------------------------------

-- `slug` is NOT NULL since slice 0.5. Signup derives it; a direct seed states it.
INSERT INTO organization (id, name, slug) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Clube A', 'clube-a'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Clube B', 'clube-b');

-- ---------------------------------------------------------------------------
-- Test 1 — a Clerk signup becomes an app_user with its cache populated
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_id uuid; r record;
BEGIN
  v_id := provision_app_user(
    'user_clerk_ana', 'ana@clube.pt', 'Ana', 'Martins',
    'https://img.clerk.example/ana.png', '2026-08-26 10:00:00+00'
  );

  SELECT cached_email::text AS email, cached_first_name AS first, cached_last_name AS last,
         synced_at, deleted_at
    INTO r
    FROM app_user WHERE id = v_id;

  IF r.email <> 'ana@clube.pt' OR r.first <> 'Ana' OR r.last <> 'Martins' THEN
    RAISE EXCEPTION 'FAIL test 1: cache not populated (%, %, %)', r.email, r.first, r.last;
  END IF;
  IF r.synced_at IS NULL THEN
    RAISE EXCEPTION 'FAIL test 1: synced_at was not stamped';
  END IF;
  RAISE NOTICE 'PASS test 1: a Clerk signup lands as an app_user with cached fields';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — redelivery is a no-op, not a duplicate
--
-- Clerk guarantees at-least-once delivery, so this happens in normal operation.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_first uuid; v_second uuid; n int;
BEGIN
  SELECT id INTO v_first FROM app_user WHERE clerk_user_id = 'user_clerk_ana';

  v_second := provision_app_user(
    'user_clerk_ana', 'ana@clube.pt', 'Ana', 'Martins',
    'https://img.clerk.example/ana.png', '2026-08-26 10:00:00+00'
  );

  SELECT count(*) INTO n FROM app_user WHERE clerk_user_id = 'user_clerk_ana';
  IF n <> 1 OR v_second <> v_first THEN
    RAISE EXCEPTION 'FAIL test 2: redelivery produced % rows (id % then %)', n, v_first, v_second;
  END IF;
  RAISE NOTICE 'PASS test 2: a redelivered webhook is idempotent';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — a newer event updates the cache; a stale one does not revert it
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_email text;
BEGIN
  PERFORM provision_app_user(
    'user_clerk_ana', 'ana.martins@clube.pt', 'Ana', 'Martins',
    'https://img.clerk.example/ana.png', '2026-08-26 11:00:00+00'
  );

  SELECT cached_email::text INTO v_email FROM app_user WHERE clerk_user_id = 'user_clerk_ana';
  IF v_email <> 'ana.martins@clube.pt' THEN
    RAISE EXCEPTION 'FAIL test 3a: newer event did not update the cache (%)', v_email;
  END IF;

  -- The retry of an older event, arriving late.
  PERFORM provision_app_user(
    'user_clerk_ana', 'ana@clube.pt', 'Ana', 'Martins',
    'https://img.clerk.example/ana.png', '2026-08-26 10:00:00+00'
  );

  SELECT cached_email::text INTO v_email FROM app_user WHERE clerk_user_id = 'user_clerk_ana';
  IF v_email <> 'ana.martins@clube.pt' THEN
    RAISE EXCEPTION 'FAIL test 3b: a stale event reverted the cache to %', v_email;
  END IF;
  RAISE NOTICE 'PASS test 3: out-of-order delivery does not revert the cache';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — resolve_memberships returns the person's orgs and roles, and only theirs
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_ana uuid; v_bruno uuid; v_m_a uuid; v_m_b uuid; n int; r record;
BEGIN
  SELECT id INTO v_ana FROM app_user WHERE clerk_user_id = 'user_clerk_ana';
  v_bruno := provision_app_user(
    'user_clerk_bruno', 'bruno@outro.pt', 'Bruno', NULL, NULL, '2026-08-26 10:00:00+00'
  );

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', v_ana, 'active')
  RETURNING id INTO v_m_a;

  INSERT INTO membership_role (organization_id, membership_id, role) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', v_m_a, 'owner'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', v_m_a, 'instructor');

  -- Bruno is in the other organization entirely.
  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', v_bruno, 'active')
  RETURNING id INTO v_m_b;

  SELECT count(*) INTO n FROM resolve_memberships('user_clerk_ana');
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 4a: expected 1 membership for Ana, got %', n;
  END IF;

  SELECT * INTO r FROM resolve_memberships('user_clerk_ana');
  IF r.o_organization_id <> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     OR r.o_organization_name <> 'Clube A'
     OR r.o_app_user_id <> v_ana THEN
    RAISE EXCEPTION 'FAIL test 4b: wrong organization returned (%, %)', r.o_organization_id, r.o_organization_name;
  END IF;
  IF NOT (r.o_roles @> ARRAY['owner', 'instructor'] AND array_length(r.o_roles, 1) = 2) THEN
    RAISE EXCEPTION 'FAIL test 4c: expected both roles, got %', r.o_roles;
  END IF;
  RAISE NOTICE 'PASS test 4: memberships and roles resolve, scoped to the one person';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — an invited-but-not-accepted or archived membership is not a live tenant
--
-- Slice 0.5 creates memberships in 'invited' before the person accepts. Until then
-- they must not be able to act as that organization.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_ana uuid; n int;
BEGIN
  SELECT id INTO v_ana FROM app_user WHERE clerk_user_id = 'user_clerk_ana';

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', v_ana, 'invited');

  SELECT count(*) INTO n FROM resolve_memberships('user_clerk_ana');
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 5: a pending invitation counted as a live membership (% rows)', n;
  END IF;
  RAISE NOTICE 'PASS test 5: only active, unarchived memberships resolve';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — the SECURITY DEFINER functions are the only cross-tenant path
--
-- This is the test that documents why the functions exist. As the app role with
-- no organization set — exactly what the tenant middleware has when it runs — a
-- plain SELECT sees nothing, and an INSERT is refused. The functions still answer.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', '', true);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM app_user;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6a: unscoped app role read % app_user rows directly', n;
  END IF;

  SELECT count(*) INTO n FROM membership;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6b: unscoped app role read % membership rows directly', n;
  END IF;

  SELECT count(*) INTO n FROM find_app_user('user_clerk_ana');
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 6c: find_app_user returned % rows for a known user', n;
  END IF;

  SELECT count(*) INTO n FROM resolve_memberships('user_clerk_ana');
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 6d: resolve_memberships returned % rows for a known user', n;
  END IF;

  RAISE NOTICE 'PASS test 6: RLS still blinds the ordinary path; only the reviewed functions see across tenants';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — the app role cannot write the identity cache behind the webhook's back
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  INSERT INTO app_user (clerk_user_id, cached_email) VALUES ('user_clerk_forged', 'forged@example.com');
  RAISE EXCEPTION 'FAIL test 7: the app role inserted an app_user directly';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 7: only provision_app_user can create an identity';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 8 — user.deleted tombstones the account, clears the cache, ends memberships
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_id uuid; r record; n int;
BEGIN
  v_id := deactivate_app_user('user_clerk_ana', '2026-08-26 12:00:00+00');
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'FAIL test 8a: deactivate_app_user did not find a known user';
  END IF;

  SELECT deleted_at, cached_email::text AS email, cached_first_name AS first INTO r
    FROM app_user WHERE id = v_id;
  IF r.deleted_at IS NULL THEN
    RAISE EXCEPTION 'FAIL test 8b: the account was not tombstoned';
  END IF;
  IF r.email IS NOT NULL OR r.first IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 8c: personal data survived the deletion (%, %)', r.email, r.first;
  END IF;

  SELECT count(*) INTO n FROM membership WHERE app_user_id = v_id AND archived_at IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8d: % memberships still active after deletion', n;
  END IF;

  SELECT count(*) INTO n FROM find_app_user('user_clerk_ana');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8e: a deleted account still resolves';
  END IF;

  SELECT count(*) INTO n FROM resolve_memberships('user_clerk_ana');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8f: a deleted account still holds % memberships', n;
  END IF;

  -- The row itself stays: memberships, and later attendance and invoices, point at it.
  SELECT count(*) INTO n FROM app_user WHERE id = v_id;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 8g: the tombstone row was removed, breaking references';
  END IF;

  RAISE NOTICE 'PASS test 8: deletion clears personal data and ends memberships, keeping referential integrity';
END $$;

-- ---------------------------------------------------------------------------
-- Test 9 — deleting someone Clerk knows and Poolse does not is a no-op
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF deactivate_app_user('user_clerk_never_seen', now()) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 9: deactivating an unknown user reported a change';
  END IF;
  RAISE NOTICE 'PASS test 9: an unknown user.deleted is a no-op, not an error';
END $$;

ROLLBACK;
