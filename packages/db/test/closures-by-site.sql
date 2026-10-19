-- Closures by site or by tank — POOLSE-84.
--
-- The bug this ticket fixes is test 1: a club with two sites that shut one for
-- works cancelled classes at both, because a closure that named no tank named no
-- site either. Test 2 is the other half of the same hole: a tank closure only
-- ever matched `class_session.pool_id`, which a parceria or a free-swim block
-- does not have, so those ran on in a drained tank.
--
-- The site is set up so that one Tuesday carries every kind of session on the
-- closed tanks — a turma on each, a parceria (with and without a contact
-- address), a free-swim block and an aula experimental.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug, max_facilities)
VALUES ('c1c1c1c1-0000-0000-0000-000000000084', 'Clube Dois Sítios', 'clube-dois-sitios', 5);

DO $$
DECLARE
  v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
  v_season uuid; v_a uuid; v_b uuid;
  v_t1 uuid; v_t2 uuid; v_t3 uuid; v_b1 uuid;
  v_g uuid; v_partner uuid; v_quiet uuid; v_pg uuid; v_pg2 uuid; v_sch uuid;
BEGIN
  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_org, '2026/2027', DATE '2026-09-01', DATE '2027-07-31', 'published')
  RETURNING id INTO v_season;

  INSERT INTO facility (organization_id, name, timezone)
  VALUES (v_org, 'Sede', 'Europe/Lisbon') RETURNING id INTO v_a;
  INSERT INTO facility (organization_id, name, timezone)
  VALUES (v_org, 'Polo Norte', 'Europe/Lisbon') RETURNING id INTO v_b;

  UPDATE facility_hours SET available = true, opens_at = TIME '07:00', closes_at = TIME '22:00'
   WHERE organization_id = v_org;

  INSERT INTO pool (organization_id, facility_id, name) VALUES (v_org, v_a, 'Tanque 1') RETURNING id INTO v_t1;
  INSERT INTO pool (organization_id, facility_id, name) VALUES (v_org, v_a, 'Tanque 2') RETURNING id INTO v_t2;
  INSERT INTO pool (organization_id, facility_id, name) VALUES (v_org, v_a, 'Tanque 3') RETURNING id INTO v_t3;
  INSERT INTO pool (organization_id, facility_id, name) VALUES (v_org, v_b, 'Norte')    RETURNING id INTO v_b1;

  -- A turma on each tank, Tuesdays. Tanque 1 teaches at 10:00, 13:00 and 15:00
  -- — either side of the half-day cut, and exactly on it.
  INSERT INTO class_group (organization_id, season_id, name, pool_id, lane_id)
  VALUES (v_org, v_season, 'T1 manhã', v_t1, (SELECT id FROM lane WHERE pool_id = v_t1))
  RETURNING id INTO v_g;
  INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_g, 2, TIME '10:00', 45);

  INSERT INTO class_group (organization_id, season_id, name, pool_id, lane_id)
  VALUES (v_org, v_season, 'T1 uma', v_t1, (SELECT id FROM lane WHERE pool_id = v_t1))
  RETURNING id INTO v_g;
  INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_g, 2, TIME '13:00', 45);

  INSERT INTO class_group (organization_id, season_id, name, pool_id, lane_id)
  VALUES (v_org, v_season, 'T1 tarde', v_t1, (SELECT id FROM lane WHERE pool_id = v_t1))
  RETURNING id INTO v_g;
  INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_g, 2, TIME '15:00', 45);

  INSERT INTO class_group (organization_id, season_id, name, pool_id, lane_id)
  VALUES (v_org, v_season, 'T2 turma', v_t2, (SELECT id FROM lane WHERE pool_id = v_t2))
  RETURNING id INTO v_g;
  INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_g, 2, TIME '10:00', 45);

  INSERT INTO class_group (organization_id, season_id, name, pool_id, lane_id)
  VALUES (v_org, v_season, 'T3 turma', v_t3, (SELECT id FROM lane WHERE pool_id = v_t3))
  RETURNING id INTO v_g;
  INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_g, 2, TIME '10:00', 45);

  INSERT INTO class_group (organization_id, season_id, name, pool_id, lane_id)
  VALUES (v_org, v_season, 'Norte turma', v_b1, (SELECT id FROM lane WHERE pool_id = v_b1))
  RETURNING id INTO v_g;
  INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_g, 2, TIME '10:00', 45);

  -- A parceria on Tanque 2, reached only through its lane: no turma, no pool_id.
  INSERT INTO partner (organization_id, facility_id, name, type)
  VALUES (v_org, v_a, 'Escola do Bairro', 'escola') RETURNING id INTO v_partner;
  INSERT INTO partner_contact (organization_id, partner_id, name, email)
  VALUES (v_org, v_partner, 'Ana Coordenadora', 'ana@escola.pt');
  INSERT INTO partner_group (organization_id, partner_id, name, participant_count)
  VALUES (v_org, v_partner, '5.º A', 20) RETURNING id INTO v_pg;
  INSERT INTO class_schedule (organization_id, facility_id, weekday, start_time, duration_minutes,
                              subject_type, partner_group_id, season_id)
  VALUES (v_org, v_a, 2, TIME '11:00', 45, 'parceria', v_pg, v_season) RETURNING id INTO v_sch;
  INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
  VALUES (v_org, v_sch, (SELECT id FROM lane WHERE pool_id = v_t2));

  -- A second partner whose only contact has a phone and no address.
  INSERT INTO partner (organization_id, facility_id, name, type)
  VALUES (v_org, v_a, 'Lar Sem Email', 'ipss_misericordia') RETURNING id INTO v_quiet;
  INSERT INTO partner_contact (organization_id, partner_id, name, phone)
  VALUES (v_org, v_quiet, 'Sr. Telefone', '912345678');
  INSERT INTO partner_group (organization_id, partner_id, name, participant_count)
  VALUES (v_org, v_quiet, 'Seniores', 8) RETURNING id INTO v_pg2;
  INSERT INTO class_schedule (organization_id, facility_id, weekday, start_time, duration_minutes,
                              subject_type, partner_group_id, season_id)
  VALUES (v_org, v_a, 2, TIME '12:00', 45, 'parceria', v_pg2, v_season) RETURNING id INTO v_sch;
  INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
  VALUES (v_org, v_sch, (SELECT id FROM lane WHERE pool_id = v_t2));

  -- Water held for the public on Tanque 2.
  INSERT INTO class_schedule (organization_id, facility_id, weekday, start_time, duration_minutes,
                              subject_type, title)
  VALUES (v_org, v_a, 2, TIME '16:00', 60, 'free_swim', 'Natação livre') RETURNING id INTO v_sch;
  INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
  VALUES (v_org, v_sch, (SELECT id FROM lane WHERE pool_id = v_t2));

  -- March 2027: Tuesdays 2, 9, 16, 23 and 30.
  PERFORM generate_sessions(v_org, DATE '2027-03-01', DATE '2027-03-31');
