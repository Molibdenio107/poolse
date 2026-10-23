-- A bill read automatically leaves a row — POOLSE-106.
--
-- The row is what keeps the per-read cost visible on /admin, so the two halves
-- of its grant are the test: the club's login writes its own reads and can
-- neither read, rewrite, delete nor write another club's; the platform's login
-- reads every club's and writes none. And a meter now says what it measures.
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

-- The club's login: its own read goes in; nothing else does.
SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'aaaaaaaa-1060-4000-8000-000000000001', true);

INSERT INTO energy_invoice_read (organization_id, succeeded)
VALUES ('aaaaaaaa-1060-4000-8000-000000000001', true);

DO $$
DECLARE ok boolean;
BEGIN
  ok := false;
  BEGIN
    INSERT INTO energy_invoice_read (organization_id, succeeded)
    VALUES ('aaaaaaaa-1060-4000-8000-000000000002', true);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2a: a read was logged against another club'; END IF;

  ok := false;
  BEGIN
    PERFORM count(*) FROM energy_invoice_read;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2b: the club read its own log'; END IF;

  ok := false;
  BEGIN
    DELETE FROM energy_invoice_read;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2c: the club could delete its reads'; END IF;

  ok := false;
  BEGIN
    UPDATE energy_invoice_read SET succeeded = false;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2d: the club could rewrite its reads'; END IF;

  RAISE NOTICE 'PASS test 2: the club logs its own reads and can do nothing else with them';
END $$;

RESET ROLE;

-- The platform's login: reads every club's, writes none.
SET LOCAL ROLE poolse_platform;
SELECT set_config('app.organization_id', '', true);

DO $$
DECLARE n int; ok boolean;
BEGIN
  SELECT count(*) INTO n FROM energy_invoice_read
   WHERE organization_id = 'aaaaaaaa-1060-4000-8000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL test 3a: the platform saw % reads', n; END IF;

  ok := false;
  BEGIN
    INSERT INTO energy_invoice_read (organization_id, succeeded)
    VALUES ('aaaaaaaa-1060-4000-8000-000000000001', true);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3b: the platform wrote a read'; END IF;

  RAISE NOTICE 'PASS test 3: the platform counts every club''s reads and writes none';
END $$;

RESET ROLE;
ROLLBACK;
