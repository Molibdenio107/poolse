-- Vacation proof — backlog round 3, stories 6, 7 and 8.
--
-- Three tests here matter more than the rest.
--
-- Test 4 is the one that would otherwise become a support ticket nobody can
-- reproduce: being refused the 3rd of August must not stop you asking for the
-- 3rd of August again. The partial unique index and the trigger that archives a
-- refused request's days are what make that true, and neither is visible from
-- the API.
--
-- Test 7 is the isolation assertion the schema rules require for every new
-- tenant table: one club cannot read, write or reference another club's leave.
--
-- Test 8 holds the line the whole vacation feature rests on — a closure for
-- building works is not a public holiday, and must not quietly hand everybody a
-- free day.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_v_a', 'a@clube.pt', 'Rita',  'Lopes',   NULL, '2026-08-26 09:00:00+00');
SELECT provision_app_user('user_v_b', 'b@clube.pt', 'Tiago', 'Freitas', NULL, '2026-08-26 09:00:00+00');
SELECT provision_app_user('user_v_c', 'c@outro.pt', 'Carla', 'Nunes',   NULL, '2026-08-26 09:00:00+00');

INSERT INTO organization (name, slug) VALUES
  ('Clube A', 'clube-a-vac'),
  ('Clube B', 'clube-b-vac');

-- ---------------------------------------------------------------------------
-- Test 1 — entitlement defaults to the Portuguese statutory minimum
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_membership uuid; n int;
BEGIN
  v_org := (SELECT id FROM organization WHERE slug = 'clube-a-vac');

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, (SELECT id FROM app_user WHERE clerk_user_id = 'user_v_a'), 'active')
  RETURNING id INTO v_membership;

  SELECT vacation_days_per_year INTO n FROM membership WHERE id = v_membership;
  IF n <> 22 THEN
    RAISE EXCEPTION 'FAIL test 1a: a new membership defaulted to % days', n;
  END IF;

  -- A club may be more generous, or a part-timer fewer. What it may not be is
  -- negative or a number of days that does not fit in a year.
  UPDATE membership SET vacation_days_per_year = 25 WHERE id = v_membership;

  BEGIN
    UPDATE membership SET vacation_days_per_year = -1 WHERE id = v_membership;
    RAISE EXCEPTION 'FAIL test 1b: a negative entitlement was stored';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 1: entitlement defaults to 22 days and stays a possible number';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — a request is days, not a range, and starts pending
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_membership uuid; v_request uuid; n int; r record;
BEGIN
  v_org := (SELECT id FROM organization WHERE slug = 'clube-a-vac');
  v_membership := (SELECT m.id FROM membership m
                     JOIN app_user u ON u.id = m.app_user_id
                    WHERE u.clerk_user_id = 'user_v_a' AND m.organization_id = v_org);

  INSERT INTO vacation_request (organization_id, membership_id)
  VALUES (v_org, v_membership)
  RETURNING id INTO v_request;

  SELECT status, decided_at, decided_by_membership_id INTO r
    FROM vacation_request WHERE id = v_request;
  IF r.status <> 'pending' OR r.decided_at IS NOT NULL OR r.decided_by_membership_id IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 2a: a new request was born %', r.status;
  END IF;

  -- Monday and Friday of the same week — the case a start/end range cannot
  -- express without splitting into two requests.
  INSERT INTO vacation_day (organization_id, vacation_request_id, membership_id, day)
  VALUES (v_org, v_request, v_membership, DATE '2026-09-07'),
         (v_org, v_request, v_membership, DATE '2026-09-11');

  SELECT count(*) INTO n FROM vacation_day WHERE vacation_request_id = v_request;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 2b: expected two separate days, got %', n;
  END IF;

  RAISE NOTICE 'PASS test 2: a request holds separate days and starts pending';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — Sundays are not working days, in the database as well as the grid
--
-- The interface greys them out. A rule only the interface knows is a rule the
-- next caller breaks, and an import or a bulk action is exactly that caller.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_membership uuid; v_request uuid;
BEGIN
  v_org := (SELECT id FROM organization WHERE slug = 'clube-a-vac');
  v_membership := (SELECT m.id FROM membership m
                     JOIN app_user u ON u.id = m.app_user_id
                    WHERE u.clerk_user_id = 'user_v_a' AND m.organization_id = v_org);
  v_request := (SELECT id FROM vacation_request WHERE membership_id = v_membership LIMIT 1);

  BEGIN
    -- 2026-09-13 is a Sunday.
    INSERT INTO vacation_day (organization_id, vacation_request_id, membership_id, day)
    VALUES (v_org, v_request, v_membership, DATE '2026-09-13');
    RAISE EXCEPTION 'FAIL test 3: a Sunday was booked as leave';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 3: a Sunday cannot be booked as a vacation day';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — one day once, and a refusal gives the day back
