-- Conflict rules — POOLSE-51.
--
-- This suite exists as much to prove what is **allowed** as what is blocked, and
-- that is not a stylistic point. The constraint this migration replaced refused
-- one instructor running two groups at once anywhere, which meant Sandra taking
-- Cadetes, Infantis and Absolutos on lanes 2, 3 and 4 of one tank at 19:15 — the
-- club's ordinary Tuesday — was rejected by the database. A scheduler wrong
-- about a club's actual practice on its first screen gets turned off.
--
-- So test 2 is the one that matters most here. It asserts that something is
-- accepted, and it would have failed before this ticket.
--
-- The other half is unchanged in spirit: two pools at once is still refused, two
-- facilities likewise, and a cancellation frees the person.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_c', 'c@clube.pt', 'Rui', 'Fonseca', NULL, '2026-09-01 09:00:00+00');

INSERT INTO organization (id, name, slug) VALUES
  ('99999999-9999-9999-9999-999999999999', 'Clube Conflitos', 'clube-conflitos');

DO $$
DECLARE
  v_org uuid; v_central uuid; v_norte uuid;
  v_big uuid; v_learner uuid; v_other_pool uuid;
  v_season uuid; v_level uuid; v_turma uuid;
  v_sandra uuid; v_joao uuid;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Central')
  RETURNING id INTO v_central;
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Norte')
  RETURNING id INTO v_norte;

  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_org, v_central, 'Tanque Grande', 'indoor') RETURNING id INTO v_big;
  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_org, v_central, 'Tanque de Aprendizagem', 'indoor') RETURNING id INTO v_learner;
  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_org, v_norte, 'Tanque Norte', 'indoor') RETURNING id INTO v_other_pool;

  INSERT INTO membership (organization_id, first_name, last_name, email)
  VALUES (v_org, 'Sandra', 'Lopes', 'sandra@clube.pt') RETURNING id INTO v_sandra;
  INSERT INTO membership (organization_id, first_name, last_name, email)
  VALUES (v_org, 'João', 'Dias', 'joao@clube.pt') RETURNING id INTO v_joao;

  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_org, '2026/2027', '2026-09-01', '2027-07-31', 'published')
  RETURNING id INTO v_season;

  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_org, 'Iniciação', 1) RETURNING id INTO v_level;

  /*
   * Three turmas, not one repeated.
   *
   * `class_session` is unique on (class_group_id, starts_at) — one turma cannot
   * meet twice at the same moment, which is right. Sandra's concurrent groups
   * are three *different* turmas sharing an instructor and a tank, which is
   * exactly what Cadetes, Infantis and Absolutos are on the reference sheet.
   */
  INSERT INTO class_group
    (organization_id, season_id, facility_id, name, level_id, pool_id, instructor_membership_id)
  VALUES (v_org, v_season, v_central, 'Cadetes',   v_level, v_big, v_sandra),
         (v_org, v_season, v_central, 'Infantis',  v_level, v_big, v_sandra),
         (v_org, v_season, v_central, 'Absolutos', v_level, v_big, v_sandra),
         -- A fourth, for the cross-pool tests: they need a turma that is not
         -- already meeting at 19:15, or the (turma, moment) unique index fires
         -- first and the exclusion constraint never gets asked.
         (v_org, v_season, v_central, 'Masters',   v_level, v_big, v_sandra),
         (v_org, v_season, v_central, 'Hidro',     v_level, v_big, v_sandra);
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — the resolved instructor is generated, and the substitute wins
--
-- It has to be a real column for the exclusion constraint to index it, and
-- generated rather than copied so no code path can write a session whose
-- resolved instructor disagrees with the two columns behind it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_turma uuid; v_pool uuid; v_sandra uuid; v_joao uuid;
        v_session uuid; v_resolved uuid;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';
  SELECT id INTO v_turma FROM class_group
   WHERE organization_id = v_org AND name = 'Cadetes';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org AND name = 'Tanque Grande';
  SELECT id INTO v_sandra FROM membership WHERE organization_id = v_org AND first_name = 'Sandra';
  SELECT id INTO v_joao FROM membership WHERE organization_id = v_org AND first_name = 'João';

  INSERT INTO class_session
    (organization_id, class_group_id, pool_id, starts_at, duration_minutes,
     instructor_membership_id, occurs_on)
  VALUES (v_org, v_turma, v_pool, '2026-09-08 19:15:00+01', 45, v_sandra, '2026-09-08')
  RETURNING id INTO v_session;

  SELECT resolved_instructor_id INTO v_resolved FROM class_session WHERE id = v_session;
  IF v_resolved <> v_sandra THEN
    RAISE EXCEPTION 'FAIL test 1a: resolved instructor is %, not Sandra', v_resolved;
  END IF;

  -- On the night she is away, the person who cannot also be in the learner tank
  -- is the person actually standing there.
  UPDATE class_session SET substitute_instructor_membership_id = v_joao WHERE id = v_session;

  SELECT resolved_instructor_id INTO v_resolved FROM class_session WHERE id = v_session;
  IF v_resolved <> v_joao THEN
    RAISE EXCEPTION 'FAIL test 1b: the substitute did not win, got %', v_resolved;
  END IF;

  UPDATE class_session SET substitute_instructor_membership_id = NULL WHERE id = v_session;

  RAISE NOTICE 'PASS test 1: resolved_instructor_id is generated and prefers the substitute';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — the club's ordinary Tuesday, which used to be refused