END $$;

-- The tests read sessions by what they are and when, on the site's clock.
CREATE TEMP VIEW s84 AS
SELECT cs.id, cs.status, cs.closure_id,
       coalesce(cg.name, pg.name, sch.title) AS what,
       (cs.starts_at AT TIME ZONE 'Europe/Lisbon')::date AS day,
       to_char(cs.starts_at AT TIME ZONE 'Europe/Lisbon', 'HH24:MI') AS at
  FROM class_session cs
  LEFT JOIN class_group cg ON cg.id = cs.class_group_id
  LEFT JOIN class_schedule sch ON sch.id = cs.schedule_id
  LEFT JOIN partner_group pg ON pg.id = sch.partner_group_id
 WHERE cs.organization_id = 'c1c1c1c1-0000-0000-0000-000000000084';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM s84 WHERE day = DATE '2027-03-09';
  IF n <> 9 THEN
    RAISE EXCEPTION 'FAIL setup: expected 9 sessions on 09-03-2027, found %', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — closing one site leaves the other alone (QA 1, the bug)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
  v_a uuid; n int;
BEGIN
  SELECT id INTO v_a FROM facility WHERE organization_id = v_org AND name = 'Sede';

  INSERT INTO closure (organization_id, facility_id, starts_on, ends_on, reason)
  VALUES (v_org, v_a, DATE '2027-03-09', DATE '2027-03-09', 'Obras na Sede');
  PERFORM apply_closures(v_org);

  SELECT count(*) INTO n FROM s84 WHERE day = DATE '2027-03-09' AND status = 'cancelled';
  IF n <> 8 THEN
    RAISE EXCEPTION 'FAIL test 1a: closing the Sede cancelled % of its 8 sessions', n;
  END IF;
  IF (SELECT status FROM s84 WHERE day = DATE '2027-03-09' AND what = 'Norte turma') <> 'scheduled' THEN
    RAISE EXCEPTION 'FAIL test 1b: closing the Sede cancelled a class at Polo Norte';
  END IF;

  RAISE NOTICE 'PASS test 1: a site closure shuts that site and no other';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — two tanks ticked: two rows, every kind of session taken (QA 2, QA 8)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
  v_a uuid; v_batch uuid := gen_random_uuid(); r record;
