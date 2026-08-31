-- What a student pays — POOLSE-42.
--
-- Three of these are worth keeping if the file is ever cut down.
--
-- **Test 2** is the arithmetic the whole ticket turns on: rounded once at the
-- period, never per month. €35,00 × 3 at 5 % is 99,75 €, and a well-meaning
-- refactor that rounds each month and sums produces 99,76 € — a cent that
-- becomes a telephone call from a parent.
--
-- **Test 5** is the snapshot. A line recomputing from the plan would change a
-- family's agreed bill retroactively the moment somebody fixed a typo in the
-- price list. Nothing in the type system stops that; this does.
--
-- **Test 8** is the tenant boundary on all three new tables.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_f', 'f@clube.pt', 'Rui', 'Fonseca', NULL, '2026-08-31 09:00:00+00');

-- Fixed ids for the same reason `facility-hours.sql` gives: test 8 runs as
-- `poolse_app` with RLS on, where a lookup by name returns nothing.
INSERT INTO organization (id, name, slug) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Clube Quotas', 'clube-quotas'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Clube Rival', 'clube-rival');

-- ---------------------------------------------------------------------------
-- Test 1 — a facility holds a price list and its periodicities
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_facility uuid; v_mensal uuid; v_trimestral uuid; v_anual uuid; v_level uuid; n int;
BEGIN
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Municipal')
  RETURNING id INTO v_facility;

  INSERT INTO fee_period (organization_id, facility_id, name, months, discount_percent, is_default, sort_order)
  VALUES (v_org, v_facility, 'Mensal', 1, 0, true, 1) RETURNING id INTO v_mensal;
  INSERT INTO fee_period (organization_id, facility_id, name, months, discount_percent, sort_order)
  VALUES (v_org, v_facility, 'Trimestral', 3, 5, 2) RETURNING id INTO v_trimestral;
  INSERT INTO fee_period (organization_id, facility_id, name, months, discount_percent, sort_order)
  VALUES (v_org, v_facility, 'Anual', 12, 10, 3) RETURNING id INTO v_anual;

  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_org, 'Iniciação', 1) RETURNING id INTO v_level;

  -- A mensalidade with no default of its own, and a quota that defaults to Anual.
  -- One list serving both is the decision this asserts.
  INSERT INTO fee_plan (organization_id, facility_id, kind, level_id, lessons_per_week, amount_cents)
  VALUES (v_org, v_facility, 'mensalidade', v_level, 2, 4500);
  INSERT INTO fee_plan (organization_id, facility_id, kind, amount_cents, default_fee_period_id)
  VALUES (v_org, v_facility, 'quota', 2500, v_anual);

  SELECT count(*) INTO n FROM fee_period WHERE facility_id = v_facility;
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL test 1a: expected 3 periods, got %', n; END IF;

  SELECT count(*) INTO n FROM fee_plan WHERE facility_id = v_facility;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL test 1b: expected 2 plans, got %', n; END IF;

  -- A price is a level and a frequency; a second one for the same pair is the
  -- same price written twice.
  BEGIN
    INSERT INTO fee_plan (organization_id, facility_id, kind, level_id, lessons_per_week, amount_cents)
    VALUES (v_org, v_facility, 'mensalidade', v_level, 2, 5000);
    RAISE EXCEPTION 'FAIL test 1c: two prices for one level at one frequency';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- The same level at a different frequency is a different price, and allowed.
  INSERT INTO fee_plan (organization_id, facility_id, kind, level_id, lessons_per_week, amount_cents)
  VALUES (v_org, v_facility, 'mensalidade', v_level, 1, 3000);

  -- A mensalidade without a level, or without a frequency, is a price nothing
  -- can ever match to a turma.
  BEGIN
    INSERT INTO fee_plan (organization_id, facility_id, kind, amount_cents)
    VALUES (v_org, v_facility, 'mensalidade', 1000);
    RAISE EXCEPTION 'FAIL test 1d: a mensalidade with no level was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- And a club has one quota, not several.
  BEGIN
    INSERT INTO fee_plan (organization_id, facility_id, kind, amount_cents)
    VALUES (v_org, v_facility, 'quota', 3000);
    RAISE EXCEPTION 'FAIL test 1e: a second quota was allowed at one site';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 1: a price is a level and a frequency, and a site has one quota';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — the total is rounded once, at the period
