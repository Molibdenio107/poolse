-- The cost ledger — POOLSE-182.
--
-- Test 1: allocate_cost — the ticket's 930 € bill (QA 1), a one-day cost, a
-- leap February, a cost too small to share, and shares that always sum exactly.
-- Test 2: windows — an época starting 15-09 splits September by days, and a
-- civil year and an época read the same month rows (QA 2). Test 3: a premium
-- over a year (QA 4). Test 4: a bill filed, edited and archived re-allocates
-- itself; a recorded cost and a purchase allocate. Test 5: a recurring cost
-- generates once, and *não pago* is not generated again. Test 6: salaries
-- accrue, hours missing are counted, an Admin's total leaves the Owner out.
-- Test 7: another club's facility is refused, and no month crosses clubs.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- Test 1: allocation
-- ---------------------------------------------------------------------------
DO $$
DECLARE n bigint; r record;
BEGIN
  -- QA 1: 930 € from 12-12 to 11-01 — 20 days in December, 11 in January.
  SELECT array_agg(cents ORDER BY month) INTO r FROM allocate_cost(DATE '2026-12-12', DATE '2027-01-11', 93000);
  IF (SELECT array_agg(cents ORDER BY month) FROM allocate_cost(DATE '2026-12-12', DATE '2027-01-11', 93000))
     <> ARRAY[60000, 33000]::bigint[] THEN
    RAISE EXCEPTION 'FAIL test 1a: 930 € over Dec–Jan is not 600 + 330';
  END IF;
  -- A one-day cost is that day's month, whole.
  IF (SELECT array_agg(cents) FROM allocate_cost(DATE '2026-03-31', DATE '2026-03-31', 4999)) <> ARRAY[4999]::bigint[] THEN
    RAISE EXCEPTION 'FAIL test 1b: a one-day cost';
  END IF;
  -- A leap February counts 29 days: 59 € over Feb–Mar 2028 (29 + 31 = 60 days).
  IF (SELECT array_agg(cents ORDER BY month) FROM allocate_cost(DATE '2028-02-01', DATE '2028-03-31', 6000))
     <> ARRAY[2900, 3100]::bigint[] THEN
    RAISE EXCEPTION 'FAIL test 1c: a leap February';
  END IF;
  -- Two cents over twelve months: never negative, exact sum.
  IF EXISTS (SELECT 1 FROM allocate_cost(DATE '2026-01-01', DATE '2026-12-31', 2) WHERE cents < 0)
     OR (SELECT sum(cents) FROM allocate_cost(DATE '2026-01-01', DATE '2026-12-31', 2)) <> 2 THEN
    RAISE EXCEPTION 'FAIL test 1d: a tiny amount went negative or lost a cent';
  END IF;
  -- Awkward amounts over awkward periods always sum exactly.
  FOR r IN SELECT a, d FROM (VALUES (1, 400), (99999, 47), (12345, 1000), (7, 3)) AS v(a, d) LOOP
    SELECT sum(cents) INTO n FROM allocate_cost(DATE '2026-01-17', DATE '2026-01-17' + r.d, r.a);
    IF n <> r.a THEN RAISE EXCEPTION 'FAIL test 1e: % over % days summed to %', r.a, r.d, n; END IF;
  END LOOP;
  -- A backwards period allocates nothing.
  IF EXISTS (SELECT 1 FROM allocate_cost(DATE '2026-02-02', DATE '2026-02-01', 100)) THEN
    RAISE EXCEPTION 'FAIL test 1f: a backwards period allocated';
  END IF;
  RAISE NOTICE 'PASS test 1: allocation by day, exact to the cent';
END $$;

INSERT INTO organization (id, name, slug) VALUES
  ('bbbbbbbb-1820-4000-8000-000000000001', 'Clube Custos A', 'clube-custos-a'),
  ('bbbbbbbb-1820-4000-8000-000000000002', 'Clube Custos B', 'clube-custos-b');