BEGIN
  SELECT id INTO v_a FROM facility WHERE organization_id = v_org AND name = 'Sede';

  INSERT INTO closure (organization_id, facility_id, pool_id, starts_on, ends_on, reason, batch_id)
  SELECT v_org, v_a, p.id, DATE '2027-03-16', DATE '2027-03-16', 'Esvaziamento', v_batch
    FROM pool p WHERE p.facility_id = v_a AND p.name IN ('Tanque 1', 'Tanque 2');
  PERFORM apply_closures(v_org);

  FOR r IN SELECT what, status FROM s84 WHERE day = DATE '2027-03-16' LOOP
    IF r.what IN ('T3 turma', 'Norte turma') AND r.status <> 'scheduled' THEN
      RAISE EXCEPTION 'FAIL test 2a: % on an open tank was %', r.what, r.status;
    END IF;
    IF r.what NOT IN ('T3 turma', 'Norte turma') AND r.status <> 'cancelled' THEN
      RAISE EXCEPTION 'FAIL test 2b: % on a closed tank stayed %', r.what, r.status;
    END IF;
  END LOOP;

  -- The parcerias and the free swim are named: they are what the old rule missed.
  IF (SELECT count(*) FROM s84 WHERE day = DATE '2027-03-16' AND status = 'cancelled'
        AND what IN ('5.º A', 'Seniores', 'Natação livre')) <> 3 THEN
    RAISE EXCEPTION 'FAIL test 2c: a parceria or the free swim on Tanque 2 was not cancelled';
  END IF;

  RAISE NOTICE 'PASS test 2: two tanks closed are two rows, and every session on them stops';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — one tank reopens on its own (QA 3)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
  v_restored int;
BEGIN
  UPDATE closure SET archived_at = now()
   WHERE organization_id = v_org AND reason = 'Esvaziamento'
     AND pool_id = (SELECT id FROM pool WHERE organization_id = v_org AND name = 'Tanque 1');
  v_restored := release_closures(v_org);

  IF v_restored <> 3 THEN
    RAISE EXCEPTION 'FAIL test 3a: reopening Tanque 1 restored % sessions, not its 3', v_restored;
  END IF;
  IF EXISTS (SELECT 1 FROM s84 WHERE day = DATE '2027-03-16' AND what LIKE 'T1 %' AND status <> 'scheduled') THEN
    RAISE EXCEPTION 'FAIL test 3b: a Tanque 1 class stayed cancelled';
  END IF;
  IF EXISTS (SELECT 1 FROM s84 WHERE day = DATE '2027-03-16'
                AND what IN ('T2 turma', '5.º A', 'Natação livre') AND status <> 'cancelled') THEN
    RAISE EXCEPTION 'FAIL test 3c: reopening Tanque 1 reopened Tanque 2';
  END IF;

  RAISE NOTICE 'PASS test 3: removing one tank''s closure gives back that tank only';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — shortening gives back exactly the days it no longer covers (QA 4)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
  v_a uuid; v_t2 uuid; v_id uuid;
BEGIN
  SELECT id INTO v_a FROM facility WHERE organization_id = v_org AND name = 'Sede';
  SELECT id INTO v_t2 FROM pool WHERE organization_id = v_org AND name = 'Tanque 2';

  INSERT INTO closure (organization_id, facility_id, pool_id, starts_on, ends_on, reason)
  VALUES (v_org, v_a, v_t2, DATE '2027-03-22', DATE '2027-03-31', 'Reparação')
  RETURNING id INTO v_id;
  PERFORM apply_closures(v_org, v_id);

  IF (SELECT count(*) FROM s84 WHERE day IN (DATE '2027-03-23', DATE '2027-03-30')
        AND what = 'T2 turma' AND status = 'cancelled') <> 2 THEN
    RAISE EXCEPTION 'FAIL test 4a: the fortnight did not take both Tuesdays';
  END IF;

  -- Two days shorter: the 30th is back, the 23rd is not.
  UPDATE closure SET ends_on = DATE '2027-03-28' WHERE id = v_id;
  PERFORM release_closures(v_org);

  IF (SELECT status FROM s84 WHERE day = DATE '2027-03-30' AND what = 'T2 turma') <> 'scheduled' THEN
    RAISE EXCEPTION 'FAIL test 4b: the day the closure gave back stayed cancelled';
  END IF;
  IF (SELECT status FROM s84 WHERE day = DATE '2027-03-23' AND what = 'T2 turma') <> 'cancelled' THEN
    RAISE EXCEPTION 'FAIL test 4c: shortening reopened a day still covered';
  END IF;

  RAISE NOTICE 'PASS test 4: shortening a closure gives back the days it left';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — a morning is before 13:00, judged on the start (QA 5)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
  v_a uuid; v_t1 uuid;
