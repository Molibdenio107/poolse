-- Closures and session generation — slices 1.5 and 1.6.
--
-- Test 2 is the one to keep above all the others. A class at 18:00 on the pool's
-- clock has to be 18:00 in January and 18:00 in July, which means two different
-- UTC instants. Get it wrong and every lesson in the summer term is an hour out,
-- silently, and the first anyone knows is a car park full of parents.
--
-- Test 5 is the second: closures are reversible. Adding August cancels its
-- classes; removing August brings them back — but a class an instructor called
-- off by hand stays cancelled, because that was a decision and not a rule.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES ('Clube A', 'clube-a'), ('Clube B', 'clube-b');

DO $$
DECLARE v_org uuid; v_facility uuid; v_pool uuid; v_group uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  INSERT INTO facility (organization_id, name, timezone)
  VALUES (v_org, 'Piscina Municipal', 'Europe/Lisbon') RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name, lane_count)
  VALUES (v_org, v_facility, 'Tanque Grande', 6) RETURNING id INTO v_pool;

  -- A season running a full year, so the generator has somewhere to run.
  INSERT INTO class_group (organization_id, name, pool_id, lane, capacity, starts_on, ends_on)
  VALUES (v_org, 'Iniciação', v_pool, 3, 8, DATE '2027-01-01', DATE '2027-12-31')
  RETURNING id INTO v_group;

  -- Tuesdays at 18:00, and Saturdays at 10:00 — a swimming school runs half its
  -- children's classes on a Saturday morning.
  INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_group, 2, TIME '18:00', 45),
         (v_org, v_group, 6, TIME '10:00', 45);
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — a year of sessions appears, on the right days
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; r record; n int; v_saturdays int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  SELECT o_created, o_cancelled, o_restored INTO r
    FROM generate_sessions(v_org, DATE '2027-01-01', DATE '2027-12-31');

  -- 52 Tuesdays and 52 Saturdays in 2027, near enough — the point is that a full
  -- year is generated rather than a 90-day window.
  IF r.o_created < 100 THEN
    RAISE EXCEPTION 'FAIL test 1a: only % sessions for a year of two-a-week', r.o_created;
  END IF;

  -- Every session lands on a Tuesday or a Saturday, in the facility's own zone.
  SELECT count(*) INTO n FROM class_session
   WHERE organization_id = v_org
     AND extract(ISODOW FROM (starts_at AT TIME ZONE 'Europe/Lisbon')) NOT IN (2, 6);
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 1b: % sessions fell on the wrong weekday', n;
  END IF;

  SELECT count(*) INTO v_saturdays FROM class_session
   WHERE organization_id = v_org
     AND extract(ISODOW FROM (starts_at AT TIME ZONE 'Europe/Lisbon')) = 6;
  IF v_saturdays < 40 THEN
    RAISE EXCEPTION 'FAIL test 1c: only % Saturday sessions in a year', v_saturdays;
  END IF;

  -- Running it again changes nothing: the whole thing is idempotent.
  SELECT o_created INTO r FROM generate_sessions(v_org, DATE '2027-01-01', DATE '2027-12-31');
  IF r.o_created <> 0 THEN
    RAISE EXCEPTION 'FAIL test 1d: a second run created % duplicates', r.o_created;
  END IF;

  RAISE NOTICE 'PASS test 1: a full year of sessions is generated, once, on the right days';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — the clock does not move when the clocks do
