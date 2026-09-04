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

-- ---------------------------------------------------------------------------
-- Test 9 — the ocupação feature's tables are sealed, all eight of them
--
-- POOLSE-55, criterion 8, and the migration skill's standing rule: a new
-- tenant-scoped table with a policy nobody tests is a policy that may not work.
-- POOLSE-43 to 51 added eight, and the ones worth worrying about are not the
-- obvious ones — `booking_lane` carries no `facility_id` and reaches its tenant
-- only through a parent, which is exactly the shape that gets a policy wrong.
--
-- Both directions, and both mechanisms: RLS for what a tenant can *see*, and the
-- composite foreign key for what it can *reference*. RLS does not catch the
-- second — a row pointing at another tenant's row passes both policies.
-- ---------------------------------------------------------------------------

RESET ROLE;

DO $$
DECLARE
  v_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_pool_b uuid; v_lane_b uuid;
  v_season_a uuid; v_season_b uuid;
  v_partner_b uuid;
BEGIN
  SELECT id INTO v_pool_b FROM pool WHERE organization_id = v_b AND name = 'Piscina B1';

  -- Every pool arrives with one lane, so B already has one.
  SELECT id INTO v_lane_b FROM lane WHERE pool_id = v_pool_b;

  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_a, '2026/2027', '2026-09-01', '2027-08-31', 'published') RETURNING id INTO v_season_a;
  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_b, '2026/2027', '2026-09-01', '2027-08-31', 'published') RETURNING id INTO v_season_b;

  INSERT INTO facility_time_slot
    (organization_id, facility_id, season_id, day_group, start_time, end_time)
  VALUES (v_b, 'b1111111-1111-1111-1111-111111111111', v_season_b, 'weekday', '09:30', '10:15');

  INSERT INTO partner (organization_id, facility_id, name, type)
  VALUES (v_b, 'b1111111-1111-1111-1111-111111111111', 'ES do Vizinho', 'escola')
  RETURNING id INTO v_partner_b;

  INSERT INTO partner_contact (organization_id, partner_id, name, email)
  VALUES (v_b, v_partner_b, 'Ana Marques', 'ana@vizinho.pt');

  INSERT INTO partner_agreement
    (organization_id, partner_id, start_date, billing_model, unit_price)
  VALUES (v_b, v_partner_b, '2026-09-01', 'por_hora_pista', 14.375000);

  INSERT INTO partner_group (organization_id, partner_id, name, participant_count)
  VALUES (v_b, v_partner_b, '6A', 24);

  INSERT INTO booking_category (organization_id, facility_id, name, colour)
  VALUES (v_b, 'b1111111-1111-1111-1111-111111111111', 'Desporto escolar', 'green');
END $$;

