-- Espaços, cleaning and issues — round 6.
--
-- Three new tenant tables, so test 5 is the one that has to exist: a policy
-- nobody tests is a policy that may not work.
--
-- The other four are the rules the interface reads back but does not own. Test 1
-- is the most valuable of them — "overdue" is computed at query time from the
-- last cleaning, and the thing that makes it trustworthy is that an *archived*
-- log does not count. Get that wrong and deleting a mistaken entry leaves a
-- space looking clean, which is the one outcome a cleaning log exists to
-- prevent.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('77777777-1111-4444-8888-777777777777', 'Clube Espaco', 'clube-espaco'),
  ('77777777-2222-4444-8888-777777777777', 'Clube Vizinho ES', 'clube-vizinho-es');

-- The neighbour runs two sites, so it holds a two-site licence. Test 5b needs
-- them: the interesting boundary is a request naming a space at the *other* site
-- of the same club, and `max_facilities` defaults to 1.
UPDATE organization SET max_facilities = 2
 WHERE id = '77777777-2222-4444-8888-777777777777';

DO $$
DECLARE v_org uuid; v_fac uuid; v_member uuid;
BEGIN
  v_org := '77777777-1111-4444-8888-777777777777';

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Municipal')
  RETURNING id INTO v_fac;

  INSERT INTO membership (organization_id, status, first_name, last_name, email)
  VALUES (v_org, 'active', 'Ana', 'Ribeiro', 'ana.es@clube.pt')
  RETURNING id INTO v_member;

  INSERT INTO space (organization_id, facility_id, name, type, expected_cleaning_interval_hours) VALUES
    (v_org, v_fac, 'Balneário Masculino', 'changing_room', 24),
    (v_org, v_fac, 'Sala de Máquinas',    'technical',     168),
    (v_org, v_fac, 'Parque',              'outdoor',       NULL);
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — overdue is derived, and an archived cleaning did not happen
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_member uuid; v_space uuid; v_log uuid;
  v_last timestamptz; v_overdue boolean;
BEGIN
  v_org := '77777777-1111-4444-8888-777777777777';
  SELECT id INTO v_member FROM membership WHERE organization_id = v_org;
  SELECT id INTO v_space FROM space
   WHERE organization_id = v_org AND name = 'Balneário Masculino';

  /*
   * Never cleaned, and an interval set. The list must call this overdue rather
   * than blank — a balneário nobody has ever cleaned is the most overdue thing
   * on the site, and treating "no history" as "fine" would hide exactly the
   * spaces this feature was built to surface.
   */
  SELECT max(performed_at) INTO v_last
    FROM cleaning_log
   WHERE organization_id = v_org AND space_id = v_space AND archived_at IS NULL;

  IF v_last IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 1: a space with no logs reported a last cleaning';
  END IF;

  -- Cleaned two days ago against a 24-hour interval: overdue.
  INSERT INTO cleaning_log (organization_id, space_id, performed_by, performed_at)
  VALUES (v_org, v_space, v_member, now() - interval '2 days')
  RETURNING id INTO v_log;

  SELECT now() - max(performed_at) > make_interval(hours => 24) INTO v_overdue
    FROM cleaning_log
   WHERE organization_id = v_org AND space_id = v_space AND archived_at IS NULL;

  IF NOT v_overdue THEN
    RAISE EXCEPTION 'FAIL test 1a: two days since cleaning, 24h interval, not overdue';
  END IF;

  -- Cleaned an hour ago: not overdue.
  INSERT INTO cleaning_log (organization_id, space_id, performed_by, performed_at)
  VALUES (v_org, v_space, v_member, now() - interval '1 hour');

  SELECT now() - max(performed_at) > make_interval(hours => 24) INTO v_overdue
    FROM cleaning_log
   WHERE organization_id = v_org AND space_id = v_space AND archived_at IS NULL;

  IF v_overdue THEN
    RAISE EXCEPTION 'FAIL test 1b: cleaned an hour ago and still overdue';
  END IF;

  /*
   * The rule that matters. An admin deletes the hour-old entry because it was
   * logged against the wrong room; the space must go straight back to overdue,
   * because as far as anybody knows it has not been cleaned since Tuesday.
   */
  UPDATE cleaning_log SET archived_at = now()
   WHERE organization_id = v_org AND space_id = v_space
     AND performed_at > now() - interval '2 hours';

  SELECT now() - max(performed_at) > make_interval(hours => 24) INTO v_overdue
    FROM cleaning_log
   WHERE organization_id = v_org AND space_id = v_space AND archived_at IS NULL;

  IF NOT v_overdue THEN
    RAISE EXCEPTION 'FAIL test 1c: an archived cleaning still counted as a cleaning';
  END IF;

  RAISE NOTICE 'PASS test 1: overdue is derived, and an archived log does not count';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — a null interval never goes overdue, and zero is refused
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_fac uuid; v_interval integer; ok boolean := false;
BEGIN
  v_org := '77777777-1111-4444-8888-777777777777';
  SELECT id INTO v_fac FROM facility WHERE organization_id = v_org;

  -- Null is "no schedule", never "overdue immediately". The same rule the tank
  -- ceilings follow: a null means not measured, and it enforces nothing.
  SELECT expected_cleaning_interval_hours INTO v_interval
    FROM space WHERE organization_id = v_org AND name = 'Parque';

  IF v_interval IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 2: the unscheduled space carried an interval';
  END IF;

  -- And zero is not a schedule either — it would mean permanently overdue,
  -- which nobody would type on purpose.
  BEGIN
    INSERT INTO space (organization_id, facility_id, name, expected_cleaning_interval_hours)
    VALUES (v_org, v_fac, 'Sala Zero', 0);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 2b: an interval of zero hours was accepted';
  END IF;

  RAISE NOTICE 'PASS test 2: null means no schedule, and zero is refused';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — one name per site, accents and case aside, and archiving frees it
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_fac uuid; ok boolean := false;
BEGIN
  v_org := '77777777-1111-4444-8888-777777777777';
  SELECT id INTO v_fac FROM facility WHERE organization_id = v_org;

  -- "balneario masculino" is the same room as "Balneário Masculino". The
  -- inventory locations this table was seeded from were typed by hand over
  -- years, so the index has to be the forgiving one or the backfill itself
  -- would have failed.
  BEGIN
    INSERT INTO space (organization_id, facility_id, name)
    VALUES (v_org, v_fac, 'balneario masculino');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 3: one room was named twice';
  END IF;

  -- Partial, so a space archived in June can come back in September.
  UPDATE space SET archived_at = now()
   WHERE organization_id = v_org AND name = 'Balneário Masculino';

  INSERT INTO space (organization_id, facility_id, name)
  VALUES (v_org, v_fac, 'Balneário Masculino');

  RAISE NOTICE 'PASS test 3: one name per site, and archiving frees it';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — a request's status and its evidence cannot disagree
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_fac uuid; v_member uuid; v_space uuid; v_req uuid;
  ok boolean := false;
