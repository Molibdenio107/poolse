-- The tank's own ceiling — round 5, ticket 4.2.
--
-- Three capacity rules now exist and they answer three different questions, so
-- the tests that matter most here are the ones proving this rule does **not**
-- reach into the other two:
--
--   * `class_group.capacity` — how many places one turma promises.
--   * `lane_level_capacity`  — how many of a level fit in one lane, a teaching
--                              judgement, unchanged by any of this.
--   * `pool.max_capacity`    — how many bodies are in the water at once, across
--                              every turma sharing the tank.
--
-- The one that would be easy to get wrong is a tank with no ceiling set. Null
-- means "not measured", and a club that has not measured it must go on
-- timetabling exactly as before — so test 1 asserts something is *allowed*, and
-- would fail if the rule defaulted to anything.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_pc', 'pc@clube.pt', 'Rui', 'Fonseca', NULL, '2026-09-01 09:00:00+00');

INSERT INTO organization (id, name, slug) VALUES
  ('99999999-0000-4444-8888-999999999999', 'Clube Capacidade', 'clube-capacidade');

DO $$
DECLARE
  v_org uuid; v_fac uuid; v_pool uuid; v_free uuid;
  v_season uuid; v_level uuid;
BEGIN
  v_org := '99999999-0000-4444-8888-999999999999';

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Municipal')
  RETURNING id INTO v_fac;

  -- The tank under test, and a second one with no ceiling at all.
  INSERT INTO pool (organization_id, facility_id, name, kind, max_capacity)
  VALUES (v_org, v_fac, 'Tanque Grande', 'indoor', 40) RETURNING id INTO v_pool;
  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_org, v_fac, 'Tanque Sem Limite', 'indoor') RETURNING id INTO v_free;

  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_org, '2026/2027', '2026-09-01', '2027-07-31', 'published')
  RETURNING id INTO v_season;

  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_org, 'Iniciação', 1) RETURNING id INTO v_level;

  INSERT INTO class_group
    (organization_id, season_id, facility_id, name, level_id, pool_id, capacity)
  VALUES (v_org, v_season, v_fac, 'Cadetes',   v_level, v_pool, 20),
         (v_org, v_season, v_fac, 'Infantis',  v_level, v_pool, 12),
         (v_org, v_season, v_fac, 'Absolutos', v_level, v_pool, 12),
         (v_org, v_season, v_fac, 'Manhã',     v_level, v_pool, 30),
         -- No capacity recorded: "not decided", and never a reason to refuse.
         (v_org, v_season, v_fac, 'Hidro',     v_level, v_pool, NULL),
         -- In the tank that has no ceiling.
         (v_org, v_season, v_fac, 'Livres',    v_level, v_free, 500);
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — a tank with no ceiling never refuses anything
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_turma uuid;
BEGIN
  v_org := '99999999-0000-4444-8888-999999999999';
  SELECT id INTO v_turma FROM class_group WHERE organization_id = v_org AND name = 'Livres';

  INSERT INTO class_schedule
    (organization_id, facility_id, class_group_id, weekday, start_time, duration_minutes)
  SELECT v_org, facility_id, v_turma, 1, '19:15', 45 FROM class_group WHERE id = v_turma;

  RAISE NOTICE 'PASS test 1: a pool with no max_capacity is unlimited, as before';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — turmas sharing a slot are summed, and fit
--
-- 20 + 12 = 32 in a tank of 40. This is the club's ordinary Monday and has to
-- keep working; a rule that refused it would be wrong on its first screen.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_fac uuid; v_cadetes uuid; v_infantis uuid;
BEGIN
  v_org := '99999999-0000-4444-8888-999999999999';
  SELECT id INTO v_fac FROM facility WHERE organization_id = v_org;
  SELECT id INTO v_cadetes  FROM class_group WHERE organization_id = v_org AND name = 'Cadetes';
  SELECT id INTO v_infantis FROM class_group WHERE organization_id = v_org AND name = 'Infantis';

  INSERT INTO class_schedule
    (organization_id, facility_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_fac, v_cadetes,  1, '19:15', 45),
         (v_org, v_fac, v_infantis, 1, '19:15', 45);

  RAISE NOTICE 'PASS test 2: 20 + 12 in a tank of 40 is allowed';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — the one that goes over is refused
