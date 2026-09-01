-- Seasons — POOLSE-07.
--
-- Test 2 is the one to keep. `season_one_active` is what makes "the current
-- season" a question with one answer, and the reset depends on it: archive then
-- insert, in that order, inside one transaction. If the index were missing, a
-- half-finished reset would leave a club with two current seasons and every
-- screen that filters by one would have to guess.
--
-- Test 4 is the other. A reset must not touch anything: the ticket promises the
-- old year stays readable, and a cascade anywhere in this chain would quietly
-- turn "archive" into "delete" the first time a real club pressed the button.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES ('Clube Época', 'clube-epoca'),
                                             ('Clube Vizinho', 'clube-vizinho');

SELECT provision_app_user('user_season', 'season@clube.pt', 'Rita', 'Nunes', NULL,
                          '2026-08-26 09:00:00+00');

-- ---------------------------------------------------------------------------
-- Test 1: the migration gave every organization a season, and every turma is in it
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_seasons int; v_active int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-epoca';

  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, '2026/2027', DATE '2026-09-01', DATE '2027-08-31');

  SELECT count(*), count(*) FILTER (WHERE archived_at IS NULL)
    INTO v_seasons, v_active
    FROM season WHERE organization_id = v_org;

  IF v_seasons <> 1 OR v_active <> 1 THEN
    RAISE EXCEPTION 'FAIL test 1: expected one current season, got % of %', v_active, v_seasons;
  END IF;

  RAISE NOTICE 'PASS test 1: an organization has exactly one current season';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: two current seasons are refused
--
-- The guarantee the reset is built on. Not an application check — this must hold
-- even when two people press the button at the same moment.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-epoca';

  BEGIN
    INSERT INTO season (organization_id, name, starts_on, ends_on)
    VALUES (v_org, '2027/2028', DATE '2027-09-01', DATE '2028-08-31');
    RAISE EXCEPTION 'FAIL test 2: a second current season was allowed';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS test 2: a second current season is refused';
  END;

  -- Archive first and the same insert is fine. That ordering *is* the reset.
  -- Both columns — POOLSE-45. `status` is the state and `archived_at` is when;
  -- `season_retired_is_not_published` refuses a row that sets only one.
  UPDATE season SET status = 'archived', archived_at = now()
   WHERE organization_id = v_org AND status = 'published';

  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, '2027/2028', DATE '2027-09-01', DATE '2028-08-31');

  RAISE NOTICE 'PASS test 3: archiving first lets the next season open';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: a retired season keeps everything hanging off it
--
-- Turmas, sessions, enrolments and attendance all survive. This is the whole
-- promise on the confirmation screen, asserted rather than assumed.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_old uuid; v_new uuid;
  v_facility uuid; v_pool uuid; v_level uuid;
  v_user uuid; v_membership uuid; v_group uuid;
  v_student uuid; v_session uuid;
  v_groups int; v_sessions int; v_marks int; v_enrolments int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-vizinho';

  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, '2026/2027', DATE '2026-09-01', DATE '2027-08-31')
  RETURNING id INTO v_old;

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina')
  RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name)
  VALUES (v_org, v_facility, 'Tanque') RETURNING id INTO v_pool;
  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_org, 'Iniciação', 0) RETURNING id INTO v_level;

  SELECT id INTO v_user FROM app_user WHERE clerk_user_id = 'user_season';
  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_user, 'active') RETURNING id INTO v_membership;
  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_membership, 'instructor');

  INSERT INTO class_group (organization_id, season_id, name, pool_id, level_id,
                           instructor_membership_id, capacity)
  VALUES (v_org, v_old, 'Bebés', v_pool, v_level, v_membership, 8)
  RETURNING id INTO v_group;

  INSERT INTO student (organization_id, first_name, last_name, level_id)
  VALUES (v_org, 'Inês', 'Costa', v_level) RETURNING id INTO v_student;
  INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
  VALUES (v_org, v_group, v_student, 'active');

  -- `duration_minutes` is the stored value; `ends_at` is generated from it.
  INSERT INTO class_session (organization_id, class_group_id, pool_id,
                             starts_at, duration_minutes, status)
  VALUES (v_org, v_group, v_pool, TIMESTAMPTZ '2026-10-06 17:00:00+01', 45, 'scheduled')
  RETURNING id INTO v_session;

  INSERT INTO attendance (organization_id, class_session_id, student_id,
                          status, recorded_by_membership_id)
  VALUES (v_org, v_session, v_student, 'present', v_membership);

  -- The reset, exactly as the repository performs it.
  -- Both columns — POOLSE-45. `status` is the state and `archived_at` is when;
  -- `season_retired_is_not_published` refuses a row that sets only one.
  UPDATE season SET status = 'archived', archived_at = now()
   WHERE organization_id = v_org AND status = 'published';
  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, '2027/2028', DATE '2027-09-01', DATE '2028-08-31')
  RETURNING id INTO v_new;

  SELECT count(*) INTO v_groups FROM class_group WHERE season_id = v_old;
  SELECT count(*) INTO v_sessions FROM class_session WHERE class_group_id = v_group;
  SELECT count(*) INTO v_enrolments FROM enrollment WHERE class_group_id = v_group;
  SELECT count(*) INTO v_marks FROM attendance WHERE class_session_id = v_session;

  IF v_groups <> 1 OR v_sessions <> 1 OR v_enrolments <> 1 OR v_marks <> 1 THEN
    RAISE EXCEPTION
      'FAIL test 4: a reset deleted something — % groups, % sessions, % enrolments, % marks',
      v_groups, v_sessions, v_enrolments, v_marks;
  END IF;

  -- And the new season is empty because nothing points at it, not because
  -- anything was emptied.
  SELECT count(*) INTO v_groups FROM class_group WHERE season_id = v_new;
  IF v_groups <> 0 THEN
    RAISE EXCEPTION 'FAIL test 4: the new season is not empty (% turmas)', v_groups;
  END IF;

  RAISE NOTICE 'PASS test 4: a retired season keeps its turmas, sessions, enrolments and marks';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: a turma cannot join another tenant's season
