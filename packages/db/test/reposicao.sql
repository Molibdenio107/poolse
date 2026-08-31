-- Aula de reposição as a credit object — POOLSE-21, first slice.
--
-- Test 2 is the one to keep. The whole ticket exists because a reposição is
-- currently a note somebody remembers, so the guarantee that matters is that the
-- credit cannot drift from the mark that earned it: minting is a trigger on
-- `attendance`, which means *every* write path mints — the register screen, an
-- importer, a correction endpoint, and psql.
--
-- Test 5 is the other. Correcting a mark back to "faltou" revokes an unspent
-- credit and is **refused** when the family has already spent it. A silent
-- no-op there would leave the office believing a correction happened.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES ('Clube Reposição', 'clube-reposicao');

SELECT provision_app_user('user_repo', 'staff@repo.pt', 'Rita', 'Nunes', NULL,
                          '2026-08-28 09:00:00+00');

/*
 * One club, one season, one turma, one pool, two students, one session.
 *
 * The season runs to 31 July, which is what makes the capping test in test 3
 * mean something.
 */
DO $$
DECLARE
  v_org uuid; v_staff uuid; v_facility uuid; v_pool uuid;
  v_season uuid; v_group uuid; v_session uuid;
  v_ana uuid; v_rui uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-reposicao';

  INSERT INTO membership (organization_id, app_user_id, status)
  SELECT v_org, id, 'active' FROM app_user WHERE clerk_user_id = 'user_repo'
  RETURNING id INTO v_staff;

  INSERT INTO facility (organization_id, name, timezone)
  VALUES (v_org, 'Piscina', 'Europe/Lisbon') RETURNING id INTO v_facility;

  INSERT INTO pool (organization_id, facility_id, name)
  VALUES (v_org, v_facility, 'Tanque') RETURNING id INTO v_pool;

  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, '2026/2027', DATE '2026-09-01', DATE '2027-07-31')
  RETURNING id INTO v_season;

  INSERT INTO class_group (organization_id, facility_id, season_id, name, capacity)
  VALUES (v_org, (SELECT id FROM facility WHERE organization_id = v_org ORDER BY created_at, id LIMIT 1), v_season, 'Iniciação A', 8) RETURNING id INTO v_group;

  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'Ana', 'Costa') RETURNING id INTO v_ana;
  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'Rui', 'Melo') RETURNING id INTO v_rui;

  INSERT INTO class_session (organization_id, class_group_id, pool_id,
                             starts_at, duration_minutes, ends_at)
  VALUES (v_org, v_group, v_pool, TIMESTAMPTZ '2027-03-12 17:00:00+00', 45,
          TIMESTAMPTZ '2027-03-12 17:45:00+00')
  RETURNING id INTO v_session;

  -- Stashed for the tests below, which each need the same handful of ids.
  CREATE TEMP TABLE fixture AS
  SELECT v_org AS org, v_staff AS staff, v_season AS season, v_group AS grp,
         v_session AS session, v_ana AS ana, v_rui AS rui;
END $$;

-- ---------------------------------------------------------------------------
-- Test 1: minting is off until a club turns it on
--
-- A club that has not thought about reposições should not discover it has been
-- issuing them. `reposicao_enabled` defaults to false, and a justified absence
-- under that default mints nothing.
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_count int;
BEGIN
  SELECT * INTO f FROM fixture;

  INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                          recorded_by_membership_id)
  VALUES (f.org, f.session, f.ana, 'excused', f.staff);

  SELECT count(*) INTO v_count FROM reposicao_credit WHERE student_id = f.ana;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL test 1: % credits minted with the feature off', v_count;
  END IF;

  DELETE FROM attendance WHERE class_session_id = f.session;
  RAISE NOTICE 'PASS test 1: nothing is minted until the club enables it';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 (21.1, 21.2): a falta justificada mints exactly one; faltou mints none
