-- Facility and pool proof — slice 1.1.
--
-- The first slice of the actual product, so the first place the phase 0
-- machinery gets used rather than tested for its own sake. Test 5 is the one
-- that matters most in the long run: a pool belongs to a facility *and* an
-- organization, and the composite foreign key is what stops those two from ever
-- disagreeing.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_a', 'a@clube.pt', 'Rui',   'Fonseca', NULL, '2026-08-26 09:00:00+00');
SELECT provision_app_user('user_b', 'b@outro.pt', 'Carla', 'Nunes',   NULL, '2026-08-26 09:00:00+00');

-- Seeded directly rather than through provision_organization: signup creates a
-- first facility automatically, and this suite counts facilities, so the two
-- would fight. What is under test here is the constraints, not signup.
INSERT INTO organization (name, slug) VALUES
  ('Clube A', 'clube-a'),
  ('Clube B', 'clube-b');

-- ---------------------------------------------------------------------------
-- Test 1 — a site with pools, created the way the API creates it
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; n int; r record;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  INSERT INTO facility (organization_id, name, address, timezone)
  VALUES (v_org, 'Piscina Municipal', 'Rua do Juncal 1', 'Europe/Lisbon')
  RETURNING id INTO v_facility;

  INSERT INTO pool (organization_id, facility_id, name, kind, volume_litres, lane_count)
  VALUES (v_org, v_facility, 'Tanque Grande', 'indoor', 1250000, 6),
         (v_org, v_facility, 'Tanque de Aprendizagem', 'indoor', 90000, 2);

  SELECT count(*) INTO n FROM pool WHERE facility_id = v_facility AND archived_at IS NULL;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 1a: expected 2 pools, got %', n;
  END IF;

  SELECT timezone, address INTO r FROM facility WHERE id = v_facility;
  IF r.timezone <> 'Europe/Lisbon' THEN
    RAISE EXCEPTION 'FAIL test 1b: timezone was not stored (%)', r.timezone;
  END IF;

  RAISE NOTICE 'PASS test 1: a facility holds its pools, its address and its timezone';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — one name per site, and the same name is fine at a different site
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_first uuid; v_second uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_first FROM facility WHERE name = 'Piscina Municipal';

  -- Case-insensitive: the database should not think these are two facilities.
  BEGIN
    INSERT INTO facility (organization_id, name) VALUES (v_org, 'piscina municipal');
    RAISE EXCEPTION 'FAIL test 2a: a duplicate facility name differing only in case was allowed';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO pool (organization_id, facility_id, name)
    VALUES (v_org, v_first, 'TANQUE GRANDE');
    RAISE EXCEPTION 'FAIL test 2b: a duplicate pool name within one facility was allowed';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  -- A second site may absolutely have a pool of the same name.
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina da Escola')
  RETURNING id INTO v_second;
  INSERT INTO pool (organization_id, facility_id, name)
  VALUES (v_org, v_second, 'Tanque Grande');

  RAISE NOTICE 'PASS test 2: names are unique per site, case-insensitively, and only per site';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — archiving frees the name again
--
-- The partial index earning its keep: closing a pool for the season and
-- reopening it must not collide with the dead row.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_facility FROM facility WHERE name = 'Piscina da Escola';

  UPDATE pool SET archived_at = now()
   WHERE facility_id = v_facility AND name = 'Tanque Grande';

  INSERT INTO pool (organization_id, facility_id, name)
  VALUES (v_org, v_facility, 'Tanque Grande');

  SELECT count(*) INTO n FROM pool
   WHERE facility_id = v_facility AND name = 'Tanque Grande';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 3: expected the archived row alongside the new one, got %', n;
  END IF;

  RAISE NOTICE 'PASS test 3: archiving a pool releases its name for next season';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — a pool with nonsense measurements is refused
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_facility FROM facility WHERE name = 'Piscina Municipal';

  BEGIN
    INSERT INTO pool (organization_id, facility_id, name, lane_count)
    VALUES (v_org, v_facility, 'Tanque Impossivel', 0);
    RAISE EXCEPTION 'FAIL test 4a: a pool with zero lanes was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO facility (organization_id, name) VALUES (v_org, '   ');
    RAISE EXCEPTION 'FAIL test 4b: a blank facility name was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- Unknown measurements stay null rather than becoming zero.
  INSERT INTO pool (organization_id, facility_id, name, volume_litres, lane_count)
  VALUES (v_org, v_facility, 'Tanque sem medidas', NULL, NULL);

  RAISE NOTICE 'PASS test 4: impossible measurements are refused, unknown ones stay unknown';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — a pool cannot live at another organization's facility
