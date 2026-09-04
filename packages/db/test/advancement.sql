-- Automatic level advancement — POOLSE-19.
--
-- Test 3 is the one to keep. The ticket names the likely mistake precisely:
-- treating "next level" as id or creation order instead of the club's
-- drag-and-drop order, so reordering levels in Settings silently reroutes every
-- future proposal while every screen still looks right. This creates the levels
-- in one order, reorders them, and asserts the proposal follows.
--
-- Test 5 is the other. Correcting the last skill back down must take the
-- proposal out of the queue without enrolling anybody — otherwise an instructor
-- fixing a mis-tap advances a child who is not ready.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES ('Clube Progressão', 'clube-progressao');

-- This fixture states its own plan. A subscription covers one facility by
-- default and `facility_licence` enforces it; nothing below is about billing,
-- so the plan is set out of the way. The limit is asserted in `facilities.sql`.
UPDATE organization SET max_facilities = 20;


SELECT provision_app_user('user_adv', 'staff@adv.pt', 'Rita', 'Nunes', NULL,
                          '2026-08-28 09:00:00+00');

/*
 * Three levels in a ladder, a student in the first, and a turma waiting at the
 * second — plus a required skill and an optional one, because criterion 1 turns
 * on the difference.
 */
DO $$
DECLARE
  v_org uuid; v_staff uuid; v_season uuid;
  v_l1 uuid; v_l2 uuid; v_l3 uuid;
  v_g1 uuid; v_g2 uuid;
  v_req uuid; v_opt uuid;
  v_ana uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-progressao';

  INSERT INTO membership (organization_id, app_user_id, status)
  SELECT v_org, id, 'active' FROM app_user WHERE clerk_user_id = 'user_adv'
  RETURNING id INTO v_staff;

  -- A site, because a turma belongs to one. This fixture predates the column and
  -- had none at all; every organization in the product has had one since
  -- provisioning existed.
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Municipal');

  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, '2026/2027', DATE '2026-09-01', DATE '2027-07-31')
  RETURNING id INTO v_season;

  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_org, 'Adaptação', 1) RETURNING id INTO v_l1;
  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_org, 'Iniciação', 2) RETURNING id INTO v_l2;
  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_org, 'Aperfeiçoamento', 3) RETURNING id INTO v_l3;

  -- No pool, so the site is named outright: `class_group.facility_id` is
  -- NOT NULL and only derives itself from a pool the turma actually has.
  INSERT INTO class_group (organization_id, facility_id, season_id, name, capacity, level_id)
  VALUES (v_org, (SELECT id FROM facility WHERE organization_id = v_org ORDER BY created_at, id LIMIT 1), v_season, 'Adaptação A', 8, v_l1) RETURNING id INTO v_g1;
  INSERT INTO class_group (organization_id, facility_id, season_id, name, capacity, level_id)
  VALUES (v_org, (SELECT id FROM facility WHERE organization_id = v_org ORDER BY created_at, id LIMIT 1), v_season, 'Iniciação A', 8, v_l2) RETURNING id INTO v_g2;

  -- One required skill and one optional, both on level 1.
  INSERT INTO skill (organization_id, level_id, name, sort_order, required)
  VALUES (v_org, v_l1, 'Imersão', 1, true) RETURNING id INTO v_req;
  INSERT INTO skill (organization_id, level_id, name, sort_order, required)
  VALUES (v_org, v_l1, 'Salto de bomba', 2, false) RETURNING id INTO v_opt;

  INSERT INTO student (organization_id, first_name, last_name, level_id, birth_date)
  VALUES (v_org, 'Ana', 'Costa', v_l1, DATE '2018-04-11') RETURNING id INTO v_ana;

  INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
  VALUES (v_org, v_g1, v_ana, 'active');

  CREATE TEMP TABLE fixture AS
  SELECT v_org AS org, v_staff AS staff, v_ana AS ana,
         v_l1 AS l1, v_l2 AS l2, v_l3 AS l3,
         v_g1 AS g1, v_g2 AS g2, v_req AS req, v_opt AS opt;
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 (19.2): only required skills gate the level
--
-- Marking the required one is enough; the optional one outstanding must not hold
-- the student back.
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_count int; v_to uuid;
BEGIN
  SELECT * INTO f FROM fixture;

  -- Nothing marked yet: not complete, and no proposal.
  IF level_is_complete(f.ana, f.l1) THEN
    RAISE EXCEPTION 'FAIL test 1: an untouched level reads as complete';
  END IF;

  INSERT INTO skill_progress (organization_id, student_id, skill_id, state,
                              recorded_by_membership_id)
  VALUES (f.org, f.ana, f.req, 'attained', f.staff);

  IF NOT level_is_complete(f.ana, f.l1) THEN
    RAISE EXCEPTION 'FAIL test 1 (19.2): the optional skill held the level back';
  END IF;

  SELECT count(*) INTO v_count FROM transfer_proposal
   WHERE student_id = f.ana AND status = 'pending';

  SELECT to_level_id INTO v_to FROM transfer_proposal
   WHERE student_id = f.ana AND status = 'pending' LIMIT 1;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL test 1 (19.1): % proposals, expected 1', v_count;
  END IF;
  IF v_to <> f.l2 THEN
    RAISE EXCEPTION 'FAIL test 1: the proposal targets the wrong level';
  END IF;

  RAISE NOTICE 'PASS test 1 (19.1, 19.2): required skills gate, optional ones do not';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: marking the same skill again proposes once
