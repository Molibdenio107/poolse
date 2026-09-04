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

-- This fixture states its own plan. A subscription covers one facility by
-- default and `facility_licence` enforces it; nothing below is about billing,
-- so the plan is set out of the way. The limit is asserted in `facilities.sql`.
UPDATE organization SET max_facilities = 20;


INSERT INTO season (organization_id, name, starts_on, ends_on)
SELECT id, 'Época de teste', DATE '2020-01-01', DATE '2030-12-31'
  FROM organization WHERE slug IN ('clube-a', 'clube-b');
-- Deliberately wide. `generate_sessions` bounds its window by the season, and a
-- realistic September-to-August range would move the assertions below without
-- them being about seasons at all. That behaviour is asserted in seasons.sql.

DO $$
DECLARE v_org uuid; v_facility uuid; v_pool uuid; v_group uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  INSERT INTO facility (organization_id, name, timezone)
  VALUES (v_org, 'Piscina Municipal', 'Europe/Lisbon') RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name)
  VALUES (v_org, v_facility, 'Tanque Grande') RETURNING id INTO v_pool;

  -- POOLSE-43: the pool trigger gives position 1; a six-lane tank needs the rest.
  UPDATE lane SET name = 'Pista 1' WHERE pool_id = v_pool AND position = 1;
  INSERT INTO lane (organization_id, pool_id, name, position)
  SELECT v_org, v_pool, 'Pista ' || n, n FROM generate_series(2, 6) AS n;

  -- A season running a full year, so the generator has somewhere to run.
  INSERT INTO class_group (organization_id, season_id, name, pool_id, lane_id, capacity,
                           starts_on, ends_on)
  VALUES (v_org, (SELECT id FROM season WHERE organization_id = v_org AND archived_at IS NULL),
          'Iniciação', v_pool, (SELECT id FROM lane WHERE pool_id = v_pool AND position = 3), 8, DATE '2027-01-01', DATE '2027-12-31')
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
-- Tests 6 and 7 moved to bookings.sql — POOLSE-46
--
-- A session holds its lanes in `class_session_lane` now, because a booking may
-- span several, and `class_session_lane_free` moved onto that table with them.
-- Asserting the same guarantee from two files would mean two places to update
-- the next time it moves, so it is asserted once, where it lives:
-- `bookings.sql` tests 3 to 5.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Test 11 — removing this and all future occurrences — POOLSE-14
--
-- Three properties, and the middle one is the trap.
--
--   a. The past is untouched. "And all future" starts here and runs forward.
--   b. A class somebody has already marked is *skipped*, not failed. Slice 1.8
--      refuses to cancel a marked session with a trigger, so without the
--      NOT EXISTS the whole statement would abort and one register taken this
--      afternoon would refuse to remove a term.
--   c. The turma stops running. Cancelling rows alone is undone by the next
--      "Gerar a época" the moment the window extends past them, so ends_on moves
--      to the day before. That is what makes "future" mean the future rather
--      than "until somebody presses generate".
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_facility uuid; v_pool uuid; v_member uuid; v_group uuid;
  v_student uuid; v_past uuid; v_anchor uuid; v_marked uuid; v_later uuid;
  n int; v_ends date;
BEGIN
  INSERT INTO organization (name, slug) VALUES ('Clube Remoção', 'clube-remocao')
  RETURNING id INTO v_org;

  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, 'Época de teste', DATE '2020-01-01', DATE '2030-12-31');

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Sede')
  RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_org, v_facility, 'Tanque', 'indoor') RETURNING id INTO v_pool;

  SELECT provision_app_user('user_rem', 'r@rem.pt', 'Rita', 'Lopes', NULL, now()) INTO v_member;
  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_member, 'active') RETURNING id INTO v_member;

  INSERT INTO class_group (organization_id, season_id, name, pool_id,
                           instructor_membership_id, ends_on)
  VALUES (v_org, (SELECT id FROM season WHERE organization_id = v_org AND archived_at IS NULL),
          'Iniciação', v_pool, v_member, DATE '2027-06-30')
  RETURNING id INTO v_group;

  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'Ana', 'Costa') RETURNING id INTO v_student;

  -- One in the past, the anchor, one marked just after it, and one later.
  INSERT INTO class_session (organization_id, class_group_id, pool_id, starts_at,
                             duration_minutes, instructor_membership_id)
  VALUES (v_org, v_group, v_pool, TIMESTAMPTZ '2026-09-01 18:00:00+01', 45, v_member)
  RETURNING id INTO v_past;

  INSERT INTO class_session (organization_id, class_group_id, pool_id, starts_at,
                             duration_minutes, instructor_membership_id)
  VALUES (v_org, v_group, v_pool, TIMESTAMPTZ '2026-10-06 18:00:00+01', 45, v_member)
  RETURNING id INTO v_anchor;

  INSERT INTO class_session (organization_id, class_group_id, pool_id, starts_at,
                             duration_minutes, instructor_membership_id)
  VALUES (v_org, v_group, v_pool, TIMESTAMPTZ '2026-10-13 18:00:00+01', 45, v_member)
  RETURNING id INTO v_marked;

  INSERT INTO class_session (organization_id, class_group_id, pool_id, starts_at,
                             duration_minutes, instructor_membership_id)
  VALUES (v_org, v_group, v_pool, TIMESTAMPTZ '2026-10-20 18:00:00+01', 45, v_member)
  RETURNING id INTO v_later;

  INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                          recorded_by_membership_id)
  VALUES (v_org, v_marked, v_student, 'present', v_member);

  -- The removal: everything from the anchor forward that nobody has marked.
  UPDATE class_session cs
     SET status = 'cancelled', cancellation_reason = 'Turma encerrada'
   WHERE cs.class_group_id = v_group
     AND cs.starts_at >= (SELECT starts_at FROM class_session WHERE id = v_anchor)
     AND cs.status <> 'cancelled'
     AND NOT EXISTS (
           SELECT 1 FROM attendance a
            WHERE a.class_session_id = cs.id AND a.organization_id = cs.organization_id
         );

  -- a. The past is untouched.
  SELECT count(*) INTO n
    FROM class_session WHERE id = v_past AND status = 'scheduled';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 11a: a past occurrence was removed';
  END IF;

  -- b. The marked one survived, and the ones around it did not.
  SELECT count(*) INTO n
    FROM class_session WHERE id = v_marked AND status = 'scheduled';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 11b: a class with attendance recorded was removed';
  END IF;

  SELECT count(*) INTO n
    FROM class_session WHERE id IN (v_anchor, v_later) AND status = 'cancelled';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 11c: expected two removals, got %', n;
  END IF;

  -- c. The turma stops, and an earlier end date would not be pushed outwards.
  UPDATE class_group
     SET ends_on = least(coalesce(ends_on, DATE '9999-12-31'), DATE '2026-10-06' - 1)
   WHERE id = v_group;

  SELECT ends_on INTO v_ends FROM class_group WHERE id = v_group;
  IF v_ends <> DATE '2026-10-05' THEN
    RAISE EXCEPTION 'FAIL test 11d: the turma ends on % rather than the day before', v_ends;
  END IF;

  -- Removing again from a later date must not extend it back out.
  UPDATE class_group
     SET ends_on = least(coalesce(ends_on, DATE '9999-12-31'), DATE '2027-01-01' - 1)
   WHERE id = v_group;

  SELECT ends_on INTO v_ends FROM class_group WHERE id = v_group;
  IF v_ends <> DATE '2026-10-05' THEN
    RAISE EXCEPTION 'FAIL test 11e: a later removal pushed the end date out to %', v_ends;
  END IF;

  RAISE NOTICE 'PASS test 11: future removal spares the past and the marked, and stops the turma';
