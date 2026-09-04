-- A lane is a row — POOLSE-43.
--
-- Three things here are worth asserting rather than reading.
--
-- **Every pool has at least one lane**, and the schema is what says so. The
-- whole model rests on there being no "no lane" case, and an invariant that
-- holds only where the application remembers it is not an invariant.
--
-- **The exclusion constraint still holds after moving to `lane_id`.** It is the
-- one thing standing between two groups and the same lane, and recreating it
-- against a uuid is where a typo silently produces a constraint that matches
-- nothing — which fails open, so nothing would ever notice.
--
-- **A lane cannot be borrowed from another organization's pool**, which is the
-- composite key doing its job one level down.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_l', 'l@clube.pt', 'Rui', 'Fonseca', NULL, '2026-09-01 09:00:00+00');

-- Fixed ids: test 7 runs under RLS as `poolse_app`, where a lookup by name
-- returns nothing and would leave a null id passing for the wrong reason.
INSERT INTO organization (id, name, slug) VALUES
  ('55555555-5555-5555-5555-555555555555', 'Clube Pistas', 'clube-pistas'),
  ('66666666-6666-6666-6666-666666666666', 'Clube Vizinho L', 'clube-vizinho-l');

-- This fixture states its own plan. A subscription covers one facility by
-- default and `facility_licence` enforces it; nothing below is about billing,
-- so the plan is set out of the way. The limit is asserted in `facilities.sql`.
UPDATE organization SET max_facilities = 20;



DO $$
DECLARE v_org uuid; v_facility uuid; v_pool uuid;
BEGIN
  v_org := '55555555-5555-5555-5555-555555555555';

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Municipal')
  RETURNING id INTO v_facility;

  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_org, v_facility, 'Tanque Grande', 'indoor')
  RETURNING id INTO v_pool;

  -- Six lanes, as a club with a competition tank would set up. Position 1 is
  -- already there from the trigger, so it is renamed rather than inserted.
  UPDATE lane SET name = 'Pista 1' WHERE pool_id = v_pool AND position = 1;

  INSERT INTO lane (organization_id, pool_id, name, position)
  SELECT v_org, v_pool, 'Pista ' || n, n FROM generate_series(2, 6) AS n;

  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_org, v_facility, 'Tanque de Aprendizagem', 'indoor');
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — a pool arrives with a lane, whether or not anybody wanted lanes
--
-- The invariant the whole model rests on. A pool created by a seed, a test or an
-- endpoint written next year must not be able to exist with no lanes, or every
-- grid cell for it is the null case this design removes.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_learner uuid; n int; v_name text;
BEGIN
  v_org := '55555555-5555-5555-5555-555555555555';
  SELECT id INTO v_learner FROM pool
   WHERE organization_id = v_org AND name = 'Tanque de Aprendizagem';

  SELECT count(*) INTO n FROM lane WHERE pool_id = v_learner AND archived_at IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 1a: a laneless pool should have exactly one lane, got %', n;
  END IF;

  -- Named after the pool, so the grid's row label reads as the tank it is.
  SELECT name INTO v_name FROM lane WHERE pool_id = v_learner;
  IF v_name <> 'Tanque de Aprendizagem' THEN
    RAISE EXCEPTION 'FAIL test 1b: the implicit lane was named "%"', v_name;
  END IF;

  RAISE NOTICE 'PASS test 1: every pool has at least one lane, named after itself';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — one name and one position per pool, ignoring case and accents
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_pool uuid;
BEGIN
  v_org := '55555555-5555-5555-5555-555555555555';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org AND name = 'Tanque Grande';

  BEGIN
    INSERT INTO lane (organization_id, pool_id, name, position)
    VALUES (v_org, v_pool, 'pista 3', 7);
    RAISE EXCEPTION 'FAIL test 2a: the same lane name was accepted in a different case';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO lane (organization_id, pool_id, name, position)
    VALUES (v_org, v_pool, 'Pista Nova', 3);
    RAISE EXCEPTION 'FAIL test 2b: two lanes were accepted at position 3';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- A zeroth lane is not a lane.
  BEGIN
    INSERT INTO lane (organization_id, pool_id, name, position)
    VALUES (v_org, v_pool, 'Pista Zero', 0);
    RAISE EXCEPTION 'FAIL test 2c: position 0 was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 2: one name and one position per pool';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — the same lane name in another pool is another lane
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_learner uuid; n int;
BEGIN
  v_org := '55555555-5555-5555-5555-555555555555';
  SELECT id INTO v_learner FROM pool
   WHERE organization_id = v_org AND name = 'Tanque de Aprendizagem';

  INSERT INTO lane (organization_id, pool_id, name, position)
  VALUES (v_org, v_learner, 'Pista 1', 2);

  SELECT count(*) INTO n FROM lane
   WHERE organization_id = v_org AND lower(name) = 'pista 1';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 3: two pools should each hold a Pista 1, got % rows', n;
  END IF;

  RAISE NOTICE 'PASS test 3: a lane name belongs to its pool, not to the club';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — archiving a lane frees its name and its position
