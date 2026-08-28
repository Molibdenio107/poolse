-- Redeeming a reposição — POOLSE-21, slice 2.
--
-- Test 2 is the one to keep. It is the conflict the ticket flags: criterion 3
-- wants an open seat, criterion 4 wants a reposição to go only where somebody
-- has vacated one, and on a full turma those read as mutually exclusive. The
-- resolution — an absence frees a place *for that date only* — is
-- `session_free_seats()`, and this asserts the whole of it: full turma offers
-- nothing, one absence offers exactly one place, and a guest booked into it
-- closes the gap again.
--
-- Test 5 is the other. A credit is spent once. Two families racing for the last
-- place must not both get it, which is why a pending hold counts against the
-- seat count and not only a confirmed booking.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES ('Clube Marcação', 'clube-marcacao');

SELECT provision_app_user('user_book', 'staff@book.pt', 'Rita', 'Nunes', NULL,
                          '2026-08-28 09:00:00+00');

/*
 * A turma of two, full, with a session next week. Three students: two enrolled,
 * one outside holding a credit and looking for a place.
 */
DO $$
DECLARE
  v_org uuid; v_staff uuid; v_facility uuid; v_pool uuid; v_season uuid;
  v_level uuid; v_group uuid; v_session uuid;
  v_ana uuid; v_rui uuid; v_out uuid; v_absence uuid; v_credit uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-marcacao';

  INSERT INTO membership (organization_id, app_user_id, status)
  SELECT v_org, id, 'active' FROM app_user WHERE clerk_user_id = 'user_book'
  RETURNING id INTO v_staff;

  INSERT INTO facility (organization_id, name, timezone)
  VALUES (v_org, 'Piscina', 'Europe/Lisbon') RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name)
  VALUES (v_org, v_facility, 'Tanque') RETURNING id INTO v_pool;

  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, '2026/2027', DATE '2026-09-01', DATE '2027-07-31')
  RETURNING id INTO v_season;

  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_org, 'Iniciação', 1) RETURNING id INTO v_level;

  -- Capacity two, so "full" is reachable with two enrolments.
  INSERT INTO class_group (organization_id, season_id, name, capacity, level_id)
  VALUES (v_org, v_season, 'Iniciação A', 2, v_level) RETURNING id INTO v_group;

  INSERT INTO student (organization_id, first_name, last_name, level_id)
  VALUES (v_org, 'Ana', 'Costa', v_level) RETURNING id INTO v_ana;
  INSERT INTO student (organization_id, first_name, last_name, level_id)
  VALUES (v_org, 'Rui', 'Melo', v_level) RETURNING id INTO v_rui;
  INSERT INTO student (organization_id, first_name, last_name, level_id)
  VALUES (v_org, 'Sofia', 'Dias', v_level) RETURNING id INTO v_out;

  INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
  VALUES (v_org, v_group, v_ana, 'active'), (v_org, v_group, v_rui, 'active');

  -- The occurrence a credit might be spent on: a week from now.
  INSERT INTO class_session (organization_id, class_group_id, pool_id,
                             starts_at, duration_minutes, ends_at)
  VALUES (v_org, v_group, v_pool, now() + interval '7 days', 45,
          now() + interval '7 days 45 minutes')
  RETURNING id INTO v_session;

  /*
   * Sofia's credit, minted the way slice 1 mints one: a justified absence on a
   * past session of a turma she is not in. Her own turma is irrelevant to the
   * test — what matters is that she holds an available credit.
   */
  UPDATE organization SET reposicao_enabled = true WHERE id = v_org;

  INSERT INTO class_session (organization_id, class_group_id, pool_id,
                             starts_at, duration_minutes, ends_at)
  VALUES (v_org, v_group, v_pool, now() - interval '7 days', 45,
          now() - interval '7 days' + interval '45 minutes')
  RETURNING id INTO v_absence;

  INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                          recorded_by_membership_id)
  VALUES (v_org, v_absence, v_out, 'excused', v_staff);

  SELECT id INTO v_credit FROM reposicao_credit
   WHERE student_id = v_out AND archived_at IS NULL;

  IF v_credit IS NULL THEN
    RAISE EXCEPTION 'setup failed: no credit was minted for Sofia';
  END IF;

  CREATE TEMP TABLE fixture AS
  SELECT v_org AS org, v_staff AS staff, v_group AS grp, v_session AS session,
         v_ana AS ana, v_rui AS rui, v_out AS outsider, v_credit AS credit,
         v_level AS level;
