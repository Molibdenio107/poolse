-- Staff compensation — POOLSE-58.
--
-- The overlap constraint and the tenant boundary are proven in
-- `tenant-isolation.sql`, test 16. This file pins the rest of the shape: the
-- CHECKs that stop a row nobody could render, and the two facts the screens
-- rest on — that `weekly_hours` may be absent and that archiving does not
-- reopen what came before.
--
-- Run: psql -v ON_ERROR_STOP=1 -d poolse_test -f salaries.sql

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Clube S', 'clube-s');

DO $$
DECLARE
  v_o uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_m uuid; v_id uuid; v_n integer; ok boolean;
BEGIN
  INSERT INTO membership (organization_id, status, first_name, last_name)
  VALUES (v_o, 'active', 'Ana', 'Ferreira') RETURNING id INTO v_m;

  -- ---------------------------------------------------------------------
  -- Test 1 — the CHECKs refuse a row no screen could render
  -- ---------------------------------------------------------------------

  ok := false;
  BEGIN
    INSERT INTO staff_compensation
      (organization_id, staff_membership_id, kind, amount_cents, effective_from, created_by_membership_id)
    VALUES (v_o, v_m, 'monthly', 0, DATE '2026-09-01', v_m);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1a: a rate of nought was accepted'; END IF;

  ok := false;
  BEGIN
    INSERT INTO staff_compensation
      (organization_id, staff_membership_id, kind, amount_cents, weekly_hours, effective_from, created_by_membership_id)
    VALUES (v_o, v_m, 'hourly', 715, 0, DATE '2026-09-01', v_m);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 1b: zero contracted hours was accepted — it is a divisor';
  END IF;

  -- 13 is not a Portuguese year, and every derived figure would be wrong for it.
  ok := false;
  BEGIN
    INSERT INTO staff_compensation
      (organization_id, staff_membership_id, kind, amount_cents, pay_periods_per_year,
       effective_from, created_by_membership_id)
    VALUES (v_o, v_m, 'monthly', 100000, 13, DATE '2026-09-01', v_m);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1c: 13 pay periods was accepted'; END IF;

  ok := false;
  BEGIN
    INSERT INTO staff_compensation
      (organization_id, staff_membership_id, kind, amount_cents, currency,
       effective_from, created_by_membership_id)
    VALUES (v_o, v_m, 'monthly', 100000, 'GBP', DATE '2026-09-01', v_m);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1d: a currency no screen renders was accepted'; END IF;

  ok := false;
  BEGIN
    INSERT INTO staff_compensation
      (organization_id, staff_membership_id, kind, amount_cents, effective_from, effective_to,
       created_by_membership_id)
    VALUES (v_o, v_m, 'monthly', 100000, DATE '2026-09-01', DATE '2026-08-01', v_m);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1e: a rate ended before it started'; END IF;

  RAISE NOTICE 'PASS test 1: the CHECKs refuse a rate that could not be rendered';

  -- ---------------------------------------------------------------------
  -- Test 2 — absent contracted hours are allowed, and stay absent
  -- ---------------------------------------------------------------------

  INSERT INTO staff_compensation
    (organization_id, staff_membership_id, kind, amount_cents, effective_from, created_by_membership_id)
  VALUES (v_o, v_m, 'hourly', 715, DATE '2026-09-01', v_m)
  RETURNING id INTO v_id;

  SELECT count(*) INTO v_n
    FROM staff_compensation WHERE id = v_id AND weekly_hours IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 2: not measured did not stay null — it must never become 0';
  END IF;

  -- And the default is the Portuguese year.
  SELECT pay_periods_per_year INTO v_n FROM staff_compensation WHERE id = v_id;
  IF v_n <> 14 THEN RAISE EXCEPTION 'FAIL test 2b: the default was %, not 14', v_n; END IF;

  RAISE NOTICE 'PASS test 2: hours may be absent, and 14 is the default year';

  -- ---------------------------------------------------------------------
  -- Test 3 — archiving the live rate does not reopen the one before it
  -- ---------------------------------------------------------------------

  -- Back-date the start before closing it: the CHECK refuses a rate that ends
  -- before it begins, at every intermediate step as well as at the end.
  UPDATE staff_compensation SET effective_from = DATE '2026-01-01' WHERE id = v_id;
  UPDATE staff_compensation SET effective_to = DATE '2026-08-31' WHERE id = v_id;

  INSERT INTO staff_compensation
    (organization_id, staff_membership_id, kind, amount_cents, effective_from, created_by_membership_id)
  VALUES (v_o, v_m, 'monthly', 120000, DATE '2026-09-01', v_m);

  UPDATE staff_compensation SET archived_at = now()
   WHERE staff_membership_id = v_m AND effective_from = DATE '2026-09-01';

  SELECT count(*) INTO v_n
    FROM staff_compensation
   WHERE staff_membership_id = v_m
     AND archived_at IS NULL
     AND effective_from <= DATE '2026-10-01'
     AND (effective_to IS NULL OR effective_to >= DATE '2026-10-01');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 3: % live rate(s) in October — a closed rate came back to life', v_n;
  END IF;

  -- The archived row is still the record of what was paid.
  SELECT count(*) INTO v_n FROM staff_compensation WHERE staff_membership_id = v_m;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL test 3b: history lost a row'; END IF;

  RAISE NOTICE 'PASS test 3: archiving leaves no live rate, and destroys nothing';

  /*
   * There is deliberately no assertion that `updated_at` moved. `set_updated_at`
   * stamps `now()`, which is the *transaction* timestamp, and this whole file is
   * one transaction — so a row corrected here carries the same instant it was
   * created with, and an assertion would be testing the clock rather than the
   * trigger.
   */
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — provenance and the three-point range — docs/financials.md
--
-- The first table to follow the financial rules, so these assertions are the
-- template for every money table after it: a provenance that defaults to the
-- honest value, a range that may be absent, and a range that cannot be
-- nonsense.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_o uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_m uuid; v_id uuid; v_p text; ok boolean;
BEGIN
  SELECT id INTO v_m FROM membership WHERE organization_id = v_o LIMIT 1;

  -- A rate somebody typed is contracted, and nothing has to say so.
  INSERT INTO staff_compensation
    (organization_id, staff_membership_id, kind, amount_cents, effective_from, created_by_membership_id)
  VALUES (v_o, v_m, 'monthly', 100000, DATE '2030-01-01', v_m)
  RETURNING id INTO v_id;

  SELECT provenance::text INTO v_p FROM staff_compensation WHERE id = v_id;
  IF v_p <> 'contracted' THEN
    RAISE EXCEPTION 'FAIL test 4a: a typed rate defaulted to %, not contracted', v_p;
  END IF;

  -- The range is optional and stays absent rather than becoming zero.
  SELECT count(*) INTO ok FROM staff_compensation
   WHERE id = v_id AND amount_low_cents IS NULL AND amount_high_cents IS NULL;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4b: an absent range did not stay null'; END IF;

  -- A guess may carry one, and the CHECK holds it in order.
  UPDATE staff_compensation
     SET provenance = 'assumed', amount_low_cents = 90000, amount_high_cents = 110000
   WHERE id = v_id;

  ok := false;
  BEGIN
    UPDATE staff_compensation SET amount_low_cents = 120000 WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4c: a low above the expected value was accepted'; END IF;

  ok := false;
  BEGIN
    UPDATE staff_compensation SET amount_high_cents = 90000 WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4d: a high below the expected value was accepted'; END IF;

  -- A negative bound is not a range either.
  ok := false;
  BEGIN
    UPDATE staff_compensation SET amount_low_cents = -1 WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4e: a negative low bound was accepted'; END IF;

  -- One bound alone is allowed: "at least this much" is a real thing to know,
  -- and requiring both would make somebody invent the other.
  UPDATE staff_compensation SET amount_low_cents = 90000, amount_high_cents = NULL WHERE id = v_id;

  RAISE NOTICE 'PASS test 4: provenance defaults to contracted and a range cannot be nonsense';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — the overlap rule holds per person, not per club
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_o uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_a uuid; v_b uuid;
BEGIN
  INSERT INTO membership (organization_id, status, first_name, last_name)
  VALUES (v_o, 'active', 'Carla', 'Dias') RETURNING id INTO v_a;
  INSERT INTO membership (organization_id, status, first_name, last_name)
  VALUES (v_o, 'active', 'Diogo', 'Melo') RETURNING id INTO v_b;

  -- The same period for two different people is the ordinary case: a club pays
  -- everybody from September. A constraint that refused it would be unusable.
  INSERT INTO staff_compensation
    (organization_id, staff_membership_id, kind, amount_cents, effective_from, created_by_membership_id)
  VALUES (v_o, v_a, 'monthly', 100000, DATE '2031-09-01', v_a);
  INSERT INTO staff_compensation
    (organization_id, staff_membership_id, kind, amount_cents, effective_from, created_by_membership_id)
  VALUES (v_o, v_b, 'monthly', 110000, DATE '2031-09-01', v_b);

  RAISE NOTICE 'PASS test 5: two people may hold the same period';
END $$;

ROLLBACK;