CREATE TEMP TABLE t182 (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT ON t182 TO poolse_app;

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1820-4000-8000-000000000001';
  v_b uuid := 'bbbbbbbb-1820-4000-8000-000000000002';
  v_site uuid; v_other_site uuid; v_member uuid; v_owner uuid; v_meter uuid; v_item uuid;
BEGIN
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Municipal') RETURNING id INTO v_site;
  INSERT INTO facility (organization_id, name) VALUES (v_b, 'Outra') RETURNING id INTO v_other_site;
  INSERT INTO membership (organization_id, status, first_name, last_name) VALUES (v_org, 'active', 'Rita', 'Admin') RETURNING id INTO v_member;
  INSERT INTO membership (organization_id, status, first_name, last_name) VALUES (v_org, 'active', 'Olga', 'Dona') RETURNING id INTO v_owner;
  INSERT INTO membership_role (organization_id, membership_id, role) VALUES (v_org, v_owner, 'owner');
  INSERT INTO energy_meter (organization_id, facility_id, name, kind, unit, reads, carrier)
  VALUES (v_org, v_site, 'Geral', 'total', 'kWh', 'cumulative_index', 'electricity') RETURNING id INTO v_meter;
  INSERT INTO inventory_item (organization_id, facility_id, name, quantity, unit)
  VALUES (v_org, v_site, 'Cloro', 5, 'kg') RETURNING id INTO v_item;
  INSERT INTO t182 VALUES ('site', v_site), ('other_site', v_other_site), ('member', v_member),
    ('owner', v_owner), ('meter', v_meter), ('item', v_item);
END $$;

-- Everything below runs as the app, in club A.
SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'bbbbbbbb-1820-4000-8000-000000000001', true);

-- ---------------------------------------------------------------------------
-- Test 2 and 3: windows and a premium
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1820-4000-8000-000000000001';
  v_site uuid := (SELECT id FROM t182 WHERE name = 'site');
  v_policy uuid; v_jan bigint; v_dec bigint; v_sum bigint; v_before bigint; v_after bigint; v_sept bigint;
BEGIN
  -- 3 000 € of water, all of September 2026.
  INSERT INTO cost_entry (organization_id, facility_id, kind, amount_cents, vat_cents, period_from, period_to)
  VALUES (v_org, v_site, 'water', 300000, 18000, DATE '2026-09-01', DATE '2026-09-30');

  -- QA 2: the época from 15-09 takes 16/30 of September; the civil year up to 14-09 the other 14/30.
  SELECT net_cents INTO v_after FROM cost_window(DATE '2026-09-15', DATE '2027-07-31') WHERE kind = 'water';
  SELECT net_cents INTO v_before FROM cost_window(DATE '2026-01-01', DATE '2026-09-14') WHERE kind = 'water';
  SELECT net_cents INTO v_sept FROM cost_window(DATE '2026-01-01', DATE '2026-12-31') WHERE kind = 'water';
  IF v_after <> 160000 OR v_before <> 140000 OR v_sept <> 300000 THEN
    RAISE EXCEPTION 'FAIL test 2: época %, before %, year %', v_after, v_before, v_sept;
  END IF;
  RAISE NOTICE 'PASS test 2: a window splits a month by days, and every window reads the same rows';

  -- QA 4: 1 200 € over 2026, by day.
  INSERT INTO insurance_policy (organization_id, facility_id, insurer, policy_number, valid_from, valid_to, cost_per_person_cents, premium_cents, premium_vat_cents)
  VALUES (v_org, v_site, 'Fidelidade', 'AP-2026-1', DATE '2026-01-01', DATE '2026-12-31', 500, 120000, 0) RETURNING id INTO v_policy;
  SELECT share_cents INTO v_jan FROM cost_month WHERE source_id = v_policy AND month = DATE '2026-01-01';
  SELECT share_cents INTO v_dec FROM cost_month WHERE source_id = v_policy AND month = DATE '2026-12-01';
  SELECT sum(share_cents) INTO v_sum FROM cost_month WHERE source_id = v_policy;
  -- 31/365 × 1 200 € = 101,92 €; the year sums to the premium exactly.
  IF v_jan <> 10192 OR v_dec <> 10192 OR v_sum <> 120000 THEN
    RAISE EXCEPTION 'FAIL test 3: January %, December %, year %', v_jan, v_dec, v_sum;
  END IF;
  -- Removing the premium removes its months.
  UPDATE insurance_policy SET premium_cents = NULL, premium_vat_cents = NULL WHERE id = v_policy;
  IF EXISTS (SELECT 1 FROM cost_month WHERE source_id = v_policy) THEN
    RAISE EXCEPTION 'FAIL test 3b: a removed premium kept its months';
  END IF;
  RAISE NOTICE 'PASS test 3: a premium spreads by day over its policy year';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: bills, recorded costs and purchases keep their months
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1820-4000-8000-000000000001';
  v_meter uuid := (SELECT id FROM t182 WHERE name = 'meter');
  v_item uuid := (SELECT id FROM t182 WHERE name = 'item');
  v_bill uuid; v_purchase uuid; n bigint;