--
-- Keep this one. The first half is the obvious rule. The second is the trap:
-- without the trigger that archives a refused request's days, being told "no"
-- for the 7th of September would block that person from ever asking again, and
-- the manager who refused would have created that with no way to see it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_a uuid; v_b uuid; v_request uuid; v_second uuid; v_third uuid; n int;
BEGIN
  v_org := (SELECT id FROM organization WHERE slug = 'clube-a-vac');
  v_a := (SELECT m.id FROM membership m JOIN app_user u ON u.id = m.app_user_id
           WHERE u.clerk_user_id = 'user_v_a' AND m.organization_id = v_org);
  v_request := (SELECT id FROM vacation_request WHERE membership_id = v_a LIMIT 1);

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, (SELECT id FROM app_user WHERE clerk_user_id = 'user_v_b'), 'active')
  RETURNING id INTO v_b;

  -- The same person cannot hold the same day twice, even across two requests.
  INSERT INTO vacation_request (organization_id, membership_id)
  VALUES (v_org, v_a) RETURNING id INTO v_second;

  BEGIN
    INSERT INTO vacation_day (organization_id, vacation_request_id, membership_id, day)
    VALUES (v_org, v_second, v_a, DATE '2026-09-07');
    RAISE EXCEPTION 'FAIL test 4a: the same day was booked twice by one person';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  -- A colleague may take the same day. Cover is a decision for the approver,
  -- not a constraint — story 7 shows who else is off rather than forbidding it.
  INSERT INTO vacation_request (organization_id, membership_id)
  VALUES (v_org, v_b) RETURNING id INTO v_third;
  INSERT INTO vacation_day (organization_id, vacation_request_id, membership_id, day)
  VALUES (v_org, v_third, v_b, DATE '2026-09-07');

  -- Now refuse the original. Its days must be released.
  UPDATE vacation_request
     SET status = 'rejected', decided_at = now(), decided_by_membership_id = v_b,
         decision_note = 'Semana de provas'
   WHERE id = v_request;

  SELECT count(*) INTO n
    FROM vacation_day WHERE vacation_request_id = v_request AND archived_at IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 4b: a refused request kept % live days', n;
  END IF;

  -- And the day can be asked for again.
  INSERT INTO vacation_day (organization_id, vacation_request_id, membership_id, day)
  VALUES (v_org, v_second, v_a, DATE '2026-09-07');

  RAISE NOTICE 'PASS test 4: one day once, and a refusal hands the day back';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — a decision is somebody's act, and a rejection carries a reason
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_a uuid; v_b uuid; v_request uuid;
BEGIN
  v_org := (SELECT id FROM organization WHERE slug = 'clube-a-vac');
  v_a := (SELECT m.id FROM membership m JOIN app_user u ON u.id = m.app_user_id
           WHERE u.clerk_user_id = 'user_v_a' AND m.organization_id = v_org);
  v_b := (SELECT m.id FROM membership m JOIN app_user u ON u.id = m.app_user_id
           WHERE u.clerk_user_id = 'user_v_b' AND m.organization_id = v_org);

  INSERT INTO vacation_request (organization_id, membership_id)
  VALUES (v_org, v_a) RETURNING id INTO v_request;

  -- Approved, but by nobody and at no time.
  BEGIN
    UPDATE vacation_request SET status = 'approved' WHERE id = v_request;
    RAISE EXCEPTION 'FAIL test 5a: a request was approved with no decision recorded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- Rejected with no reason. Story 7 is explicit, and this is the only place the
  -- rule cannot be forgotten by a caller written later.
  BEGIN
    UPDATE vacation_request
       SET status = 'rejected', decided_at = now(), decided_by_membership_id = v_b
     WHERE id = v_request;
    RAISE EXCEPTION 'FAIL test 5b: a rejection was stored with no note';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- Withdrawing is the requester's own act and needs no approver.
  UPDATE vacation_request
     SET status = 'withdrawn', decided_at = now()
   WHERE id = v_request;

  RAISE NOTICE 'PASS test 5: decisions record who and when; a rejection records why';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — withdrawing releases the days too
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_b uuid; v_request uuid; n int;
BEGIN
  v_org := (SELECT id FROM organization WHERE slug = 'clube-a-vac');
  v_b := (SELECT m.id FROM membership m JOIN app_user u ON u.id = m.app_user_id
           WHERE u.clerk_user_id = 'user_v_b' AND m.organization_id = v_org);

  INSERT INTO vacation_request (organization_id, membership_id)
  VALUES (v_org, v_b) RETURNING id INTO v_request;
  INSERT INTO vacation_day (organization_id, vacation_request_id, membership_id, day)
  VALUES (v_org, v_request, v_b, DATE '2026-10-05');

  UPDATE vacation_request SET status = 'withdrawn', decided_at = now() WHERE id = v_request;

  SELECT count(*) INTO n
    FROM vacation_day WHERE vacation_request_id = v_request AND archived_at IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6: a withdrawn request kept % live days', n;
  END IF;

  RAISE NOTICE 'PASS test 6: withdrawing a request releases its days';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — leave cannot cross tenants
