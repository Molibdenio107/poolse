-- The grid a schedule is written on — POOLSE-44.
--
-- Four things worth asserting rather than reading.
--
-- **Abutting is not overlapping.** A 45-minute pitch is 09:30–10:15 then
-- 10:15–11:00, and a constraint that called that a collision would refuse every
-- real grid on its first row. `int4range` is half-open, which is the whole
-- reason it was chosen over anything computed by hand.
--
-- **`24:00` works and `00:00` is refused.** Midnight-at-the-end arithmetics to
-- 1440; midnight-at-the-start arithmetics to 0 and would make an empty range the
-- exclusion silently ignores — a slot that overlaps everything and conflicts
-- with nothing.
--
-- **The day groups are independent**, so a Saturday grid can sit on the same
-- hours as a weekday one.
--
-- **The season is part of the key**, or a club could never draft next year.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_s', 's@clube.pt', 'Rui', 'Fonseca', NULL, '2026-09-01 09:00:00+00');

INSERT INTO organization (id, name, slug) VALUES
  ('77777777-7777-7777-7777-777777777777', 'Clube Grelha', 'clube-grelha'),
  ('88888888-8888-8888-8888-888888888888', 'Clube Vizinho S', 'clube-vizinho-s');

DO $$
DECLARE v_org uuid; v_facility uuid; v_season uuid;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Municipal')
  RETURNING id INTO v_facility;

  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, '2026/2027', '2026-09-01', '2027-08-31') RETURNING id INTO v_season;

  -- The reference club's weekday grid, gap and all.
  INSERT INTO facility_time_slot (organization_id, facility_id, season_id, day_group, start_time, end_time)
  VALUES
    (v_org, v_facility, v_season, 'weekday', '06:30', '07:15'),
    (v_org, v_facility, v_season, 'weekday', '08:45', '09:30'),
    (v_org, v_facility, v_season, 'weekday', '09:30', '10:15'),
    (v_org, v_facility, v_season, 'weekday', '10:15', '11:00'),
    (v_org, v_facility, v_season, 'weekday', '11:00', '11:45'),
    (v_org, v_facility, v_season, 'weekday', '11:45', '12:30'),
    -- The hole: nothing between 12:30 and 14:45, and nothing models it.
    (v_org, v_facility, v_season, 'weekday', '14:45', '15:30'),
    (v_org, v_facility, v_season, 'weekday', '21:00', '21:45');
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — abutting slots are accepted, and the gap is simply absent
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; n int;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';

  SELECT count(*) INTO n FROM facility_time_slot
   WHERE organization_id = v_org AND day_group = 'weekday' AND archived_at IS NULL;
  IF n <> 8 THEN
    RAISE EXCEPTION 'FAIL test 1a: expected 8 weekday slots, got %', n;
  END IF;

  -- Nothing covers 13:00. A gap is the absence of a row.
  SELECT count(*) INTO n FROM facility_time_slot
   WHERE organization_id = v_org AND start_time <= TIME '13:00' AND end_time > TIME '13:00';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 1b: something claimed to cover the lunchtime gap';
  END IF;

  RAISE NOTICE 'PASS test 1: abutting slots stand, and a gap is an absent row';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — an overlapping slot is refused
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; v_season uuid;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org;
  SELECT id INTO v_season FROM season WHERE organization_id = v_org;

  BEGIN
    INSERT INTO facility_time_slot (organization_id, facility_id, season_id, day_group, start_time, end_time)
    VALUES (v_org, v_facility, v_season, 'weekday', '10:00', '10:45');
    RAISE EXCEPTION 'FAIL test 2a: a slot overlapping 09:30-10:15 was accepted';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;

  -- Fully containing an existing slot is also an overlap.
  BEGIN
    INSERT INTO facility_time_slot (organization_id, facility_id, season_id, day_group, start_time, end_time)
    VALUES (v_org, v_facility, v_season, 'weekday', '09:00', '12:00');
    RAISE EXCEPTION 'FAIL test 2b: a slot swallowing four others was accepted';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;

  -- And the gap is genuinely free.
  INSERT INTO facility_time_slot (organization_id, facility_id, season_id, day_group, start_time, end_time)
  VALUES (v_org, v_facility, v_season, 'weekday', '13:00', '13:45');

  RAISE NOTICE 'PASS test 2: overlapping slots are refused; the gap accepts one';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — midnight, at both ends
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; v_season uuid;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org;
  SELECT id INTO v_season FROM season WHERE organization_id = v_org;

  -- A late lane-hire slot running to the end of the day. `24:00` is how that is
  -- written, and it arithmetics to 1440 rather than wrapping to zero.
  INSERT INTO facility_time_slot (organization_id, facility_id, season_id, day_group, start_time, end_time)
  VALUES (v_org, v_facility, v_season, 'weekday', '23:00', '24:00');

  -- The same slot written the wrong way is refused before it can become a row
  -- that overlaps everything and conflicts with nothing.
  BEGIN
    INSERT INTO facility_time_slot (organization_id, facility_id, season_id, day_group, start_time, end_time)
    VALUES (v_org, v_facility, v_season, 'saturday', '21:00', '00:00');
    RAISE EXCEPTION 'FAIL test 3b: a slot ending at 00:00 was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- And the 23:00 slot really is in the way of anything overlapping it.
  BEGIN
    INSERT INTO facility_time_slot (organization_id, facility_id, season_id, day_group, start_time, end_time)
    VALUES (v_org, v_facility, v_season, 'weekday', '23:30', '24:00');
    RAISE EXCEPTION 'FAIL test 3c: 24:00 produced a range that collides with nothing';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 3: 24:00 is a real end; 00:00 is refused';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — the three day groups are independent
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; v_season uuid; n int;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org;
  SELECT id INTO v_season FROM season WHERE organization_id = v_org;

  -- The reference club's weekend grid sits on hours the weekday one also uses.
  INSERT INTO facility_time_slot (organization_id, facility_id, season_id, day_group, start_time, end_time)
  VALUES (v_org, v_facility, v_season, 'saturday', '09:30', '10:15'),
         (v_org, v_facility, v_season, 'sunday',   '09:30', '10:15');

  SELECT count(*) INTO n FROM facility_time_slot
   WHERE organization_id = v_org AND start_time = TIME '09:30' AND archived_at IS NULL;
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL test 4: expected 09:30 in all three day groups, got %', n;
  END IF;

  RAISE NOTICE 'PASS test 4: weekday, Saturday and Sunday keep their own grids';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — next year's grid does not collide with this year's