--
-- Keep this one. Wall-clock 18:00 in January and in July are different instants,
-- and a swimming school notices immediately when they are not.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_winter timestamptz; v_summer timestamptz; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  SELECT starts_at INTO v_winter FROM class_session
   WHERE organization_id = v_org
     AND (starts_at AT TIME ZONE 'Europe/Lisbon')::date = DATE '2027-01-12';
  SELECT starts_at INTO v_summer FROM class_session
   WHERE organization_id = v_org
     AND (starts_at AT TIME ZONE 'Europe/Lisbon')::date = DATE '2027-07-13';

  IF v_winter IS NULL OR v_summer IS NULL THEN
    RAISE EXCEPTION 'FAIL test 2a: expected a Tuesday class in January and in July';
  END IF;

  -- Different instants…
  IF (v_winter::time) = (v_summer::time) THEN
    RAISE EXCEPTION 'FAIL test 2b: January and July resolved to the same UTC time — DST ignored';
  END IF;

  -- …and the same time on the pool's clock, which is what anybody turning up
  -- actually experiences.
  SELECT count(*) INTO n FROM class_session
   WHERE organization_id = v_org
     AND extract(ISODOW FROM (starts_at AT TIME ZONE 'Europe/Lisbon')) = 2
     AND (starts_at AT TIME ZONE 'Europe/Lisbon')::time <> TIME '18:00';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 2c: % Tuesday classes are not at 18:00 local', n;
  END IF;

  RAISE NOTICE 'PASS test 2: 18:00 stays 18:00 on the pool clock, across the clock change';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — August is empty, and it repeats every year
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  INSERT INTO closure (organization_id, starts_on, ends_on, reason, repeats_annually)
  VALUES (v_org, DATE '2027-08-01', DATE '2027-08-31', 'Férias de agosto', true);

  PERFORM generate_sessions(v_org, DATE '2027-01-01', DATE '2027-12-31');

  SELECT count(*) INTO n FROM class_session
   WHERE organization_id = v_org
     AND status = 'scheduled'
     AND (starts_at AT TIME ZONE 'Europe/Lisbon')::date BETWEEN DATE '2027-08-01' AND DATE '2027-08-31';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 3a: % classes still scheduled in August', n;
  END IF;

  -- The recurring rule holds in a year the closure row never mentions.
  IF NOT closure_covers(DATE '2027-08-01', DATE '2027-08-31', true, DATE '2029-08-14') THEN
    RAISE EXCEPTION 'FAIL test 3b: an annual August closure missed August 2029';
  END IF;
  IF closure_covers(DATE '2027-08-01', DATE '2027-08-31', true, DATE '2029-09-14') THEN
    RAISE EXCEPTION 'FAIL test 3c: an August closure swallowed September';
  END IF;

  -- And a range that wraps the year end, which the naive comparison gets wrong.
  IF NOT closure_covers(DATE '2027-12-20', DATE '2028-01-05', true, DATE '2030-01-02') THEN
    RAISE EXCEPTION 'FAIL test 3d: a Christmas closure missed the January half of itself';
  END IF;

  RAISE NOTICE 'PASS test 3: August is empty, every year, and year-end ranges wrap correctly';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — a closure added after generation cancels what it covers
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; r record; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  INSERT INTO closure (organization_id, starts_on, ends_on, reason)
  VALUES (v_org, DATE '2027-04-05', DATE '2027-04-09', 'Interrupção da Páscoa');

  SELECT o_cancelled INTO r FROM generate_sessions(v_org, DATE '2027-01-01', DATE '2027-12-31');
  IF r.o_cancelled = 0 THEN
    RAISE EXCEPTION 'FAIL test 4a: a new closure cancelled nothing';
  END IF;

  SELECT count(*) INTO n FROM class_session
   WHERE organization_id = v_org
     AND status = 'cancelled'
     AND closure_id IS NOT NULL
     AND (starts_at AT TIME ZONE 'Europe/Lisbon')::date BETWEEN DATE '2027-04-05' AND DATE '2027-04-09';
  IF n = 0 THEN
    RAISE EXCEPTION 'FAIL test 4b: the Easter week is not marked as closed';
  END IF;

  RAISE NOTICE 'PASS test 4: a closure added later cancels the classes it covers';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — closures are reversible; a human cancellation is not
