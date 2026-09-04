-- When a site is open — round 4.
--
-- The rule under test is narrow and its edges are where the value is: disabling
-- a weekday must stop *new* classes and must not touch, refuse or delete the
-- ones already on that day. That asymmetry is the decision this feature was
-- built around, and it is the thing a later refactor is most likely to
-- accidentally symmetrise — a well-meaning "also validate on update" or a filter
-- added to `generate_sessions` would each break it in a way no type checker sees.
--
-- Tests 4 and 5 are therefore the ones worth keeping if this file is ever cut
-- down: they assert what must *keep working* after the rule exists.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_h', 'h@clube.pt', 'Rui', 'Fonseca', NULL, '2026-08-29 09:00:00+00');

-- Fixed ids, not generated ones. Test 6 runs as `poolse_app` with RLS on, and
-- under RLS a lookup by name returns nothing — so an id read *inside* that test
-- would be null and the test would pass for the wrong reason. Written down here,
-- while we are still the owner, they cannot be.
INSERT INTO organization (id, name, slug) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Clube Horas', 'clube-horas'),
  ('22222222-2222-2222-2222-222222222222', 'Clube Vizinho', 'clube-vizinho');

-- This fixture states its own plan. A subscription covers one facility by
-- default and `facility_licence` enforces it; nothing below is about billing,
-- so the plan is set out of the way. The limit is asserted in `facilities.sql`.
UPDATE organization SET max_facilities = 20;



-- ---------------------------------------------------------------------------
-- Test 1 — a new site arrives with all seven days, open
--
-- The seeding trigger is what lets every reader of this table be a plain SELECT
-- rather than a SELECT plus a defaulting rule. If it stops firing, nothing
-- breaks loudly — a missing row just reads as "no restriction" in whichever of
-- the three readers has not been taught to default. So it is asserted directly.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; n int; v_open int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube Horas';

  INSERT INTO facility (organization_id, name, timezone)
  VALUES (v_org, 'Piscina Municipal', 'Europe/Lisbon')
  RETURNING id INTO v_facility;

  SELECT count(*) INTO n FROM facility_hours WHERE facility_id = v_facility;
  IF n <> 7 THEN
    RAISE EXCEPTION 'FAIL test 1a: expected 7 days, got %', n;
  END IF;

  SELECT count(*) INTO v_open
    FROM facility_hours WHERE facility_id = v_facility AND available;
  IF v_open <> 7 THEN
    RAISE EXCEPTION 'FAIL test 1b: a new site should open every day, % were open', v_open;
  END IF;

  -- "Nobody has narrowed this yet", not an invented 08:00–22:00 that would
  -- silently invalidate a late class somebody already runs.
  PERFORM 1 FROM facility_hours
   WHERE facility_id = v_facility
     AND (opens_at <> TIME '00:00' OR closes_at <> TIME '24:00');
  IF FOUND THEN
    RAISE EXCEPTION 'FAIL test 1c: default hours are not the whole day';
  END IF;

  RAISE NOTICE 'PASS test 1: a new site opens seven days, all day, until somebody says otherwise';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — a closed day refuses a new class, an open one accepts it
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_facility uuid; v_pool uuid; v_season uuid; v_group uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube Horas';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org AND name = 'Piscina Municipal';

  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_org, v_facility, 'Tanque Grande', 'indoor') RETURNING id INTO v_pool;

  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, '2026/27', DATE '2026-09-01', DATE '2027-07-31') RETURNING id INTO v_season;

  INSERT INTO class_group (organization_id, season_id, name, pool_id)
  VALUES (v_org, v_season, 'Iniciação', v_pool) RETURNING id INTO v_group;

  -- Sunday off — the ask this whole feature came from.
  UPDATE facility_hours SET available = false
   WHERE facility_id = v_facility AND weekday = 7;

  BEGIN
    INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
    VALUES (v_org, v_group, 7, TIME '10:00', 45);
    RAISE EXCEPTION 'FAIL test 2a: a class was scheduled on a day the site does not open';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Monday is untouched and still works.
  INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_group, 1, TIME '10:00', 45);

  RAISE NOTICE 'PASS test 2: a closed day refuses a new class and leaves the other six alone';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — opening hours bound the start AND the end
--
-- Round 4 reversed the original decision here. Hours used to bound only the
-- start, so a lesson could run past closing; the operator setting the hours is
-- describing when the building is staffed, and a class scheduled to finish after
-- the lights go off is the error the hours exist to catch. The end is inclusive
-- — a class may finish exactly at closing, because that is the last lesson and
-- refusing it would make every operator set closing a minute late.
--
-- The wrap past midnight is the case worth having a test for: `time '23:30' +
-- interval '60 minutes'` is `00:30`, which compares as *before* every closing
-- time. The check works in minutes-from-midnight so that a class ending at 24:30
-- is 1470 and is plainly too late.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; v_group uuid; v_schedule uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube Horas';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org AND name = 'Piscina Municipal';
  SELECT id INTO v_group FROM class_group WHERE organization_id = v_org AND name = 'Iniciação';

  UPDATE facility_hours SET opens_at = TIME '08:00', closes_at = TIME '21:00'
   WHERE facility_id = v_facility AND weekday = 2;

  BEGIN
    INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
    VALUES (v_org, v_group, 2, TIME '07:30', 45);
    RAISE EXCEPTION 'FAIL test 3a: a class started before the site opens';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
    VALUES (v_org, v_group, 2, TIME '21:00', 45);
    RAISE EXCEPTION 'FAIL test 3b: closing time is exclusive, a class started on it';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Starts inside the window, ends fifteen minutes after it. Refused now.
  BEGIN
    INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
    VALUES (v_org, v_group, 2, TIME '20:45', 45);
    RAISE EXCEPTION 'FAIL test 3c: a class was allowed to run past closing';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Ends exactly at closing. Allowed, on purpose: this is the last lesson.
  INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_group, 2, TIME '20:15', 45)
  RETURNING id INTO v_schedule;

  -- Lengthening it past closing must be refused too. This is the half that is
  -- easy to miss: without `duration_minutes` in the trigger's UPDATE OF list,
  -- the rule would hold for new rows only and an operator could stretch an
  -- existing class straight through the closing time.
  BEGIN
    UPDATE class_schedule SET duration_minutes = 60 WHERE id = v_schedule;
    RAISE EXCEPTION 'FAIL test 3d: an existing class was lengthened past closing';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 3: hours bound both when a class starts and when it finishes';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3b — a class that would end after midnight is refused, not wrapped
