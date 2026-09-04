-- A booking is not only a turma — POOLSE-46.
--
-- The piece worth the most attention is the lane guarantee, because it moved.
-- `class_session_lane_free` was an exclusion constraint on `class_session` and
-- worked while a session had exactly one lane. A session across three lanes
-- needs three rows, so it moved onto the table that holds them — and an
-- exclusion constraint cannot reach into another table, so those rows carry
-- their own copy of the session's times.
--
-- **A copy is a thing that can go stale.** Shorten a session by ten minutes and
-- every lane row has to follow, or the constraint compares against a window
-- nobody is swimming in: the lane looks busy when it is free, or free when it is
-- busy. Test 4 is that trigger, and it is the reason this file exists.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_b', 'b@clube.pt', 'Rui', 'Fonseca', NULL, '2026-09-01 09:00:00+00');

INSERT INTO organization (id, name, slug) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Clube Marcações', 'clube-marcacoes'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Clube Vizinho B', 'clube-vizinho-b');

-- This fixture states its own plan. A subscription covers one facility by
-- default and `facility_licence` enforces it; nothing below is about billing,
-- so the plan is set out of the way. The limit is asserted in `facilities.sql`.
UPDATE organization SET max_facilities = 20;



DO $$
DECLARE v_org uuid; v_facility uuid; v_pool uuid; v_season uuid;
BEGIN
  v_org := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Municipal')
  RETURNING id INTO v_facility;

  INSERT INTO pool (organization_id, facility_id, name) VALUES (v_org, v_facility, 'Tanque Grande')
  RETURNING id INTO v_pool;

  -- Six lanes. Position 1 arrives with the pool; the rest are added.
  UPDATE lane SET name = 'Pista 1' WHERE pool_id = v_pool AND position = 1;
  INSERT INTO lane (organization_id, pool_id, name, position)
  SELECT v_org, v_pool, 'Pista ' || n, n FROM generate_series(2, 6) AS n;

  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, '2026/2027', '2026-09-01', '2027-08-31') RETURNING id INTO v_season;

  INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id)
  VALUES (v_org, v_season, v_facility, 'Absolutos', v_pool),
         (v_org, v_season, v_facility, 'Cadetes', v_pool),
         (v_org, v_season, v_facility, 'Infantis', v_pool);
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — a booking says what it is, and cannot say two things
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; v_group uuid;
BEGIN
  v_org := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org;
  SELECT id INTO v_group FROM class_group WHERE organization_id = v_org AND name = 'Absolutos';

  -- The ordinary case: a turma booking.
  INSERT INTO class_schedule
    (organization_id, class_group_id, facility_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_group, v_facility, 2, TIME '19:15', 45);

  -- A turma booking with no turma is not a turma booking.
  BEGIN
    INSERT INTO class_schedule
      (organization_id, facility_id, weekday, start_time, duration_minutes, subject_type)
    VALUES (v_org, v_facility, 3, TIME '19:15', 45, 'turma');
    RAISE EXCEPTION 'FAIL test 1a: a turma booking with no turma was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- An evento carries neither a turma nor a partner.
  INSERT INTO class_schedule
    (organization_id, facility_id, weekday, start_time, duration_minutes, subject_type, title)
  VALUES (v_org, v_facility, 6, TIME '09:00', 120, 'evento', 'Gala de Natal');

  BEGIN
    INSERT INTO class_schedule
      (organization_id, class_group_id, facility_id, weekday, start_time,
       duration_minutes, subject_type)
    VALUES (v_org, v_group, v_facility, 4, TIME '19:15', 45, 'evento');
    RAISE EXCEPTION 'FAIL test 1b: an evento was allowed to carry a turma';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 1: a booking is exactly one kind of thing';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — the opening-hours trigger reads the booking's own site
--
-- It reached the site through the turma, which returns nothing for a booking
-- that has none — and "nothing" meant "this site has no hours", so every
-- parceria and evento would have sailed past the check untested.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid;
BEGIN
  v_org := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org;

  -- A facility arrives with a full week of default hours, so this narrows the
  -- Friday it already has rather than inserting a second one.
  UPDATE facility_hours SET available = true, opens_at = TIME '08:00', closes_at = TIME '20:00'
   WHERE organization_id = v_org AND facility_id = v_facility AND weekday = 5;

  -- An evento outside those hours is refused, exactly as a turma would be.
  BEGIN
    INSERT INTO class_schedule
      (organization_id, facility_id, weekday, start_time, duration_minutes, subject_type, title)
    VALUES (v_org, v_facility, 5, TIME '21:00', 45, 'evento', 'Fora de horas');
    RAISE EXCEPTION 'FAIL test 2a: an evento outside opening hours was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- And one inside them is fine.
  INSERT INTO class_schedule
    (organization_id, facility_id, weekday, start_time, duration_minutes, subject_type, title)
  VALUES (v_org, v_facility, 5, TIME '18:00', 45, 'evento', 'Dentro de horas');

  RAISE NOTICE 'PASS test 2: the hours check applies to every kind of booking';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — a booking occupies one lane or several, and cannot share
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_pool uuid; v_group uuid; v_other uuid; v_a uuid; v_b uuid;
  v_when timestamptz := '2026-10-06 19:15:00+00';
  n int;
