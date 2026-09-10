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
-- **Tests 8 to 12 are slice 4.2's** — `pool_analysis_alert`. The two to keep if
-- this file is ever cut down are 8, one alert per analysis, which is what stops a
-- retried submit from emailing a club twice about one sample; and 11, the absent
-- DELETE grant, which a future `GRANT ALL` would undo while passing everything
-- else here.
--
-- **Tests 13 to 16 are `pool_metric_range`**, the second half of the same slice.
-- 13 is the one that matters: a bound may be null on either side or on both, and
-- what that means is decided by `resolveBands` rather than by this table. A
-- well-meaning NOT NULL here would take away both the one-sided band and the off
-- switch, and every test above it would still pass.
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

-- This fixture states its own plan. A subscription covers one facility by
-- default and `facility_licence` enforces it; nothing below is about billing,
-- so the plan is set out of the way. The limit is asserted in `facilities.sql`.
UPDATE organization SET max_facilities = 20;



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

-- ---------------------------------------------------------------------------
-- Test 8 — one alert per analysis
--
-- Slice 4.2. The unique index is what makes the send path safe to re-enter: a
-- retried submit, or two people pressing Guardar at once, must not produce two
-- emails about one sample. Not partial, because this table has no `archived_at`
-- — an alert is a record of something that happened and there is nothing for an
-- operator to remove.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := '55555555-5555-5555-5555-555555555555';
  v_pool uuid; v_analysis uuid;
BEGIN
  SELECT a.id, a.pool_id INTO v_analysis, v_pool
    FROM pool_analysis a WHERE a.organization_id = v_org LIMIT 1;

  INSERT INTO pool_analysis_alert (organization_id, pool_id, analysis_id, metrics)
  VALUES (v_org, v_pool, v_analysis, ARRAY['ph']::pool_metric[]);

  BEGIN
    INSERT INTO pool_analysis_alert (organization_id, pool_id, analysis_id, metrics)
    VALUES (v_org, v_pool, v_analysis, ARRAY['free_chlorine']::pool_metric[]);
    RAISE EXCEPTION 'FAIL test 8: one analysis raised two alerts';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 8: an analysis raises at most one alert';
END $$;

-- ---------------------------------------------------------------------------
-- Test 9 — an alert about nothing, and a delivery to nobody
--
-- Two CHECKs that exist because both states are writable by a careless caller
-- and neither means anything. `excursions()` returning an empty list is the
-- signal *not* to raise an alert, so a row with no metrics is a bug that would
-- otherwise sit in the compliance record; and `delivered_at` with an empty
-- recipient list claims a message reached nobody in particular.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := '55555555-5555-5555-5555-555555555555';
  v_pool uuid; v_analysis uuid;
BEGIN
  -- A second analysis, because the first already has its one alert.
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org LIMIT 1;

  INSERT INTO pool_analysis (organization_id, pool_id, taken_at)
  VALUES (v_org, v_pool, TIMESTAMPTZ '2026-08-28 07:30:00+00')
  RETURNING id INTO v_analysis;

  BEGIN
    INSERT INTO pool_analysis_alert (organization_id, pool_id, analysis_id, metrics)
    VALUES (v_org, v_pool, v_analysis, ARRAY[]::pool_metric[]);
    RAISE EXCEPTION 'FAIL test 9a: an alert was raised about no metric at all';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO pool_analysis_alert (organization_id, pool_id, analysis_id, metrics,
                                     recipients, delivered_at)
    VALUES (v_org, v_pool, v_analysis, ARRAY['ph']::pool_metric[],
            ARRAY[]::text[], now());
    RAISE EXCEPTION 'FAIL test 9b: an alert claimed delivery to an empty recipient list';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 9: an empty metric list and a delivery to nobody are both refused';
END $$;

-- ---------------------------------------------------------------------------
-- Test 10 — the alert cannot name the neighbour's pool
--
-- The composite key again, for the same reason test 6 asserts it on the
-- analysis: RLS does not catch a cross-tenant *reference*, because each row
-- passes its own policy.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := '55555555-5555-5555-5555-555555555555';
  v_analysis uuid; v_their_pool uuid;
