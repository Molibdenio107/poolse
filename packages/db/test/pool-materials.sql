-- What is in the pool room — round 4.
--
-- Two things here are worth asserting rather than reading. The name is free text
-- on purpose, so the *only* thing standing between a club and two rows for the
-- same pile of floats is the accent- and case-insensitive unique index — and a
-- duplicate is not a loud failure, it is a count that quietly stops meaning
-- anything. And that index has to be partial, or archiving an item makes its
-- name permanently unusable, which is the trap CLAUDE.md names.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_m', 'm@clube.pt', 'Rui', 'Fonseca', NULL, '2026-08-29 09:00:00+00');

-- Fixed ids: test 5 runs under RLS as `poolse_app`, where a lookup by name
-- returns nothing and would leave a null id passing for the wrong reason.
INSERT INTO organization (id, name, slug) VALUES
  ('33333333-3333-3333-3333-333333333333', 'Clube Material', 'clube-material'),
  ('44444444-4444-4444-4444-444444444444', 'Clube Vizinho M', 'clube-vizinho-m');

DO $$
DECLARE v_org uuid; v_facility uuid;
BEGIN
  v_org := '33333333-3333-3333-3333-333333333333';

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Municipal')
  RETURNING id INTO v_facility;

  INSERT INTO pool (organization_id, facility_id, name, kind) VALUES
    (v_org, v_facility, 'Tanque Grande', 'indoor'),
    (v_org, v_facility, 'Tanque de Aprendizagem', 'indoor');
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — an item is a name and a count, and zero is an answer
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_pool uuid; n int; q int;
BEGIN
  v_org := '33333333-3333-3333-3333-333333333333';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org AND name = 'Tanque Grande';

  INSERT INTO pool_material (organization_id, pool_id, name, quantity) VALUES
    (v_org, v_pool, 'Flutuadores', 24),
    (v_org, v_pool, 'Pranchas', 18),
    -- "We have a box for these and it is empty" is a different fact from having
    -- no row at all, and the operator who did the stock check wants to record it.
    (v_org, v_pool, 'Arcos', 0);

  SELECT count(*) INTO n FROM pool_material WHERE pool_id = v_pool AND archived_at IS NULL;
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL test 1a: expected 3 items, got %', n;
  END IF;

  SELECT quantity INTO q FROM pool_material WHERE pool_id = v_pool AND name = 'Arcos';
  IF q <> 0 THEN
    RAISE EXCEPTION 'FAIL test 1b: zero was not stored as zero (%)', q;
  END IF;

  -- A negative count is not a shortage, it is a typo.
  BEGIN
    INSERT INTO pool_material (organization_id, pool_id, name, quantity)
    VALUES (v_org, v_pool, 'Halteres', -1);
    RAISE EXCEPTION 'FAIL test 1c: a negative quantity was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- An untouched form field sends a blank, and a blank is not a name.
  BEGIN
    INSERT INTO pool_material (organization_id, pool_id, name) VALUES (v_org, v_pool, '   ');
    RAISE EXCEPTION 'FAIL test 1d: a blank name was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 1: an item is a free-text name and a count, and zero counts';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — one row per kind of item, whatever the accents and the case
--
-- The name is free text, so this index is the only thing between a club and two
-- rows for the same pile of floats. A duplicate does not fail loudly; it just
-- makes the count wrong in a way nobody notices until they trust it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_pool uuid;
BEGIN
  v_org := '33333333-3333-3333-3333-333333333333';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org AND name = 'Tanque Grande';

  BEGIN
    INSERT INTO pool_material (organization_id, pool_id, name, quantity)
    VALUES (v_org, v_pool, 'flutuadores', 5);
    RAISE EXCEPTION 'FAIL test 2a: the same item was recorded twice in different case';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO pool_material (organization_id, pool_id, name, quantity)
    VALUES (v_org, v_pool, 'Flutuádores', 5);
    RAISE EXCEPTION 'FAIL test 2b: an accent was enough to duplicate an item';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 2: one row per kind of item, ignoring case and accents';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — the same name at a different pool is a different pile
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_other uuid; n int;
BEGIN
  v_org := '33333333-3333-3333-3333-333333333333';
  SELECT id INTO v_other FROM pool WHERE organization_id = v_org AND name = 'Tanque de Aprendizagem';

  INSERT INTO pool_material (organization_id, pool_id, name, quantity)
  VALUES (v_org, v_other, 'Flutuadores', 40);

  SELECT count(*) INTO n
    FROM pool_material WHERE organization_id = v_org AND name ILIKE 'flutuadores';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 3: two pools should each hold their own floats, got % rows', n;
  END IF;

  RAISE NOTICE 'PASS test 3: kit belongs to a pool, not to the building';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — archiving an item frees its name again
--
-- The trap CLAUDE.md names: without the partial index, archiving "Pranchas" and
-- buying more next season violates the constraint against a dead row, and the
-- operator cannot record kit they are holding.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_pool uuid; n int;
BEGIN
  v_org := '33333333-3333-3333-3333-333333333333';
  SELECT id INTO v_pool FROM pool WHERE organization_id = v_org AND name = 'Tanque Grande';

  UPDATE pool_material SET archived_at = now()
   WHERE pool_id = v_pool AND name = 'Pranchas';

  INSERT INTO pool_material (organization_id, pool_id, name, quantity)
  VALUES (v_org, v_pool, 'Pranchas', 30);

  -- The old row is still there — history is soft-deleted, never destroyed.
  SELECT count(*) INTO n FROM pool_material WHERE pool_id = v_pool AND name = 'Pranchas';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 4: expected the archived row and the new one, got %', n;
  END IF;

  RAISE NOTICE 'PASS test 4: an archived item does not hold its name hostage';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — inventory is the tenant's own
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_a uuid := '33333333-3333-3333-3333-333333333333';
  v_b uuid := '44444444-4444-4444-4444-444444444444';
  n int;
BEGIN
  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM pool_material WHERE organization_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 5: the neighbouring club could read % of our items', n;
  END IF;

  PERFORM set_config('app.organization_id', v_a::text, true);

  SELECT count(*) INTO n FROM pool_material WHERE organization_id = v_a AND archived_at IS NULL;
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL test 5b: our own inventory was not visible to us';
  END IF;

  RAISE NOTICE 'PASS test 5: inventory is visible only to the pool''s own tenant';
END $$;

RESET ROLE;

ROLLBACK;
