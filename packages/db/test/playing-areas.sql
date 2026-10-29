-- Recintos — POOLSE-122.
--
-- A pool is one kind of recinto. These prove the two stay one thing: every pool
-- has its recinto and every pool recinto its pool, they archive and rename
-- together, the children carry the recinto without the API naming it, and a
-- recinto cannot cross the tenant boundary.
--
-- Run: psql -v ON_ERROR_STOP=1 -d poolse_test -f playing-areas.sql

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Clube A', 'clube-a'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Clube B', 'clube-b');
UPDATE organization SET max_facilities = 20;

INSERT INTO facility (id, organization_id, name) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Sede A'),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Anexo A'),
  ('b1111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Sede B');

INSERT INTO season (organization_id, name, starts_on, ends_on) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Época A', DATE '2026-09-01', DATE '2027-07-31');

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

-- ---------------------------------------------------------------------------
-- Test 1 — a pool inserted the old way gets its recinto, in position
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_fac uuid := 'a1111111-1111-1111-1111-111111111111';
        v_n int; v_bad int; v_positions text;
BEGIN
  INSERT INTO pool (organization_id, facility_id, name) VALUES
    (current_organization_id(), v_fac, 'Piscina Grande'),
    (current_organization_id(), v_fac, 'Tanque de Aprendizagem');

  SELECT count(*), count(*) FILTER (WHERE a.sport_id <> 'pool' OR a.name <> p.name
                                       OR a.facility_id <> p.facility_id),
         string_agg(a.position::text, ',' ORDER BY a.position)
    INTO v_n, v_bad, v_positions
    FROM pool p JOIN playing_area a ON a.id = p.playing_area_id
   WHERE p.facility_id = v_fac;
  IF v_n <> 2 OR v_bad <> 0 THEN
    RAISE EXCEPTION 'FAIL test 1: % pools with recintos, % disagreeing', v_n, v_bad;
  END IF;
  IF v_positions <> '0,1' THEN
    RAISE EXCEPTION 'FAIL test 1: positions %, expected 0,1', v_positions;
  END IF;
  RAISE NOTICE 'PASS test 1: each pool got its own recinto of sport pool, in order';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — a recinto of sport pool with no pool is refused at commit
-- ---------------------------------------------------------------------------

DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO playing_area (organization_id, facility_id, sport_id, name)
    VALUES (current_organization_id(), 'a1111111-1111-1111-1111-111111111111', 'pool', 'Tanque Fantasma');
    SET CONSTRAINTS playing_area_pool_has_child IMMEDIATE;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2: a pool recinto without a pool was accepted'; END IF;

  -- A court needs no pool.
  INSERT INTO playing_area (organization_id, facility_id, sport_id, name)
  VALUES (current_organization_id(), 'a1111111-1111-1111-1111-111111111111', 'tennis', 'Campo 1');
  SET CONSTRAINTS playing_area_pool_has_child IMMEDIATE;

  -- And a pool still opens with its recinto when constraints are immediate.
  INSERT INTO pool (organization_id, facility_id, name)
  VALUES (current_organization_id(), 'a2222222-2222-2222-2222-222222222222', 'Tanque Imediato');
  SET CONSTRAINTS ALL DEFERRED;
  RAISE NOTICE 'PASS test 2: a pool recinto needs its pool; a tennis court does not';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — a pool cannot hang off a court, nor change recinto or site
-- ---------------------------------------------------------------------------

DO $$
DECLARE ok boolean;
        v_court uuid;
        v_pool uuid;