BEGIN
  -- One that has not already alerted, or the unique index from test 8 answers
  -- first and this passes for the wrong reason.
  SELECT a.id INTO v_analysis
    FROM pool_analysis a
   WHERE a.organization_id = v_org
     AND NOT EXISTS (
       SELECT 1 FROM pool_analysis_alert al
        WHERE al.analysis_id = a.id AND al.organization_id = a.organization_id
     )
   LIMIT 1;
  IF v_analysis IS NULL THEN
    RAISE EXCEPTION 'FAIL test 10: the fixture has no un-alerted analysis to use';
  END IF;

  SELECT id INTO v_their_pool
    FROM pool WHERE organization_id = '66666666-6666-6666-6666-666666666666';

  BEGIN
    INSERT INTO pool_analysis_alert (organization_id, pool_id, analysis_id, metrics)
    VALUES (v_org, v_their_pool, v_analysis, ARRAY['ph']::pool_metric[]);
    RAISE EXCEPTION 'FAIL test 10: our alert named the neighbour''s pool';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 10: the composite key refuses a cross-tenant pool on an alert';
END $$;

-- ---------------------------------------------------------------------------
-- Test 11 — the app role cannot delete an alert, and cannot read another's
--
-- The missing DELETE grant is the same instrument `invoice` uses: a privilege
-- that was never granted cannot be forgotten by application code, whereas a
-- trigger can be dropped by a later migration that meant something else. The
-- test is here because a well-meaning `GRANT ALL` in a future migration would
-- pass every other assertion in this file.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF has_table_privilege('poolse_app', 'pool_analysis_alert', 'DELETE') THEN
    RAISE EXCEPTION 'FAIL test 11a: poolse_app can delete an alert';
  END IF;

  IF NOT has_table_privilege('poolse_app', 'pool_analysis_alert', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL test 11b: poolse_app cannot read alerts';
  END IF;

  IF NOT has_table_privilege('poolse_app', 'pool_analysis_alert', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL test 11c: poolse_app cannot raise an alert';
  END IF;

  -- UPDATE is needed, and only for `delivered_at` and `recipients`: the send
  -- happens after the transaction that wrote the reading has committed.
  IF NOT has_table_privilege('poolse_app', 'pool_analysis_alert', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL test 11d: poolse_app cannot stamp what the send did';
  END IF;

  RAISE NOTICE 'PASS test 11: the app may raise, read and stamp an alert, and never delete one';
END $$;

-- ---------------------------------------------------------------------------
-- Test 12 — an alert is the tenant's own
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_a uuid := '55555555-5555-5555-5555-555555555555';
  v_b uuid := '66666666-6666-6666-6666-666666666666';
  n int;
BEGIN
  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM pool_analysis_alert WHERE organization_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 12a: the neighbouring club could read % of our alerts', n;
  END IF;

  PERFORM set_config('app.organization_id', v_a::text, true);

  SELECT count(*) INTO n FROM pool_analysis_alert WHERE organization_id = v_a;
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL test 12b: our own alerts were not visible to us';
  END IF;

  RAISE NOTICE 'PASS test 12: alerts are visible only to their own tenant';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 13 — a pool's own safe range, and the bounds it may hold
--
-- Slice 4.2's second half. Both bounds are nullable and independent, because a
-- null bound is not judged — an outdoor tank with a floor and no ceiling is a
-- real pool, and a row with neither bound is how a club says "do not judge this
-- metric here" without a column for it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := '55555555-5555-5555-5555-555555555555';
  v_pool uuid;
  n int;
BEGIN
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org LIMIT 1;

  -- A hotel tank: its own temperature band, both ends.
  INSERT INTO pool_metric_range (organization_id, pool_id, metric, min_value, max_value)
  VALUES (v_org, v_pool, 'temperature', 28, 31);

  -- One end only, which is the case a NOT NULL would have made unsayable.
  INSERT INTO pool_metric_range (organization_id, pool_id, metric, min_value, max_value)
  VALUES (v_org, v_pool, 'free_chlorine', 0.5, NULL);

  -- Neither end: not judged at all.
  INSERT INTO pool_metric_range (organization_id, pool_id, metric, min_value, max_value)
  VALUES (v_org, v_pool, 'turbidity', NULL, NULL);

  SELECT count(*) INTO n FROM pool_metric_range
   WHERE pool_id = v_pool AND archived_at IS NULL;
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL test 13a: expected three ranges, found %', n;
  END IF;

  -- A band the wrong way round would make every reading an excursion in both
  -- directions at once, which is a typo that reads fine on a form.
  BEGIN
    INSERT INTO pool_metric_range (organization_id, pool_id, metric, min_value, max_value)
    VALUES (v_org, v_pool, 'ph', 7.6, 7.2);
    RAISE EXCEPTION 'FAIL test 13b: a maximum below the minimum was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Equal ends are allowed: "exactly 7.4" is a strict club, not a mistake.
  INSERT INTO pool_metric_range (organization_id, pool_id, metric, min_value, max_value)
  VALUES (v_org, v_pool, 'salt', 4000, 4000);

  BEGIN
    INSERT INTO pool_metric_range (organization_id, pool_id, metric, min_value, max_value)
    VALUES (v_org, v_pool, 'total_alkalinity', -1, 100);
    RAISE EXCEPTION 'FAIL test 13c: a negative bound was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- pH has a real ceiling here, exactly as it does on the reading.
  BEGIN
    INSERT INTO pool_metric_range (organization_id, pool_id, metric, min_value, max_value)
    VALUES (v_org, v_pool, 'ph', 7, 15);
    RAISE EXCEPTION 'FAIL test 13d: a pH ceiling above 14 was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 13: a range may hold one bound, both, or neither, and never a bad pair';
END $$;

-- ---------------------------------------------------------------------------
-- Test 14 — one live range per metric per pool, and archiving frees the slot
--
-- The partial unique index. A club that overrides pH, reverts to the reference
-- and overrides it again next season must not collide with the dead row — the
-- same reason every unique constraint on a soft-deletable table here is partial.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := '55555555-5555-5555-5555-555555555555';
  v_pool uuid;
BEGIN
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org LIMIT 1;

  BEGIN
    INSERT INTO pool_metric_range (organization_id, pool_id, metric, min_value, max_value)
    VALUES (v_org, v_pool, 'temperature', 26, 30);
    RAISE EXCEPTION 'FAIL test 14a: one pool held two live temperature ranges';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  UPDATE pool_metric_range SET archived_at = now()
   WHERE pool_id = v_pool AND metric = 'temperature' AND archived_at IS NULL;

  -- Reverting and overriding again is an ordinary thing to do across seasons.
  INSERT INTO pool_metric_range (organization_id, pool_id, metric, min_value, max_value)
  VALUES (v_org, v_pool, 'temperature', 26, 30);

  RAISE NOTICE 'PASS test 14: one live range per metric, and an archived one holds no slot';
END $$;

-- ---------------------------------------------------------------------------
-- Test 15 — a range cannot name the neighbour's pool, and is not visible to them
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := '55555555-5555-5555-5555-555555555555';
  v_their_pool uuid;
BEGIN
  SELECT id INTO v_their_pool
    FROM pool WHERE organization_id = '66666666-6666-6666-6666-666666666666';

  BEGIN
    INSERT INTO pool_metric_range (organization_id, pool_id, metric, min_value, max_value)
    VALUES (v_org, v_their_pool, 'ph', 7, 8);
    RAISE EXCEPTION 'FAIL test 15: our range named the neighbour''s pool';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 15: the composite key refuses a cross-tenant pool on a range';
END $$;

SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_a uuid := '55555555-5555-5555-5555-555555555555';
  v_b uuid := '66666666-6666-6666-6666-666666666666';
  n int;
BEGIN
  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM pool_metric_range WHERE organization_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 16a: the neighbouring club could read % of our ranges', n;
  END IF;

  PERFORM set_config('app.organization_id', v_a::text, true);

  SELECT count(*) INTO n FROM pool_metric_range WHERE organization_id = v_a;
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL test 16b: our own ranges were not visible to us';
  END IF;

  RAISE NOTICE 'PASS test 16: safe ranges are visible only to their own tenant';
END $$;

RESET ROLE;

ROLLBACK;