END $$;

-- ---------------------------------------------------------------------------
-- Test 1: the shared helper counts what the ticket says it counts
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_free int;
BEGIN
  SELECT * INTO f FROM fixture;

  -- Capacity 2, two enrolled, nobody absent: full.
  SELECT session_free_seats(f.session) INTO v_free;
  IF v_free <> 0 THEN
    RAISE EXCEPTION 'FAIL test 1: a full turma reports % free seats', v_free;
  END IF;

  RAISE NOTICE 'PASS test 1: enrolled students consume the places';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 (21.4, 21.5): an absence frees a place for that date, and only that date
--
-- The conflict the ticket names, resolved. This is the test to keep.
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_free int; v_offered int;
BEGIN
  SELECT * INTO f FROM fixture;

  -- 21.5: full turma, no absences, backfill-only on — nothing is offered.
  UPDATE organization SET reposicao_backfill_only = true WHERE id = f.org;

  SELECT count(*) INTO v_offered
    FROM reposicao_options(f.credit) o WHERE o.session_id = f.session;
  IF v_offered <> 0 THEN
    RAISE EXCEPTION 'FAIL test 2 (21.5): a full turma with no absence was offered';
  END IF;

  -- 21.4: mark Ana absent on that date. Her place is free for that date.
  INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                          recorded_by_membership_id)
  VALUES (f.org, f.session, f.ana, 'absent', f.staff);

  SELECT session_free_seats(f.session) INTO v_free;
  IF v_free <> 1 THEN
    RAISE EXCEPTION 'FAIL test 2 (21.4): one absence freed % places', v_free;
  END IF;

  SELECT count(*) INTO v_offered
    FROM reposicao_options(f.credit) o WHERE o.session_id = f.session;
  IF v_offered <> 1 THEN
    RAISE EXCEPTION 'FAIL test 2 (21.4): the backfill occurrence was not offered';
  END IF;

  RAISE NOTICE 'PASS test 2 (21.4, 21.5): an absence frees exactly one place, for that date';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: a guest takes the place they were given
--
-- Otherwise "backfill-only" would let every credit in the club pile onto the one
-- absence, which is the failure criterion 4 exists to prevent.
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_free int; v_booking uuid; v_status text;
BEGIN
  SELECT * INTO f FROM fixture;

  INSERT INTO reposicao_booking (organization_id, credit_id, class_session_id,
                                 status, requested_by_membership_id, holds_until)
  VALUES (f.org, f.credit, f.session, 'pending', f.staff, now() + interval '48 hours')
  RETURNING id INTO v_booking;

  -- A pending hold occupies the seat: a hold that could be gazumped is not a hold.
  SELECT session_free_seats(f.session) INTO v_free;
  IF v_free <> 0 THEN
    RAISE EXCEPTION 'FAIL test 3: a pending booking left % places open', v_free;
  END IF;

  -- And the credit followed its booking, by trigger rather than by a second write.
  SELECT status::text INTO v_status FROM reposicao_credit WHERE id = f.credit;
  IF v_status <> 'booked' THEN
    RAISE EXCEPTION 'FAIL test 3: the credit is % after being booked', v_status;
  END IF;

  RAISE NOTICE 'PASS test 3: a pending guest holds the place, and the credit follows';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: rejecting hands the class back
--
-- The family asked for a date that did not suit. They did nothing wrong and keep
-- what they are owed.
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_booking uuid; v_status text; v_free int;
BEGIN
  SELECT * INTO f FROM fixture;

  SELECT id INTO v_booking FROM reposicao_booking
   WHERE credit_id = f.credit AND status = 'pending';

  UPDATE reposicao_booking
     SET status = 'rejected', holds_until = NULL,
         decided_by_membership_id = f.staff, decided_at = now()
   WHERE id = v_booking;

  SELECT status::text INTO v_status FROM reposicao_credit WHERE id = f.credit;
  IF v_status <> 'available' THEN
    RAISE EXCEPTION 'FAIL test 4: a rejected booking left the credit %', v_status;
  END IF;

  -- And the seat is open again.
  SELECT session_free_seats(f.session) INTO v_free;
  IF v_free <> 1 THEN
    RAISE EXCEPTION 'FAIL test 4: the rejected seat was not released (% free)', v_free;
  END IF;

  RAISE NOTICE 'PASS test 4: rejecting returns the credit and the seat';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: a credit is spent once