-- What org A can see of it: nothing.
SET ROLE poolse_app;
SELECT set_config('app.organization_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

DO $$
DECLARE
  n integer;
  v_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
BEGIN
  -- Deliberately unscoped, every one of them. This is the query somebody writes
  -- tired, and the database has to be the thing that refuses it.
  SELECT count(*) INTO n FROM lane WHERE organization_id = v_b;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 9a: org A sees % of org B lanes', n; END IF;

  SELECT count(*) INTO n FROM facility_time_slot WHERE organization_id = v_b;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 9b: org A sees % of org B slots', n; END IF;

  SELECT count(*) INTO n FROM partner WHERE organization_id = v_b;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 9c: org A sees % of org B partners', n; END IF;

  SELECT count(*) INTO n FROM partner_contact WHERE organization_id = v_b;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 9d: org A sees % of org B contacts', n; END IF;

  -- The one carrying a price. A competitor reading another club's lane-hour rate
  -- is the worst single row in this feature.
  SELECT count(*) INTO n FROM partner_agreement WHERE organization_id = v_b;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 9e: org A sees % of org B agreements', n; END IF;

  SELECT count(*) INTO n FROM partner_group WHERE organization_id = v_b;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 9f: org A sees % of org B groups', n; END IF;

  SELECT count(*) INTO n FROM booking_category WHERE organization_id = v_b;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 9g: org A sees % of org B categories', n; END IF;

  RAISE NOTICE 'PASS test 9: none of the feature tables leak across the boundary';
END $$;

-- ---------------------------------------------------------------------------
-- Test 10 — and none of them can be *referenced* across it either
--
-- The half RLS does not cover. Every one of these rows would pass its own
-- policy; only the composite key stops org A hanging its booking on org B's
-- lane, its slot on org B's season, or its booking on org B's partner group.
-- ---------------------------------------------------------------------------

RESET ROLE;

DO $$
DECLARE
  v_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_pool_a uuid; v_lane_b uuid; v_season_b uuid; v_group_b uuid; v_slot_b uuid;
  v_group_a uuid; v_schedule_a uuid;
  ok boolean;
BEGIN
  SELECT id INTO v_pool_a FROM pool WHERE organization_id = v_a AND name = 'Piscina A1';
  SELECT l.id INTO v_lane_b FROM lane l JOIN pool p ON p.id = l.pool_id
   WHERE p.organization_id = v_b LIMIT 1;
  SELECT id INTO v_season_b FROM season WHERE organization_id = v_b LIMIT 1;
  SELECT id INTO v_group_b FROM partner_group WHERE organization_id = v_b LIMIT 1;
  SELECT id INTO v_slot_b FROM facility_time_slot WHERE organization_id = v_b LIMIT 1;

  -- A lane in another tenant's pool.
  ok := false;
  BEGIN
    INSERT INTO lane (organization_id, pool_id, name, position)
    SELECT v_a, p.id, 'Pista roubada', 9 FROM pool p WHERE p.organization_id = v_b LIMIT 1;
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 10a: org A put a lane in org B pool'; END IF;

  -- A slot in another tenant's season.
  ok := false;
  BEGIN
    INSERT INTO facility_time_slot
      (organization_id, facility_id, season_id, day_group, start_time, end_time)
    VALUES (v_a, 'a1111111-1111-1111-1111-111111111111', v_season_b, 'weekday', '08:00', '08:45');
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 10b: org A hung a slot on org B season'; END IF;

  -- A booking on another tenant's partner group — the one POOLSE-47 added the
  -- composite key for, and the one that would put a school in the wrong club.
  ok := false;
  BEGIN
    INSERT INTO class_schedule
      (organization_id, facility_id, subject_type, partner_group_id, season_id,
       weekday, start_time, duration_minutes)
    SELECT v_a, 'a1111111-1111-1111-1111-111111111111', 'parceria', v_group_b,
           s.id, 2, '09:30', 45
      FROM season s WHERE s.organization_id = v_a LIMIT 1;
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 10c: org A booked org B partner group'; END IF;

  -- And a booking of org A's own, put on org B's lane. `booking_lane` reaches
  -- its tenant only through the schedule, which is what makes it worth asserting.
  INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id)
  SELECT v_a, s.id, 'a1111111-1111-1111-1111-111111111111', 'Absolutos A', v_pool_a
    FROM season s WHERE s.organization_id = v_a LIMIT 1
  RETURNING id INTO v_group_a;

  INSERT INTO class_schedule
    (organization_id, facility_id, subject_type, class_group_id, weekday, start_time,
     duration_minutes)
  VALUES (v_a, 'a1111111-1111-1111-1111-111111111111', 'turma', v_group_a, 2, '19:15', 45)
  RETURNING id INTO v_schedule_a;

  ok := false;
  BEGIN
    INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
    VALUES (v_a, v_schedule_a, v_lane_b);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 10d: org A booked a lane in org B pool'; END IF;

  -- A slot from the neighbour's grid, on our own booking.
  ok := false;
  BEGIN
    UPDATE class_schedule SET slot_id = v_slot_b WHERE id = v_schedule_a;
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 10e: org A used org B time slot'; END IF;

  RAISE NOTICE 'PASS test 10: the composite keys hold across every table in the feature';
END $$;

ROLLBACK;
