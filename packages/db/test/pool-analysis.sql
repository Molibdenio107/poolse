-- Water quality — round 4.
--
-- Three things here are worth asserting rather than trusting.
--
-- The unit travels with the value. A pH of 7.2 and a temperature of 7.2 are not
-- the same measurement, and a schema that lets a row exist without saying which
-- it is produces a chart whose axis is a guess. The column is NOT NULL and this
-- proves it.
--
-- An analysis belongs to a pool by composite key. Attaching org A's analysis to
-- org B's pool must be impossible in the schema, not merely unusual in the
-- repository — RLS will not catch it, because both rows pass their own policies.
--
-- And the values die with their analysis. `pool_analysis_value` has no
-- `archived_at` on purpose: a half-archived analysis, with three of its five
-- measurements visible, is a worse record than no record. The cascade is what
-- makes that safe.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_w', 'w@clube.pt', 'Rui', 'Fonseca', NULL, '2026-08-29 09:00:00+00');

-- Fixed ids: the RLS test runs as `poolse_app`, where a lookup by name returns
-- nothing and a null id would let an assertion pass for the wrong reason.
INSERT INTO organization (id, name, slug) VALUES
  ('55555555-5555-5555-5555-555555555555', 'Clube Água', 'clube-agua'),
  ('66666666-6666-6666-6666-666666666666', 'Clube Vizinho A', 'clube-vizinho-a');

DO $$
DECLARE v_org uuid; v_other uuid; v_facility uuid; v_f2 uuid;
BEGIN
  v_org   := '55555555-5555-5555-5555-555555555555';
  v_other := '66666666-6666-6666-6666-666666666666';

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Municipal')
  RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_org, v_facility, 'Tanque Grande', 'indoor');

  INSERT INTO facility (organization_id, name) VALUES (v_other, 'Piscina do Vizinho')
  RETURNING id INTO v_f2;
  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_other, v_f2, 'Tanque Vizinho', 'indoor');
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — an analysis is a moment, and each value carries its own unit
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_pool uuid; v_analysis uuid; n int; v numeric; u text;
BEGIN
  v_org := '55555555-5555-5555-5555-555555555555';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org AND name = 'Tanque Grande';

  INSERT INTO pool_analysis (organization_id, pool_id, taken_at, notes)
  VALUES (v_org, v_pool, TIMESTAMPTZ '2026-08-01 09:00:00+00', 'Colhida antes da lavagem')
  RETURNING id INTO v_analysis;

  INSERT INTO pool_analysis_value (organization_id, analysis_id, metric, value, unit) VALUES
    (v_org, v_analysis, 'ph',            7.240, 'pH'),
    (v_org, v_analysis, 'temperature',  27.500, '°C'),
    (v_org, v_analysis, 'free_chlorine', 0.625, 'ppm');

  SELECT count(*) INTO n FROM pool_analysis_value WHERE analysis_id = v_analysis;
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL test 1a: expected 3 measurements, got %', n;
  END IF;

  -- Three decimals, kept. This is the whole reason the column is numeric(10,3)
  -- and not an integer of some assumed unit.
  SELECT value, unit INTO v, u
    FROM pool_analysis_value WHERE analysis_id = v_analysis AND metric = 'free_chlorine';
  IF v <> 0.625 THEN
    RAISE EXCEPTION 'FAIL test 1b: 0.625 ppm came back as %', v;
  END IF;
  IF u <> 'ppm' THEN
    RAISE EXCEPTION 'FAIL test 1c: the unit did not travel with the value (%)', u;
  END IF;

  -- A measurement with no unit is a number nobody can read.
  BEGIN
    INSERT INTO pool_analysis_value (organization_id, analysis_id, metric, value, unit)
    VALUES (v_org, v_analysis, 'turbidity', 0.4, '   ');
    RAISE EXCEPTION 'FAIL test 1d: a blank unit was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 1: an analysis holds measurements, each with its own unit';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — the bounds that catch a misplaced decimal point
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_analysis uuid;
BEGIN
  v_org := '55555555-5555-5555-5555-555555555555';
  SELECT id INTO v_analysis FROM pool_analysis WHERE organization_id = v_org LIMIT 1;

  -- pH has a real ceiling; 72 is 7.2 typed in a hurry.
  BEGIN
    INSERT INTO pool_analysis_value (organization_id, analysis_id, metric, value, unit)
    VALUES (v_org, v_analysis, 'total_alkalinity', 80, 'ppm');
    UPDATE pool_analysis_value SET metric = 'ph', value = 72
     WHERE analysis_id = v_analysis AND metric = 'total_alkalinity';
    RAISE EXCEPTION 'FAIL test 2a: a pH of 72 was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Nothing on this panel is meaningfully negative.
  BEGIN
    INSERT INTO pool_analysis_value (organization_id, analysis_id, metric, value, unit)
    VALUES (v_org, v_analysis, 'salt', -1, 'ppm');
    RAISE EXCEPTION 'FAIL test 2b: a negative measurement was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 2: impossible readings are refused by the schema';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — one value per metric per analysis