BEGIN
  INSERT INTO energy_invoice (organization_id, meter_id, supplier, invoice_number, issued_on, period_start, period_end,
                              subtotal_cents, vat_cents, total_cents, document_total_cents)
  VALUES (v_org, v_meter, 'EDP', 'FT 2027/1', DATE '2027-01-15', DATE '2026-12-12', DATE '2027-01-11', 93000, 21390, 114390, 114390)
  RETURNING id INTO v_bill;
  IF (SELECT array_agg(share_cents ORDER BY month) FROM cost_month WHERE source_id = v_bill) <> ARRAY[60000, 33000]::bigint[]
     OR (SELECT sum(vat_cents) FROM cost_month WHERE source_id = v_bill) <> 21390
     OR (SELECT DISTINCT kind::text FROM cost_month WHERE source_id = v_bill) <> 'electricity' THEN
    RAISE EXCEPTION 'FAIL test 4a: a bill''s months';
  END IF;
  -- Editing the bill edits its months.
  UPDATE energy_invoice SET period_end = DATE '2026-12-31' WHERE id = v_bill;
  IF (SELECT count(*) FROM cost_month WHERE source_id = v_bill) <> 1 THEN
    RAISE EXCEPTION 'FAIL test 4b: an edited bill kept its old months';
  END IF;
  UPDATE energy_invoice SET archived_at = now() WHERE id = v_bill;
  IF EXISTS (SELECT 1 FROM cost_month WHERE source_id = v_bill) THEN
    RAISE EXCEPTION 'FAIL test 4c: an archived bill still costs';
  END IF;

  INSERT INTO inventory_purchase (organization_id, inventory_item_id, quantity, amount_cents, vat_cents, bought_on)
  VALUES (v_org, v_item, 10, 18000, 4140, DATE '2026-10-05') RETURNING id INTO v_purchase;
  SELECT share_cents INTO n FROM cost_month WHERE source_id = v_purchase AND month = DATE '2026-10-01' AND kind = 'materials';
  IF n IS DISTINCT FROM 18000 THEN RAISE EXCEPTION 'FAIL test 4d: a purchase is not its month''s materials'; END IF;
  RAISE NOTICE 'PASS test 4: bills, costs and purchases keep their own months';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: recurring fixed costs
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1820-4000-8000-000000000001';
  v_template uuid; n int; v_occurrence uuid;
BEGIN
  INSERT INTO cost_entry (organization_id, kind, amount_cents, recurrence, effective_from, effective_to, supplier)
  VALUES (v_org, 'fixed', 4900, 'monthly', DATE '2026-01-01', DATE '2026-06-30', 'Poolse')
  RETURNING id INTO v_template;
  IF EXISTS (SELECT 1 FROM cost_month WHERE source_id = v_template) THEN
    RAISE EXCEPTION 'FAIL test 5a: a template costs on its own';
  END IF;
  n := materialise_fixed_costs(DATE '2026-12-31');
  IF n <> 6 THEN RAISE EXCEPTION 'FAIL test 5b: % occurrences, not 6', n; END IF;
  IF materialise_fixed_costs(DATE '2026-12-31') <> 0 THEN RAISE EXCEPTION 'FAIL test 5c: generated twice'; END IF;
  -- March was not paid: archived, and not generated again.
  SELECT id INTO v_occurrence FROM cost_entry WHERE template_id = v_template AND period_from = DATE '2026-03-01';
  UPDATE cost_entry SET archived_at = now() WHERE id = v_occurrence;
  IF materialise_fixed_costs(DATE '2026-12-31') <> 0 THEN RAISE EXCEPTION 'FAIL test 5d: não pago came back'; END IF;
  IF (SELECT sum(share_cents) FROM cost_month cm JOIN cost_entry e ON e.id = cm.source_id WHERE e.template_id = v_template) <> 5 * 4900 THEN
    RAISE EXCEPTION 'FAIL test 5e: five paid months are not 5 × 49 €';
  END IF;
  RAISE NOTICE 'PASS test 5: a recurring cost is generated once, and não pago stays out';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: salaries are read on demand
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1820-4000-8000-000000000001';
  v_member uuid := (SELECT id FROM t182 WHERE name = 'member');
  v_owner uuid := (SELECT id FROM t182 WHERE name = 'owner');
  v_hourly uuid; r record;