--
-- Two live bookings on one credit is the thing that would let a family attend
-- twice for one absence. Enforced by an index, not by the repository.
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_refused boolean := false;
BEGIN
  SELECT * INTO f FROM fixture;

  INSERT INTO reposicao_booking (organization_id, credit_id, class_session_id,
                                 status, requested_by_membership_id)
  VALUES (f.org, f.credit, f.session, 'confirmed', f.staff);

  BEGIN
    INSERT INTO reposicao_booking (organization_id, credit_id, class_session_id,
                                   status, requested_by_membership_id)
    VALUES (f.org, f.credit, f.session, 'confirmed', f.staff);
  EXCEPTION WHEN unique_violation THEN
    v_refused := true;
  END;

  IF NOT v_refused THEN
    RAISE EXCEPTION 'FAIL test 5: one credit took two live bookings';
  END IF;

  RAISE NOTICE 'PASS test 5: a credit is spent once, enforced by the schema';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: a hold nobody answered is released, and the family keeps the class
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_booking uuid; v_status text; v_credit_status text; v_n int;
BEGIN
  SELECT * INTO f FROM fixture;

  -- Clear the confirmed booking from test 5 and make a stale pending one.
  UPDATE reposicao_booking SET status = 'cancelled', decided_by_membership_id = f.staff,
         decided_at = now(), holds_until = NULL
   WHERE credit_id = f.credit AND status = 'confirmed';

  INSERT INTO reposicao_booking (organization_id, credit_id, class_session_id,
                                 status, requested_by_membership_id, holds_until)
  VALUES (f.org, f.credit, f.session, 'pending', f.staff, now() - interval '1 hour')
  RETURNING id INTO v_booking;

  v_n := release_expired_reposicao_holds(f.org, now());
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 6: % holds released, expected 1', v_n;
  END IF;

  SELECT status::text INTO v_status FROM reposicao_booking WHERE id = v_booking;
  IF v_status <> 'cancelled' THEN
    RAISE EXCEPTION 'FAIL test 6: the lapsed hold is %', v_status;
  END IF;

  SELECT status::text INTO v_credit_status FROM reposicao_credit WHERE id = f.credit;
  IF v_credit_status <> 'available' THEN
    RAISE EXCEPTION 'FAIL test 6: the credit is % after its hold lapsed', v_credit_status;
  END IF;

  -- Idempotent, like the expiry job it sits beside.
  IF release_expired_reposicao_holds(f.org, now()) <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6: a second sweep released more';
  END IF;

  RAISE NOTICE 'PASS test 6: a lapsed hold frees the seat and returns the class';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 (21.7): a credit is never offered a class after it expires
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_offered int;
BEGIN
  SELECT * INTO f FROM fixture;

  -- Expire the credit the day before the session it would otherwise fit.
  UPDATE reposicao_credit
     SET expires_on = (now() + interval '6 days')::date
   WHERE id = f.credit;

  SELECT count(*) INTO v_offered
    FROM reposicao_options(f.credit) o WHERE o.session_id = f.session;

  IF v_offered <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7 (21.7): a class after the expiry was offered';
  END IF;

  RAISE NOTICE 'PASS test 7 (21.7): nothing is offered past the expiry date';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8: bookings are tenant data like everything else
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_other uuid; v_visible int;
BEGIN
  SELECT * INTO f FROM fixture;

  INSERT INTO organization (name, slug) VALUES ('Clube Outro', 'clube-outro-book')
  RETURNING id INTO v_other;

  PERFORM set_config('app.organization_id', v_other::text, true);
  SET LOCAL ROLE poolse_app;

  SELECT count(*) INTO v_visible FROM reposicao_booking;

  RESET ROLE;

  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8: another tenant saw % bookings', v_visible;
  END IF;

  RAISE NOTICE 'PASS test 8: bookings are invisible to another tenant';
END $$;

ROLLBACK;