--
-- Two pH rows in one analysis is not two readings, it is a double submit, and it
-- would put two points on the chart at the same instant.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_analysis uuid;
BEGIN
  v_org := '55555555-5555-5555-5555-555555555555';
  SELECT id INTO v_analysis FROM pool_analysis WHERE organization_id = v_org LIMIT 1;

  BEGIN
    INSERT INTO pool_analysis_value (organization_id, analysis_id, metric, value, unit)
    VALUES (v_org, v_analysis, 'ph', 7.9, 'pH');
    RAISE EXCEPTION 'FAIL test 3: the same metric was recorded twice in one analysis';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 3: one value per metric per analysis';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — one analysis per pool per instant, and archiving frees the slot
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_pool uuid; n int;
BEGIN
  v_org := '55555555-5555-5555-5555-555555555555';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org AND name = 'Tanque Grande';

  BEGIN
    INSERT INTO pool_analysis (organization_id, pool_id, taken_at)
    VALUES (v_org, v_pool, TIMESTAMPTZ '2026-08-01 09:00:00+00');
    RAISE EXCEPTION 'FAIL test 4a: the same pool was analysed twice at one instant';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- The partial index, doing its job: a mistyped analysis is archived and the
  -- moment can be recorded again.
  UPDATE pool_analysis SET archived_at = now()
   WHERE organization_id = v_org AND taken_at = TIMESTAMPTZ '2026-08-01 09:00:00+00';

  INSERT INTO pool_analysis (organization_id, pool_id, taken_at)
  VALUES (v_org, v_pool, TIMESTAMPTZ '2026-08-01 09:00:00+00');

  SELECT count(*) INTO n FROM pool_analysis
   WHERE organization_id = v_org AND taken_at = TIMESTAMPTZ '2026-08-01 09:00:00+00';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 4b: expected the archived analysis and the new one, got %', n;
  END IF;

  RAISE NOTICE 'PASS test 4: one analysis per instant, and archiving does not hold the slot';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — measurements die with their analysis
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_pool uuid; v_analysis uuid; n int;
BEGIN
  v_org := '55555555-5555-5555-5555-555555555555';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org AND name = 'Tanque Grande';

  INSERT INTO pool_analysis (organization_id, pool_id, taken_at)
  VALUES (v_org, v_pool, TIMESTAMPTZ '2026-08-15 09:00:00+00')
  RETURNING id INTO v_analysis;

  INSERT INTO pool_analysis_value (organization_id, analysis_id, metric, value, unit)
  VALUES (v_org, v_analysis, 'ph', 7.1, 'pH');

  DELETE FROM pool_analysis WHERE id = v_analysis;

  SELECT count(*) INTO n FROM pool_analysis_value WHERE analysis_id = v_analysis;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 5: % measurements outlived their analysis', n;
  END IF;

  RAISE NOTICE 'PASS test 5: destroying an analysis takes its measurements with it';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — an analysis cannot be attached to another tenant's pool
--
-- The composite foreign key, which is the only thing that prevents this. RLS
-- does not: each row passes its own policy, and it is the *reference between
-- them* that crosses the boundary.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_their_pool uuid;
BEGIN
  v_org := '55555555-5555-5555-5555-555555555555';
  SELECT id INTO v_their_pool
    FROM pool WHERE organization_id = '66666666-6666-6666-6666-666666666666';

  BEGIN
    INSERT INTO pool_analysis (organization_id, pool_id, taken_at)
    VALUES (v_org, v_their_pool, TIMESTAMPTZ '2026-08-20 09:00:00+00');
    RAISE EXCEPTION 'FAIL test 6: our analysis was attached to the neighbour''s pool';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 6: the composite key refuses a cross-tenant pool';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — water quality is the tenant's own
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_a uuid := '55555555-5555-5555-5555-555555555555';
  v_b uuid := '66666666-6666-6666-6666-666666666666';
  n int;
BEGIN
  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM pool_analysis WHERE organization_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7a: the neighbouring club could read % of our analyses', n;
  END IF;

  SELECT count(*) INTO n FROM pool_analysis_value WHERE organization_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7b: the neighbouring club could read % of our measurements', n;
  END IF;

  PERFORM set_config('app.organization_id', v_a::text, true);

  SELECT count(*) INTO n FROM pool_analysis WHERE organization_id = v_a AND archived_at IS NULL;
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL test 7c: our own analyses were not visible to us';
  END IF;

  RAISE NOTICE 'PASS test 7: analyses and their values are visible only to their own tenant';
END $$;

RESET ROLE;

ROLLBACK;