--
-- Keep this one. It is the difference between a rule and a decision: removing
-- August brings its classes back, and nothing brings back a class an instructor
-- called off.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_closure uuid; v_manual uuid; r record; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  -- One class called off by a person, with no closure behind it.
  SELECT id INTO v_manual FROM class_session
   WHERE organization_id = v_org AND status = 'scheduled'
     AND (starts_at AT TIME ZONE 'Europe/Lisbon')::date = DATE '2027-05-11';
  UPDATE class_session
     SET status = 'cancelled', cancellation_reason = 'Instrutora doente'
   WHERE id = v_manual;

  -- Now withdraw the Easter closure.
  SELECT id INTO v_closure FROM closure
   WHERE organization_id = v_org AND reason = 'Interrupção da Páscoa';
  UPDATE closure SET archived_at = now() WHERE id = v_closure;

  SELECT o_restored INTO r FROM generate_sessions(v_org, DATE '2027-01-01', DATE '2027-12-31');
  IF r.o_restored = 0 THEN
    RAISE EXCEPTION 'FAIL test 5a: removing a closure restored nothing';
  END IF;

  SELECT count(*) INTO n FROM class_session
   WHERE organization_id = v_org AND status = 'cancelled'
     AND (starts_at AT TIME ZONE 'Europe/Lisbon')::date BETWEEN DATE '2027-04-05' AND DATE '2027-04-09';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 5b: % Easter classes stayed cancelled', n;
  END IF;

  -- The human decision survives untouched.
  SELECT status::text, cancellation_reason INTO r FROM class_session WHERE id = v_manual;
  IF r.status <> 'cancelled' OR r.cancellation_reason <> 'Instrutora doente' THEN
    RAISE EXCEPTION 'FAIL test 5c: the generator overrode a cancellation made by a person';
  END IF;

  RAISE NOTICE 'PASS test 5: closures are reversible; a cancellation by a person is not';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — two turmas cannot hold the same lane at the same moment
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_pool uuid; v_other uuid; v_when timestamptz;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org;
  SELECT starts_at INTO v_when FROM class_session
   WHERE organization_id = v_org AND status = 'scheduled' LIMIT 1;

  INSERT INTO class_group (organization_id, name, pool_id, lane)
  VALUES (v_org, 'Outra Turma', v_pool, 3) RETURNING id INTO v_other;

  BEGIN
    INSERT INTO class_session (organization_id, class_group_id, pool_id, lane,
                               starts_at, duration_minutes)
    VALUES (v_org, v_other, v_pool, 3, v_when, 45);
    RAISE EXCEPTION 'FAIL test 6a: two turmas were put in lane 3 at the same time';
  EXCEPTION
    WHEN exclusion_violation THEN NULL;
  END;

  -- A different lane in the same pool at the same moment is fine.
  INSERT INTO class_session (organization_id, class_group_id, pool_id, lane,
                             starts_at, duration_minutes)
  VALUES (v_org, v_other, v_pool, 4, v_when, 45);

  RAISE NOTICE 'PASS test 6: a lane cannot be double-booked, and its neighbour is free';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — a cancelled class releases its lane
--
-- The reason this constraint lives on sessions and not on the weekly pattern: a
-- pattern has no way to say "except the 15th".
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_pool uuid; v_third uuid; v_when timestamptz;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org;
  SELECT starts_at INTO v_when FROM class_session
   WHERE organization_id = v_org AND lane = 4 LIMIT 1;

  UPDATE class_session SET status = 'cancelled', cancellation_reason = 'Gala'
   WHERE lane = 4 AND starts_at = v_when;

  INSERT INTO class_group (organization_id, name, pool_id, lane)
  VALUES (v_org, 'Turma de Substituição', v_pool, 4) RETURNING id INTO v_third;

  INSERT INTO class_session (organization_id, class_group_id, pool_id, lane,
                             starts_at, duration_minutes)
  VALUES (v_org, v_third, v_pool, 4, v_when, 45);

  RAISE NOTICE 'PASS test 7: a cancelled session frees its lane for another turma';
END $$;

