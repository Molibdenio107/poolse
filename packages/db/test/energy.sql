-- Energy meters and readings — slices 5.1 and 5.2.
--
-- Test 1 is the rule the module rests on: a cumulative index cannot run
-- backwards, and the refusal carries the neighbouring figure so the screen can
-- quote it. Test 2 is its boundary — an interval meter may read anything,
-- because each value is its own consumption. Test 3 is the piece that makes a
-- correction possible: an archived reading leaves the series, so the figure
-- that replaces it is judged against the right neighbours.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES ('Clube Energia', 'clube-energia');

DO $$
DECLARE
  v_org uuid; v_fac uuid; v_dial uuid; v_interval uuid;
  v_detail text; ok boolean;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-energia';
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Municipal')
  RETURNING id INTO v_fac;

  INSERT INTO energy_meter (organization_id, facility_id, name, reads, initial_index)
  VALUES (v_org, v_fac, 'Geral', 'cumulative_index', 18402)
  RETURNING id INTO v_dial;

  INSERT INTO energy_meter (organization_id, facility_id, name, reads)
  VALUES (v_org, v_fac, 'Fatura mensal', 'interval_consumption')
  RETURNING id INTO v_interval;

  -- -------------------------------------------------------------------------
  -- Test 1: a dial does not run backwards, and the refusal quotes the neighbour
  -- -------------------------------------------------------------------------

  INSERT INTO energy_reading (organization_id, meter_id, taken_at, value)
  VALUES (v_org, v_dial, '2026-07-01 08:00+00', 19000),
         (v_org, v_dial, '2026-09-01 08:00+00', 20000);

  -- Below the initial index: logging began at 18,402, so 18,000 is a typo.
  ok := false;
  BEGIN
    INSERT INTO energy_reading (organization_id, meter_id, taken_at, value)
    VALUES (v_org, v_dial, '2026-06-01 08:00+00', 18000);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    ok := v_detail = 'energy_index_backwards|18402.000|18000.000';
    IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1a: detail was %', v_detail; END IF;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1a: a reading below the initial index was accepted'; END IF;

  -- Between two readings but below the earlier one.
  ok := false;
  BEGIN
    INSERT INTO energy_reading (organization_id, meter_id, taken_at, value)
    VALUES (v_org, v_dial, '2026-08-01 08:00+00', 18900);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    ok := v_detail = 'energy_index_backwards|19000.000|18900.000';
    IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1b: detail was %', v_detail; END IF;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1b: a reading below its predecessor was accepted'; END IF;

  -- Between two readings but above the later one — a backdated entry typed
  -- against the wrong month.
  ok := false;
  BEGIN
    INSERT INTO energy_reading (organization_id, meter_id, taken_at, value)
    VALUES (v_org, v_dial, '2026-08-01 08:00+00', 20500);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    ok := v_detail = 'energy_index_ahead|20000.000|20500.000';
    IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1c: detail was %', v_detail; END IF;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1c: a reading above its successor was accepted'; END IF;

  -- And the honest one in between is fine.
  INSERT INTO energy_reading (organization_id, meter_id, taken_at, value)
  VALUES (v_org, v_dial, '2026-08-01 08:00+00', 19500);

  RAISE NOTICE 'PASS test 1: a dial does not run backwards, and the refusal says by how much';

  -- -------------------------------------------------------------------------
  -- Test 2: an interval meter is not judged
  -- -------------------------------------------------------------------------

  INSERT INTO energy_reading (organization_id, meter_id, taken_at, value)
  VALUES (v_org, v_interval, '2026-07-01 08:00+00', 900),
         (v_org, v_interval, '2026-08-01 08:00+00', 300),
         (v_org, v_interval, '2026-09-01 08:00+00', 1200);

  -- And an interval meter cannot carry a starting index at all.
  ok := false;
  BEGIN
    UPDATE energy_meter SET initial_index = 5 WHERE id = v_interval;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2: an interval meter took an initial index'; END IF;

  RAISE NOTICE 'PASS test 2: an interval meter reads what it reads';

  -- -------------------------------------------------------------------------
  -- Test 3: an archived reading leaves the series
  -- -------------------------------------------------------------------------

  -- The September figure was a typo; archive it, and a smaller one may follow.
  UPDATE energy_reading SET archived_at = now()
   WHERE meter_id = v_dial AND taken_at = '2026-09-01 08:00+00';

  INSERT INTO energy_reading (organization_id, meter_id, taken_at, value)
  VALUES (v_org, v_dial, '2026-09-02 08:00+00', 19800);

  -- Un-archiving it is judged again, and now it is ahead of its successor.
  ok := false;
  BEGIN
    UPDATE energy_reading SET archived_at = NULL
     WHERE meter_id = v_dial AND taken_at = '2026-09-01 08:00+00';
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3: restoring a reading skipped the rule'; END IF;

  RAISE NOTICE 'PASS test 3: an archived reading is out of the series, and back in only if it fits';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: a bill's totals must agree with its parts, and the same bill twice is refused
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_meter uuid; v_inv uuid; ok boolean;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-energia';
  SELECT id INTO v_meter FROM energy_meter WHERE organization_id = v_org AND name = 'Geral';

  -- The first EDP sample, in cents: 41,36 s/IVA (taxes included) + 4,87 IVA = 46,23; 66,64 in the envelope.
  INSERT INTO energy_invoice
    (organization_id, meter_id, supplier, invoice_number, issued_on, period_start, period_end, due_on,
     subtotal_cents, vat_cents, total_cents, other_charges_cents, document_total_cents)
  VALUES (v_org, v_meter, 'EDP Comercial', 'FT2025 K3425/340041459032',
          DATE '2025-11-28', DATE '2025-10-26', DATE '2025-11-25', DATE '2025-12-23',
          4136, 487, 4623, 2041, 6664)
  RETURNING id INTO v_inv;

  INSERT INTO energy_invoice_register (organization_id, invoice_id, register, previous_index, current_index, kwh)
  VALUES (v_org, v_inv, 'vazio', 968, 1033, 65),
         (v_org, v_inv, 'ponta', 439, 472, 33),
         (v_org, v_inv, 'cheias', 1113, 1185, 72);

  INSERT INTO energy_invoice_line
    (organization_id, invoice_id, position, kind, description, period, from_on, to_on,
     quantity, unit, unit_price, amount_cents, discount_cents, total_cents, vat_rate)
  VALUES
    (v_org, v_inv, 0, 'energy', 'Consumo real Simples', 'simples', DATE '2025-10-26', DATE '2025-11-11',
     92, 'kWh', 0.1675, 1541, 62, 1479, 6),
    (v_org, v_inv, 1, 'energy', 'Consumo real Simples', 'simples', DATE '2025-11-12', DATE '2025-11-25',
     78, 'kWh', 0.1675, 1307, 52, 1255, 6),
    (v_org, v_inv, 2, 'power', 'Potência (4,6 kVA)', NULL, DATE '2025-10-26', DATE '2025-11-25',
     31, 'dias', 0.4631, 1435, 57, 1378, 23),
    (v_org, v_inv, 3, 'tax', 'DGEG', NULL, NULL, NULL, 1, 'mês', 0.07, 7, 0, 7, 23),
    (v_org, v_inv, 4, 'tax', 'IEC', NULL, NULL, NULL, 170, 'kWh', 0.001, 17, 0, 17, 23);

  -- A total that disagrees with its parts.
  ok := false;
  BEGIN
    INSERT INTO energy_invoice
      (organization_id, meter_id, supplier, invoice_number, issued_on, period_start, period_end,
       subtotal_cents, vat_cents, total_cents, document_total_cents)
    VALUES (v_org, v_meter, 'EDP Comercial', 'FT-typo', DATE '2025-11-28', DATE '2025-10-26', DATE '2025-11-25',
            4112, 511, 4600, 4600);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4a: a total that is not subtotal + VAT was accepted'; END IF;

  -- A register running backwards.
  ok := false;
  BEGIN
    INSERT INTO energy_invoice_register (organization_id, invoice_id, register, previous_index, current_index, kwh)
    VALUES (v_org, v_inv, 'super_vazio', 500, 400, 0);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4b: a register with current below previous was accepted'; END IF;

  -- The same bill twice, whatever the case of the number.
  ok := false;
  BEGIN
    INSERT INTO energy_invoice
      (organization_id, meter_id, supplier, invoice_number, issued_on, period_start, period_end,
       subtotal_cents, vat_cents, total_cents, document_total_cents)
    VALUES (v_org, v_meter, 'edp comercial', 'ft2025 k3425/340041459032', DATE '2025-11-28',
            DATE '2025-10-26', DATE '2025-11-25', 4112, 511, 4623, 4623);
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4c: the same bill was filed twice'; END IF;

  -- Archived, the number is free again — a bill filed on the wrong meter is
  -- removed and filed again.
  UPDATE energy_invoice SET archived_at = now() WHERE id = v_inv;
  INSERT INTO energy_invoice
    (organization_id, meter_id, supplier, invoice_number, issued_on, period_start, period_end,
     subtotal_cents, vat_cents, total_cents, document_total_cents)
  VALUES (v_org, v_meter, 'EDP Comercial', 'FT2025 K3425/340041459032', DATE '2025-11-28',
          DATE '2025-10-26', DATE '2025-11-25', 4112, 511, 4623, 4623);

  RAISE NOTICE 'PASS test 4: a bill adds up, its registers only go up, and it is filed once';
END $$;

ROLLBACK;
