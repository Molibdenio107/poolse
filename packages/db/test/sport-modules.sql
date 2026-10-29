-- Sports as paid modules — POOLSE-124.
--
-- A club is a pool club until Rui switches another sport on. These prove the
-- switch: only the platform writes it, the pool never leaves it, a court is made
-- (or brought back) only for a sport that is on, and a sport with live courts
-- cannot be switched off — the refusal names them.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Clube A', 'clube-a'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Clube B', 'clube-b');

INSERT INTO facility (id, organization_id, name) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Sede A'),
  ('b1111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Sede B');

-- ---------------------------------------------------------------------------
-- Test 1 — a new club is a pool club, and a court is refused
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

DO $$
DECLARE v text[]; ok boolean := false; v_detail text;
BEGIN
  SELECT enabled_sports INTO v FROM organization WHERE id = current_organization_id();
  IF v <> ARRAY['pool'] THEN
    RAISE EXCEPTION 'FAIL test 1: a new club has %, expected {pool}', v;
  END IF;

  -- The pool is unaffected: its recinto is made by its own trigger, as before.
  INSERT INTO pool (organization_id, facility_id, name)
    VALUES (current_organization_id(), 'a1111111-1111-1111-1111-111111111111', 'Piscina');

  BEGIN
    INSERT INTO playing_area (organization_id, facility_id, sport_id, name)
      VALUES (current_organization_id(), 'a1111111-1111-1111-1111-111111111111', 'tennis', 'Campo 1');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    ok := v_detail = 'sport_not_enabled|tennis';
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1: a tennis court was made for a pool club (%)', v_detail; END IF;
  RAISE NOTICE 'PASS test 1: a new club is {pool}, and a court for a sport that is off is refused';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — the club cannot switch a sport on for itself
-- ---------------------------------------------------------------------------

DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = current_organization_id();
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2: poolse_app wrote enabled_sports'; END IF;
  RAISE NOTICE 'PASS test 2: the app login cannot write enabled_sports';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — the platform switches tennis on, and the court can be made
-- ---------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE poolse_platform;

UPDATE organization SET enabled_sports = '{pool,tennis}'
 WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

DO $$
DECLARE n int;
BEGIN
  -- The platform reads recintos (the /admin count), and the other club still has none.
  SELECT count(*) INTO n FROM playing_area WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL test 3: the platform read % recintos, expected the pool''s', n; END IF;
END $$;

RESET ROLE;
SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

INSERT INTO playing_area (organization_id, facility_id, sport_id, name) VALUES
  (current_organization_id(), 'a1111111-1111-1111-1111-111111111111', 'tennis', 'Campo Central'),
  (current_organization_id(), 'a1111111-1111-1111-1111-111111111111', 'tennis', 'Campo 2');

DO $$
BEGIN
  RAISE NOTICE 'PASS test 3: the platform switched tennis on, and the courts were made';
END $$;

-- The other club is untouched: still {pool}, still refused.
SELECT set_config('app.organization_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);

DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO playing_area (organization_id, facility_id, sport_id, name)
      VALUES (current_organization_id(), 'b1111111-1111-1111-1111-111111111111', 'tennis', 'Campo B');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3: switching tennis on for A switched it on for B'; END IF;
  RAISE NOTICE 'PASS test 3b: another club''s switch reaches nobody else';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — tennis cannot be switched off while a court is live; the refusal names them
-- ---------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE poolse_platform;

DO $$
DECLARE ok boolean := false; v_detail text;
BEGIN
  BEGIN
    UPDATE organization SET enabled_sports = '{pool}'
     WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    ok := v_detail = 'sport_in_use|tennis|Campo 2, Campo Central';
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4: tennis switched off over live courts (%)', v_detail; END IF;
  RAISE NOTICE 'PASS test 4: a sport with live courts stays on, and the refusal names them';
END $$;

-- Archive them (the club's act), and the switch goes through.
RESET ROLE;
SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
UPDATE playing_area SET archived_at = now() WHERE sport_id = 'tennis';

RESET ROLE;
SET LOCAL ROLE poolse_platform;
UPDATE organization SET enabled_sports = '{pool}' WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- And an archived court does not come back from the bin while its sport is off.
RESET ROLE;
SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    UPDATE playing_area SET archived_at = NULL WHERE name = 'Campo 2';
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4: a court was restored with its sport off'; END IF;
  RAISE NOTICE 'PASS test 4b: archived first, then switched off; and no restore while it is off';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — the pool never leaves, and the catalogue is the only source of keys
-- ---------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE poolse_platform;

DO $$
DECLARE ok boolean := false; v_detail text;
BEGIN
  BEGIN
    UPDATE organization SET enabled_sports = '{tennis}' WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 5: pool was switched off'; END IF;

  ok := false;
  BEGIN
    UPDATE organization SET enabled_sports = '{pool,curling}' WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    ok := v_detail = 'sport_unknown|curling';
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 5: an unknown sport was switched on (%)', v_detail; END IF;
  RAISE NOTICE 'PASS test 5: pool is always on, and only a catalogue sport can be';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — an add-on's price: never the pool's, never negative
-- ---------------------------------------------------------------------------

RESET ROLE;

DO $$
DECLARE ok boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM sport WHERE addon_monthly_cents IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL test 6: a sport arrived priced';
  END IF;
  BEGIN
    UPDATE sport SET addon_monthly_cents = 1000 WHERE id = 'pool';
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 6: the pool was priced as an add-on'; END IF;
  RAISE NOTICE 'PASS test 6: every add-on is unpriced, and the pool is never one';
END $$;

ROLLBACK;