--
-- QA 42.2 and 42.14. The whole ticket's arithmetic.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_total int;
BEGIN
  v_total := fee_total_cents(3500, 3::smallint, 5);
  IF v_total <> 9975 THEN
    RAISE EXCEPTION 'FAIL test 2a: 35,00 x 3 at 5%% should be 99,75, got %', v_total;
  END IF;

  /*
   * The ticket's own example does not actually distinguish the two methods.
   *
   * 3500 x 0.95 is 3325 exactly, so rounding per month and rounding once give
   * the same 9975 — which makes 35,00 a fine illustration and a useless test.
   * 33,33 EUR is the case that tells them apart: per month it is
   * round(3166.35) x 3 = 9498, and at the period it is round(9499.05) = 9499.
   */
  IF fee_total_cents(3333, 3::smallint, 5) <> 9499 THEN
    RAISE EXCEPTION 'FAIL test 2b: expected 94,99 at the period, got %',
      fee_total_cents(3333, 3::smallint, 5);
  END IF;

  IF fee_total_cents(3333, 3::smallint, 5) = round(3333 * 0.95) * 3 THEN
    RAISE EXCEPTION 'FAIL test 2c: the total matches per-month rounding, which is the bug';
  END IF;

  -- QA 42.14: one month at nothing off is the plan amount, exactly.
  IF fee_total_cents(3500, 1::smallint, 0) <> 3500 THEN
    RAISE EXCEPTION 'FAIL test 2d: one month at 0%% drifted';
  END IF;

  IF fee_total_cents(4500, 12::smallint, 10) <> 48600 THEN
    RAISE EXCEPTION 'FAIL test 2e: 45,00 x 12 at 10%% should be 486,00';
  END IF;

  -- A null discount is no discount, not a null total.
  IF fee_total_cents(3500, 2::smallint, NULL) <> 7000 THEN
    RAISE EXCEPTION 'FAIL test 2f: a null discount should behave as zero';
  END IF;

  RAISE NOTICE 'PASS test 2: totals round once at the period, never per month';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — one default periodicity per facility, and names that do not collide
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_facility uuid; v_ok boolean;
BEGIN
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org;

  BEGIN
    INSERT INTO fee_period (organization_id, facility_id, name, months, is_default)
    VALUES (v_org, v_facility, 'Outro mensal', 2, true);
    RAISE EXCEPTION 'FAIL test 3a: a second default periodicity was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO fee_period (organization_id, facility_id, name, months)
    VALUES (v_org, v_facility, 'TRIMESTRAL', 4);
    RAISE EXCEPTION 'FAIL test 3b: a duplicate periodicity name was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO fee_period (organization_id, facility_id, name, months)
    VALUES (v_org, v_facility, 'Bienal', 36);
    RAISE EXCEPTION 'FAIL test 3c: 36 months was allowed past the 24-month bound';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  /*
   * Archiving frees the name and the month count.
   *
   * The standing rule about partial uniques, asserted rather than assumed: a club
   * that retires "Trimestral" in June must be able to bring it back in September.
   */
  UPDATE fee_period SET archived_at = now()
   WHERE organization_id = v_org AND name = 'Trimestral';

  INSERT INTO fee_period (organization_id, facility_id, name, months, discount_percent)
  VALUES (v_org, v_facility, 'Trimestral', 3, 7);

  RAISE NOTICE 'PASS test 3: one default, unique names and months, and archiving frees both';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — a plan cannot default to another site's periodicity