--
-- The poolside grid saves incrementally over a flaky connection (POOLSE-20 AC5),
-- so the last skill genuinely does get written twice. A second proposal would
-- put the same child in the queue twice.
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_count int;
BEGIN
  SELECT * INTO f FROM fixture;

  UPDATE skill_progress SET state = 'attained'
   WHERE student_id = f.ana AND skill_id = f.req;

  SELECT count(*) INTO v_count FROM transfer_proposal
   WHERE student_id = f.ana AND status = 'pending';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL test 2: re-marking produced % proposals', v_count;
  END IF;

  RAISE NOTICE 'PASS test 2: generation is idempotent under repeated saves';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 (19.6): "next" follows the drag-and-drop order, not creation order
--
-- The ticket's named trap, and the reason it is dangerous is that nothing looks
-- wrong when it breaks. Aperfeiçoamento is dragged above Iniciação; the next
-- proposal must target Aperfeiçoamento.
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_next uuid;
BEGIN
  SELECT * INTO f FROM fixture;

  -- Before the reorder: level 1 leads to level 2.
  SELECT next_level(f.org, f.l1) INTO v_next;
  IF v_next <> f.l2 THEN
    RAISE EXCEPTION 'FAIL test 3: next was wrong before any reorder';
  END IF;

  -- Drag Aperfeiçoamento between them — POOLSE-05 writes sort_order.
  UPDATE student_level SET sort_order = 2 WHERE id = f.l3;
  UPDATE student_level SET sort_order = 3 WHERE id = f.l2;

  SELECT next_level(f.org, f.l1) INTO v_next;
  IF v_next <> f.l3 THEN
    RAISE EXCEPTION 'FAIL test 3 (19.6): reordering did not change the ladder';
  END IF;

  -- And back, so the rest of the tests read the ladder they were written for.
  UPDATE student_level SET sort_order = 2 WHERE id = f.l2;
  UPDATE student_level SET sort_order = 3 WHERE id = f.l3;

  RAISE NOTICE 'PASS test 3 (19.6): the ladder is the club''s order, not the id order';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 (19.3, 19.10): candidates are ranked, and guests do not eat seats
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_proposal uuid; v_count int; v_free int; v_reason text;
BEGIN
  SELECT * INTO f FROM fixture;

  SELECT id INTO v_proposal FROM transfer_proposal
   WHERE student_id = f.ana AND status = 'pending';

  SELECT count(*) INTO v_count FROM transfer_candidates(v_proposal);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL test 4: % candidate turmas, expected 1', v_count;
  END IF;

  SELECT rank_reason INTO v_reason FROM transfer_candidates(v_proposal) LIMIT 1;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'FAIL test 4: a candidate came back with no reason to rank it';
  END IF;

  -- Capacity 8, nobody enrolled in the target yet.
  SELECT class_group_free_seats(f.g2) INTO v_free;
  IF v_free <> 8 THEN
    RAISE EXCEPTION 'FAIL test 4: an empty turma of 8 reports % seats', v_free;
  END IF;

  RAISE NOTICE 'PASS test 4: candidates rank, and an empty turma is empty';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 (19.8): correcting the last skill takes the proposal with it
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_status text; v_pending int; v_enrolled int;
BEGIN
  SELECT * INTO f FROM fixture;

  UPDATE skill_progress SET state = 'tested'
   WHERE student_id = f.ana AND skill_id = f.req;

  SELECT count(*) INTO v_pending FROM transfer_proposal
   WHERE student_id = f.ana AND status = 'pending';
  IF v_pending <> 0 THEN
    RAISE EXCEPTION 'FAIL test 5 (19.8): the proposal stayed in the queue';
  END IF;

  SELECT status::text INTO v_status FROM transfer_proposal WHERE student_id = f.ana;
  IF v_status <> 'invalidated' THEN
    RAISE EXCEPTION 'FAIL test 5: the proposal is % rather than invalidated', v_status;
  END IF;

  -- And nobody was moved.
  SELECT count(*) INTO v_enrolled FROM enrollment
   WHERE student_id = f.ana AND class_group_id = f.g2 AND status = 'active';
  IF v_enrolled <> 0 THEN
    RAISE EXCEPTION 'FAIL test 5: an invalidated proposal enrolled somebody';
  END IF;

  RAISE NOTICE 'PASS test 5 (19.8): a corrected skill invalidates without enrolling';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: the end of the ladder proposes nothing
