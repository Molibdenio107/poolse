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

-- This fixture states its own plan. A subscription covers one facility by
-- default and `facility_licence` enforces it; nothing below is about billing,
-- so the plan is set out of the way. The limit is asserted in `facilities.sql`.
UPDATE organization SET max_facilities = 20;



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

-- ---------------------------------------------------------------------------
-- Test 11 — the espaços tables, and their three nullable targets
-- ---------------------------------------------------------------------------
--
-- `maintenance_request` is the one worth asserting hardest. It carries three
-- nullable foreign keys so Módulo 2 can reuse it, and a nullable composite key
-- is MATCH SIMPLE: it is *not checked at all* when any of its columns is null.
-- That is the behaviour this feature wants, and it is also exactly the kind of
-- thing that silently stops protecting anything if a later migration makes
-- facility_id nullable. This test is what would notice.

DO $$
DECLARE
  v_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_fac_a uuid := 'a1111111-1111-1111-1111-111111111111';
  v_fac_b uuid := 'b1111111-1111-1111-1111-111111111111';
  v_space_a uuid; v_space_b uuid; v_pool_b uuid;
  v_member_a uuid; v_member_b uuid; v_seen integer; ok boolean;
BEGIN
  INSERT INTO space (organization_id, facility_id, name) VALUES (v_a, v_fac_a, 'Balneário A')
  RETURNING id INTO v_space_a;
  INSERT INTO space (organization_id, facility_id, name) VALUES (v_b, v_fac_b, 'Balneário B')
  RETURNING id INTO v_space_b;

  SELECT id INTO v_pool_b FROM pool WHERE organization_id = v_b LIMIT 1;

  INSERT INTO membership (organization_id, status, first_name, last_name, email)
  VALUES (v_a, 'active', 'Ana', 'A', 'ana.ti@a.pt') RETURNING id INTO v_member_a;
  INSERT INTO membership (organization_id, status, first_name, last_name, email)
  VALUES (v_b, 'active', 'Bruno', 'B', 'bruno.ti@b.pt') RETURNING id INTO v_member_b;

  -- A space at the neighbour's site.
  ok := false;
  BEGIN
    INSERT INTO space (organization_id, facility_id, name) VALUES (v_a, v_fac_b, 'Roubado');
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 11a: org A made a space at org B site'; END IF;

  -- A cleaning of the neighbour's space.
  ok := false;
  BEGIN
    INSERT INTO cleaning_log (organization_id, space_id, performed_by)
    VALUES (v_a, v_space_b, v_member_a);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 11b: org A logged a clean of org B space'; END IF;

  -- A cleaning credited to the neighbour's staff.
  ok := false;
  BEGIN
    INSERT INTO cleaning_log (organization_id, space_id, performed_by)
    VALUES (v_a, v_space_a, v_member_b);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 11c: a clean was credited across tenants'; END IF;

  -- Each nullable target in turn, pointed at the neighbour.
  ok := false;
  BEGIN
    INSERT INTO maintenance_request
      (organization_id, facility_id, space_id, type, description, reported_by)
    VALUES (v_a, v_fac_a, v_space_b, 'fault', 'Porta', v_member_a);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 11d: a request named org B space'; END IF;

  ok := false;
  BEGIN
    INSERT INTO maintenance_request
      (organization_id, facility_id, pool_id, type, description, reported_by)
    VALUES (v_a, v_fac_a, v_pool_b, 'fault', 'Filtro', v_member_a);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 11e: a request named org B pool'; END IF;

  -- A request with no target at all is legitimate — "the front door lock is
  -- broken" belongs to the site — and must still be refused across tenants only
  -- by the facility key.
  INSERT INTO maintenance_request
    (organization_id, facility_id, type, description, reported_by)
  VALUES (v_a, v_fac_a, 'restock', 'Faltam sacos do lixo', v_member_a);

  ok := false;
  BEGIN
    INSERT INTO maintenance_request
      (organization_id, facility_id, type, description, reported_by)
    VALUES (v_a, v_fac_b, 'fault', 'Fechadura', v_member_a);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 11f: a request was filed at org B site'; END IF;

  -- And the policies themselves, from the app role.
  SET LOCAL ROLE poolse_app;
  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO v_seen FROM space;
  IF v_seen <> 1 THEN RAISE EXCEPTION 'FAIL test 11g: org B saw % spaces, not 1', v_seen; END IF;

  SELECT count(*) INTO v_seen FROM maintenance_request;
  IF v_seen <> 0 THEN RAISE EXCEPTION 'FAIL test 11h: org B saw % of org A requests', v_seen; END IF;

  -- Writing into the neighbour is refused by WITH CHECK, not merely hidden.
  ok := false;
  BEGIN
    INSERT INTO space (organization_id, facility_id, name) VALUES (v_a, v_fac_a, 'Contrabando');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 11i: org B wrote a space into org A'; END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS test 11: spaces, cleaning logs and requests are isolated both ways';
END $$;

-- ---------------------------------------------------------------------------
-- Test 12 — the apólice, and the two new references on a fee line
-- ---------------------------------------------------------------------------
--
-- `insurance_policy` is an ordinary tenant table and gets the ordinary proof.
-- The interesting half is `student_fee`, which gained references to a season and
-- to a policy: a line naming the neighbour's season would put one club's student
-- inside another club's year, and one naming the neighbour's apólice would leave
-- a swimmer covered by insurance their club never bought. Neither is something
-- RLS catches — both rows pass their own policy — so both are composite keys,
-- and this is what says so.