BEGIN
  SELECT id INTO v_a FROM facility WHERE organization_id = v_org AND name = 'Sede';
  SELECT id INTO v_t1 FROM pool WHERE organization_id = v_org AND name = 'Tanque 1';

  INSERT INTO closure (organization_id, facility_id, pool_id, starts_on, ends_on, reason, part_of_day)
  VALUES (v_org, v_a, v_t1, DATE '2027-03-02', DATE '2027-03-02', 'Análise de manhã', 'morning');
  PERFORM apply_closures(v_org);

  IF (SELECT status FROM s84 WHERE day = DATE '2027-03-02' AND what = 'T1 manhã') <> 'cancelled' THEN
    RAISE EXCEPTION 'FAIL test 5a: the 10:00 class survived a morning closure';
  END IF;
  IF EXISTS (SELECT 1 FROM s84 WHERE day = DATE '2027-03-02'
                AND what IN ('T1 uma', 'T1 tarde') AND status <> 'scheduled') THEN
    RAISE EXCEPTION 'FAIL test 5b: a class at or after 13:00 was taken by a morning';
  END IF;

  RAISE NOTICE 'PASS test 5: a morning closure takes what starts before 13:00, and nothing after';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — morning and afternoon coexist; a whole day over them does not (QA 6)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
  v_a uuid; v_t1 uuid; v_t3 uuid;
BEGIN
  SELECT id INTO v_a FROM facility WHERE organization_id = v_org AND name = 'Sede';
  SELECT id INTO v_t1 FROM pool WHERE organization_id = v_org AND name = 'Tanque 1';
  SELECT id INTO v_t3 FROM pool WHERE organization_id = v_org AND name = 'Tanque 3';

  INSERT INTO closure (organization_id, facility_id, pool_id, starts_on, ends_on, reason, part_of_day)
  VALUES (v_org, v_a, v_t1, DATE '2027-03-02', DATE '2027-03-02', 'Análise à tarde', 'afternoon');

  BEGIN
    INSERT INTO closure (organization_id, facility_id, pool_id, starts_on, ends_on, reason)
    VALUES (v_org, v_a, v_t1, DATE '2027-03-02', DATE '2027-03-02', 'O dia todo');
    RAISE EXCEPTION 'FAIL test 6a: a whole day was stored over two halves';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO closure (organization_id, facility_id, pool_id, starts_on, ends_on, reason, part_of_day)
    VALUES (v_org, v_a, v_t1, DATE '2027-03-02', DATE '2027-03-02', 'Outra manhã', 'morning');
    RAISE EXCEPTION 'FAIL test 6b: two mornings on one tank and day were stored';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;

  -- Another tank, the same day: no conflict.
  INSERT INTO closure (organization_id, facility_id, pool_id, starts_on, ends_on, reason)
  VALUES (v_org, v_a, v_t3, DATE '2027-03-02', DATE '2027-03-02', 'Tanque 3 fechado');

  -- A tank inside its site's closure is redundant, not a conflict.
  INSERT INTO closure (organization_id, facility_id, pool_id, starts_on, ends_on, reason)
  VALUES (v_org, v_a, v_t3, DATE '2027-03-09', DATE '2027-03-09', 'Tanque 3 também');

  RAISE NOTICE 'PASS test 6: halves of one day coexist, a whole day over them is refused';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — a half day is one day; a manual closure names a site; a tank is at
-- its site (QA 7, QA 12)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
  v_a uuid; v_b1 uuid;