BEGIN
  v_org := '77777777-1111-4444-8888-777777777777';
  SELECT id INTO v_fac FROM facility WHERE organization_id = v_org;
  SELECT id INTO v_member FROM membership WHERE organization_id = v_org;
  SELECT id INTO v_space FROM space
   WHERE organization_id = v_org AND name = 'Sala de Máquinas';

  INSERT INTO maintenance_request
    (organization_id, facility_id, space_id, type, description, reported_by)
  VALUES (v_org, v_fac, v_space, 'fault', 'A bomba faz um ruído estranho', v_member)
  RETURNING id INTO v_req;

  -- Resolved, with nobody named as having resolved it. The screen would have to
  -- render "Resolvido por —", and an operator would reasonably read that as a
  -- bug in the page rather than a bug in the data.
  BEGIN
    UPDATE maintenance_request SET status = 'resolved' WHERE id = v_req;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 4: a request resolved itself with no resolver';
  END IF;

  -- Open, but carrying a resolver. The other half of the same rule.
  ok := false;
  BEGIN
    UPDATE maintenance_request
       SET resolved_by = v_member, resolved_at = now()
     WHERE id = v_req;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 4b: an open request named who resolved it';
  END IF;

  -- The honest resolution passes.
  UPDATE maintenance_request
     SET status = 'resolved', resolved_by = v_member, resolved_at = now(),
         resolution_note = 'Substituído o rolamento'
   WHERE id = v_req;

  -- A description of spaces is not a description.
  ok := false;
  BEGIN
    INSERT INTO maintenance_request
      (organization_id, facility_id, space_id, type, description, reported_by)
    VALUES (v_org, v_fac, v_space, 'restock', '   ', v_member);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 4c: a request of whitespace was accepted';
  END IF;

  RAISE NOTICE 'PASS test 4: status and evidence agree, and a blank report is refused';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — the tenant boundary, and the site boundary inside it
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_other uuid;
  v_space uuid; v_fac uuid;
  v_other_fac uuid; v_other_fac_2 uuid; v_other_member uuid; v_other_space uuid;
  v_seen integer; ok boolean := false;