BEGIN
  SELECT id INTO v_court FROM playing_area WHERE name = 'Campo 1';
  ok := false;
  BEGIN
    INSERT INTO pool (organization_id, facility_id, name, playing_area_id)
    VALUES (current_organization_id(), 'a1111111-1111-1111-1111-111111111111', 'Piscina no Campo', v_court);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3: a pool was hung off a tennis court'; END IF;

  SELECT id INTO v_pool FROM pool WHERE name = 'Piscina Grande';
  ok := false;
  BEGIN
    UPDATE pool SET facility_id = 'a2222222-2222-2222-2222-222222222222' WHERE id = v_pool;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3: a pool moved site away from its recinto'; END IF;

  ok := false;
  BEGIN
    UPDATE playing_area SET sport_id = 'padel' WHERE id = v_court;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3: a recinto changed sport'; END IF;
  RAISE NOTICE 'PASS test 3: a pool''s recinto is of sport pool, and neither moves';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — archive and rename travel both ways
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_pool uuid; v_area uuid; v_state text;
BEGIN
  SELECT id, playing_area_id INTO v_pool, v_area FROM pool WHERE name = 'Piscina Grande';

  UPDATE pool SET archived_at = now() WHERE id = v_pool;
  IF (SELECT archived_at FROM playing_area WHERE id = v_area) IS NULL THEN
    RAISE EXCEPTION 'FAIL test 4: archiving the pool left its recinto live';
  END IF;

  UPDATE playing_area SET archived_at = NULL WHERE id = v_area;
  IF (SELECT archived_at FROM pool WHERE id = v_pool) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 4: restoring the recinto left its pool archived';
  END IF;

  UPDATE pool SET name = 'Piscina Olímpica' WHERE id = v_pool;
  SELECT name INTO v_state FROM playing_area WHERE id = v_area;
  IF v_state <> 'Piscina Olímpica' THEN
    RAISE EXCEPTION 'FAIL test 4: renaming the pool left its recinto as %', v_state;
  END IF;
  RAISE NOTICE 'PASS test 4: one soft delete and one name, both directions';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — names are unique per site among live recintos, accent-blind
-- ---------------------------------------------------------------------------

DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO pool (organization_id, facility_id, name)
    VALUES (current_organization_id(), 'a1111111-1111-1111-1111-111111111111', 'PISCINA OLIMPICA');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 5: a pool took a live recinto''s name without its accent'; END IF;

  ok := false;
  BEGIN
    INSERT INTO pool (organization_id, facility_id, name)
    VALUES (current_organization_id(), 'a1111111-1111-1111-1111-111111111111', 'campo 1');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 5: a pool and a court on one site shared a name'; END IF;

  -- Another site may use it.
  INSERT INTO pool (organization_id, facility_id, name)
  VALUES (current_organization_id(), 'a2222222-2222-2222-2222-222222222222', 'Piscina Olímpica');
  RAISE NOTICE 'PASS test 5: one name per site across sports; another site may reuse it';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — turmas, closures and meters carry the recinto without being told
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_pool uuid; v_area uuid; v_other uuid; v_other_area uuid;
        v_group uuid; v_closure uuid; v_meter uuid; v_got uuid;