BEGIN
  SELECT id INTO v_a FROM facility WHERE organization_id = v_org AND name = 'Sede';
  SELECT id INTO v_b1 FROM pool WHERE organization_id = v_org AND name = 'Norte';

  BEGIN
    INSERT INTO closure (organization_id, facility_id, starts_on, ends_on, reason, part_of_day)
    VALUES (v_org, v_a, DATE '2027-04-05', DATE '2027-04-06', 'Duas manhãs', 'morning');
    RAISE EXCEPTION 'FAIL test 7a: a half day across two days was stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO closure (organization_id, starts_on, ends_on, reason)
    VALUES (v_org, DATE '2027-04-05', DATE '2027-04-05', 'Em todo o lado');
    RAISE EXCEPTION 'FAIL test 7b: a manual closure with no site was stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO closure (organization_id, facility_id, pool_id, starts_on, ends_on, reason)
    VALUES (v_org, v_a, v_b1, DATE '2027-04-05', DATE '2027-04-05', 'Tanque de outro sítio');
    RAISE EXCEPTION 'FAIL test 7c: a closure put a tank at the wrong site';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 7: half days are single days, and every manual closure has its site';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8 — a holiday still shuts every site
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
BEGIN
  INSERT INTO closure (organization_id, starts_on, ends_on, reason, source)
  VALUES (v_org, DATE '2027-03-23', DATE '2027-03-23', 'Feriado de teste', 'national_holiday');
  PERFORM apply_closures(v_org);

  IF EXISTS (SELECT 1 FROM s84 WHERE day = DATE '2027-03-23' AND status = 'scheduled') THEN
    RAISE EXCEPTION 'FAIL test 8: a holiday left a class running somewhere';
  END IF;

  RAISE NOTICE 'PASS test 8: a national holiday is still the whole organization''s';
END $$;

-- ---------------------------------------------------------------------------
-- Test 9 — a tank closure inside a site closure: removing it keeps the tank shut
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
  v_session uuid; v_stamp uuid; v_site uuid;
BEGIN
  SELECT id INTO v_site FROM closure WHERE organization_id = v_org AND reason = 'Obras na Sede';
  PERFORM apply_closures(v_org);

  -- T3's 9 March lesson was taken by the site closure first (the older), so the
  -- redundant tank closure stamped nothing; stamp it to the tank closure to make
  -- the case, then remove the tank closure.
  SELECT id INTO v_session FROM s84 WHERE day = DATE '2027-03-09' AND what = 'T3 turma';
  UPDATE class_session SET closure_id =
    (SELECT id FROM closure WHERE organization_id = v_org AND reason = 'Tanque 3 também')
   WHERE id = v_session;
  UPDATE closure SET archived_at = now() WHERE organization_id = v_org AND reason = 'Tanque 3 também';
  PERFORM release_closures(v_org);

  SELECT closure_id INTO v_stamp FROM class_session WHERE id = v_session;
  IF (SELECT status FROM class_session WHERE id = v_session) <> 'cancelled' OR v_stamp <> v_site THEN
    RAISE EXCEPTION 'FAIL test 9: removing a tank closure reopened a tank its site keeps shut';
  END IF;

  RAISE NOTICE 'PASS test 9: a lesson still under another closure is re-stamped, not restored';
END $$;

-- ---------------------------------------------------------------------------
-- Test 10 — what a tank says, and what a check-in asks (QA 9, QA 10)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
  v_t1 uuid; v_t2 uuid; v_t3 uuid; r record;
BEGIN
  SELECT id INTO v_t1 FROM pool WHERE organization_id = v_org AND name = 'Tanque 1';
  SELECT id INTO v_t2 FROM pool WHERE organization_id = v_org AND name = 'Tanque 2';
  SELECT id INTO v_t3 FROM pool WHERE organization_id = v_org AND name = 'Tanque 3';

  -- Tanque 2 is shut 22–28 March.
  SELECT * INTO r FROM pool_closure_at(v_org, v_t2, TIMESTAMPTZ '2027-03-24 10:00 Europe/Lisbon');
  IF r.closure_id IS NULL OR r.until <> DATE '2027-03-28' THEN
    RAISE EXCEPTION 'FAIL test 10a: a check-in on a shut tank was not told until when (%)', r.until;
  END IF;
  SELECT * INTO r FROM pool_closure_at(v_org, v_t3, TIMESTAMPTZ '2027-03-24 10:00 Europe/Lisbon');
  IF r.closure_id IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 10b: an open tank of the same site read as shut';
  END IF;

  -- A morning shuts the morning only.
  SELECT * INTO r FROM pool_closure_at(v_org, v_t1, TIMESTAMPTZ '2027-03-02 09:00 Europe/Lisbon');
  IF r.part_of_day IS DISTINCT FROM 'morning' THEN
    RAISE EXCEPTION 'FAIL test 10c: a 09:00 check-in missed the morning closure';
  END IF;

  -- The card's answer for a day: Tanque 2 shut, Tanque 3 not, Tanque 1 a half.
  IF NOT EXISTS (SELECT 1 FROM pool_closures_on(v_org, DATE '2027-03-24')
                  WHERE pool_id = v_t2 AND until = DATE '2027-03-28' AND part_of_day IS NULL)
     OR EXISTS (SELECT 1 FROM pool_closures_on(v_org, DATE '2027-03-24') WHERE pool_id = v_t3) THEN
    RAISE EXCEPTION 'FAIL test 10d: the tank card read the wrong closure';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pool_closures_on(v_org, DATE '2027-03-02')
                  WHERE pool_id = v_t1 AND part_of_day IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL test 10e: a half day did not reach the tank card';
  END IF;
  -- After the closure ends, nothing.
  IF EXISTS (SELECT 1 FROM pool_closures_on(v_org, DATE '2027-03-29') WHERE pool_id = v_t2) THEN
    RAISE EXCEPTION 'FAIL test 10f: the tank card still said shut after the closure';
  END IF;

  RAISE NOTICE 'PASS test 10: a tank knows when it is shut, and until when';