--
-- The composite foreign key, not RLS. Both rows pass their own policy — only
-- `(organization_id, season_id)` stops the reference.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_a uuid; v_b uuid; v_season_b uuid;
  v_facility uuid; v_pool uuid; v_level uuid;
BEGIN
  SELECT id INTO v_a FROM organization WHERE slug = 'clube-epoca';
  SELECT id INTO v_b FROM organization WHERE slug = 'clube-vizinho';
  SELECT id INTO v_season_b FROM season
   WHERE organization_id = v_b AND archived_at IS NULL;

  INSERT INTO facility (organization_id, name) VALUES (v_a, 'Piscina A')
  RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name)
  VALUES (v_a, v_facility, 'Tanque A') RETURNING id INTO v_pool;
  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_a, 'Iniciação', 0) RETURNING id INTO v_level;

  BEGIN
    INSERT INTO class_group (organization_id, season_id, name, pool_id, level_id, capacity)
    VALUES (v_a, v_season_b, 'Roubada', v_pool, v_level, 8);
    RAISE EXCEPTION 'FAIL test 5: a turma joined another tenant''s season';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS test 5: a turma cannot join another tenant''s season';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: generate_sessions never extends a retired season
--
-- Without the join to `season`, the next press of "Gerar a época" would refill
-- last year's turmas and undo the reset.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_group uuid; v_before int; v_after int; v_made int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-vizinho';
  SELECT id INTO v_group FROM class_group WHERE organization_id = v_org;

  -- A weekly slot, so there would be plenty to generate if anything did.
  INSERT INTO class_schedule (organization_id, class_group_id, weekday,
                              start_time, duration_minutes)
  VALUES (v_org, v_group, 2, TIME '17:00', 45);

  SELECT count(*) INTO v_before FROM class_session WHERE class_group_id = v_group;

  SELECT o_created INTO v_made
    FROM generate_sessions(v_org, DATE '2026-09-01', DATE '2027-06-30');

  SELECT count(*) INTO v_after FROM class_session WHERE class_group_id = v_group;

  IF v_after <> v_before THEN
    RAISE EXCEPTION 'FAIL test 6: generate added % sessions to a retired season',
      v_after - v_before;
  END IF;

  RAISE NOTICE 'PASS test 6: generate_sessions leaves a retired season alone';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7: a new organization opens with a season
--
-- The hole `1787878800000_season-on-provision.sql` closed. Without it the very
-- first turma of every new customer would fail on a NOT NULL.
-- ---------------------------------------------------------------------------

SELECT provision_app_user('user_fresh', 'fresh@clube.pt', 'Nuno', 'Dias', NULL,
                          '2026-08-26 09:00:00+00');

DO $$
DECLARE
  v_org uuid; v_seasons int;
BEGIN
  SELECT o_organization_id INTO v_org
    FROM provision_organization('user_fresh', 'Clube Novo', 'pt-PT', 'Piscina Nova');

  SELECT count(*) INTO v_seasons
    FROM season WHERE organization_id = v_org AND archived_at IS NULL;

  IF v_seasons <> 1 THEN
    RAISE EXCEPTION 'FAIL test 7: a new organization got % current seasons', v_seasons;
  END IF;

  RAISE NOTICE 'PASS test 7: signing up opens a season';
END $$;

ROLLBACK;