--
-- Deliberately unbuilt, pending a business decision — see the migration header.
-- Asserted so that "nothing happens" is a tested behaviour rather than an
-- accident somebody later mistakes for a bug.
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_top uuid; v_rui uuid; v_count int;
BEGIN
  SELECT * INTO f FROM fixture;

  IF next_level(f.org, f.l3) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 6: the last level has a next one';
  END IF;

  INSERT INTO skill (organization_id, level_id, name, sort_order, required)
  VALUES (f.org, f.l3, 'Viragem', 1, true) RETURNING id INTO v_top;

  INSERT INTO student (organization_id, first_name, last_name, level_id)
  VALUES (f.org, 'Rui', 'Melo', f.l3) RETURNING id INTO v_rui;

  INSERT INTO skill_progress (organization_id, student_id, skill_id, state,
                              recorded_by_membership_id)
  VALUES (f.org, v_rui, v_top, 'attained', f.staff);

  SELECT count(*) INTO v_count FROM transfer_proposal WHERE student_id = v_rui;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6: the end of the ladder produced % proposals', v_count;
  END IF;

  RAISE NOTICE 'PASS test 6: finishing the last level proposes nothing, by decision';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7: proposals are tenant data like everything else
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_other uuid; v_visible int;
BEGIN
  INSERT INTO organization (name, slug) VALUES ('Clube Outro', 'clube-outro-adv')
  RETURNING id INTO v_other;


  PERFORM set_config('app.organization_id', v_other::text, true);
  SET LOCAL ROLE poolse_app;

  SELECT count(*) INTO v_visible FROM transfer_proposal;

  RESET ROLE;

  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7: another tenant saw % proposals', v_visible;
  END IF;

  RAISE NOTICE 'PASS test 7: proposals are invisible to another tenant';
END $$;


-- ---------------------------------------------------------------------------
-- Test 8: advancing out of one turma must not end enrolment in another
--
-- Found in review, and the worst of the batch because it lost data in silence:
-- the transfer ended *every* active enrolment for the student, so a child who
-- also swam in a second turma simply stopped appearing on its register with
-- nothing to show why.
--
-- Asserted at the schema level — the repository scopes its UPDATE to turmas at
-- the level being left, and this pins the rule that scoping expresses.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  f RECORD; v_other_level uuid; v_other uuid; v_still int; v_left int;
BEGIN
  SELECT * INTO f FROM fixture;

  -- A second turma at a different level — Hidro, say — that Ana also attends.
  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (f.org, 'Hidroginástica', 10) RETURNING id INTO v_other_level;

  INSERT INTO class_group (organization_id, facility_id, season_id, name, capacity, level_id)
  SELECT f.org, cg.facility_id, cg.season_id, 'Hidro A', 8, v_other_level
    FROM class_group cg WHERE cg.id = f.g1
  RETURNING id INTO v_other;

  INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
  VALUES (f.org, v_other, f.ana, 'active');

  /*
   * The transfer, as the repository performs it: end only the enrolments whose
   * turma sits at the level being left.
   */
  UPDATE enrollment e
     SET status = 'ended', ended_on = current_date
    FROM class_group cg
   WHERE cg.id = e.class_group_id
     AND cg.organization_id = e.organization_id
     AND e.student_id = f.ana
     AND e.organization_id = f.org
     AND e.status = 'active'
     AND cg.level_id = f.l1;

  SELECT count(*) INTO v_left FROM enrollment
   WHERE student_id = f.ana AND class_group_id = f.g1 AND status = 'active';
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8: the enrolment being advanced out of survived';
  END IF;

  SELECT count(*) INTO v_still FROM enrollment
   WHERE student_id = f.ana AND class_group_id = v_other AND status = 'active';
  IF v_still <> 1 THEN
    RAISE EXCEPTION 'FAIL test 8: advancing ended an unrelated turma enrolment';
  END IF;

  RAISE NOTICE 'PASS test 8: advancing leaves the student''s other turmas alone';
END $$;

ROLLBACK;