--
-- The three-column foreign key. A two-column one would have allowed it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_other uuid; v_their_period uuid;
BEGIN
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina do Norte')
  RETURNING id INTO v_other;

  INSERT INTO fee_period (organization_id, facility_id, name, months, is_default)
  VALUES (v_org, v_other, 'Mensal', 1, true) RETURNING id INTO v_their_period;

  BEGIN
    INSERT INTO fee_plan (organization_id, facility_id, kind, level_id, lessons_per_week,
                          amount_cents, default_fee_period_id)
    SELECT v_org, f.id, 'mensalidade',
           (SELECT id FROM student_level WHERE organization_id = v_org LIMIT 1), 3,
           1000, v_their_period
      FROM facility f WHERE f.organization_id = v_org AND f.name = 'Piscina Municipal';
    RAISE EXCEPTION 'FAIL test 4: a plan defaulted to another site''s periodicity';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 4: a plan''s default periodicity belongs to its own site';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — the snapshot survives an edit to the price list
--
-- AC4, and the thing most likely to be got wrong.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_facility uuid; v_plan uuid; v_period uuid; v_student uuid; v_line uuid;
  v_amount int; v_discount numeric;
BEGIN
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org AND name = 'Piscina Municipal';
  SELECT id INTO v_plan FROM fee_plan
   WHERE organization_id = v_org AND kind = 'mensalidade' AND lessons_per_week = 2;
  SELECT id INTO v_period FROM fee_period
   WHERE organization_id = v_org AND facility_id = v_facility AND months = 3 AND archived_at IS NULL;

  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'Duarte', 'Melo') RETURNING id INTO v_student;

  -- The line agrees to what the plan says *today*.
  INSERT INTO student_fee (organization_id, student_id, fee_plan_id, fee_period_id,
                           amount_cents, discount_percent)
  SELECT v_org, v_student, v_plan, v_period, p.amount_cents, fp.discount_percent
    FROM fee_plan p, fee_period fp
   WHERE p.id = v_plan AND fp.id = v_period
  RETURNING id INTO v_line;

  -- The club puts its prices up.
  UPDATE fee_plan SET amount_cents = 5000 WHERE id = v_plan;
  UPDATE fee_period SET discount_percent = 20 WHERE id = v_period;

  SELECT amount_cents, discount_percent INTO v_amount, v_discount
    FROM student_fee WHERE id = v_line;

  IF v_amount <> 4500 THEN
    RAISE EXCEPTION 'FAIL test 5a: the agreed amount followed the price list, now %', v_amount;
  END IF;
  IF v_discount <> 7 THEN
    RAISE EXCEPTION 'FAIL test 5b: the agreed discount followed the period, now %', v_discount;
  END IF;

  RAISE NOTICE 'PASS test 5: editing the price list never rewrites an existing agreement';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — the shape of a fee line
--
-- A quota is never attached to a turma; a manual discount is one kind or the
-- other and never without a reason.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_facility uuid; v_quota uuid; v_period uuid; v_student uuid;
  v_group uuid; v_enrolment uuid; v_other_student uuid; v_season uuid;