DO $$
DECLARE
  v_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_fac_a uuid := 'a1111111-1111-1111-1111-111111111111';
  v_fac_b uuid := 'b1111111-1111-1111-1111-111111111111';
  v_pol_a uuid; v_pol_b uuid;
  v_season_a uuid; v_season_b uuid;
  v_plan_a uuid; v_student_a uuid; v_period_a uuid;
  v_seen integer; ok boolean;
BEGIN
  INSERT INTO insurance_policy
    (organization_id, facility_id, insurer, policy_number, valid_from, valid_to,
     cost_per_person_cents)
  VALUES (v_a, v_fac_a, 'Fidelidade', 'AP-1', DATE '2026-09-01', DATE '2027-08-31', 850)
  RETURNING id INTO v_pol_a;

  INSERT INTO insurance_policy
    (organization_id, facility_id, insurer, policy_number, valid_from, valid_to,
     cost_per_person_cents)
  VALUES (v_b, v_fac_b, 'Tranquilidade', 'AP-1', DATE '2026-09-01', DATE '2027-08-31', 900)
  RETURNING id INTO v_pol_b;

  -- The same policy number at two clubs is ordinary: the index is per facility.
  IF v_pol_a IS NULL OR v_pol_b IS NULL THEN
    RAISE EXCEPTION 'FAIL test 12a: two clubs could not both hold policy AP-1';
  END IF;

  -- A policy filed at the neighbour's site.
  ok := false;
  BEGIN
    INSERT INTO insurance_policy
      (organization_id, facility_id, insurer, policy_number, valid_from, valid_to,
       cost_per_person_cents)
    VALUES (v_a, v_fac_b, 'Fidelidade', 'AP-2', DATE '2026-09-01', DATE '2027-08-31', 850);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 12b: org A insured org B site'; END IF;

  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_a, '2026/2027 A', DATE '2026-09-01', DATE '2027-07-31', 'draft')
  RETURNING id INTO v_season_a;
  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_b, '2026/2027 B', DATE '2026-09-01', DATE '2027-07-31', 'draft')
  RETURNING id INTO v_season_b;

  INSERT INTO fee_period (organization_id, facility_id, name, months)
  VALUES (v_a, v_fac_a, 'Anual', 12) RETURNING id INTO v_period_a;

  INSERT INTO fee_plan
    (organization_id, facility_id, kind, amount_cents, season_id, recurrence, vat_exempt)
  VALUES (v_a, v_fac_a, 'seguro', 1200, v_season_a, 'annual', true)
  RETURNING id INTO v_plan_a;

  -- A seguro price for the neighbour's season.
  ok := false;
  BEGIN
    INSERT INTO fee_plan
      (organization_id, facility_id, kind, amount_cents, season_id, recurrence, vat_exempt)
    VALUES (v_a, v_fac_a, 'seguro', 1200, v_season_b, 'annual', true);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 12c: org A priced org B season'; END IF;

  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_a, 'Ana', 'Costa') RETURNING id INTO v_student_a;

  -- A cover line naming the neighbour's apólice: the swimmer would be insured by
  -- a policy their club never bought, and nothing else would ever say so.
  ok := false;
  BEGIN
    INSERT INTO student_fee
      (organization_id, student_id, fee_plan_id, fee_period_id, kind, season_id,
       insurance_policy_id, covers_from, covers_to, amount_cents)
    VALUES (v_a, v_student_a, v_plan_a, v_period_a, 'seguro', v_season_a,
            v_pol_b, DATE '2026-09-01', DATE '2027-08-31', 1200);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 12d: a student was covered by org B policy'; END IF;

  -- The club's own policy is accepted, so the refusal above is the key doing its
  -- job rather than the insert being wrong in some other way.
  INSERT INTO student_fee
    (organization_id, student_id, fee_plan_id, fee_period_id, kind, season_id,
     insurance_policy_id, covers_from, covers_to, amount_cents)
  VALUES (v_a, v_student_a, v_plan_a, v_period_a, 'seguro', v_season_a,
          v_pol_a, DATE '2026-09-01', DATE '2027-08-31', 1200);

  -- And the same student cannot be insured twice for one season.
  ok := false;
  BEGIN
    INSERT INTO student_fee
      (organization_id, student_id, fee_plan_id, fee_period_id, kind, season_id,
       insurance_policy_id, covers_from, covers_to, amount_cents)
    VALUES (v_a, v_student_a, v_plan_a, v_period_a, 'seguro', v_season_a,
            v_pol_a, DATE '2026-09-01', DATE '2027-08-31', 1200);
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 12e: one student, two seguros, one season'; END IF;

  -- And the policies themselves, from the app role.
  SET LOCAL ROLE poolse_app;
  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO v_seen FROM insurance_policy;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'FAIL test 12f: org B saw % policies, not 1', v_seen;
  END IF;

  ok := false;
  BEGIN
    INSERT INTO insurance_policy
      (organization_id, facility_id, insurer, policy_number, valid_from, valid_to,
       cost_per_person_cents)
    VALUES (v_a, v_fac_a, 'Contrabando', 'AP-9', DATE '2026-09-01', DATE '2027-08-31', 1);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 12g: org B wrote a policy into org A'; END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS test 12: apólices and cover lines are isolated both ways';
END $$;

ROLLBACK;