END $$;

-- ---------------------------------------------------------------------------
-- Test 11 — the impact count is the same rule (tanks, half days)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
  v_a uuid; v_t1 uuid; v_t2 uuid; n int;
BEGIN
  SELECT id INTO v_a FROM facility WHERE organization_id = v_org AND name = 'Sede';
  SELECT id INTO v_t1 FROM pool WHERE organization_id = v_org AND name = 'Tanque 1';
  SELECT id INTO v_t2 FROM pool WHERE organization_id = v_org AND name = 'Tanque 2';

  -- 30 March is open everywhere: Sede has 8 sessions that day.
  SELECT o_sessions INTO n FROM closure_impact(v_org, DATE '2027-03-30', DATE '2027-03-30', v_a);
  IF n <> 8 THEN RAISE EXCEPTION 'FAIL test 11a: the whole Sede would take %, not 8', n; END IF;

  SELECT o_sessions INTO n
    FROM closure_impact(v_org, DATE '2027-03-30', DATE '2027-03-30', v_a, ARRAY[v_t1, v_t2]);
  IF n <> 7 THEN RAISE EXCEPTION 'FAIL test 11b: Tanques 1 and 2 would take %, not 7', n; END IF;

  SELECT o_sessions INTO n
    FROM closure_impact(v_org, DATE '2027-03-30', DATE '2027-03-30', v_a, ARRAY[v_t1], 'afternoon');
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL test 11c: Tanque 1 in the afternoon would take %, not 2', n; END IF;

  RAISE NOTICE 'PASS test 11: what a closure would cost is counted by the same rule';
END $$;

-- ---------------------------------------------------------------------------
-- Test 12 — the warning reaches families, partners and trial leads (QA 8)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
  v_a uuid; v_t2 uuid; v_batch uuid := gen_random_uuid(); v_closure uuid;
  v_session uuid; n int;
BEGIN
  SELECT id INTO v_a FROM facility WHERE organization_id = v_org AND name = 'Sede';
  SELECT id INTO v_t2 FROM pool WHERE organization_id = v_org AND name = 'Tanque 2';
  SELECT id INTO v_session FROM s84 WHERE day = DATE '2027-03-30' AND what = 'T2 turma';

  INSERT INTO lead (organization_id, facility_id, swimmer_first_name, swimmer_last_name,
                    swimmer_birth_date, guardian_name, email, consent_text_version, consented_at,
                    status, trial_session_id, decided_at)
  VALUES (v_org, v_a, 'Rita', 'Experimental', DATE '2018-05-01', 'Mãe da Rita',
          'mae.rita@example.pt', 'v1', now(), 'trial_booked', v_session, now());

  INSERT INTO closure (organization_id, facility_id, pool_id, starts_on, ends_on, reason, batch_id)
  VALUES (v_org, v_a, v_t2, DATE '2027-03-30', DATE '2027-03-30', 'Avaria', v_batch)
  RETURNING id INTO v_closure;
  PERFORM apply_closures(v_org);

  SELECT count(*) INTO n FROM message_recipients(v_org, 'closure', NULL, NULL, NULL, v_closure)
   WHERE partner_id IS NOT NULL AND email = 'ana@escola.pt';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL test 12a: the partner contact was not reached'; END IF;

  SELECT count(*) INTO n FROM message_recipients(v_org, 'closure', NULL, NULL, NULL, v_closure)
   WHERE partner_id IS NOT NULL AND email IS NULL AND student_name = 'Lar Sem Email';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 12b: a partner with no address was skipped, not counted';
  END IF;

  SELECT count(*) INTO n FROM message_recipients(v_org, 'closure', NULL, NULL, NULL, v_closure)
   WHERE lead_id IS NOT NULL AND email = 'mae.rita@example.pt' AND name = 'Mãe da Rita';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL test 12c: the trial lead was not reached'; END IF;

  -- No other audience ever yields a partner or a lead.
  SELECT count(*) INTO n FROM message_recipients(v_org, 'organization', NULL, NULL, NULL, NULL)
   WHERE partner_id IS NOT NULL OR lead_id IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 12d: the whole-club audience reached a partner'; END IF;

  RAISE NOTICE 'PASS test 12: a closure warns families, partners and trial leads';