--
-- The core of criterion 1, and asserted through a plain INSERT rather than
-- through any application code — that is the point of minting in a trigger.
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_credit reposicao_credit%ROWTYPE; v_count int;
BEGIN
  SELECT * INTO f FROM fixture;
  UPDATE organization SET reposicao_enabled = true WHERE id = f.org;

  -- Faltou: nothing.
  INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                          recorded_by_membership_id)
  VALUES (f.org, f.session, f.rui, 'absent', f.staff);

  SELECT count(*) INTO v_count FROM reposicao_credit WHERE student_id = f.rui;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL test 2 (21.2): an unjustified absence minted % credits', v_count;
  END IF;

  -- Falta justificada: exactly one.
  INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                          recorded_by_membership_id)
  VALUES (f.org, f.session, f.ana, 'excused', f.staff);

  SELECT count(*) INTO v_count FROM reposicao_credit
   WHERE student_id = f.ana AND archived_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL test 2 (21.1): % credits minted, expected exactly 1', v_count;
  END IF;

  SELECT * INTO v_credit FROM reposicao_credit WHERE student_id = f.ana;

  IF v_credit.status <> 'available' THEN
    RAISE EXCEPTION 'FAIL test 2: a fresh credit is %', v_credit.status;
  END IF;

  -- The absence was on 12 March 2027 in Lisbon; the window is 60 days.
  IF v_credit.issued_on <> DATE '2027-03-12' THEN
    RAISE EXCEPTION 'FAIL test 2: issued_on is %, expected the session date', v_credit.issued_on;
  END IF;

  IF v_credit.expires_on <> DATE '2027-05-11' THEN
    RAISE EXCEPTION 'FAIL test 2: expires_on is %, expected 2027-05-11', v_credit.expires_on;
  END IF;

  -- The rule is copied onto the row, not read back from settings later.
  IF v_credit.source_window_days <> 60 THEN
    RAISE EXCEPTION 'FAIL test 2: the window was not snapshotted';
  END IF;

  RAISE NOTICE 'PASS test 2 (21.1, 21.2): justified mints one, unjustified mints none';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: the window is capped at the end of the época
--
-- Your call in the backlog round. An absence in the last week gets the days that
-- remain, not sixty — because a credit that outlives its season has no turma to
-- be redeemed into.
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_late uuid; v_expires date;
BEGIN
  SELECT * INTO f FROM fixture;

  -- A session eight days before the season ends on 31 July 2027.
  INSERT INTO class_session (organization_id, class_group_id, pool_id,
                             starts_at, duration_minutes, ends_at)
  VALUES (f.org, f.grp, (SELECT id FROM pool WHERE organization_id = f.org LIMIT 1),
          TIMESTAMPTZ '2027-07-23 17:00:00+00', 45, TIMESTAMPTZ '2027-07-23 17:45:00+00')
  RETURNING id INTO v_late;

  INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                          recorded_by_membership_id)
  VALUES (f.org, v_late, f.rui, 'excused', f.staff);

  SELECT expires_on INTO v_expires FROM reposicao_credit
   WHERE student_id = f.rui AND archived_at IS NULL;

  -- 23 July + 60 days is 21 September; the season ends on 31 July.
  IF v_expires <> DATE '2027-07-31' THEN
    RAISE EXCEPTION 'FAIL test 3: a late absence expires %, expected the season end', v_expires;
  END IF;

  -- And the pure function agrees, which is what the trigger and the tests share.
  IF reposicao_expiry(DATE '2027-03-12', 60::smallint, DATE '2027-07-31')
     <> DATE '2027-05-11' THEN
    RAISE EXCEPTION 'FAIL test 3: an early absence was capped when it should not be';
  END IF;

  RAISE NOTICE 'PASS test 3: the window is capped at the end of the época';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: the turma overrides the club, and null means inherit