BEGIN
  v_org := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org;
  SELECT id INTO v_group FROM class_group WHERE organization_id = v_org AND name = 'Absolutos';
  SELECT id INTO v_other FROM class_group WHERE organization_id = v_org AND name = 'Cadetes';

  -- Hidroginástica across lanes 1 to 3, as one session.
  INSERT INTO class_session
    (organization_id, class_group_id, pool_id, starts_at, duration_minutes)
  VALUES (v_org, v_group, v_pool, v_when, 45) RETURNING id INTO v_a;

  INSERT INTO class_session_lane (organization_id, session_id, lane_id, starts_at, ends_at)
  SELECT v_org, v_a, l.id, v_when, v_when + interval '45 minutes'
    FROM lane l WHERE l.pool_id = v_pool AND l.position BETWEEN 1 AND 3;

  SELECT count(*) INTO n FROM class_session_lane WHERE session_id = v_a;
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL test 3a: expected 3 lane rows, got %', n;
  END IF;

  INSERT INTO class_session
    (organization_id, class_group_id, pool_id, starts_at, duration_minutes)
  VALUES (v_org, v_other, v_pool, v_when, 45) RETURNING id INTO v_b;

  -- Lane 2 is inside that span, so it is taken.
  BEGIN
    INSERT INTO class_session_lane (organization_id, session_id, lane_id, starts_at, ends_at)
    SELECT v_org, v_b, l.id, v_when, v_when + interval '45 minutes'
      FROM lane l WHERE l.pool_id = v_pool AND l.position = 2;
    RAISE EXCEPTION 'FAIL test 3b: a lane inside a multi-lane booking was taken twice';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;

  -- Lane 4 is not.
  INSERT INTO class_session_lane (organization_id, session_id, lane_id, starts_at, ends_at)
  SELECT v_org, v_b, l.id, v_when, v_when + interval '45 minutes'
    FROM lane l WHERE l.pool_id = v_pool AND l.position = 4;

  -- Neither is lane 2 an hour later.
  INSERT INTO class_session_lane (organization_id, session_id, lane_id, starts_at, ends_at)
  SELECT v_org, v_b, l.id, v_when + interval '45 minutes', v_when + interval '90 minutes'
    FROM lane l WHERE l.pool_id = v_pool AND l.position = 5;

  RAISE NOTICE 'PASS test 3: a booking spans lanes, and a spanned lane is taken';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — the copied times follow the session
--
-- The highest-risk piece of this ticket. The lane rows carry their own copy of
-- the session's window because an exclusion constraint cannot reach into another
-- table, and a copy nobody maintains is worse than no constraint at all: the
-- lane would look busy when it is free, or free when it is busy.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_pool uuid; v_group uuid; v_a uuid; v_c uuid;
  v_when timestamptz := '2026-10-06 19:15:00+00';
  v_ends timestamptz; n int;
BEGIN
  v_org := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org;
  SELECT id INTO v_group FROM class_group WHERE organization_id = v_org AND name = 'Absolutos';
  -- Named by its turma: created_at ties inside one transaction, because now()
  -- is the transaction's clock rather than the statement's.
  SELECT cs.id INTO v_a FROM class_session cs
    JOIN class_group cg ON cg.id = cs.class_group_id
   WHERE cs.organization_id = v_org AND cs.starts_at = v_when AND cg.name = 'Absolutos';

  -- Shortened from 45 minutes to 30.
  UPDATE class_session SET duration_minutes = 30 WHERE id = v_a;

  SELECT ends_at INTO v_ends FROM class_session WHERE id = v_a;

  SELECT count(*) INTO n FROM class_session_lane
   WHERE session_id = v_a AND ends_at = v_ends;
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL test 4a: only % of 3 lane rows followed the new end time', n;
  END IF;

  -- The freed quarter of an hour is genuinely free now.
  INSERT INTO class_session
    (organization_id, class_group_id, pool_id, starts_at, duration_minutes)
  VALUES (v_org, v_group, v_pool, v_when + interval '30 minutes', 15)
  RETURNING id INTO v_c;

  INSERT INTO class_session_lane (organization_id, session_id, lane_id, starts_at, ends_at)
  SELECT v_org, v_c, l.id, v_when + interval '30 minutes', v_when + interval '45 minutes'
    FROM lane l WHERE l.pool_id = v_pool AND l.position = 1;

  RAISE NOTICE 'PASS test 4: shortening a session moves every one of its lane rows';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — a cancelled session releases every lane it held
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_pool uuid; v_group uuid; v_a uuid; v_d uuid;
  v_when timestamptz := '2026-10-06 19:15:00+00';
  n int;