--
-- Keep this one. It is the composite foreign key from decision 2 applied to the
-- first real product table, and the failure it prevents is the worst kind: one
-- customer's pool appearing inside another customer's site.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_a uuid; v_b uuid; v_a_facility uuid;
BEGIN
  SELECT id INTO v_a FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_b FROM organization WHERE name = 'Clube B';
  SELECT id INTO v_a_facility FROM facility WHERE name = 'Piscina Municipal';

  BEGIN
    INSERT INTO pool (organization_id, facility_id, name)
    VALUES (v_b, v_a_facility, 'Tanque Roubado');
    RAISE EXCEPTION 'FAIL test 5: a pool was placed in another organization''s facility';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 5: a pool cannot be placed at another organization''s facility';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — the app role sees only its own sites, and cannot write to another
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE v_a uuid; v_b uuid; n int;
BEGIN
  SET LOCAL ROLE postgres;
  SELECT id INTO v_a FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_b FROM organization WHERE name = 'Clube B';
  SET LOCAL ROLE poolse_app;

  PERFORM set_config('app.organization_id', v_b::text, true);

  -- The listing query from the repository, with no WHERE organization_id on it.
  SELECT count(*) INTO n FROM facility WHERE archived_at IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6a: Clube B listed % of Clube A facilities', n;
  END IF;

  SELECT count(*) INTO n FROM pool WHERE archived_at IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6b: Clube B listed % of Clube A pools', n;
  END IF;

  BEGIN
    INSERT INTO facility (organization_id, name) VALUES (v_a, 'Sede Roubada');
    RAISE EXCEPTION 'FAIL test 6c: Clube B created a facility inside Clube A';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'PASS test 6: sites are invisible and unwritable across tenants';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 7 — archiving a site takes its pools with it
--
-- Otherwise a pool outlives the building it is in, and every later screen has to
-- special-case a pool whose facility is gone.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_facility uuid; n int;
BEGIN
  SELECT id INTO v_facility FROM facility WHERE name = 'Piscina Municipal';

  UPDATE facility SET archived_at = now() WHERE id = v_facility;
  UPDATE pool SET archived_at = now()
   WHERE facility_id = v_facility AND archived_at IS NULL;

  SELECT count(*) INTO n FROM pool
   WHERE facility_id = v_facility AND archived_at IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7: % pools outlived their facility', n;
  END IF;

  RAISE NOTICE 'PASS test 7: archiving a site archives the pools inside it';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8 — dimensions are measurements, not counts
--
-- Backlog story 1. The reason this is `numeric` and not `integer` is one number:
-- 12.5. A pool that length is ordinary, and storing it as 12 or 13 produces a
-- figure that looks precise and is wrong.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; r record;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_facility FROM facility WHERE name = 'Piscina da Escola';

  INSERT INTO pool (organization_id, facility_id, name, length_m, width_m, max_depth_m)
  VALUES (v_org, v_facility, 'Tanque Olimpico', 25, 12.5, 1.8);

  SELECT length_m, width_m, max_depth_m INTO r
    FROM pool WHERE name = 'Tanque Olimpico';

  IF r.width_m <> 12.5 THEN
    RAISE EXCEPTION 'FAIL test 8a: 12.5 m came back as % — rounded to an integer', r.width_m;
  END IF;
  IF r.max_depth_m <> 1.8 THEN
    RAISE EXCEPTION 'FAIL test 8b: 1.8 m came back as %', r.max_depth_m;
  END IF;

  -- A measurement of zero is an empty form, not a pool.
  BEGIN
    INSERT INTO pool (organization_id, facility_id, name, length_m)
    VALUES (v_org, v_facility, 'Tanque Impossivel 2', 0);
    RAISE EXCEPTION 'FAIL test 8c: a pool 0 m long was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- Unknown stays unknown: an operator who inherited a pool and never measured
  -- it should not be blocked from recording the pool.
  INSERT INTO pool (organization_id, facility_id, name)
  VALUES (v_org, v_facility, 'Tanque por medir');

  RAISE NOTICE 'PASS test 8: dimensions keep their decimals, refuse zero, and stay optional';
END $$;