BEGIN
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org AND name = 'Piscina Municipal';
  SELECT id INTO v_quota FROM fee_plan WHERE organization_id = v_org AND kind = 'quota';
  SELECT id INTO v_period FROM fee_period
   WHERE organization_id = v_org AND facility_id = v_facility AND months = 12;
  SELECT id INTO v_student FROM student WHERE organization_id = v_org AND first_name = 'Duarte';

  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, '2026/2027', DATE '2026-09-01', DATE '2027-07-31')
  RETURNING id INTO v_season;

  INSERT INTO class_group (organization_id, facility_id, season_id, name)
  VALUES (v_org, v_facility, v_season, 'Turma A') RETURNING id INTO v_group;

  INSERT INTO enrollment (organization_id, class_group_id, student_id)
  VALUES (v_org, v_group, v_student) RETURNING id INTO v_enrolment;

  BEGIN
    INSERT INTO student_fee (organization_id, student_id, fee_plan_id, enrollment_id,
                             fee_period_id, amount_cents)
    VALUES (v_org, v_student, v_quota, v_enrolment, v_period, 2500);
    RAISE EXCEPTION 'FAIL test 6a: a quota was attached to an enrolment';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO student_fee (organization_id, student_id, fee_plan_id, fee_period_id,
                             amount_cents, manual_discount_percent, manual_discount_cents,
                             discount_reason)
    VALUES (v_org, v_student, v_quota, v_period, 2500, 10, 500, 'irmãos');
    RAISE EXCEPTION 'FAIL test 6b: both kinds of manual discount were allowed at once';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO student_fee (organization_id, student_id, fee_plan_id, fee_period_id,
                             amount_cents, manual_discount_percent)
    VALUES (v_org, v_student, v_quota, v_period, 2500, 10);
    RAISE EXCEPTION 'FAIL test 6c: a manual discount was allowed with no reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A line's enrolment belongs to the same student — the composite key, not a
  -- check. Another child's enrolment must not be attachable to this one's fee.
  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'Inês', 'Gonçalves') RETURNING id INTO v_other_student;

  BEGIN
    INSERT INTO student_fee (organization_id, student_id, fee_plan_id, enrollment_id,
                             fee_period_id, amount_cents)
    SELECT v_org, v_other_student, p.id, v_enrolment, v_period, p.amount_cents
      FROM fee_plan p WHERE p.organization_id = v_org AND p.kind = 'mensalidade';
    RAISE EXCEPTION 'FAIL test 6d: a fee line took another student''s enrolment';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 6: quotas carry no enrolment, discounts need a reason, enrolments stay with their student';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6b — ending an enrolment ends what it was charging
--
-- QA 42.7. In the schema rather than in the two places that end enrolments
-- today, because "must not silently keep charging" is not a rule a third call
-- site should be able to forget.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_student uuid; v_enrolment uuid; v_period uuid; v_plan uuid; v_line uuid;
  v_ends date; n int;
BEGIN
  SELECT id INTO v_student FROM student WHERE organization_id = v_org AND first_name = 'Duarte';
  SELECT e.id INTO v_enrolment FROM enrollment e WHERE e.student_id = v_student;
  SELECT id INTO v_plan FROM fee_plan WHERE organization_id = v_org AND kind = 'mensalidade';
  SELECT id INTO v_period FROM fee_period
   WHERE organization_id = v_org AND months = 12 AND archived_at IS NULL LIMIT 1;

  INSERT INTO student_fee (organization_id, student_id, fee_plan_id, enrollment_id,
                           fee_period_id, amount_cents)
  VALUES (v_org, v_student, v_plan, v_enrolment, v_period, 4500)
  RETURNING id INTO v_line;

  UPDATE enrollment SET status = 'ended', ended_on = DATE '2027-03-31' WHERE id = v_enrolment;

  SELECT ends_on INTO v_ends FROM student_fee WHERE id = v_line;
  IF v_ends IS DISTINCT FROM DATE '2027-03-31' THEN
    RAISE EXCEPTION 'FAIL test 6b: the fee line ended on %, not with the enrolment', v_ends;
  END IF;

  -- Ended, not deleted: the office still has to answer what was charged in March.
  SELECT count(*) INTO n FROM student_fee WHERE id = v_line AND archived_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL test 6c: the line disappeared instead of ending'; END IF;

  RAISE NOTICE 'PASS test 6b: ending an enrolment ends its fee line and keeps it as history';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — sócio is a fact about the person, not a derived one
