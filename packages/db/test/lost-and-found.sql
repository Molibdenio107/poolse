-- Lost and found — round 5, ticket 6.1.
--
-- A new tenant table with a policy nobody tests is a policy that may not work,
-- so test 4 is the one that earns its place: another club's lost property must
-- be invisible, and a row naming another club's student must be refused by the
-- composite key rather than by anybody remembering to scope a query.
--
-- The other three cover the rules the schema is carrying on behalf of the API:
-- a status and its timestamp cannot disagree, nobody is notified about an item
-- with no owner, and a description is not blank.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_lf', 'lf@clube.pt', 'Rui', 'Fonseca', NULL, '2026-09-01 09:00:00+00');

INSERT INTO organization (id, name, slug) VALUES
  ('99999999-6666-4444-8888-999999999999', 'Clube Achados', 'clube-achados'),
  ('99999999-7777-4444-8888-999999999999', 'Clube Vizinho LF', 'clube-vizinho-lf');

DO $$
DECLARE v_org uuid; v_fac uuid; v_student uuid;
BEGIN
  v_org := '99999999-6666-4444-8888-999999999999';

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Municipal')
  RETURNING id INTO v_fac;
  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'Duarte', 'Melo') RETURNING id INTO v_student;

  -- The ordinary case: a towel on a bench, belonging to nobody yet.
  INSERT INTO lost_and_found_item (organization_id, facility_id, description, location_found)
  VALUES (v_org, v_fac, 'Toalha azul', 'Balneário masculino');

  -- And one that has been claimed.
  INSERT INTO lost_and_found_item
    (organization_id, facility_id, description, location_found, student_id)
  VALUES (v_org, v_fac, 'Óculos Speedo', 'Bancada', v_student);
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — a status and its timestamp cannot disagree
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_item uuid; ok boolean := false;
BEGIN
  v_org := '99999999-6666-4444-8888-999999999999';
  SELECT id INTO v_item FROM lost_and_found_item
   WHERE organization_id = v_org AND description = 'Toalha azul';

  -- Returned without a moment, or a moment without being returned. Both are the
  -- same fact written twice, and the schema keeps them honest rather than
  -- whichever code path happens to set them.
  BEGIN
    UPDATE lost_and_found_item SET status = 'returned' WHERE id = v_item;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1: returned with no returned_at'; END IF;

  ok := false;
  BEGIN
    UPDATE lost_and_found_item SET returned_at = now() WHERE id = v_item;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1b: returned_at while still found'; END IF;

  -- Both together is the real thing, and works.
  UPDATE lost_and_found_item
     SET status = 'returned', returned_at = now()
   WHERE id = v_item;

  RAISE NOTICE 'PASS test 1: returning an item sets both halves or neither';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — nobody is notified about an item with no owner
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_fac uuid; ok boolean := false;
BEGIN
  v_org := '99999999-6666-4444-8888-999999999999';
  SELECT id INTO v_fac FROM facility WHERE organization_id = v_org;

  BEGIN
    INSERT INTO lost_and_found_item
      (organization_id, facility_id, description, student_notified_at)
    VALUES (v_org, v_fac, 'Chinelos', now());
  EXCEPTION WHEN check_violation THEN ok := true;
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 2: an ownerless item was marked as notified';
  END IF;

  -- A blank description is not a description either.
  ok := false;
  BEGIN
    INSERT INTO lost_and_found_item (organization_id, facility_id, description)
    VALUES (v_org, v_fac, '   ');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2b: a blank description was accepted'; END IF;

  RAISE NOTICE 'PASS test 2: notified needs an owner, and a description needs words';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — telling a student is a stamp, and it survives being returned
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_item uuid; v_when timestamptz;
BEGIN
  v_org := '99999999-6666-4444-8888-999999999999';
  SELECT id INTO v_item FROM lost_and_found_item
   WHERE organization_id = v_org AND description = 'Óculos Speedo';

  UPDATE lost_and_found_item
     SET student_notified_at = '2026-09-02 10:00:00+00'
   WHERE id = v_item;

  UPDATE lost_and_found_item
     SET status = 'returned', returned_at = now()
   WHERE id = v_item;

  SELECT student_notified_at INTO v_when FROM lost_and_found_item WHERE id = v_item;
  IF v_when IS NULL THEN
    RAISE EXCEPTION 'FAIL test 3: closing the item forgot that the student was told';
  END IF;

  RAISE NOTICE 'PASS test 3: the notification stamp outlives the item being returned';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — the tenant boundary
--
-- The one that matters for a new table. Another club's lost property is
-- invisible, and a row naming another club's student is refused by the composite
-- key rather than by anybody remembering a WHERE clause.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_other uuid; v_other_fac uuid; v_student uuid; v_seen int; ok boolean := false;
BEGIN
  v_org   := '99999999-6666-4444-8888-999999999999';
  v_other := '99999999-7777-4444-8888-999999999999';

  INSERT INTO facility (organization_id, name) VALUES (v_other, 'Piscina Vizinha')
  RETURNING id INTO v_other_fac;

  SELECT id INTO v_student FROM student WHERE organization_id = v_org;

  -- The neighbour's site, holding the first club's student. The composite key is
  -- the only thing standing in the way, and it is enough.
  BEGIN
    INSERT INTO lost_and_found_item
      (organization_id, facility_id, description, student_id)
    VALUES (v_other, v_other_fac, 'Touca emprestada', v_student);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 4: a club claimed another club''s student';
  END IF;

  -- And an ordinary row of their own is theirs alone.
  INSERT INTO lost_and_found_item (organization_id, facility_id, description)
  VALUES (v_other, v_other_fac, 'Garrafa');

  /*
   * `SET LOCAL ROLE poolse_app` before counting, and it is the whole point.
   *
   * This file runs as the owner, which *bypasses* row-level security — so a
   * count taken here without switching role sees all three rows and would pass
   * whatever the policy said. The first version of this test did exactly that
   * and reported 3, which is the policy being ignored rather than broken.
   *
   * The app never connects as the owner (`assertRlsApplies` refuses to boot if
   * it does), so this is the role the question has to be asked as.
   */
  SET LOCAL ROLE poolse_app;
  PERFORM set_config('app.organization_id', v_org::text, true);
  SELECT count(*) INTO v_seen FROM lost_and_found_item;

  IF v_seen <> 2 THEN
    RAISE EXCEPTION 'FAIL test 4b: scoped to one club, saw % rows instead of 2', v_seen;
  END IF;

  -- And no tenant at all sees nothing, rather than everything.
  PERFORM set_config('app.organization_id', '', true);
  SELECT count(*) INTO v_seen FROM lost_and_found_item;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'FAIL test 4c: no tenant set saw % rows instead of none', v_seen;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS test 4: lost property stops at the tenant boundary';
END $$;

ROLLBACK;