--
-- Criterion 1. The three-state column is the point: "this turma is an exception"
-- has to be expressible separately from "nobody has said".
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_session uuid; v_count int;
BEGIN
  SELECT * INTO f FROM fixture;

  -- The club says yes; this turma says no.
  UPDATE class_group SET reposicao_enabled = false WHERE id = f.grp;

  INSERT INTO class_session (organization_id, class_group_id, pool_id,
                             starts_at, duration_minutes, ends_at)
  VALUES (f.org, f.grp, (SELECT id FROM pool WHERE organization_id = f.org LIMIT 1),
          TIMESTAMPTZ '2027-04-02 17:00:00+00', 45, TIMESTAMPTZ '2027-04-02 17:45:00+00')
  RETURNING id INTO v_session;

  INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                          recorded_by_membership_id)
  VALUES (f.org, v_session, f.rui, 'excused', f.staff);

  SELECT count(*) INTO v_count FROM reposicao_credit
   WHERE class_session_id = v_session AND archived_at IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL test 4: the turma opt-out was ignored';
  END IF;

  -- Back to inheriting: the club's yes applies again.
  UPDATE class_group SET reposicao_enabled = NULL WHERE id = f.grp;
  UPDATE attendance SET status = 'absent'
   WHERE class_session_id = v_session AND student_id = f.rui;
  UPDATE attendance SET status = 'excused'
   WHERE class_session_id = v_session AND student_id = f.rui;

  SELECT count(*) INTO v_count FROM reposicao_credit
   WHERE class_session_id = v_session AND archived_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL test 4: null did not inherit the club setting (% credits)', v_count;
  END IF;

  RAISE NOTICE 'PASS test 4: the turma wins, and null inherits rather than disables';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: correcting the mark revokes — unless the family already spent it
--
-- The guarantee the office depends on, in both directions.
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_credit uuid; v_archived timestamptz; v_refused boolean := false;
BEGIN
  SELECT * INTO f FROM fixture;

  SELECT id INTO v_credit FROM reposicao_credit
   WHERE student_id = f.ana AND class_session_id = f.session AND archived_at IS NULL;

  -- Corrected to "faltou": the credit goes.
  UPDATE attendance SET status = 'absent'
   WHERE class_session_id = f.session AND student_id = f.ana;

  SELECT archived_at INTO v_archived FROM reposicao_credit WHERE id = v_credit;
  IF v_archived IS NULL THEN
    RAISE EXCEPTION 'FAIL test 5: an unspent credit survived the correction';
  END IF;

  -- Hidden, never deleted: "we owed you a class in March" outlives the credit.
  IF NOT EXISTS (SELECT 1 FROM reposicao_credit WHERE id = v_credit) THEN
    RAISE EXCEPTION 'FAIL test 5: the credit was destroyed rather than archived';
  END IF;

  -- And the revocation is explainable.
  IF NOT EXISTS (
    SELECT 1 FROM audit_log
     WHERE action = 'reposicao.revoked' AND entity_id = v_credit
  ) THEN
    RAISE EXCEPTION 'FAIL test 5: nothing recorded the revocation';
  END IF;

  -- Now the other direction: mint again, mark it spent, and try to correct.
  UPDATE attendance SET status = 'excused'
   WHERE class_session_id = f.session AND student_id = f.ana;

  UPDATE reposicao_credit SET status = 'used', redeemed_at = now()
   WHERE student_id = f.ana AND archived_at IS NULL;

  BEGIN
    UPDATE attendance SET status = 'absent'
     WHERE class_session_id = f.session AND student_id = f.ana;
  EXCEPTION WHEN restrict_violation THEN
    v_refused := true;
  END;

  IF NOT v_refused THEN
    RAISE EXCEPTION 'FAIL test 5: a spent credit was silently retracted';
  END IF;

  RAISE NOTICE 'PASS test 5: an unspent credit is revoked, a spent one refuses';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 (21.11): the per-época cap, and why nothing was minted