BEGIN
  SELECT id, playing_area_id INTO v_pool, v_area FROM pool WHERE name = 'Piscina Olímpica'
     AND facility_id = 'a1111111-1111-1111-1111-111111111111';
  SELECT id, playing_area_id INTO v_other, v_other_area FROM pool WHERE name = 'Tanque de Aprendizagem';

  INSERT INTO class_group (organization_id, season_id, name, pool_id)
  VALUES (current_organization_id(), (SELECT id FROM season LIMIT 1), 'Turma Recinto', v_pool)
  RETURNING id, playing_area_id INTO v_group, v_got;
  IF v_got IS DISTINCT FROM v_area THEN RAISE EXCEPTION 'FAIL test 6: turma recinto %', v_got; END IF;

  UPDATE class_group SET pool_id = v_other WHERE id = v_group RETURNING playing_area_id INTO v_got;
  IF v_got IS DISTINCT FROM v_other_area THEN RAISE EXCEPTION 'FAIL test 6: moved turma kept %', v_got; END IF;

  -- A forged recinto is overwritten by the pool's.
  UPDATE class_group SET playing_area_id = v_area WHERE id = v_group RETURNING playing_area_id INTO v_got;
  IF v_got IS DISTINCT FROM v_other_area THEN RAISE EXCEPTION 'FAIL test 6: turma recinto drifted from its pool'; END IF;

  UPDATE class_group SET pool_id = NULL WHERE id = v_group RETURNING playing_area_id INTO v_got;
  IF v_got IS NOT NULL THEN RAISE EXCEPTION 'FAIL test 6: a turma with no pool kept a stale recinto'; END IF;

  INSERT INTO closure (organization_id, facility_id, pool_id, starts_on, ends_on, reason)
  VALUES (current_organization_id(), 'a1111111-1111-1111-1111-111111111111', v_pool,
          DATE '2027-03-09', DATE '2027-03-09', 'Esvaziamento')
  RETURNING playing_area_id INTO v_got;
  IF v_got IS DISTINCT FROM v_area THEN RAISE EXCEPTION 'FAIL test 6: closure recinto %', v_got; END IF;

  INSERT INTO closure (organization_id, facility_id, starts_on, ends_on, reason)
  VALUES (current_organization_id(), 'a1111111-1111-1111-1111-111111111111',
          DATE '2027-03-10', DATE '2027-03-10', 'Obras')
  RETURNING playing_area_id INTO v_got;
  IF v_got IS NOT NULL THEN RAISE EXCEPTION 'FAIL test 6: a whole-site closure named a recinto'; END IF;

  INSERT INTO energy_meter (organization_id, facility_id, pool_id, name, reads)
  VALUES (current_organization_id(), 'a1111111-1111-1111-1111-111111111111', v_pool,
          'Bomba', 'interval_consumption')
  RETURNING playing_area_id INTO v_got;
  IF v_got IS DISTINCT FROM v_area THEN RAISE EXCEPTION 'FAIL test 6: meter recinto %', v_got; END IF;

  RAISE NOTICE 'PASS test 6: turma, closure and meter follow their pool''s recinto';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — the tenant boundary
-- ---------------------------------------------------------------------------

DO $$
DECLARE ok boolean; v_n int; v_area_a uuid;
BEGIN
  SELECT id INTO v_area_a FROM playing_area WHERE name = 'Campo 1';

  PERFORM set_config('app.organization_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
  SELECT count(*) INTO v_n FROM playing_area;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL test 7: org B saw % of org A''s recintos', v_n; END IF;

  ok := false;
  BEGIN
    INSERT INTO playing_area (organization_id, facility_id, sport_id, name)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1111111-1111-1111-1111-111111111111', 'gym', 'Ginásio');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 7: org B wrote a recinto into org A'; END IF;

  ok := false;
  BEGIN
    INSERT INTO playing_area (organization_id, facility_id, sport_id, name)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'a1111111-1111-1111-1111-111111111111', 'gym', 'Ginásio');
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 7: org B put a recinto on org A''s site'; END IF;

  ok := false;
  BEGIN
    INSERT INTO energy_meter (organization_id, facility_id, name, reads, playing_area_id)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1111111-1111-1111-1111-111111111111',
            'Roubado', 'interval_consumption', v_area_a);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 7: org B''s meter named org A''s recinto'; END IF;

  PERFORM set_config('app.organization_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
  RAISE NOTICE 'PASS test 7: a recinto stays inside its club';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8 — the catalogue is read-only to the app, and no recinto is deleted
-- ---------------------------------------------------------------------------

DO $$
DECLARE ok boolean; v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM sport;
  IF v_n <> 8 THEN RAISE EXCEPTION 'FAIL test 8: % sports seeded, expected 8', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM sport WHERE id = 'gym' AND NOT has_units AND has_inventory)
     OR NOT EXISTS (SELECT 1 FROM sport WHERE id = 'padel' AND has_units AND NOT has_metrics) THEN
    RAISE EXCEPTION 'FAIL test 8: gym or padel seeded with the wrong flags';
  END IF;

  ok := false;
  BEGIN
    INSERT INTO sport (id, default_slot_minutes, has_units, has_metrics, has_inventory, units_shareable, position)
    VALUES ('curling', 60, false, false, false, false, 9);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 8: a club added a sport'; END IF;

  ok := false;
  BEGIN
    DELETE FROM playing_area WHERE name = 'Campo 1';
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 8: the app deleted a recinto'; END IF;
  RAISE NOTICE 'PASS test 8: eight sports, read-only to clubs; recintos are archived, never deleted';
END $$;

ROLLBACK;
