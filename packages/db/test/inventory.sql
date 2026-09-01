-- What the club owns, and which tanks it serves — round 6.
--
-- Replaces `pool-materials.sql`. The two assertions it made are still here — the
-- accent- and case-insensitive unique index, and the fact that it is partial —
-- because both still guard the same things: a duplicate does not fail loudly, it
-- makes a count quietly stop meaning anything, and a non-partial index would make
-- an archived item's name permanently unusable.
--
-- What is new is the scope. An item belongs to a facility and serves the building,
-- a chosen set of pools, or all of them; the interesting property is that "a
-- chosen set" cannot reach a pool at another site. That is a composite key routed
-- through `facility_id`, not an application check, and it is worth proving.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_m', 'm@clube.pt', 'Rui', 'Fonseca', NULL, '2026-08-29 09:00:00+00');

-- Fixed ids: test 6 runs under RLS as `poolse_app`, where a lookup by name
-- returns nothing and would leave a null id passing for the wrong reason.
INSERT INTO organization (id, name, slug) VALUES
  ('33333333-3333-3333-3333-333333333333', 'Clube Material', 'clube-material'),
  ('44444444-4444-4444-4444-444444444444', 'Clube Vizinho M', 'clube-vizinho-m');

DO $$
DECLARE v_org uuid; v_municipal uuid; v_hotel uuid;
BEGIN
  v_org := '33333333-3333-3333-3333-333333333333';

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Municipal')
  RETURNING id INTO v_municipal;

  -- A second site in the same club. The whole point of the facility key is that
  -- these two do not share a store room.
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Hotel Mar')
  RETURNING id INTO v_hotel;

  INSERT INTO pool (organization_id, facility_id, name, kind) VALUES
    (v_org, v_municipal, 'Tanque Grande', 'indoor'),
    (v_org, v_municipal, 'Tanque de Aprendizagem', 'indoor'),
    (v_org, v_hotel, 'Tanque do Hotel', 'indoor');
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — an item is a name and a count, and zero is an answer
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; n int; q int;
BEGIN
  v_org := '33333333-3333-3333-3333-333333333333';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org AND name = 'Piscina Municipal';

  INSERT INTO inventory_item (organization_id, facility_id, name, quantity, scope) VALUES
    (v_org, v_facility, 'Flutuadores', 24, 'all_pools'),
    (v_org, v_facility, 'Pranchas', 18, 'pools'),
    -- "We have a box for these and it is empty" is a different fact from having
    -- no row at all, and the operator who did the stock check wants to record it.
    (v_org, v_facility, 'Arcos', 0, 'facility');

  SELECT count(*) INTO n
    FROM inventory_item WHERE facility_id = v_facility AND archived_at IS NULL;
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL test 1a: expected 3 items, got %', n;
  END IF;

  SELECT quantity INTO q
    FROM inventory_item WHERE facility_id = v_facility AND name = 'Arcos';
  IF q <> 0 THEN
    RAISE EXCEPTION 'FAIL test 1b: zero was not stored as zero (%)', q;
  END IF;

  -- A negative count is not a shortage, it is a typo.
  BEGIN
    INSERT INTO inventory_item (organization_id, facility_id, name, quantity)
    VALUES (v_org, v_facility, 'Halteres', -1);
    RAISE EXCEPTION 'FAIL test 1c: a negative quantity was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- An untouched form field sends a blank, and a blank is not a name.
  BEGIN
    INSERT INTO inventory_item (organization_id, facility_id, name)
    VALUES (v_org, v_facility, '   ');
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
DECLARE v_org uuid; v_facility uuid;
BEGIN
  v_org := '33333333-3333-3333-3333-333333333333';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org AND name = 'Piscina Municipal';

  BEGIN
    INSERT INTO inventory_item (organization_id, facility_id, name, quantity)
    VALUES (v_org, v_facility, 'flutuadores', 5);
    RAISE EXCEPTION 'FAIL test 2a: the same item was recorded twice in different case';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO inventory_item (organization_id, facility_id, name, quantity)
    VALUES (v_org, v_facility, 'Flutuádores', 5);
    RAISE EXCEPTION 'FAIL test 2b: an accent was enough to duplicate an item';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- A different scope is not a different item. Two "Pranchas" rows at one site,
  -- one for the learner tank and one for the main tank, is exactly the
  -- duplication this model replaced — the second is a pool added to the first.
  BEGIN
    INSERT INTO inventory_item (organization_id, facility_id, name, quantity, scope)
    VALUES (v_org, v_facility, 'Pranchas', 30, 'facility');
    RAISE EXCEPTION 'FAIL test 2c: the same name was recorded twice under a different scope';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 2: one row per kind of item, ignoring case, accents and scope';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — the same name at another site is another store room
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_hotel uuid; n int;
BEGIN
  v_org := '33333333-3333-3333-3333-333333333333';
  SELECT id INTO v_hotel FROM facility WHERE organization_id = v_org AND name = 'Hotel Mar';

  INSERT INTO inventory_item (organization_id, facility_id, name, quantity, scope)
  VALUES (v_org, v_hotel, 'Flutuadores', 40, 'all_pools');

  SELECT count(*) INTO n
    FROM inventory_item WHERE organization_id = v_org AND name ILIKE 'flutuadores';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 3: each site should hold its own floats, got % rows', n;
  END IF;

  RAISE NOTICE 'PASS test 3: kit belongs to a site, and two sites do not share a store room';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — a chosen set of pools cannot reach across the car park