--
-- The specific bug the minutes-from-midnight arithmetic exists to prevent. On a
-- site open until 24:00, a 23:30 class of 45 minutes ends at 00:15 the next day.
-- Compared as a `time` that is 00:15, which is before every closing time in the
-- schema, so the naive check passes exactly the row it must refuse.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; v_group uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube Horas';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org AND name = 'Piscina Municipal';
  SELECT id INTO v_group FROM class_group WHERE organization_id = v_org AND name = 'Iniciação';

  -- Open all day, which is the default and the most permissive the hours get.
  UPDATE facility_hours SET opens_at = TIME '00:00', closes_at = TIME '24:00'
   WHERE facility_id = v_facility AND weekday = 3;

  BEGIN
    INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
    VALUES (v_org, v_group, 3, TIME '23:30', 45);
    RAISE EXCEPTION 'FAIL test 3e: a class ending after midnight wrapped and was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Ending exactly at midnight on a site open until 24:00 is fine: 1440 = 1440.
  INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_group, 3, TIME '23:15', 45);

  RAISE NOTICE 'PASS test 3b: midnight does not wrap — 00:15 is later than 24:00, not earlier';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — closing a day leaves the classes already on it alone
--
-- The decision, stated as a test. An operator who closes Saturday is told what
-- is already there and moves it deliberately; the database does not refuse the
-- change, and nothing disappears underneath them.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; v_group uuid; v_schedule uuid; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube Horas';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org AND name = 'Piscina Municipal';
  SELECT id INTO v_group FROM class_group WHERE organization_id = v_org AND name = 'Iniciação';

  INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_group, 6, TIME '09:00', 45) RETURNING id INTO v_schedule;

  -- The change itself must succeed. A constraint that refused this would put the
  -- operator in a deadlock: they cannot close the day until they move the class,
  -- and the reason they are moving the class is that the day is closing.
  UPDATE facility_hours SET available = false
   WHERE facility_id = v_facility AND weekday = 6;

  SELECT count(*) INTO n
    FROM class_schedule
   WHERE id = v_schedule AND archived_at IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 4a: closing a day removed a class that was already on it';
  END IF;

  -- And taking it off the closed day must work, which it would not if the
  -- trigger fired on every update rather than on the columns that matter.
  UPDATE class_schedule SET archived_at = now() WHERE id = v_schedule;

  RAISE NOTICE 'PASS test 4: closing a day blocks the next class, not the ones already there';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — a turma with no pool is bound by its site's hours all the same
--
-- This test used to assert the opposite, and it was right when it was written:
-- the trigger reached the site through `class_group.pool_id`, so a turma with no
-- lane decided yet had no site and no hours to break.
--
-- Round 4 gave `class_group` a facility of its own, which made that a hole
-- rather than a kindness — a class could be put on a day the building is shut
-- simply by not having chosen a lane. Round 5's trigger reads the turma's own
-- facility, so the rule now covers every turma at the site.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_season uuid; v_group uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube Horas';
  SELECT id INTO v_season FROM season WHERE organization_id = v_org AND archived_at IS NULL;

  INSERT INTO class_group (organization_id, facility_id, season_id, name)
  VALUES (v_org, (SELECT id FROM facility WHERE organization_id = v_org ORDER BY created_at, id LIMIT 1), v_season, 'Ainda sem piscina') RETURNING id INTO v_group;

  -- Sunday, which is closed at the only site this organization has.
  BEGIN
    INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
    VALUES (v_org, v_group, 7, TIME '10:00', 45);
    RAISE EXCEPTION 'FAIL test 5a: a turma with no pool escaped its site''s closed day';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- And a day the site does open still works, so the rule refuses the day
  -- rather than the turma.
  INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_group, 3, TIME '10:00', 45);

  RAISE NOTICE 'PASS test 5: a turma with no pool is bound by its own site''s hours';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — hours are the tenant's own
--
-- Every table in this schema gets this test, and this one earns it twice over:
-- it is read by a trigger, and a trigger that could see another tenant's row
-- would refuse or permit a class on somebody else's opening hours.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_a uuid := '11111111-1111-1111-1111-111111111111';
  v_b uuid := '22222222-2222-2222-2222-222222222222';
  n int;
BEGIN
  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM facility_hours WHERE organization_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6: the neighbouring club could read % rows of our hours', n;
  END IF;

  PERFORM set_config('app.organization_id', v_a::text, true);

  SELECT count(*) INTO n FROM facility_hours WHERE organization_id = v_a;
  IF n <> 7 THEN
    RAISE EXCEPTION 'FAIL test 6b: our own hours were not visible to us, got %', n;
  END IF;

  RAISE NOTICE 'PASS test 6: opening hours are visible only to the site''s own tenant';
END $$;

RESET ROLE;

ROLLBACK;