END $$;

-- ---------------------------------------------------------------------------
-- Test 13: closures do not overlap, and take effect on their own — POOLSE-31
--
-- Two closures over the same days is not a richer truth; it is a question
-- nobody can answer, because a cancelled class can only carry one reason. And a
-- closure that only bites at the next generation leaves this afternoon's class
-- standing after somebody has said the pool is shut.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_facility uuid; v_pool uuid; v_group uuid;
  v_first uuid; v_cancelled int; v_sessions int; v_marked int;
BEGIN
  INSERT INTO organization (name, slug) VALUES ('Clube Encerrado', 'clube-encerrado')
  RETURNING id INTO v_org;


  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, 'Época de teste', DATE '2020-01-01', DATE '2030-12-31');

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina')
  RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name)
  VALUES (v_org, v_facility, 'Tanque') RETURNING id INTO v_pool;

  INSERT INTO class_group (organization_id, season_id, name, pool_id, lane_id)
  VALUES (v_org, (SELECT id FROM season WHERE organization_id = v_org),
          'Iniciação', v_pool, (SELECT id FROM lane WHERE pool_id = v_pool AND position = 1))
  RETURNING id INTO v_group;

  -- A class inside the week we are about to close.
  INSERT INTO class_session (organization_id, class_group_id, pool_id,
                             starts_at, duration_minutes, status)
  VALUES (v_org, v_group, v_pool,
          TIMESTAMPTZ '2027-03-10 18:00:00+00', 45, 'scheduled');

  -- What it would cost, asked before committing.
  SELECT o_sessions, o_marked INTO v_sessions, v_marked
    FROM closure_impact(v_org, DATE '2027-03-08', DATE '2027-03-14', NULL);

  IF v_sessions <> 1 OR v_marked <> 0 THEN
    RAISE EXCEPTION 'FAIL test 13: impact said % sessions, % marked', v_sessions, v_marked;
  END IF;

  INSERT INTO closure (organization_id, starts_on, ends_on, reason, source)
  VALUES (v_org, DATE '2027-03-08', DATE '2027-03-14', 'Manutenção anual', 'manual')
  RETURNING id INTO v_first;

  -- Overlapping the same days, same reach, is refused by the database.
  BEGIN
    INSERT INTO closure (organization_id, starts_on, ends_on, reason, source)
    VALUES (v_org, DATE '2027-03-12', DATE '2027-03-20', 'Outra coisa', 'manual');
    RAISE EXCEPTION 'FAIL test 13: two closures covered the same days';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;

  -- Touching but not overlapping is fine — the day after is a different day.
  INSERT INTO closure (organization_id, starts_on, ends_on, reason, source)
  VALUES (v_org, DATE '2027-03-15', DATE '2027-03-20', 'Obras', 'manual');

  -- And the closure takes the class down on its own, without generating.
  SELECT apply_closure(v_org, v_first) INTO v_cancelled;
  IF v_cancelled <> 1 THEN
    RAISE EXCEPTION 'FAIL test 13: apply_closure cancelled % classes', v_cancelled;
  END IF;

  -- Stamped with the closure, which is what tells it apart from a class somebody
  -- removed by hand and what lets removing the closure give it back.
  IF NOT EXISTS (
    SELECT 1 FROM class_session
     WHERE class_group_id = v_group AND status = 'cancelled' AND closure_id = v_first
  ) THEN
    RAISE EXCEPTION 'FAIL test 13: the cancellation does not carry its closure';
  END IF;

  RAISE NOTICE 'PASS test 13: closures cannot overlap, and bite without a generation';
END $$;

ROLLBACK;