--
-- QA 51.4. Sandra on three adjacent lanes of one tank at 19:15. This is the
-- assertion the whole ticket turns on, and it fails against the constraint that
-- was here before.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_turma uuid; v_pool uuid; v_sandra uuid; n int;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';
  SELECT id INTO v_turma FROM class_group
   WHERE organization_id = v_org AND name = 'Cadetes';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org AND name = 'Tanque Grande';
  SELECT id INTO v_sandra FROM membership WHERE organization_id = v_org AND first_name = 'Sandra';

  -- Two more groups, same instructor, same tank, same moment.
  INSERT INTO class_session
    (organization_id, class_group_id, pool_id, starts_at, duration_minutes,
     instructor_membership_id, occurs_on)
  SELECT v_org, cg.id, v_pool, '2026-09-08 19:15:00+01', 45, v_sandra, '2026-09-08'
    FROM class_group cg
   WHERE cg.organization_id = v_org AND cg.name IN ('Infantis', 'Absolutos');

  SELECT count(*) INTO n FROM class_session
   WHERE organization_id = v_org AND resolved_instructor_id = v_sandra
     AND starts_at = '2026-09-08 19:15:00+01';

  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL test 2: expected three concurrent groups in one tank, got %', n;
  END IF;

  RAISE NOTICE 'PASS test 2: one instructor, three lanes of one pool, at once — allowed';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — two pools at once, and two facilities at once
