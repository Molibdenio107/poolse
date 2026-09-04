-- Planning next year while this one runs — POOLSE-45.
--
-- Four things worth asserting rather than reading.
--
-- **A draft can exist beside the published season.** That is the feature, and it
-- is the thing the old `season_one_active` index refused: drafts are unarchived
-- too, so the index that made "the current season" meaningful also made planning
-- impossible.
--
-- **Publishing is atomic and ordered.** The incumbent must be archived before the
-- draft takes the slot, or the partial index refuses the second update — and a
-- moment with two published seasons, or none, is a moment where every screen
-- filtering by the current season is wrong.
--
-- **The generator refuses a draft.** Without it, a turma parked in next year's
-- plan puts two hundred phantom sessions on the calendar the club is using
-- today.
--
-- **`archived_at` still means when.** Status is the state; the timestamp is the
-- date a season was retired, and the reset flow writes it.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_d', 'd@clube.pt', 'Rui', 'Fonseca', NULL, '2026-09-01 09:00:00+00');

INSERT INTO organization (id, name, slug) VALUES
  ('99999999-9999-9999-9999-999999999999', 'Clube Épocas', 'clube-epocas');

-- This fixture states its own plan. A subscription covers one facility by
-- default and `facility_licence` enforces it; nothing below is about billing,
-- so the plan is set out of the way. The limit is asserted in `facilities.sql`.
UPDATE organization SET max_facilities = 20;



DO $$
DECLARE v_org uuid; v_facility uuid;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Municipal')
  RETURNING id INTO v_facility;

  INSERT INTO pool (organization_id, facility_id, name) VALUES (v_org, v_facility, 'Tanque');

  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, '2026/2027', '2026-09-01', '2027-08-31');
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — a draft sits beside the published season
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; n int; v_status season_status;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';

  SELECT status INTO v_status FROM season WHERE organization_id = v_org;
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'FAIL test 1a: the club''s only season is %, not published', v_status;
  END IF;

  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_org, '2027/2028', '2027-09-01', '2028-08-31', 'draft');

  SELECT count(*) INTO n FROM season WHERE organization_id = v_org;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 1b: expected two seasons, got %', n;
  END IF;

  -- A second draft is fine too: a club may plan more than one way.
  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_org, '2027/2028 (alternativa)', '2027-09-01', '2028-08-31', 'draft');

  RAISE NOTICE 'PASS test 1: drafts sit beside the published season, and beside each other';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — exactly one published season, enforced by the index
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';

  BEGIN
    INSERT INTO season (organization_id, name, starts_on, ends_on, status)
    VALUES (v_org, '2028/2029', '2028-09-01', '2029-08-31', 'published');
    RAISE EXCEPTION 'FAIL test 2: a second published season was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 2: only one season may be published at a time';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — publishing retires the incumbent, in one statement
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_draft uuid; v_old uuid; n int;
  v_status season_status; v_retired timestamptz;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';
  SELECT id INTO v_old FROM season WHERE organization_id = v_org AND status = 'published';
  SELECT id INTO v_draft FROM season
   WHERE organization_id = v_org AND name = '2027/2028';

  IF NOT publish_season(v_org, v_draft) THEN
    RAISE EXCEPTION 'FAIL test 3a: publishing returned false';
  END IF;

  SELECT count(*) INTO n FROM season WHERE organization_id = v_org AND status = 'published';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 3b: % published seasons after publishing', n;
  END IF;

  SELECT status INTO v_status FROM season WHERE id = v_draft;
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'FAIL test 3c: the draft is % rather than published', v_status;
  END IF;

  -- The retired one keeps its date, because `archived_at` says *when* and the
  -- status says what.
  SELECT status, archived_at INTO v_status, v_retired FROM season WHERE id = v_old;
  IF v_status <> 'archived' OR v_retired IS NULL THEN
    RAISE EXCEPTION 'FAIL test 3d: the old season is % with archived_at %', v_status, v_retired;
  END IF;

  -- The other draft is untouched.
  SELECT status INTO v_status FROM season
   WHERE organization_id = v_org AND name = '2027/2028 (alternativa)';
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'FAIL test 3e: the second draft became %', v_status;
  END IF;

  RAISE NOTICE 'PASS test 3: publishing retires the incumbent and leaves other drafts alone';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — publishing what is already published, and what cannot be
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_current uuid; v_archived uuid; n int;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';
  SELECT id INTO v_current FROM season WHERE organization_id = v_org AND status = 'published';
  SELECT id INTO v_archived FROM season WHERE organization_id = v_org AND status = 'archived' LIMIT 1;

  -- Idempotent: publishing the current season is not a change and not an error.
  IF NOT publish_season(v_org, v_current) THEN
    RAISE EXCEPTION 'FAIL test 4a: republishing the current season returned false';
  END IF;

  SELECT count(*) INTO n FROM season WHERE organization_id = v_org AND status = 'published';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 4b: % published seasons after a no-op publish', n;
  END IF;

  -- Un-retiring a season is a different operation and is not this one.
  BEGIN
    PERFORM publish_season(v_org, v_archived);
    RAISE EXCEPTION 'FAIL test 4c: an archived season was published';
  EXCEPTION WHEN raise_exception THEN
    IF sqlerrm LIKE 'FAIL test 4c%' THEN RAISE; END IF;
  END;

  -- A season from another club is simply not found.
  IF publish_season(v_org, gen_random_uuid()) THEN
    RAISE EXCEPTION 'FAIL test 4d: publishing an unknown season returned true';
  END IF;

  RAISE NOTICE 'PASS test 4: publishing is idempotent, and refuses an archived season';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — the generator will not run a draft