BEGIN
  v_org   := '77777777-1111-4444-8888-777777777777';
  v_other := '77777777-2222-4444-8888-777777777777';

  SELECT id INTO v_fac FROM facility WHERE organization_id = v_org;
  SELECT id INTO v_space FROM space
   WHERE organization_id = v_org AND name = 'Sala de Máquinas';

  INSERT INTO facility (organization_id, name) VALUES (v_other, 'Piscina Vizinha')
  RETURNING id INTO v_other_fac;
  INSERT INTO facility (organization_id, name) VALUES (v_other, 'Piscina Vizinha 2')
  RETURNING id INTO v_other_fac_2;
  INSERT INTO membership (organization_id, status, first_name, last_name, email)
  VALUES (v_other, 'active', 'Bruno', 'Costa', 'bruno.es@vizinho.pt')
  RETURNING id INTO v_other_member;
  INSERT INTO space (organization_id, facility_id, name)
  VALUES (v_other, v_other_fac, 'Receção')
  RETURNING id INTO v_other_space;

  -- The neighbour logging a cleaning against this club's sala de máquinas. Both
  -- rows pass their own RLS policy, so the composite key is the only thing in
  -- the way — and it is enough.
  BEGIN
    INSERT INTO cleaning_log (organization_id, space_id, performed_by)
    VALUES (v_other, v_space, v_other_member);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 5: a club logged a cleaning of another club''s space';
  END IF;

  /*
   * And the boundary *inside* a tenant: a request filed at one site naming a
   * space at another. The key routes through facility_id precisely so that a
   * multi-site câmara cannot report the Alvalade balneário as broken on the
   * Benfica issue list.
   */
  ok := false;
  BEGIN
    INSERT INTO maintenance_request
      (organization_id, facility_id, space_id, type, description, reported_by)
    VALUES (v_other, v_other_fac_2, v_other_space, 'fault', 'Porta emperrada', v_other_member);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 5b: a request named a space at another site';
  END IF;

  -- Their own, at their own site, is fine.
  INSERT INTO maintenance_request
    (organization_id, facility_id, space_id, type, description, reported_by)
  VALUES (v_other, v_other_fac, v_other_space, 'fault', 'Porta emperrada', v_other_member);

  /*
   * `SET LOCAL ROLE poolse_app` before counting: this file runs as the owner,
   * which bypasses row-level security, so a count taken without switching role
   * would pass whatever the policy said.
   */
  SET LOCAL ROLE poolse_app;
  PERFORM set_config('app.organization_id', v_other::text, true);

  SELECT count(*) INTO v_seen FROM space;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'FAIL test 5c: scoped to one club, saw % spaces instead of 1', v_seen;
  END IF;

  SELECT count(*) INTO v_seen FROM maintenance_request;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'FAIL test 5d: scoped to one club, saw % requests instead of 1', v_seen;
  END IF;

  SELECT count(*) INTO v_seen FROM cleaning_log;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'FAIL test 5e: scoped to one club, saw % cleaning logs instead of none', v_seen;
  END IF;

  -- No tenant at all sees nothing, rather than everything.
  PERFORM set_config('app.organization_id', '', true);

  SELECT count(*) INTO v_seen FROM space;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'FAIL test 5f: no tenant set saw % spaces instead of none', v_seen;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS test 5: spaces, cleanings and issues stop at both boundaries';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — an inventory item cannot be placed in another site's space
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_other uuid; v_fac uuid; v_item uuid; v_other_space uuid;
  ok boolean := false;
BEGIN
  v_org   := '77777777-1111-4444-8888-777777777777';
  v_other := '77777777-2222-4444-8888-777777777777';

  SELECT id INTO v_fac FROM facility WHERE organization_id = v_org;
  SELECT id INTO v_other_space FROM space WHERE organization_id = v_other;

  INSERT INTO inventory_item (organization_id, facility_id, name, quantity)
  VALUES (v_org, v_fac, 'Pranchas', 24)
  RETURNING id INTO v_item;

  -- The backfill matched items to spaces by text within a facility; this is what
  -- stops any later hand-edit from doing what the backfill could not.
  BEGIN
    UPDATE inventory_item SET space_id = v_other_space WHERE id = v_item;
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 6: kit was stored in another club''s room';
  END IF;

  -- An item nobody placed keeps a null space, which is a real answer and not a
  -- gap to be filled with an invented room.
  IF (SELECT space_id FROM inventory_item WHERE id = v_item) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 6b: an unplaced item was given a space';
  END IF;

  RAISE NOTICE 'PASS test 6: an item is placed at its own site or nowhere';
END $$;

ROLLBACK;