--
-- The trap CLAUDE.md names: without the partial indexes, archiving Pista 6 and
-- adding it back next season violates the constraint against a dead row.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_pool uuid; n int;
BEGIN
  v_org := '55555555-5555-5555-5555-555555555555';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org AND name = 'Tanque Grande';

  UPDATE lane SET archived_at = now() WHERE pool_id = v_pool AND position = 6;

  INSERT INTO lane (organization_id, pool_id, name, position)
  VALUES (v_org, v_pool, 'Pista 6', 6);

  -- The old row is still there — history is soft-deleted, never destroyed.
  SELECT count(*) INTO n FROM lane WHERE pool_id = v_pool AND position = 6;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 4: expected the archived lane and the new one, got %', n;
  END IF;

  RAISE NOTICE 'PASS test 4: an archived lane does not hold its name or position hostage';
END $$;

-- ---------------------------------------------------------------------------
-- Tests 5 and 6 moved to bookings.sql — POOLSE-46
--
-- A session holds its lanes in `class_session_lane` now, because a booking may
-- span several, and `class_session_lane_free` moved onto that table with them.
-- Asserting the same guarantee from two files would mean two places to update
-- the next time it moves, so it is asserted once, where it lives:
-- `bookings.sql` tests 3 to 5.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Test 7 — a lane belongs to its tenant, and cannot be borrowed
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_a uuid := '55555555-5555-5555-5555-555555555555';
  v_b uuid := '66666666-6666-6666-6666-666666666666';
  v_facility_b uuid; v_pool_b uuid; v_lane_a uuid; v_season_b uuid;
BEGIN
  SELECT l.id INTO v_lane_a FROM lane l WHERE l.organization_id = v_a LIMIT 1;

  INSERT INTO facility (organization_id, name) VALUES (v_b, 'Piscina Vizinha')
  RETURNING id INTO v_facility_b;
  INSERT INTO pool (organization_id, facility_id, name) VALUES (v_b, v_facility_b, 'Tanque B')
  RETURNING id INTO v_pool_b;
  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_b, '2026/2027', '2026-09-01', '2027-08-31') RETURNING id INTO v_season_b;

  -- The composite key: B's turma cannot claim A's lane.
  BEGIN
    INSERT INTO class_group (organization_id, season_id, name, pool_id, lane_id)
    VALUES (v_b, v_season_b, 'Turma Roubada', v_pool_b, v_lane_a);
    RAISE EXCEPTION 'FAIL test 7a: a turma took a lane from another organization';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- And a lane cannot be created in another organization's pool.
  BEGIN
    INSERT INTO lane (organization_id, pool_id, name, position)
    VALUES (v_b, (SELECT id FROM pool WHERE organization_id = v_a LIMIT 1), 'Pista Roubada', 9);
    RAISE EXCEPTION 'FAIL test 7b: a lane was added to another organization''s pool';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 7: a lane cannot be borrowed across the tenant boundary';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8 — lanes are visible only to their own tenant
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_a uuid := '55555555-5555-5555-5555-555555555555';
  v_b uuid := '66666666-6666-6666-6666-666666666666';
  n int;
BEGIN
  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM lane WHERE organization_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8a: the neighbouring club could read % of our lanes', n;
  END IF;

  PERFORM set_config('app.organization_id', v_a::text, true);

  SELECT count(*) INTO n FROM lane WHERE organization_id = v_a AND archived_at IS NULL;
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL test 8b: our own lanes were not visible to us';
  END IF;

  RAISE NOTICE 'PASS test 8: lanes are visible only to their own tenant';
END $$;

RESET ROLE;

ROLLBACK;