--
-- AC6: a sócio with no quota line has to be representable, or an honorary member
-- and a staff child cannot be recorded at all.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_student uuid; n int;
BEGIN
  SELECT id INTO v_student FROM student WHERE organization_id = v_org AND first_name = 'Inês';

  UPDATE student SET is_socio = true, socio_number = 'S-0001', socio_since = DATE '2026-01-15'
   WHERE id = v_student;

  SELECT count(*) INTO n FROM student_fee sf
    JOIN fee_plan p ON p.id = sf.fee_plan_id
   WHERE sf.student_id = v_student AND p.kind = 'quota';

  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 7a: expected a sócio with no quota line'; END IF;

  SELECT count(*) INTO n FROM student WHERE id = v_student AND is_socio;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL test 7b: the membership was not recorded'; END IF;

  -- Two members cannot share a number.
  BEGIN
    UPDATE student SET socio_number = 'S-0001'
     WHERE organization_id = v_org AND first_name = 'Duarte';
    RAISE EXCEPTION 'FAIL test 7c: two students shared a sócio number';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 7: a sócio with no quota line is representable, and numbers are unique';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7b — a payment settles one occurrence, and lateness is a date
--
-- The flag this replaced could not say *which* month was paid, so "overdue"
-- degenerated into "nobody has touched this". These are the two functions that
-- give it a meaning.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_line uuid; v_start date; n int;
BEGIN
  -- A day past the end of February means February's last day, not an error.
  IF fee_due_on(DATE '2026-02-01', 31::smallint) <> DATE '2026-02-28' THEN
    RAISE EXCEPTION 'FAIL test 7b-a: a due day of 31 did not clamp to the short month';
  END IF;
  IF fee_due_on(DATE '2026-09-01', 8::smallint) <> DATE '2026-09-08' THEN
    RAISE EXCEPTION 'FAIL test 7b-b: an ordinary due day moved';
  END IF;

  -- A quarterly line is asked for one payment a quarter, not one a month.
  IF current_period_start(DATE '2026-01-15', NULL, 3::smallint)
     <> DATE '2026-07-15' THEN
    RAISE EXCEPTION 'FAIL test 7b-c: the quarterly occurrence was %',
      current_period_start(DATE '2026-01-15', NULL, 3::smallint);
  END IF;

  -- An ended line is not asking for anything.
  IF current_period_start(DATE '2025-01-01', DATE '2025-06-30', 1::smallint) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 7b-d: an ended line still wanted paying';
  END IF;

  SELECT id INTO v_line FROM student_fee WHERE organization_id = v_org LIMIT 1;
  v_start := DATE '2026-09-01';

  INSERT INTO student_fee_payment (organization_id, student_fee_id, period_start)
  VALUES (v_org, v_line, v_start);

  -- One settlement per occurrence: a second would double every total built here.
  BEGIN
    INSERT INTO student_fee_payment (organization_id, student_fee_id, period_start)
    VALUES (v_org, v_line, v_start);
    RAISE EXCEPTION 'FAIL test 7b-e: one occurrence was settled twice';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  SELECT count(*) INTO n FROM student_fee_payment WHERE student_fee_id = v_line;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL test 7b-f: expected one payment, got %', n; END IF;

  RAISE NOTICE 'PASS test 7b: a payment settles one occurrence, and a due day clamps';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8 — all three tables are the tenant's own
--
-- QA 42.11.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  n int;
BEGIN
  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM fee_plan WHERE organization_id = v_a;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 8a: the rival club read % of our plans', n; END IF;

  SELECT count(*) INTO n FROM fee_period WHERE organization_id = v_a;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 8b: the rival club read % of our periods', n; END IF;

  SELECT count(*) INTO n FROM student_fee WHERE organization_id = v_a;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 8c: the rival club read % of our fee lines', n; END IF;

  SELECT count(*) INTO n FROM student_fee_payment WHERE organization_id = v_a;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 8d: the rival club read % of our payments', n; END IF;

  PERFORM set_config('app.organization_id', v_a::text, true);

  SELECT count(*) INTO n FROM fee_plan WHERE organization_id = v_a;
  IF n = 0 THEN RAISE EXCEPTION 'FAIL test 8e: our own plans were invisible to us'; END IF;

  RAISE NOTICE 'PASS test 8: plans, periods, lines and payments are visible only to their own tenant';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 9 — two membership rates, and a penalty per kind of charge