--
-- QA 51.6 and 51.7. One person, one building. The second is covered by the same
-- constraint without a facility term, because two facilities means two pools.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_turma uuid; v_learner uuid; v_north uuid; v_sandra uuid; ok boolean;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';
  SELECT id INTO v_turma FROM class_group
   WHERE organization_id = v_org AND name = 'Masters';
  SELECT id INTO v_learner FROM pool
   WHERE organization_id = v_org AND name = 'Tanque de Aprendizagem';
  SELECT id INTO v_north FROM pool WHERE organization_id = v_org AND name = 'Tanque Norte';
  SELECT id INTO v_sandra FROM membership WHERE organization_id = v_org AND first_name = 'Sandra';

  ok := false;
  BEGIN
    INSERT INTO class_session
      (organization_id, class_group_id, pool_id, starts_at, duration_minutes,
       instructor_membership_id, occurs_on)
    VALUES (v_org, v_turma, v_learner, '2026-09-08 19:15:00+01', 45, v_sandra, '2026-09-08');
  EXCEPTION WHEN exclusion_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 3a: Sandra was accepted in a second tank at the same time';
  END IF;

  -- A partial overlap, not only an identical start. She cannot leave halfway.
  ok := false;
  BEGIN
    INSERT INTO class_session
      (organization_id, class_group_id, pool_id, starts_at, duration_minutes,
       instructor_membership_id, occurs_on)
    VALUES (v_org, v_turma, v_learner, '2026-09-08 19:45:00+01', 45, v_sandra, '2026-09-08');
  EXCEPTION WHEN exclusion_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 3b: a partial overlap across tanks was accepted';
  END IF;

  -- QA 51.7 — the other building, same moment.
  ok := false;
  BEGIN
    INSERT INTO class_session
      (organization_id, class_group_id, pool_id, starts_at, duration_minutes,
       instructor_membership_id, occurs_on)
    VALUES (v_org, v_turma, v_north, '2026-09-08 19:15:00+01', 45, v_sandra, '2026-09-08');
  EXCEPTION WHEN exclusion_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 3c: Sandra was accepted at a second facility at the same time';
  END IF;

  -- Back-to-back in another tank is fine. She walks across.
  INSERT INTO class_session
    (organization_id, class_group_id, pool_id, starts_at, duration_minutes,
     instructor_membership_id, occurs_on)
  VALUES (v_org, v_turma, v_learner, '2026-09-08 20:00:00+01', 45, v_sandra, '2026-09-08');

  RAISE NOTICE 'PASS test 3: two pools at once refused, back-to-back allowed';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — a cancelled session frees the instructor
--
-- QA 51.3, and the same rule the lane exclusion already follows: a class that is
-- not happening cannot be holding anybody.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_turma uuid; v_big uuid; v_learner uuid; v_sandra uuid;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';
  /*
   * A fresh turma for the insert, because the (turma, moment) unique index is
   * not partial on status — a cancelled 19:15 Cadetes row still occupies that
   * pair. What is being tested is the *instructor* constraint: cancelling the
   * three groups in the big tank frees Sandra for the learner tank.
   */
  SELECT id INTO v_turma FROM class_group
   WHERE organization_id = v_org AND name = 'Hidro';
  SELECT id INTO v_big FROM pool WHERE organization_id = v_org AND name = 'Tanque Grande';
  SELECT id INTO v_learner FROM pool
   WHERE organization_id = v_org AND name = 'Tanque de Aprendizagem';
  SELECT id INTO v_sandra FROM membership WHERE organization_id = v_org AND first_name = 'Sandra';

  UPDATE class_session SET status = 'cancelled'
   WHERE organization_id = v_org AND pool_id = v_big
     AND starts_at = '2026-09-08 19:15:00+01';

  INSERT INTO class_session
    (organization_id, class_group_id, pool_id, starts_at, duration_minutes,
     instructor_membership_id, occurs_on)
  VALUES (v_org, v_turma, v_learner, '2026-09-08 19:15:00+01', 45, v_sandra, '2026-09-08');

  RAISE NOTICE 'PASS test 4: cancelling the class frees the instructor';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — the constraint is per tenant, deliberately
--
-- Criterion 11, made structural. An exclusion constraint is enforced over the
-- whole table by its index with no RLS policy applied, so without the
-- `organization_id WITH =` term, tenant A booking somebody could be refused
-- because of a row in tenant B — leaking B's existence and refusing a booking A
-- is entitled to make.
--
-- A person teaching at two clubs that both use Poolse is therefore invisible to
-- both, and that is the decision rather than a gap.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_a uuid; v_b uuid; v_pool_b uuid; v_turma_b uuid; v_person_b uuid;
  v_facility_b uuid; v_season_b uuid; v_level_b uuid; v_shared uuid;