--
-- The composite key routes through `facility_id`, so "these two tanks" is
-- checked against the item's own site rather than against the tenant. Without
-- it, an admin at a club with two sites could attach the municipal pool's lane
-- ropes to the hotel's tank and nothing would object.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_municipal uuid; v_item uuid; v_own uuid; v_foreign uuid; n int;
BEGIN
  v_org := '33333333-3333-3333-3333-333333333333';
  SELECT id INTO v_municipal FROM facility WHERE organization_id = v_org AND name = 'Piscina Municipal';
  SELECT id INTO v_item FROM inventory_item
   WHERE facility_id = v_municipal AND name = 'Pranchas';
  SELECT id INTO v_own FROM pool WHERE organization_id = v_org AND name = 'Tanque Grande';
  SELECT id INTO v_foreign FROM pool WHERE organization_id = v_org AND name = 'Tanque do Hotel';

  INSERT INTO inventory_item_pool (organization_id, facility_id, item_id, pool_id)
  VALUES (v_org, v_municipal, v_item, v_own);

  SELECT count(*) INTO n FROM inventory_item_pool WHERE item_id = v_item;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 4a: the pool at this site was not attached, got % rows', n;
  END IF;

  BEGIN
    INSERT INTO inventory_item_pool (organization_id, facility_id, item_id, pool_id)
    VALUES (v_org, v_municipal, v_item, v_foreign);
    RAISE EXCEPTION 'FAIL test 4b: an item was attached to a pool at another site';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 4: a pools-scoped item can only name tanks at its own site';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — archiving an item frees its name again
--
-- The trap CLAUDE.md names: without the partial index, archiving "Pranchas" and
-- buying more next season violates the constraint against a dead row, and the
-- operator cannot record kit they are holding.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; n int;
BEGIN
  v_org := '33333333-3333-3333-3333-333333333333';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org AND name = 'Piscina Municipal';

  UPDATE inventory_item SET archived_at = now()
   WHERE facility_id = v_facility AND name = 'Pranchas';

  INSERT INTO inventory_item (organization_id, facility_id, name, quantity, scope)
  VALUES (v_org, v_facility, 'Pranchas', 30, 'facility');

  -- The old row is still there — history is soft-deleted, never destroyed.
  SELECT count(*) INTO n FROM inventory_item WHERE facility_id = v_facility AND name = 'Pranchas';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 5: expected the archived row and the new one, got %', n;
  END IF;

  RAISE NOTICE 'PASS test 5: an archived item does not hold its name hostage';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — inventory is the tenant's own
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_a uuid := '33333333-3333-3333-3333-333333333333';
  v_b uuid := '44444444-4444-4444-4444-444444444444';
  n int;
BEGIN
  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM inventory_item WHERE organization_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6a: the neighbouring club could read % of our items', n;
  END IF;

  -- The junction has a policy of its own. Without one it would be readable by
  -- anybody, and "which tanks does this serve" is as much the club's business as
  -- the item is.
  SELECT count(*) INTO n FROM inventory_item_pool WHERE organization_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6b: the neighbouring club could read % of our scopes', n;
  END IF;

  PERFORM set_config('app.organization_id', v_a::text, true);

  SELECT count(*) INTO n
    FROM inventory_item WHERE organization_id = v_a AND archived_at IS NULL;
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL test 6c: our own inventory was not visible to us';
  END IF;

  RAISE NOTICE 'PASS test 6: inventory and its scope are visible only to their own tenant';
END $$;

RESET ROLE;

ROLLBACK;