--
-- Round 5. The band is a property of the quota, not a second price list; the
-- penalty is arithmetic Postgres owns, for the same reason every other total is.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_facility uuid;
BEGIN
  SELECT id INTO v_facility FROM facility
   WHERE organization_id = v_org AND name = 'Piscina Municipal';

  -- A child is under eighteen today; somebody born thirty years ago is not.
  IF quota_band_for((current_date - INTERVAL '10 years')::date) <> 'under_18' THEN
    RAISE EXCEPTION 'FAIL test 9a: a ten-year-old was not banded as a child';
  END IF;
  IF quota_band_for((current_date - INTERVAL '30 years')::date) <> 'adult' THEN
    RAISE EXCEPTION 'FAIL test 9b: a thirty-year-old was not banded as an adult';
  END IF;
  -- Exactly eighteen today is an adult: the band is "under 18", not "18 or under".
  IF quota_band_for((current_date - INTERVAL '18 years')::date) <> 'adult' THEN
    RAISE EXCEPTION 'FAIL test 9c: somebody eighteen today was still a child';
  END IF;
  -- Nothing recorded is the ordinary rate, never the cheaper one.
  IF quota_band_for(NULL::date) <> 'adult' THEN
    RAISE EXCEPTION 'FAIL test 9d: a missing birth date was given the child rate';
  END IF;

  -- The site already has an unbanded quota, from test 1. A banded one joins it.
  INSERT INTO fee_plan (organization_id, facility_id, kind, age_band, amount_cents)
  VALUES (v_org, v_facility, 'quota', 'under_18', 1200);

  -- But only one per band.
  BEGIN
    INSERT INTO fee_plan (organization_id, facility_id, kind, age_band, amount_cents)
    VALUES (v_org, v_facility, 'quota', 'under_18', 1500);
    RAISE EXCEPTION 'FAIL test 9e: two child quotas were allowed at one site';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- A mensalidade is banded by its level, which says it better than an age does.
  BEGIN
    INSERT INTO fee_plan (organization_id, facility_id, kind, level_id, lessons_per_week,
                          age_band, amount_cents)
    SELECT v_org, v_facility, 'mensalidade',
           (SELECT id FROM student_level WHERE organization_id = v_org LIMIT 1), 4,
           'under_18', 3000;
    RAISE EXCEPTION 'FAIL test 9f: a mensalidade was given an age band';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- The penalty, in the three shapes a club can ask for.
  IF fee_penalty_cents('none', 500, 10, 3500) <> 0 THEN
    RAISE EXCEPTION 'FAIL test 9g: a club charging nothing charged something';
  END IF;
  IF fee_penalty_cents('amount', 500, 10, 3500) <> 500 THEN
    RAISE EXCEPTION 'FAIL test 9h: a flat penalty was not the flat amount';
  END IF;
  -- Ten per cent of 35,00 €, rounded once, in Postgres.
  IF fee_penalty_cents('percent', 500, 10, 3500) <> 350 THEN
    RAISE EXCEPTION 'FAIL test 9i: a percentage penalty was %',
      fee_penalty_cents('percent', 500, 10, 3500);
  END IF;
  -- A member who pays only a quota has no monthly mensalidade to take a
  -- percentage of, and a percentage of nothing is nothing.
  IF fee_penalty_cents('percent', 500, 10, 0) <> 0 THEN
    RAISE EXCEPTION 'FAIL test 9j: a percentage of no mensalidade was not zero';
  END IF;

  RAISE NOTICE 'PASS test 9: quotas band by age, and a penalty is flat or a percentage';
END $$;

ROLLBACK;