END $$;

-- ---------------------------------------------------------------------------
-- Test 13 — a lesson reached by lanes alone is still at its site
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
  v_a uuid; v_session uuid; r record;
BEGIN
  SELECT id INTO v_a FROM facility WHERE organization_id = v_org AND name = 'Sede';
  INSERT INTO class_session (organization_id, starts_at, duration_minutes, occurs_on)
  VALUES (v_org, TIMESTAMPTZ '2027-04-13 18:00 Europe/Lisbon', 45, DATE '2027-04-13')
  RETURNING id INTO v_session;
  INSERT INTO class_session_lane (organization_id, session_id, lane_id, starts_at, ends_at)
  SELECT v_org, v_session, l.id, TIMESTAMPTZ '2027-04-13 18:00 Europe/Lisbon',
         TIMESTAMPTZ '2027-04-13 18:45 Europe/Lisbon'
    FROM lane l JOIN pool p ON p.id = l.pool_id WHERE p.name = 'Tanque 3' AND p.organization_id = v_org;

  SELECT * INTO r FROM session_reach(v_org, v_session);
  IF r.facility_id IS DISTINCT FROM v_a OR cardinality(r.pool_ids) <> 1 THEN
    RAISE EXCEPTION 'FAIL test 13: a session on a lane alone had no site';
  END IF;

  RAISE NOTICE 'PASS test 13: a session reached only through its lanes knows its site';
END $$;

-- ---------------------------------------------------------------------------
-- Test 14 — none of it crosses tenants
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
  v_other uuid; v_other_site uuid;
BEGIN
  INSERT INTO organization (name, slug) VALUES ('Clube Alheio', 'clube-alheio-84')
  RETURNING id INTO v_other;
  INSERT INTO facility (organization_id, name) VALUES (v_other, 'Alheia') RETURNING id INTO v_other_site;

  BEGIN
    INSERT INTO closure (organization_id, facility_id, starts_on, ends_on, reason)
    VALUES (v_org, v_other_site, DATE '2027-05-04', DATE '2027-05-04', 'Do vizinho');
    RAISE EXCEPTION 'FAIL test 14: a closure named another club''s site';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 14: a closure cannot name another club''s site';
END $$;

-- ---------------------------------------------------------------------------
-- Test 15 — 19-10-2026 sweep: lifting a closure gives back only what still
-- exists, one lesson at a time, and never touches the past
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
  v_a uuid; v_t2 uuid; v_t3 uuid; v_closure uuid; v_t3_session uuid; v_t2_session uuid;
  v_intruder uuid; v_restored int; v_past uuid; v_old uuid;