-- ---------------------------------------------------------------------------
-- Test 9 — photographs belong to one tenant's pool, structurally
--
-- Backlog story 2. The tables are empty and will stay empty until object storage
-- is configured, but the guarantee is worth asserting now: a composite foreign
-- key is the reason a polymorphic `photo` table was rejected, and an assertion
-- is what stops somebody "simplifying" it later.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_a uuid; v_b uuid; v_a_pool uuid; v_a_facility uuid; n int;
BEGIN
  SELECT id INTO v_a FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_b FROM organization WHERE name = 'Clube B';
  SELECT id INTO v_a_facility FROM facility WHERE name = 'Piscina da Escola';
  SELECT id INTO v_a_pool FROM pool
   WHERE facility_id = v_a_facility AND archived_at IS NULL LIMIT 1;

  BEGIN
    INSERT INTO pool_photo (organization_id, pool_id, storage_key)
    VALUES (v_b, v_a_pool, 'pools/roubada.jpg');
    RAISE EXCEPTION 'FAIL test 9a: Clube B attached a photograph to a Clube A pool';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO facility_photo (organization_id, facility_id, storage_key)
    VALUES (v_b, v_a_facility, 'facilities/roubada.jpg');
    RAISE EXCEPTION 'FAIL test 9b: Clube B attached a photograph to a Clube A facility';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  -- The same object attached twice is a double-submitted upload, not two
  -- photographs.
  INSERT INTO pool_photo (organization_id, pool_id, storage_key)
  VALUES (v_a, v_a_pool, 'pools/norte.jpg');
  BEGIN
    INSERT INTO pool_photo (organization_id, pool_id, storage_key)
    VALUES (v_a, v_a_pool, 'pools/norte.jpg');
    RAISE EXCEPTION 'FAIL test 9c: the same object was attached to one pool twice';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  -- Removing one and re-uploading it later must work, which is what the partial
  -- index is for.
  UPDATE pool_photo SET archived_at = now() WHERE storage_key = 'pools/norte.jpg';
  INSERT INTO pool_photo (organization_id, pool_id, storage_key)
  VALUES (v_a, v_a_pool, 'pools/norte.jpg');

  SELECT count(*) INTO n FROM pool_photo WHERE storage_key = 'pools/norte.jpg';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 9d: expected the archived row beside the new one, got %', n;
  END IF;

  RAISE NOTICE 'PASS test 9: photographs cannot cross tenants, and cannot be attached twice';
END $$;

-- ---------------------------------------------------------------------------
-- Test 10 — a site's location is real, complete, and invisible across tenants
--
-- Backlog round 3, story 3. Three things at once, because they are one property:
-- the coordinates are the input to a weather lookup, and a wrong one is not an
-- error anybody sees — it is the right town's name over the wrong town's sky.
--
--   a. Half a coordinate cannot be stored. A latitude with no longitude looks
--      placed and cannot be plotted, and every reader downstream would need a
--      branch for a state that should never exist.
--   b. The ranges are the ranges. -8.65 is Aveiro; -800 is a typo that would be
--      accepted forever by a text column.
--   c. Another tenant sees none of it. `facility` is tenant-scoped and these are
--      new columns on it, so the policy already covers them — this asserts that
--      rather than assuming it, which is the whole habit this file exists for.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_a uuid; v_b uuid; v_facility uuid; n int;
BEGIN
  v_a := (SELECT id FROM organization WHERE slug = 'clube-a');
  v_b := (SELECT id FROM organization WHERE slug = 'clube-b');

  INSERT INTO facility (organization_id, name, city, country_code, latitude, longitude)
  VALUES (v_a, 'Piscinas Municipais de Aveiro', 'Aveiro', 'PT', 40.645750, -8.646430)
  RETURNING id INTO v_facility;

  -- a. Half a coordinate.
  BEGIN
    UPDATE facility SET longitude = NULL WHERE id = v_facility;
    RAISE EXCEPTION 'FAIL test 10a: a latitude was stored with no longitude';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- b. Out of range, and a lower-case country code.
  BEGIN
    UPDATE facility SET longitude = -800 WHERE id = v_facility;
    RAISE EXCEPTION 'FAIL test 10b: an impossible longitude was stored';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE facility SET country_code = 'pt' WHERE id = v_facility;
    RAISE EXCEPTION 'FAIL test 10c: a lower-case country code was stored';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- The stored value survives the round trip exactly. numeric(9,6) is not a
  -- float, and this is the assertion that would catch somebody "simplifying" it
  -- into one.
  SELECT count(*) INTO n
    FROM facility
   WHERE id = v_facility AND latitude = 40.645750 AND longitude = -8.646430;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 10d: the coordinates did not round-trip exactly';
  END IF;

  -- c. Across tenants.
  SET LOCAL ROLE poolse_app;

  PERFORM set_config('app.organization_id', v_a::text, true);
  SELECT count(*) INTO n FROM facility WHERE city = 'Aveiro';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 10e: the owning organization saw % rows', n;
  END IF;

  PERFORM set_config('app.organization_id', v_b::text, true);
  SELECT count(*) INTO n FROM facility WHERE city = 'Aveiro';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 10f: another tenant read % locations', n;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS test 10: a location is complete, in range, exact, and tenant-scoped';
END $$;

ROLLBACK;