BEGIN
  v_org := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org;
  SELECT id INTO v_group FROM class_group WHERE organization_id = v_org AND name = 'Infantis';
  -- Named by its turma: created_at ties inside one transaction, because now()
  -- is the transaction's clock rather than the statement's.
  SELECT cs.id INTO v_a FROM class_session cs
    JOIN class_group cg ON cg.id = cs.class_group_id
   WHERE cs.organization_id = v_org AND cs.starts_at = v_when AND cg.name = 'Absolutos';

  UPDATE class_session SET status = 'cancelled' WHERE id = v_a;

  SELECT count(*) INTO n FROM class_session_lane
   WHERE session_id = v_a AND cancelled;
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL test 5a: only % of 3 lane rows were released', n;
  END IF;

  -- Lanes 2 and 3 were inside the cancelled span and nothing else holds them,
  -- so the whole window is free again. Lane 1 is deliberately left out: test 4
  -- put a short class on it, and that one is still running.
  INSERT INTO class_session
    (organization_id, class_group_id, pool_id, starts_at, duration_minutes)
  VALUES (v_org, v_group, v_pool, v_when, 45) RETURNING id INTO v_d;

  INSERT INTO class_session_lane (organization_id, session_id, lane_id, starts_at, ends_at)
  SELECT v_org, v_d, l.id, v_when, v_when + interval '45 minutes'
    FROM lane l WHERE l.pool_id = v_pool AND l.position IN (2, 3);

  RAISE NOTICE 'PASS test 5: cancelling frees every lane the session held';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — one booking per subject per moment, whatever the subject
--
-- The old index keyed on `class_group_id`, which stops constraining anything
-- once that column can be null: every evento would have been free to duplicate.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; v_group uuid;
BEGIN
  v_org := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org;
  SELECT id INTO v_group FROM class_group WHERE organization_id = v_org AND name = 'Absolutos';

  BEGIN
    INSERT INTO class_schedule
      (organization_id, class_group_id, facility_id, weekday, start_time, duration_minutes)
    VALUES (v_org, v_group, v_facility, 2, TIME '19:15', 45);
    RAISE EXCEPTION 'FAIL test 6: the same turma was booked twice at one moment';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 6: a subject is booked once per moment';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — none of it crosses the tenant boundary
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_facility_b uuid; v_lane_a uuid; v_schedule_a uuid;
BEGIN
  SELECT l.id INTO v_lane_a FROM lane l WHERE l.organization_id = v_a LIMIT 1;
  SELECT s.id INTO v_schedule_a FROM class_schedule s WHERE s.organization_id = v_a LIMIT 1;

  INSERT INTO facility (organization_id, name) VALUES (v_b, 'Piscina Vizinha')
  RETURNING id INTO v_facility_b;

  -- B cannot put its booking on A's lane.
  BEGIN
    INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
    VALUES (v_b, v_schedule_a, v_lane_a);
    RAISE EXCEPTION 'FAIL test 7a: a booking lane crossed the tenant boundary';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- Nor can it book its own class at A's site.
  BEGIN
    INSERT INTO class_schedule
      (organization_id, facility_id, weekday, start_time, duration_minutes, subject_type, title)
    VALUES (v_b, (SELECT id FROM facility WHERE organization_id = v_a LIMIT 1),
            2, TIME '19:15', 45, 'evento', 'Roubado');
    RAISE EXCEPTION 'FAIL test 7b: a booking was made at another club''s site';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 7: bookings and their lanes stay inside their tenant';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8 — the lane rows are visible only to their own tenant
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  n int;
BEGIN
  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM class_session_lane WHERE organization_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8a: the neighbouring club could read % of our lane rows', n;
  END IF;

  SELECT count(*) INTO n FROM booking_lane WHERE organization_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8b: the neighbouring club could read our booking lanes';
  END IF;

  PERFORM set_config('app.organization_id', v_a::text, true);

  SELECT count(*) INTO n FROM class_session_lane WHERE organization_id = v_a;
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL test 8c: our own lane rows were not visible to us';
  END IF;

  RAISE NOTICE 'PASS test 8: booking and session lanes are their tenant''s own';
END $$;

RESET ROLE;

ROLLBACK;
