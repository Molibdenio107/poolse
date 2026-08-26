-- Tenant isolation proof — slice 0.3's "done when".
--
-- This is not a unit test of application code. It proves that the DATABASE refuses
-- cross-tenant access even when the application does everything wrong: an unscoped
-- SELECT with no WHERE clause, and an INSERT deliberately pointing at another
-- tenant's row.
--
-- Run: psql -v ON_ERROR_STOP=1 -d poolse_test -f tenant-isolation.sql
-- Any FAIL raises an exception and aborts.

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- Seed two tenants as the owner (owner bypasses RLS, which is why migrations work)
-- ---------------------------------------------------------------------------

-- `slug` is NOT NULL since slice 0.5. Signup derives it; a direct seed states it.
INSERT INTO organization (id, name, slug) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Clube A', 'clube-a'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Clube B', 'clube-b');

INSERT INTO facility (id, organization_id, name) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Sede A'),
  ('b1111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Sede B');

INSERT INTO pool (organization_id, facility_id, name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1111111-1111-1111-1111-111111111111', 'Piscina A1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1111111-1111-1111-1111-111111111111', 'Piscina A2'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1111111-1111-1111-1111-111111111111', 'Piscina B1');

-- ---------------------------------------------------------------------------
-- Test 1 — an unscoped query as the app role sees only the scoped tenant
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

DO $$
DECLARE n int; names text;
BEGIN
  -- Deliberately no WHERE clause. This is the method written at 23:40.
  SELECT count(*), string_agg(name, ', ' ORDER BY name) INTO n, names FROM pool;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 1: unscoped SELECT returned % rows (%), expected 2 from org A', n, names;
  END IF;
  RAISE NOTICE 'PASS test 1: unscoped SELECT saw only org A (%)', names;
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — switching tenant switches the visible set, with no code change
-- ---------------------------------------------------------------------------

SELECT set_config('app.organization_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pool;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 2: expected 1 row for org B, got %', n;
  END IF;
  RAISE NOTICE 'PASS test 2: same query, org B sees 1 row';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — an unscoped connection sees nothing at all
-- ---------------------------------------------------------------------------

SELECT set_config('app.organization_id', '', true);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pool;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 3: connection with no tenant set saw % rows', n;
  END IF;
  RAISE NOTICE 'PASS test 3: no tenant set means no rows, not all rows';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — RLS blocks writing a row into another tenant
-- ---------------------------------------------------------------------------

SELECT set_config('app.organization_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

DO $$
BEGIN
  INSERT INTO facility (organization_id, name)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Smuggled into B');
  RAISE EXCEPTION 'FAIL test 4: wrote a facility into another tenant';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 4: RLS WITH CHECK rejected the cross-tenant INSERT';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — the composite foreign key blocks a same-tenant row from referencing
-- another tenant's parent, which RLS alone would not catch
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  INSERT INTO pool (organization_id, facility_id, name)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          'b1111111-1111-1111-1111-111111111111',   -- org B's facility
          'Pool in the wrong building');
  RAISE EXCEPTION 'FAIL test 5: org A pool accepted org B facility';
EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS test 5: composite FK rejected the cross-tenant reference';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — partial unique index lets an archived membership be recreated
-- ---------------------------------------------------------------------------

RESET ROLE;

INSERT INTO app_user (id, clerk_user_id) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'user_test_instructor');

INSERT INTO membership (organization_id, app_user_id, status, archived_at) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c1111111-1111-1111-1111-111111111111', 'active', now());

DO $$
BEGIN
  -- Same person, same org, re-added next season. The archived row must not block it.
  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c1111111-1111-1111-1111-111111111111', 'active');
  RAISE NOTICE 'PASS test 6: archived membership did not block re-adding the person';
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'FAIL test 6: partial unique index is not partial';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — one membership can hold several roles
-- ---------------------------------------------------------------------------

DO $$
DECLARE mid uuid; n int;
BEGIN
  SELECT id INTO mid FROM membership
   WHERE app_user_id = 'c1111111-1111-1111-1111-111111111111' AND archived_at IS NULL;

  INSERT INTO membership_role (organization_id, membership_id, role) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', mid, 'owner'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', mid, 'instructor');

  SELECT count(*) INTO n FROM membership_role WHERE membership_id = mid;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 7: expected 2 roles, got %', n;
  END IF;
  RAISE NOTICE 'PASS test 7: the owner who also teaches keeps both roles';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8 — a self-provisioned organization is as sealed as a seeded one
--
-- Slice 0.5 added the one write path that deliberately runs with RLS bypassed:
-- `provision_organization` is SECURITY DEFINER because a brand-new organization
-- has no `current_organization_id()` to satisfy the policy with. That makes it
-- the single most likely place for isolation to be quietly undone — a stray
-- statement inside a function that already runs as the owner would touch any
-- tenant it liked.
--
-- So this asserts the outcome rather than the mechanism: after signup, a session
-- scoped to the new organization sees exactly its own rows and none of the two
-- seeded tenants above, and the seeded tenants cannot see it either.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_user uuid; v_org uuid; v_membership uuid; v_facility uuid; v_slug text;
  n int; v_status text; v_trial timestamptz;
BEGIN
  PERFORM provision_app_user('user_signup', 'novo@clube.pt', 'Nuno', 'Dias', NULL,
                             '2026-08-26 09:00:00+00');

  SELECT o_organization_id, o_membership_id, o_facility_id, o_slug
    INTO v_org, v_membership, v_facility, v_slug
    FROM provision_organization('user_signup', 'Piscinas do Sul', 'pt-PT', 'Piscina Central');

  -- The trial starts immediately and takes no payment; phase 2 enforces it.
  SELECT subscription_status::text, trial_ends_at INTO v_status, v_trial
    FROM organization WHERE id = v_org;
  IF v_status <> 'trialing' THEN
    RAISE EXCEPTION 'FAIL test 8a: new organization is %, not trialing', v_status;
  END IF;
  IF v_trial IS NULL OR v_trial <= now() THEN
    RAISE EXCEPTION 'FAIL test 8b: trial_ends_at was not set into the future (%)', v_trial;
  END IF;
  IF v_slug <> 'piscinas-do-sul' THEN
    RAISE EXCEPTION 'FAIL test 8c: slug came out as %', v_slug;
  END IF;
  IF v_facility IS NULL THEN
    RAISE EXCEPTION 'FAIL test 8d: signup did not create a first facility';
  END IF;

  -- Now the part that matters. As the app role, scoped to the brand-new tenant.
  SET LOCAL ROLE poolse_app;
  PERFORM set_config('app.organization_id', v_org::text, true);

  SELECT count(*) INTO n FROM organization;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 8e: the new tenant sees % organizations, not just its own', n;
  END IF;

  SELECT count(*) INTO n FROM facility;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 8f: the new tenant sees % facilities, not just its own', n;
  END IF;

  -- The seeded tenants above have pools; this one has none. Seeing any would
  -- mean signup had punched a hole through to them.
  SELECT count(*) INTO n FROM pool;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8g: the new tenant sees % pools belonging to others', n;
  END IF;

  SELECT count(*) INTO n FROM membership;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 8h: the new tenant sees % memberships, not just its own', n;
  END IF;

  -- And the reverse direction: org A must not have gained a facility.
  PERFORM set_config('app.organization_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
  SELECT count(*) INTO n FROM facility WHERE id = v_facility;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8i: org A can see the new tenant''s facility';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS test 8: a self-provisioned organization is sealed in both directions';
END $$;

ROLLBACK;