--
-- The ticket asks for the refusal to be explainable, not merely silent — the
-- front desk has to be able to answer "why did we not get one for that?".
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_session uuid; v_count int; v_before int;
BEGIN
  SELECT * INTO f FROM fixture;

  UPDATE organization SET reposicao_cap_per_season = 1 WHERE id = f.org;

  SELECT count(*) INTO v_before FROM reposicao_credit
   WHERE student_id = f.rui AND archived_at IS NULL;

  INSERT INTO class_session (organization_id, class_group_id, pool_id,
                             starts_at, duration_minutes, ends_at)
  VALUES (f.org, f.grp, (SELECT id FROM pool WHERE organization_id = f.org LIMIT 1),
          TIMESTAMPTZ '2027-05-14 17:00:00+00', 45, TIMESTAMPTZ '2027-05-14 17:45:00+00')
  RETURNING id INTO v_session;

  INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                          recorded_by_membership_id)
  VALUES (f.org, v_session, f.rui, 'excused', f.staff);

  SELECT count(*) INTO v_count FROM reposicao_credit
   WHERE student_id = f.rui AND archived_at IS NULL;

  IF v_count <> v_before THEN
    RAISE EXCEPTION 'FAIL test 6 (21.11): the cap was exceeded (% then %)', v_before, v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM audit_log
     WHERE action = 'reposicao.capped' AND entity_id = f.rui
  ) THEN
    RAISE EXCEPTION 'FAIL test 6 (21.11): the cap refusal was silent';
  END IF;

  UPDATE organization SET reposicao_cap_per_season = NULL WHERE id = f.org;
  RAISE NOTICE 'PASS test 6 (21.11): the cap holds and records why';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 (21.7 groundwork): expiry runs in the club's calendar, and repeats safely
--
-- A credit expiring on the 30th is alive all day on the 30th. The job takes the
-- date rather than reading a clock, so "today" is the club's day and not UTC's.
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_credit uuid; v_status reposicao_credit_status; v_n int;
BEGIN
  SELECT * INTO f FROM fixture;

  SELECT id INTO v_credit FROM reposicao_credit
   WHERE student_id = f.rui AND archived_at IS NULL AND status = 'available'
   ORDER BY expires_on LIMIT 1;

  UPDATE reposicao_credit SET expires_on = DATE '2027-05-30' WHERE id = v_credit;

  -- On the day itself, it is still alive.
  PERFORM expire_reposicao_credits(f.org, DATE '2027-05-30');
  SELECT status INTO v_status FROM reposicao_credit WHERE id = v_credit;
  IF v_status <> 'available' THEN
    RAISE EXCEPTION 'FAIL test 7: a credit died on its own expiry date';
  END IF;

  -- The day after, it is gone, and the expiry is recorded.
  v_n := expire_reposicao_credits(f.org, DATE '2027-05-31');
  SELECT status INTO v_status FROM reposicao_credit WHERE id = v_credit;
  IF v_status <> 'expired' THEN
    RAISE EXCEPTION 'FAIL test 7: the credit is % the day after expiry', v_status;
  END IF;
  IF v_n < 1 THEN
    RAISE EXCEPTION 'FAIL test 7: the job reported % expiries', v_n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM audit_log WHERE action = 'reposicao.expired' AND entity_id = v_credit
  ) THEN
    RAISE EXCEPTION 'FAIL test 7: the expiry was not recorded';
  END IF;

  -- Idempotent: a second pass finds nothing and must not re-notify.
  v_n := expire_reposicao_credits(f.org, DATE '2027-05-31');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7: a second run expired % more', v_n;
  END IF;

  RAISE NOTICE 'PASS test 7: expiry uses the club''s date and is safe to re-run';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8: a credit is tenant data like everything else
--
-- The convention: every new tenant-scoped table gets an isolation assertion
-- rather than a policy nobody tested.
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_other uuid; v_visible int;
BEGIN
  SELECT * INTO f FROM fixture;

  INSERT INTO organization (name, slug) VALUES ('Clube Outro', 'clube-outro-repo')
  RETURNING id INTO v_other;

  PERFORM set_config('app.organization_id', v_other::text, true);
  SET LOCAL ROLE poolse_app;

  SELECT count(*) INTO v_visible FROM reposicao_credit;

  RESET ROLE;

  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8: another tenant saw % credits', v_visible;
  END IF;

  RAISE NOTICE 'PASS test 8: credits are invisible to another tenant';
END $$;

ROLLBACK;