--
-- The isolation assertion every new tenant-scoped table gets. Three attacks: an
-- unscoped read, a write aimed at the other tenant, and a day attached to
-- another organization's request.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_a uuid; v_b uuid; v_member_a uuid; v_member_b uuid; v_request_a uuid; n int;
BEGIN
  v_a := (SELECT id FROM organization WHERE slug = 'clube-a-vac');
  v_b := (SELECT id FROM organization WHERE slug = 'clube-b-vac');

  v_member_a := (SELECT m.id FROM membership m JOIN app_user u ON u.id = m.app_user_id
                  WHERE u.clerk_user_id = 'user_v_a' AND m.organization_id = v_a);

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_b, (SELECT id FROM app_user WHERE clerk_user_id = 'user_v_c'), 'active')
  RETURNING id INTO v_member_b;

  v_request_a := (SELECT id FROM vacation_request
                   WHERE organization_id = v_a AND membership_id = v_member_a LIMIT 1);

  -- A request for a membership that belongs to another organization. The
  -- composite key is what refuses this; RLS would not, because each row passes
  -- its own policy.
  BEGIN
    INSERT INTO vacation_request (organization_id, membership_id) VALUES (v_a, v_member_b);
    RAISE EXCEPTION 'FAIL test 7a: leave was requested for another tenant''s member';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  -- A day hung off another organization's request.
  BEGIN
    INSERT INTO vacation_day (organization_id, vacation_request_id, membership_id, day)
    VALUES (v_b, v_request_a, v_member_b, DATE '2026-11-02');
    RAISE EXCEPTION 'FAIL test 7b: a day was attached to another tenant''s request';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  SET LOCAL ROLE poolse_app;

  PERFORM set_config('app.organization_id', v_a::text, true);
  SELECT count(*) INTO n FROM vacation_request;
  IF n = 0 THEN
    RAISE EXCEPTION 'FAIL test 7c: the owning organization saw none of its own requests';
  END IF;

  -- The attack the whole schema exists to stop: a query with no WHERE clause.
  PERFORM set_config('app.organization_id', v_b::text, true);
  SELECT count(*) INTO n FROM vacation_request;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7d: an unscoped read returned % of another club''s requests', n;
  END IF;

  SELECT count(*) INTO n FROM vacation_day;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7e: an unscoped read returned % of another club''s days', n;
  END IF;

  -- And a write aimed across the boundary.
  BEGIN
    INSERT INTO vacation_request (organization_id, membership_id) VALUES (v_a, v_member_a);
    RAISE EXCEPTION 'FAIL test 7f: a request was written into another tenant';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;
  RAISE NOTICE 'PASS test 7: leave is invisible, unwritable and unreferenceable across tenants';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8 — a municipal holiday is a holiday; a shutdown for building works is not
--
-- Keep this one. It is the distinction the entire vacation balance rests on: a
-- pool closed for obras must not quietly hand every member of staff a free day,
-- and the only thing separating the two is `source`.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; n int;
BEGIN
  v_org := (SELECT id FROM organization WHERE slug = 'clube-a-vac');

  -- Aveiro's municipal holiday, and a fortnight of building works.
  INSERT INTO closure (organization_id, starts_on, ends_on, reason, source)
  VALUES (v_org, DATE '2026-05-12', DATE '2026-05-12', 'Feriado municipal de Aveiro',
          'municipal_holiday');

  INSERT INTO closure (organization_id, starts_on, ends_on, reason, source)
  VALUES (v_org, DATE '2026-06-01', DATE '2026-06-14', 'Obras no tanque grande', 'manual');

  -- Seeding twice must be harmless, exactly as it is for national holidays.
  BEGIN
    INSERT INTO closure (organization_id, starts_on, ends_on, reason, source)
    VALUES (v_org, DATE '2026-05-12', DATE '2026-05-12', 'Feriado municipal de Aveiro',
            'municipal_holiday');
    RAISE EXCEPTION 'FAIL test 8a: the same municipal holiday was stored twice';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  -- This is the query every vacation screen runs. It must find the holiday and
  -- must not find the building works.
  SELECT count(*) INTO n
    FROM closure
   WHERE source IN ('national_holiday', 'municipal_holiday')
     AND archived_at IS NULL
     AND DATE '2026-05-12' BETWEEN starts_on AND ends_on;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 8b: expected the municipal holiday, found % rows', n;
  END IF;

  SELECT count(*) INTO n
    FROM closure
   WHERE source IN ('national_holiday', 'municipal_holiday')
     AND archived_at IS NULL
     AND DATE '2026-06-05' BETWEEN starts_on AND ends_on;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8c: a shutdown for building works counted as a holiday';
  END IF;

  -- An invented source is not storable. The three kinds are a closed set.
  BEGIN
    INSERT INTO closure (organization_id, starts_on, ends_on, reason, source)
    VALUES (v_org, DATE '2026-07-01', DATE '2026-07-01', 'Qualquer coisa', 'regional_holiday');
    RAISE EXCEPTION 'FAIL test 8d: an unknown closure source was stored';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 8: municipal holidays count as holidays; building works do not';
END $$;

ROLLBACK;
