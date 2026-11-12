-- Every AI read leaves a row, and only Poolse switches a reader on — POOLSE-137.
--
-- The grants are the test: the club's login claims its own reads, reads them
-- back (the cap needs the count), fills each one in once and nothing more, sees
-- no other club's, and cannot switch a reader on or move its own cap. The
-- platform's login reads every club's, writes none, and sets the ticks.
-- (Replaces energy-invoice-read.sql, whose table this folded in; the meter
-- carrier check stays.)
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('aaaaaaaa-1060-4000-8000-000000000001', 'Clube Leituras A', 'clube-leituras-a'),
  ('aaaaaaaa-1060-4000-8000-000000000002', 'Clube Leituras B', 'clube-leituras-b');

-- A meter is electricity unless it says otherwise, and may say gas or water.
DO $$
DECLARE v_fac uuid; v_carrier text;
BEGIN
  INSERT INTO facility (organization_id, name)
  VALUES ('aaaaaaaa-1060-4000-8000-000000000001', 'Piscina') RETURNING id INTO v_fac;
  INSERT INTO energy_meter (organization_id, facility_id, name, reads, initial_index)
  VALUES ('aaaaaaaa-1060-4000-8000-000000000001', v_fac, 'Geral', 'cumulative_index', 0)
  RETURNING carrier::text INTO v_carrier;
  IF v_carrier <> 'electricity' THEN RAISE EXCEPTION 'FAIL test 1: a new meter was %', v_carrier; END IF;
  INSERT INTO energy_meter (organization_id, facility_id, name, reads, initial_index, carrier)
  VALUES ('aaaaaaaa-1060-4000-8000-000000000001', v_fac, 'Caldeira', 'cumulative_index', 0, 'gas');
  RAISE NOTICE 'PASS test 1: a meter is electricity by default and may be gas';
END $$;

-- A new club has no reader on and no cap; a cap of 0 is refused.
DO $$
DECLARE v_readers text[]; v_cap int; ok boolean := false;
BEGIN
  SELECT ai_readers::text[], ai_monthly_cap INTO v_readers, v_cap
    FROM organization WHERE id = 'aaaaaaaa-1060-4000-8000-000000000001';
  IF v_readers <> '{}' OR v_cap IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 2a: a new club had readers % and cap %', v_readers, v_cap;
  END IF;
  BEGIN
    UPDATE organization SET ai_monthly_cap = 0 WHERE id = 'aaaaaaaa-1060-4000-8000-000000000001';
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2b: a cap of 0 was accepted'; END IF;
  RAISE NOTICE 'PASS test 2: a new club has no reader on and no cap, and 0 is not a cap';
END $$;

-- Club B already has a read, so A has something it must not see.
INSERT INTO ai_read (organization_id, reader, finished_at, succeeded)
VALUES ('aaaaaaaa-1060-4000-8000-000000000002', 'pdf_table', now(), true);

-- The club's login.
SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'aaaaaaaa-1060-4000-8000-000000000001', true);

DO $$
DECLARE v_id uuid; n int; ok boolean;
BEGIN
  INSERT INTO ai_read (organization_id, reader)
  VALUES ('aaaaaaaa-1060-4000-8000-000000000001', 'energy_invoice') RETURNING id INTO v_id;

  SELECT count(*) INTO n FROM ai_read;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL test 3a: the club saw % reads, expected its own 1', n; END IF;

  UPDATE ai_read SET finished_at = now(), succeeded = true, model = 'claude-haiku-5-5',
                     input_tokens = 1200, output_tokens = 300
   WHERE id = v_id;

  ok := false;
  BEGIN
    UPDATE ai_read SET succeeded = false WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3b: a finished read was rewritten'; END IF;

  ok := false;
  BEGIN
    UPDATE ai_read SET reader = 'pdf_table' WHERE id = v_id;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3c: the club moved a read to another reader'; END IF;

  ok := false;
  BEGIN
    DELETE FROM ai_read;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3d: the club could delete its reads'; END IF;

  ok := false;
  BEGIN
    INSERT INTO ai_read (organization_id, reader)
    VALUES ('aaaaaaaa-1060-4000-8000-000000000002', 'energy_invoice');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3e: a read was logged against another club'; END IF;

  ok := false;
  BEGIN
    UPDATE organization SET ai_readers = '{energy_invoice}' WHERE id = current_organization_id();
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3f: the club switched a reader on itself'; END IF;

  ok := false;
  BEGIN
    UPDATE organization SET ai_monthly_cap = 1000 WHERE id = current_organization_id();
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3g: the club moved its own cap'; END IF;

  RAISE NOTICE 'PASS test 3: the club claims, reads and finishes its own reads once, and nothing more';
END $$;

RESET ROLE;

-- The platform's login: reads every club's reads, writes none, sets the ticks.
SET LOCAL ROLE poolse_platform;
SELECT set_config('app.organization_id', '', true);

DO $$
DECLARE n int; ok boolean;
BEGIN
  SELECT count(*) INTO n FROM ai_read
   WHERE organization_id IN ('aaaaaaaa-1060-4000-8000-000000000001', 'aaaaaaaa-1060-4000-8000-000000000002');
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL test 4a: the platform saw % reads', n; END IF;

  ok := false;
  BEGIN
    INSERT INTO ai_read (organization_id, reader)
    VALUES ('aaaaaaaa-1060-4000-8000-000000000001', 'energy_invoice');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4b: the platform wrote a read'; END IF;

  UPDATE organization SET ai_readers = '{energy_invoice,pdf_table}', ai_monthly_cap = 50
   WHERE id = 'aaaaaaaa-1060-4000-8000-000000000001';

  -- The four switches exist. Their migration default is off, but this runs on a
  -- used database where Rui may have turned them on from /admin (12-11-2026),
  -- so the state is not asserted here.
  SELECT count(*) INTO n FROM platform_switch
   WHERE name IN ('energy_invoice_ai', 'water_report_ai', 'pdf_table_ai', 'column_match_ai');
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL test 4c: % of the four new switches exist', n; END IF;

  RAISE NOTICE 'PASS test 4: the platform counts every club''s reads, writes none, and sets the ticks';
END $$;

RESET ROLE;
ROLLBACK;