BEGIN
  v_a := '99999999-9999-9999-9999-999999999999';

  INSERT INTO organization (name, slug) VALUES ('Clube Vizinho C', 'clube-vizinho-c')
  RETURNING id INTO v_b;

  INSERT INTO facility (organization_id, name) VALUES (v_b, 'Piscina Vizinha')
  RETURNING id INTO v_facility_b;
  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_b, v_facility_b, 'Tanque Vizinho', 'indoor') RETURNING id INTO v_pool_b;
  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_b, '2026/2027', '2026-09-01', '2027-07-31', 'published') RETURNING id INTO v_season_b;
  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_b, 'Iniciação', 1) RETURNING id INTO v_level_b;

  -- The same human being, as far as the world is concerned — but a different
  -- membership row, because a membership belongs to one tenant.
  INSERT INTO membership (organization_id, first_name, last_name, email)
  VALUES (v_b, 'Sandra', 'Lopes', 'sandra@clube.pt') RETURNING id INTO v_person_b;

  INSERT INTO class_group
    (organization_id, season_id, facility_id, name, level_id, pool_id, instructor_membership_id)
  VALUES (v_b, v_season_b, v_facility_b, 'Vizinhos', v_level_b, v_pool_b, v_person_b)
  RETURNING id INTO v_turma_b;

  -- Tenant A already has Sandra teaching at 20:00 in the learner tank (test 3).
  -- Tenant B booking its own Sandra at the same moment must be entirely
  -- unaffected — a refusal here would be A's data reaching into B.
  INSERT INTO class_session
    (organization_id, class_group_id, pool_id, starts_at, duration_minutes,
     instructor_membership_id, occurs_on)
  VALUES (v_b, v_turma_b, v_pool_b, '2026-09-08 20:00:00+01', 45, v_person_b, '2026-09-08');

  RAISE NOTICE 'PASS test 5: the instructor rule stops at the tenant boundary, on purpose';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — the soft limit is nullable, and a limit is not a block
--
-- Criterion 4. Null means the club has no opinion; a number is something the
-- warning query reads, and nothing in the schema refuses a fourth group.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_central uuid; v_limit int; ok boolean;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';
  SELECT id INTO v_central FROM facility
   WHERE organization_id = v_org AND name = 'Piscina Central';

  SELECT max_concurrent_groups_per_instructor INTO v_limit
    FROM facility WHERE id = v_central;
  IF v_limit IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 6a: a club started with an opinion it never gave (%)', v_limit;
  END IF;

  UPDATE facility SET max_concurrent_groups_per_instructor = 3 WHERE id = v_central;

  -- Zero is not a policy, it is a typo.
  ok := false;
  BEGIN
    UPDATE facility SET max_concurrent_groups_per_instructor = 0 WHERE id = v_central;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 6b: a limit of zero was accepted';
  END IF;

  RAISE NOTICE 'PASS test 6: the concurrency limit is nullable, positive, and never a block';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — lane capacity per level overrides the lane's default
--
-- Criterion 5's data. The same level is a different density in a 25m tank and a
-- learner pool, which is why the number belongs to the pairing rather than to
-- either side of it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_lane uuid; v_level uuid; v_cap int;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';
  SELECT l.id INTO v_lane
    FROM lane l JOIN pool p ON p.id = l.pool_id
   WHERE l.organization_id = v_org AND p.name = 'Tanque Grande'
   LIMIT 1;
  SELECT id INTO v_level FROM student_level WHERE organization_id = v_org LIMIT 1;

  UPDATE lane SET default_capacity = 10 WHERE id = v_lane;

  INSERT INTO lane_level_capacity (organization_id, lane_id, level_id, capacity)
  VALUES (v_org, v_lane, v_level, 6);

  SELECT coalesce(llc.capacity, l.default_capacity) INTO v_cap
    FROM lane l
    LEFT JOIN lane_level_capacity llc
      ON llc.lane_id = l.id AND llc.level_id = v_level
   WHERE l.id = v_lane;

  IF v_cap <> 6 THEN
    RAISE EXCEPTION 'FAIL test 7: the per-level capacity did not override, got %', v_cap;
  END IF;

  RAISE NOTICE 'PASS test 7: lane capacity is overridable per level';
END $$;

ROLLBACK;