-- ---------------------------------------------------------------------------
-- Test 9 — the national holidays, seeded the way the API seeds them
--
-- This is the endpoint's own statement, verbatim: the same ON CONFLICT against
-- the same partial index, so a re-run adds nothing. The dates come from the
-- TypeScript side (holidays.test.ts owns the computus); what is checked here is
-- what they do to the calendar.
--
-- And then the move that matters: a holiday is deleted, because plenty of
-- municipal pools open on the 5th of October, and the class comes back.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid;
  v_dates date[] := ARRAY[
    DATE '2027-01-01', DATE '2027-03-26', DATE '2027-03-28', DATE '2027-04-25',
    DATE '2027-05-01', DATE '2027-05-27', DATE '2027-06-10', DATE '2027-08-15',
    DATE '2027-10-05', DATE '2027-11-01', DATE '2027-12-01', DATE '2027-12-08',
    DATE '2027-12-25'
  ];
  v_date date;
  v_target date;
  v_before int;
  n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  -- Before anything: how many holidays actually land on a class day? If none
  -- did, everything below would pass without proving a thing.
  SELECT count(*) INTO v_before
    FROM unnest(v_dates) AS d(on_date)
   WHERE extract(ISODOW FROM d.on_date) IN (2, 6);

  IF v_before = 0 THEN
    RAISE EXCEPTION 'FAIL test 9a: no 2027 holiday falls on a Tuesday or Saturday';
  END IF;

  FOREACH v_date IN ARRAY v_dates LOOP
    INSERT INTO closure (organization_id, starts_on, ends_on, reason, source, repeats_annually)
    VALUES (v_org, v_date, v_date, 'Feriado', 'national_holiday', false)
    ON CONFLICT (organization_id, starts_on)
      WHERE source = 'national_holiday' AND archived_at IS NULL
      DO NOTHING;

    -- Twice, exactly as pressing the button twice would.
    INSERT INTO closure (organization_id, starts_on, ends_on, reason, source, repeats_annually)
    VALUES (v_org, v_date, v_date, 'Feriado', 'national_holiday', false)
    ON CONFLICT (organization_id, starts_on)
      WHERE source = 'national_holiday' AND archived_at IS NULL
      DO NOTHING;
  END LOOP;

  SELECT count(*) INTO n FROM closure
   WHERE organization_id = v_org AND source = 'national_holiday' AND archived_at IS NULL;
  IF n <> 13 THEN
    RAISE EXCEPTION 'FAIL test 9b: seeding twice left % holidays, expected 13', n;
  END IF;

  PERFORM generate_sessions(v_org, DATE '2027-01-01', DATE '2027-12-31');

  -- Not one class left standing on a national holiday.
  SELECT count(*) INTO n
    FROM class_session cs
   WHERE cs.organization_id = v_org
     AND cs.status <> 'cancelled'
     AND (cs.starts_at AT TIME ZONE 'Europe/Lisbon')::date = ANY (v_dates);
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 9c: % classes still scheduled on a national holiday', n;
  END IF;

  -- Now open on one of them. Pick a holiday that actually has a class, so the
  -- assertion below cannot pass by accident.
  SELECT d.on_date INTO v_target
    FROM unnest(v_dates) AS d(on_date)
   WHERE extract(ISODOW FROM d.on_date) IN (2, 6)
   ORDER BY d.on_date
   LIMIT 1;

  UPDATE closure SET archived_at = now()
   WHERE organization_id = v_org AND source = 'national_holiday' AND starts_on = v_target;

  PERFORM generate_sessions(v_org, DATE '2027-01-01', DATE '2027-12-31');

  SELECT count(*) INTO n
    FROM class_session cs
   WHERE cs.organization_id = v_org
     AND cs.status = 'scheduled'
     AND (cs.starts_at AT TIME ZONE 'Europe/Lisbon')::date = v_target;
  IF n = 0 THEN
    RAISE EXCEPTION 'FAIL test 9d: deleting the % holiday did not bring the class back', v_target;
  END IF;

  RAISE NOTICE 'PASS test 9: holidays close the pool, and deleting one opens it again (%)', v_target;