--
-- Without `season_id` in the exclusion key a club could not plan ahead at all,
-- which is the whole reason slots belong to a season.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; v_next uuid;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org;

  -- `season_one_active` allows one unarchived season, so next year's is created
  -- archived here. POOLSE-45 replaces that index with a status.
  -- A draft, now that seasons have one — POOLSE-45. Before that this had to
  -- be inserted archived, because `season_one_active` allowed only one live row.
  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_org, '2027/2028', '2027-09-01', '2028-08-31', 'draft') RETURNING id INTO v_next;

  INSERT INTO facility_time_slot (organization_id, facility_id, season_id, day_group, start_time, end_time)
  VALUES (v_org, v_facility, v_next, 'weekday', '09:30', '10:15');

  RAISE NOTICE 'PASS test 5: a second season may reuse the same hours';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — an archived slot frees its hours
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; v_season uuid; n int;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org;
  SELECT id INTO v_season FROM season WHERE organization_id = v_org AND archived_at IS NULL;

  UPDATE facility_time_slot SET archived_at = now()
   WHERE season_id = v_season AND day_group = 'weekday' AND start_time = TIME '06:30';

  INSERT INTO facility_time_slot (organization_id, facility_id, season_id, day_group, start_time, end_time)
  VALUES (v_org, v_facility, v_season, 'weekday', '06:30', '07:15');

  SELECT count(*) INTO n FROM facility_time_slot
   WHERE season_id = v_season AND day_group = 'weekday' AND start_time = TIME '06:30';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 6: expected the archived slot and the new one, got %', n;
  END IF;

  RAISE NOTICE 'PASS test 6: an archived slot does not hold its hours hostage';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — a slot cannot be attached to another organization's site or season
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_a uuid := '77777777-7777-7777-7777-777777777777';
  v_b uuid := '88888888-8888-8888-8888-888888888888';
  v_facility_a uuid; v_season_a uuid; v_facility_b uuid; v_season_b uuid;
BEGIN
  SELECT id INTO v_facility_a FROM facility WHERE organization_id = v_a;
  SELECT id INTO v_season_a FROM season WHERE organization_id = v_a AND archived_at IS NULL;

  INSERT INTO facility (organization_id, name) VALUES (v_b, 'Piscina Vizinha')
  RETURNING id INTO v_facility_b;
  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_b, '2026/2027', '2026-09-01', '2027-08-31') RETURNING id INTO v_season_b;

  BEGIN
    INSERT INTO facility_time_slot (organization_id, facility_id, season_id, day_group, start_time, end_time)
    VALUES (v_b, v_facility_a, v_season_b, 'weekday', '18:00', '18:45');
    RAISE EXCEPTION 'FAIL test 7a: a slot was attached to another club''s site';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO facility_time_slot (organization_id, facility_id, season_id, day_group, start_time, end_time)
    VALUES (v_b, v_facility_b, v_season_a, 'weekday', '18:00', '18:45');
    RAISE EXCEPTION 'FAIL test 7b: a slot was attached to another club''s season';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 7: a slot cannot reach across the tenant boundary';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8 — slots are visible only to their own tenant
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_a uuid := '77777777-7777-7777-7777-777777777777';
  v_b uuid := '88888888-8888-8888-8888-888888888888';
  n int;
BEGIN
  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM facility_time_slot WHERE organization_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8a: the neighbouring club could read % of our slots', n;
  END IF;

  PERFORM set_config('app.organization_id', v_a::text, true);

  SELECT count(*) INTO n FROM facility_time_slot
   WHERE organization_id = v_a AND archived_at IS NULL;
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL test 8b: our own slots were not visible to us';
  END IF;

  RAISE NOTICE 'PASS test 8: slots are visible only to their own tenant';
END $$;

RESET ROLE;

ROLLBACK;
