-- Levels and seasons per sport — POOLSE-126, the schema half.
--
-- A swimming ladder has nothing to do with a tennis one. These prove a pool club
-- sees nothing move, a turma's level and season share its recinto's sport, the
-- ladder functions never step onto another sport's rung, and a sport with Época
-- própria publishes one season of its own beside the shared one.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug, enabled_sports) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Clube A', 'clube-a', '{pool,tennis}');

INSERT INTO facility (id, organization_id, name) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Sede A');

INSERT INTO season (id, organization_id, name, starts_on, ends_on) VALUES
  ('a5555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Época 26/27', DATE '2026-09-01', DATE '2027-07-31');

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

INSERT INTO pool (id, organization_id, facility_id, name) VALUES
  ('a2222222-2222-2222-2222-222222222222', current_organization_id(),
   'a1111111-1111-1111-1111-111111111111', 'Piscina');
INSERT INTO playing_area (id, organization_id, facility_id, sport_id, name) VALUES
  ('a3333333-3333-3333-3333-333333333333', current_organization_id(),
   'a1111111-1111-1111-1111-111111111111', 'tennis', 'Campo 1');

-- Two swimming levels the old way, and a tennis ladder with the same first name.
INSERT INTO student_level (id, organization_id, name, sort_order, min_age_months, max_age_months) VALUES
  ('b1111111-1111-1111-1111-111111111111', current_organization_id(), 'Iniciação', 1, 48, 95),
  ('b2222222-2222-2222-2222-222222222222', current_organization_id(), 'Aperfeiçoamento', 3, 96, 143);
INSERT INTO student_level (id, organization_id, name, sort_order, sport_id, min_age_months, max_age_months) VALUES
  ('c1111111-1111-1111-1111-111111111111', current_organization_id(), 'Iniciação', 1, 'tennis', 48, 95),
  ('c2222222-2222-2222-2222-222222222222', current_organization_id(), 'Competição', 2, 'tennis', 96, 143);

-- ---------------------------------------------------------------------------
-- Test 1 — a level made the old way is a swimming level; names and bands per sport
-- ---------------------------------------------------------------------------

DO $$
DECLARE v text; ok boolean := false;
BEGIN
  SELECT sport_id INTO v FROM student_level WHERE id = 'b1111111-1111-1111-1111-111111111111';
  IF v <> 'pool' THEN RAISE EXCEPTION 'FAIL test 1: a level with no sport is %', v; END IF;

  -- The tennis Iniciação above shares a name and an age band and was accepted;
  -- a second swimming Iniciação is still a duplicate.
  BEGIN
    INSERT INTO student_level (organization_id, name) VALUES (current_organization_id(), 'INICIACAO');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1: two swimming levels share a name'; END IF;

  ok := false;
  BEGIN
    UPDATE student_level SET sport_id = 'tennis' WHERE id = 'b2222222-2222-2222-2222-222222222222';
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1: a level changed sport'; END IF;
  RAISE NOTICE 'PASS test 1: levels default to swimming; names and age bands are per sport; a level keeps its sport';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — the ladder stays on its sport
-- ---------------------------------------------------------------------------

DO $$
DECLARE v uuid;
BEGIN
  -- After swimming Iniciação (1) the next rung is swimming Aperfeiçoamento (3),
  -- never tennis Competição (2), though it sorts between them.
  v := next_level(current_organization_id(), 'b1111111-1111-1111-1111-111111111111');
  IF v IS DISTINCT FROM 'b2222222-2222-2222-2222-222222222222' THEN
    RAISE EXCEPTION 'FAIL test 2: next_level stepped to %', v;
  END IF;
  v := age_fit_level(current_organization_id(), 'b1111111-1111-1111-1111-111111111111', 100, NULL);
  IF v IS DISTINCT FROM 'b2222222-2222-2222-2222-222222222222' THEN
    RAISE EXCEPTION 'FAIL test 2: age_fit_level stepped to %', v;
  END IF;
  v := next_level(current_organization_id(), 'c1111111-1111-1111-1111-111111111111');
  IF v IS DISTINCT FROM 'c2222222-2222-2222-2222-222222222222' THEN
    RAISE EXCEPTION 'FAIL test 2: the tennis ladder stepped to %', v;
  END IF;
  RAISE NOTICE 'PASS test 2: next_level and age_fit_level never leave the sport';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — a turma's level shares its recinto's sport
-- ---------------------------------------------------------------------------