--
-- A third turma of 12 would make 44 in a tank of 40.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_fac uuid; v_absolutos uuid; ok boolean := false;
BEGIN
  v_org := '99999999-0000-4444-8888-999999999999';
  SELECT id INTO v_fac FROM facility WHERE organization_id = v_org;
  SELECT id INTO v_absolutos FROM class_group WHERE organization_id = v_org AND name = 'Absolutos';

  BEGIN
    INSERT INTO class_schedule
      (organization_id, facility_id, class_group_id, weekday, start_time, duration_minutes)
    VALUES (v_org, v_fac, v_absolutos, 1, '19:15', 45);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 3: 44 swimmers were allowed into a tank of 40';
  END IF;

  -- A partial overlap is still an overlap: half an hour of 44 people is 44
  -- people. Starting as the first two finish is not.
  ok := false;
  BEGIN
    INSERT INTO class_schedule
      (organization_id, facility_id, class_group_id, weekday, start_time, duration_minutes)
    VALUES (v_org, v_fac, v_absolutos, 1, '19:45', 45);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 3b: a partial overlap was not counted';
  END IF;

  INSERT INTO class_schedule
    (organization_id, facility_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_fac, v_absolutos, 1, '20:00', 45);

  RAISE NOTICE 'PASS test 3: over the ceiling is refused, back-to-back is allowed';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — a turma with no capacity never blocks, and never counts
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_fac uuid; v_hidro uuid;
BEGIN
  v_org := '99999999-0000-4444-8888-999999999999';
  SELECT id INTO v_fac FROM facility WHERE organization_id = v_org;
  SELECT id INTO v_hidro FROM class_group WHERE organization_id = v_org AND name = 'Hidro';

  -- Into the already-full 19:15 slot. Null capacity is "not decided", so it has
  -- nothing to add and nothing to be refused for.
  INSERT INTO class_schedule
    (organization_id, facility_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_fac, v_hidro, 1, '19:15', 45);

  RAISE NOTICE 'PASS test 4: a turma with no capacity neither blocks nor counts';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — another weekday is another question
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_fac uuid; v_manha uuid;
BEGIN
  v_org := '99999999-0000-4444-8888-999999999999';
  SELECT id INTO v_fac FROM facility WHERE organization_id = v_org;
  SELECT id INTO v_manha FROM class_group WHERE organization_id = v_org AND name = 'Manhã';

  -- 30 at the same hour on Tuesday, beside 32 on Monday. Different day, so the
  -- tank is empty as far as this slot is concerned.
  INSERT INTO class_schedule
    (organization_id, facility_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_fac, v_manha, 2, '19:15', 45);

  RAISE NOTICE 'PASS test 5: Tuesday does not count against Monday';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — editing the turma is checked too
--
-- Without the second trigger the ceiling would hold only against new schedules,
-- and a turma of 12 in a full tank could be edited to 80 with nothing objecting.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_infantis uuid; ok boolean := false;
BEGIN
  v_org := '99999999-0000-4444-8888-999999999999';
  SELECT id INTO v_infantis FROM class_group WHERE organization_id = v_org AND name = 'Infantis';

  BEGIN
    UPDATE class_group SET capacity = 80 WHERE id = v_infantis;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 6: a turma was widened past the tank it swims in';
  END IF;

  -- Shrinking is always fine, and so is widening within the room that is left:
  -- 20 + 16 = 36 in a tank of 40.
  UPDATE class_group SET capacity = 16 WHERE id = v_infantis;

  RAISE NOTICE 'PASS test 6: raising a turma past the tank ceiling is refused';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — the ceiling stops at the tenant boundary
--
-- Another club's turmas must not be counted against this tank, and this club's
-- must not be counted against theirs. A leak here would refuse a save by citing
-- classes the operator cannot see.
-- ---------------------------------------------------------------------------

INSERT INTO organization (id, name, slug) VALUES
  ('99999999-1111-4444-8888-999999999999', 'Clube Vizinho', 'clube-vizinho');

DO $$
DECLARE
  v_other uuid; v_fac uuid; v_pool uuid; v_season uuid; v_level uuid; v_turma uuid;
BEGIN
  v_other := '99999999-1111-4444-8888-999999999999';

  INSERT INTO facility (organization_id, name) VALUES (v_other, 'Piscina Vizinha')
  RETURNING id INTO v_fac;
  INSERT INTO pool (organization_id, facility_id, name, kind, max_capacity)
  VALUES (v_other, v_fac, 'Tanque Vizinho', 'indoor', 40) RETURNING id INTO v_pool;
  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_other, '2026/2027', '2026-09-01', '2027-07-31', 'published')
  RETURNING id INTO v_season;
  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_other, 'Iniciação', 1) RETURNING id INTO v_level;

  INSERT INTO class_group
    (organization_id, season_id, facility_id, name, level_id, pool_id, capacity)
  VALUES (v_other, v_season, v_fac, 'Vizinhos', v_level, v_pool, 39)
  RETURNING id INTO v_turma;

  -- 39 into their own 40 at the exact hour the first club is full. If the rule
  -- leaked across tenants this would be refused.
  INSERT INTO class_schedule
    (organization_id, facility_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_other, v_fac, v_turma, 1, '19:15', 45);

  RAISE NOTICE 'PASS test 7: the tank ceiling counts only its own tenant';
END $$;

ROLLBACK;