BEGIN
  -- 1 200 €/month × 14 / 12 = 1 400 € a month.
  INSERT INTO staff_compensation (organization_id, staff_membership_id, kind, amount_cents, effective_from, created_by_membership_id)
  VALUES (v_org, v_member, 'monthly', 120000, DATE '2026-01-01', v_owner);
  INSERT INTO staff_compensation (organization_id, staff_membership_id, kind, amount_cents, effective_from, created_by_membership_id)
  VALUES (v_org, v_owner, 'monthly', 300000, DATE '2026-01-01', v_owner);
  -- An hourly rate with no hours: left out, and counted.
  INSERT INTO membership (organization_id, status, first_name, last_name) VALUES (v_org, 'active', 'Hugo', 'Horas') RETURNING id INTO v_hourly;
  INSERT INTO staff_compensation (organization_id, staff_membership_id, kind, amount_cents, effective_from, created_by_membership_id)
  VALUES (v_org, v_hourly, 'hourly', 1500, DATE '2026-01-01', v_owner);

  SELECT * INTO r FROM salary_months(DATE '2026-03-01', DATE '2026-03-31', true);
  IF r.cents <> 140000 OR r.without_hours <> 1 THEN
    RAISE EXCEPTION 'FAIL test 6a: without the Owner, March is % (%) not 1 400 €', r.cents, r.without_hours;
  END IF;
  SELECT * INTO r FROM salary_months(DATE '2026-03-01', DATE '2026-03-31', false);
  IF r.cents <> 140000 + 350000 THEN RAISE EXCEPTION 'FAIL test 6b: with the Owner, March is %', r.cents; END IF;
  RAISE NOTICE 'PASS test 6: salaries accrue on read, and an Admin''s total leaves the Owner out';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7: tenancy
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1820-4000-8000-000000000001';
  v_other_site uuid := (SELECT id FROM t182 WHERE name = 'other_site');
  ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO cost_entry (organization_id, facility_id, kind, amount_cents, period_from, period_to)
    VALUES (v_org, v_other_site, 'water', 100, DATE '2026-01-01', DATE '2026-01-01');
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 7a: a cost named another club''s site'; END IF;
  -- The app cannot write a month row for another club.
  ok := false;
  BEGIN
    INSERT INTO cost_month (organization_id, source_kind, source_id, month, share_cents, vat_cents, kind, basis)
    VALUES ('bbbbbbbb-1820-4000-8000-000000000002', 'cost_entry', gen_random_uuid(), DATE '2026-01-01', 1, 0, 'water', 'invoice');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 7b: a month row was written into another club'; END IF;
END $$;

SELECT set_config('app.organization_id', 'bbbbbbbb-1820-4000-8000-000000000002', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cost_month) OR EXISTS (SELECT 1 FROM cost_entry) OR EXISTS (SELECT 1 FROM cost_window(DATE '2000-01-01', DATE '2100-01-01')) THEN
    RAISE EXCEPTION 'FAIL test 7c: another club sees our costs';
  END IF;
  IF EXISTS (SELECT 1 FROM salary_months(DATE '2026-01-01', DATE '2026-12-31', false) WHERE cents <> 0) THEN
    RAISE EXCEPTION 'FAIL test 7d: another club sees our salaries';
  END IF;
  RAISE NOTICE 'PASS test 7: a cost never crosses clubs';
END $$;

RESET ROLE;
ROLLBACK;