BEGIN
  SELECT id INTO v_a FROM facility WHERE organization_id = v_org AND name = 'Sede';
  SELECT id INTO v_t2 FROM pool WHERE organization_id = v_org AND name = 'Tanque 2';
  SELECT id INTO v_t3 FROM pool WHERE organization_id = v_org AND name = 'Tanque 3';
  PERFORM generate_sessions(v_org, DATE '2027-05-01', DATE '2027-05-31');

  INSERT INTO closure (organization_id, facility_id, starts_on, ends_on, reason)
  VALUES (v_org, v_a, DATE '2027-05-04', DATE '2027-05-04', 'Avaria geral')
  RETURNING id INTO v_closure;
  PERFORM apply_closures(v_org, v_closure);

  -- The T3 turma's slot is removed while the closure holds its week.
  SELECT id INTO v_t3_session FROM s84 WHERE day = DATE '2027-05-04' AND what = 'T3 turma';
  UPDATE class_schedule SET archived_at = now()
   WHERE id = (SELECT schedule_id FROM class_session WHERE id = v_t3_session);

  -- And T2's lane is taken at that hour while its lesson is cancelled. The
  -- lesson holds its lane as a generated booking does (released while cancelled).
  SELECT id INTO v_t2_session FROM s84 WHERE day = DATE '2027-05-04' AND what = 'T2 turma';
  INSERT INTO class_session_lane (organization_id, session_id, lane_id, starts_at, ends_at, cancelled)
  SELECT v_org, cs.id, l.id, cs.starts_at, cs.ends_at, true
    FROM class_session cs, lane l WHERE cs.id = v_t2_session AND l.pool_id = v_t2;
  INSERT INTO class_session (organization_id, starts_at, duration_minutes, occurs_on)
  SELECT v_org, starts_at, duration_minutes, occurs_on FROM class_session WHERE id = v_t2_session
  RETURNING id INTO v_intruder;
  INSERT INTO class_session_lane (organization_id, session_id, lane_id, starts_at, ends_at)
  SELECT v_org, v_intruder, l.id, cs.starts_at, cs.ends_at
    FROM class_session cs, lane l WHERE cs.id = v_intruder AND l.pool_id = v_t2;

  UPDATE closure SET archived_at = now() WHERE id = v_closure;
  v_restored := release_closures(v_org);

  IF (SELECT status FROM class_session WHERE id = v_t3_session) <> 'cancelled' THEN
    RAISE EXCEPTION 'FAIL test 15a: lifting the closure brought back a removed slot''s lesson';
  END IF;
  IF (SELECT status FROM class_session WHERE id = v_t2_session) <> 'cancelled' THEN
    RAISE EXCEPTION 'FAIL test 15b: a lesson whose lane was taken came back on top of it';
  END IF;
  IF (SELECT status FROM s84 WHERE day = DATE '2027-05-04' AND what = 'Norte turma') <> 'scheduled'
     OR (SELECT status FROM s84 WHERE day = DATE '2027-05-04' AND what = 'T1 manhã') <> 'scheduled' THEN
    RAISE EXCEPTION 'FAIL test 15c: the lessons that could come back did not';
  END IF;

  -- The past is history: a closure made over last year changes nothing there.
  INSERT INTO class_session (organization_id, starts_at, duration_minutes, occurs_on, pool_id)
  VALUES (v_org, TIMESTAMPTZ '2024-05-07 10:00 Europe/Lisbon', 45, DATE '2024-05-07', v_t3)
  RETURNING id INTO v_past;
  INSERT INTO closure (organization_id, facility_id, starts_on, ends_on, reason, repeats_annually)
  VALUES (v_org, v_a, DATE '2027-05-07', DATE '2027-05-07', 'Todos os anos', true)
  RETURNING id INTO v_old;
  PERFORM apply_closures(v_org, v_old);
  IF (SELECT status FROM class_session WHERE id = v_past) <> 'scheduled' THEN
    RAISE EXCEPTION 'FAIL test 15d: an annual closure rewrote a lesson from 2024';
  END IF;

  RAISE NOTICE 'PASS test 15: lifting a closure gives back what still exists and fits, and the past stays';
END $$;

-- Sweep 19-10-2026b: a morning closure and an afternoon closure on the same day
-- shut the day between them, for every day-level reader.
DO $$
DECLARE
  v_org  uuid := 'c1c1c1c1-0000-0000-0000-000000000084';
  v_site uuid; v_tank uuid;
BEGIN
  SELECT id INTO v_site FROM facility WHERE organization_id = v_org AND name = 'Polo Norte';
  SELECT id INTO v_tank FROM pool WHERE organization_id = v_org AND name = 'Norte';

  INSERT INTO closure (organization_id, facility_id, pool_id, starts_on, ends_on, reason, part_of_day)
  VALUES (v_org, v_site, v_tank, DATE '2027-06-15', DATE '2027-06-15', 'Manhã', 'morning');
  IF closure_day_shut(v_org, v_site, ARRAY[v_tank], DATE '2027-06-15') THEN
    RAISE EXCEPTION 'FAIL test 16a: a morning alone shut the whole day';
  END IF;

  INSERT INTO closure (organization_id, facility_id, pool_id, starts_on, ends_on, reason, part_of_day)
  VALUES (v_org, v_site, v_tank, DATE '2027-06-15', DATE '2027-06-15', 'Tarde', 'afternoon');
  IF NOT closure_day_shut(v_org, v_site, ARRAY[v_tank], DATE '2027-06-15') THEN
    RAISE EXCEPTION 'FAIL test 16b: a morning and an afternoon closure left the day open';
  END IF;
  IF closure_day_shut(v_org, v_site, '{}'::uuid[], DATE '2027-06-15') THEN
    RAISE EXCEPTION 'FAIL test 16c: two tank closures shut the whole site';
  END IF;

  RAISE NOTICE 'PASS test 16: a morning and an afternoon closure shut the day together, and only their tank';
END $$;

ROLLBACK;