END $$;

-- ---------------------------------------------------------------------------
-- Test 10 — a closure is measured on the pool's calendar, not on UTC's
--
-- A late class in the Azores is the case that separates the two. In winter the
-- islands run at UTC−1, so 23:30 on a Tuesday in Ponta Delgada is 00:30 UTC on
-- the Wednesday, and a generator that asks "what UTC day is this?" steps straight
-- over a closure on that Tuesday — then cancels the class on a Wednesday nobody
-- closed. January, not June: Azores summer time is UTC+0, where the two answers
-- agree and the test would prove nothing. The assertion below enforces that.
--
-- Rare, and silent, which is exactly why it gets a test. The pool is in Portugal
-- either way; only its clock differs.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_facility uuid; v_pool uuid; v_group uuid;
  v_session uuid; v_status class_session_status; v_utc_date date;
BEGIN
  -- Its own organization, not Clube B: test 8 below proves Clube B sees nothing,
  -- and it can only prove that while Clube B owns nothing.
  INSERT INTO organization (name, slug) VALUES ('Clube C', 'clube-c') RETURNING id INTO v_org;

  INSERT INTO facility (organization_id, name, timezone)
  VALUES (v_org, 'Piscina dos Açores', 'Atlantic/Azores') RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name, lane_count)
  VALUES (v_org, v_facility, 'Tanque', 4) RETURNING id INTO v_pool;

  INSERT INTO class_group (organization_id, name, pool_id, lane)
  VALUES (v_org, 'Adultos Tarde', v_pool, 1) RETURNING id INTO v_group;

  -- Tuesday at 23:30. Late, and real: lane hire after the last children's class.
  INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_group, 2, TIME '23:30', 45);

  -- Generate first, with nothing in the way, so the row exists before the
  -- closure does. That is what puts the cancel pass — not the create pass — on
  -- the hook for getting the day right.
  PERFORM generate_sessions(v_org, DATE '2027-01-01', DATE '2027-01-31');

  SELECT id, (starts_at AT TIME ZONE 'UTC')::date
    INTO v_session, v_utc_date
    FROM class_session
   WHERE organization_id = v_org
     AND (starts_at AT TIME ZONE 'Atlantic/Azores')::date = DATE '2027-01-12';

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'FAIL test 10a: no class generated for Tuesday 12 January in the Azores';
  END IF;

  -- The premise of the test: the two answers really do differ.
  IF v_utc_date = DATE '2027-01-12' THEN
    RAISE EXCEPTION 'FAIL test 10b: the UTC date matches, so this proves nothing';
  END IF;

  INSERT INTO closure (organization_id, starts_on, ends_on, reason)
  VALUES (v_org, DATE '2027-01-12', DATE '2027-01-12', 'Manutenção');

  PERFORM generate_sessions(v_org, DATE '2027-01-01', DATE '2027-01-31');

  SELECT status INTO v_status FROM class_session WHERE id = v_session;
  IF v_status <> 'cancelled' THEN
    RAISE EXCEPTION 'FAIL test 10c: the Tuesday closure missed a 23:30 Azores class (UTC date %)', v_utc_date;
  END IF;

  RAISE NOTICE 'PASS test 10: closures follow the pool clock, not UTC (% local, % UTC)',
    DATE '2027-01-12', v_utc_date;
END $$;

-- ---------------------------------------------------------------------------
-- Test 8 — sessions and closures do not cross tenants
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE v_b uuid; n int;
BEGIN
  SET LOCAL ROLE postgres;
  SELECT id INTO v_b FROM organization WHERE name = 'Clube B';
  SET LOCAL ROLE poolse_app;

  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM class_session;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8a: Clube B read % of Clube A sessions', n;
  END IF;

  SELECT count(*) INTO n FROM closure;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8b: Clube B read % of Clube A closures', n;
  END IF;

  RAISE NOTICE 'PASS test 8: the calendar is invisible across tenants';
END $$;

RESET ROLE;

ROLLBACK;