--
-- The failure this ticket exists to prevent: a turma parked in next year's plan
-- putting two hundred dated sessions on the calendar the club uses today.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_pool uuid; v_draft uuid; v_published uuid;
  v_group uuid; v_other uuid; r record; n int;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org;
  SELECT id INTO v_draft FROM season
   WHERE organization_id = v_org AND status = 'draft' LIMIT 1;
  SELECT id INTO v_published FROM season
   WHERE organization_id = v_org AND status = 'published';

  -- One turma in the plan, one in the season that is actually running.
  INSERT INTO class_group (organization_id, season_id, name, pool_id, lane_id, starts_on, ends_on)
  VALUES (v_org, v_draft, 'Turma Planeada', v_pool,
          (SELECT id FROM lane WHERE pool_id = v_pool AND position = 1),
          DATE '2027-10-01', DATE '2027-10-31')
  RETURNING id INTO v_group;

  INSERT INTO class_group (organization_id, season_id, name, pool_id, starts_on, ends_on)
  VALUES (v_org, v_published, 'Turma a Correr', v_pool, DATE '2027-10-01', DATE '2027-10-31')
  RETURNING id INTO v_other;

  INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_group, 2, TIME '18:00', 45),
         (v_org, v_other, 2, TIME '19:00', 45);

  SELECT o_created INTO r FROM generate_sessions(v_org, DATE '2027-10-01', DATE '2027-10-31');

  SELECT count(*) INTO n FROM class_session WHERE class_group_id = v_group;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 5a: the draft turma generated % sessions', n;
  END IF;

  SELECT count(*) INTO n FROM class_session WHERE class_group_id = v_other;
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL test 5b: the published turma generated nothing';
  END IF;

  RAISE NOTICE 'PASS test 5: a draft generates no sessions; the published season still does';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — an archived season stays fully readable
--
-- POOLSE-07's rule, unchanged: archived means "no longer current", not "gone".
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; n int;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';

  SELECT count(*) INTO n FROM season WHERE organization_id = v_org AND status = 'archived';
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL test 6: the retired season disappeared';
  END IF;

  RAISE NOTICE 'PASS test 6: an archived season is still there to be read';
END $$;

ROLLBACK;