DO $$
DECLARE ok boolean := false; v_detail text; v_turma uuid;
BEGIN
  BEGIN
    INSERT INTO class_group (organization_id, season_id, name, pool_id, level_id)
    VALUES (current_organization_id(), 'a5555555-5555-5555-5555-555555555555', 'Errada',
            'a2222222-2222-2222-2222-222222222222', 'c1111111-1111-1111-1111-111111111111');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    ok := v_detail = 'level_sport_mismatch|tennis|pool';
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3: a tennis level went on a pool turma (%)', v_detail; END IF;

  INSERT INTO class_group (organization_id, season_id, name, pool_id, level_id)
  VALUES (current_organization_id(), 'a5555555-5555-5555-5555-555555555555', 'Natação 1',
          'a2222222-2222-2222-2222-222222222222', 'b1111111-1111-1111-1111-111111111111')
  RETURNING id INTO v_turma;

  INSERT INTO class_group (organization_id, facility_id, season_id, name, playing_area_id, level_id)
  VALUES (current_organization_id(), 'a1111111-1111-1111-1111-111111111111',
          'a5555555-5555-5555-5555-555555555555', 'Ténis 1',
          'a3333333-3333-3333-3333-333333333333', 'c1111111-1111-1111-1111-111111111111');

  ok := false;
  BEGIN
    UPDATE class_group SET level_id = 'c2222222-2222-2222-2222-222222222222' WHERE id = v_turma;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3: a pool turma was moved to a tennis level'; END IF;
  RAISE NOTICE 'PASS test 3: a turma''s level is of its recinto''s sport, made or edited';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — the shared season reaches every sport; Época própria gives one its own
-- ---------------------------------------------------------------------------

DO $$
DECLARE v text[]; ok boolean := false; v_detail text;
BEGIN
  SELECT array_agg(s ORDER BY s) INTO v FROM season_scope('a5555555-5555-5555-5555-555555555555') s;
  IF v <> ARRAY['pool', 'tennis'] THEN RAISE EXCEPTION 'FAIL test 4: the shared season reaches %', v; END IF;

  -- Toggle off: a tennis season is refused.
  BEGIN
    INSERT INTO season (organization_id, name, starts_on, ends_on, sport_id)
    VALUES (current_organization_id(), 'Ténis 2027', DATE '2027-01-01', DATE '2027-12-31', 'tennis');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    ok := v_detail = 'season_sport_not_own|tennis';
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4: a tennis season with the toggle off (%)', v_detail; END IF;

  -- The pool never gets one.
  ok := false;
  BEGIN
    UPDATE organization SET own_season_sports = '{pool}' WHERE id = current_organization_id();
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4: the pool was given its own season'; END IF;
  RAISE NOTICE 'PASS test 4: the shared season reaches every sport, and a sport season needs Época própria';
END $$;

-- Toggle on (the club's own setting) and publish a tennis season beside the shared one.
UPDATE organization SET own_season_sports = '{tennis}' WHERE id = current_organization_id();
INSERT INTO season (id, organization_id, name, starts_on, ends_on, sport_id) VALUES
  ('a6666666-6666-6666-6666-666666666666', current_organization_id(),
   'Ténis 2027', DATE '2027-01-01', DATE '2027-12-31', 'tennis');

DO $$
DECLARE v text[]; ok boolean := false;
BEGIN
  SELECT array_agg(s ORDER BY s) INTO v FROM season_scope('a5555555-5555-5555-5555-555555555555') s;
  IF v <> ARRAY['pool'] THEN RAISE EXCEPTION 'FAIL test 5: the shared season still reaches %', v; END IF;
  SELECT array_agg(s) INTO v FROM season_scope('a6666666-6666-6666-6666-666666666666') s;
  IF v <> ARRAY['tennis'] THEN RAISE EXCEPTION 'FAIL test 5: the tennis season reaches %', v; END IF;

  -- One published tennis season at a time; the shared one is untouched by it.
  BEGIN
    INSERT INTO season (organization_id, name, starts_on, ends_on, sport_id)
    VALUES (current_organization_id(), 'Ténis 2028', DATE '2028-01-01', DATE '2028-12-31', 'tennis');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 5: two tennis seasons published'; END IF;
  IF (SELECT status FROM season WHERE id = 'a5555555-5555-5555-5555-555555555555') <> 'published' THEN
    RAISE EXCEPTION 'FAIL test 5: the shared season was unpublished';
  END IF;

  -- A tennis season takes only tennis turmas.
  ok := false;
  BEGIN
    INSERT INTO class_group (organization_id, season_id, name, pool_id)
    VALUES (current_organization_id(), 'a6666666-6666-6666-6666-666666666666', 'Natação no ténis',
            'a2222222-2222-2222-2222-222222222222');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 5: a pool turma went into the tennis season'; END IF;
  INSERT INTO class_group (organization_id, facility_id, season_id, name, playing_area_id)
  VALUES (current_organization_id(), 'a1111111-1111-1111-1111-111111111111',
          'a6666666-6666-6666-6666-666666666666', 'Ténis 2',
          'a3333333-3333-3333-3333-333333333333');
  RAISE NOTICE 'PASS test 5: Época própria publishes one tennis season beside the shared one, for tennis turmas only';
END $$;

ROLLBACK;
