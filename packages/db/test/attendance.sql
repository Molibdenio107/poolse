-- Attendance proof — slice 1.8.
--
-- Two tests here matter more than the rest.
--
-- Test 4 is backlog round 3, story 5's last rule, which waited for this table:
-- a class somebody has marked cannot be called off. It is a trigger rather than
-- a repository check because there are two ways a session gets cancelled — a
-- person on the calendar, and `generate_sessions` when a closure covers the day
-- — and the generator is the dangerous one. Adding an August closure after a
-- term has been taught would otherwise silently cancel classes people attended.
--
-- Test 6 is the isolation assertion every new tenant table gets. `class_session`
-- had no composite key until this migration, so it is also the first proof that
-- attendance cannot be hung off another club's class.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_att_a', 'rita@att.pt', 'Rita', 'Lopes', NULL, now());
SELECT provision_app_user('user_att_b', 'nuno@out.pt', 'Nuno', 'Cardoso', NULL, now());

INSERT INTO organization (name, slug) VALUES
  ('Clube Presenças', 'clube-presencas'),
  ('Clube Outro',     'clube-outro-att');

-- ---------------------------------------------------------------------------
-- Test 1 — a class is marked, one row per student, signed by whoever marked it
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_facility uuid; v_pool uuid; v_instructor uuid;
  v_group uuid; v_session uuid; v_ana uuid; v_joao uuid; n int;
BEGIN
  v_org := (SELECT id FROM organization WHERE slug = 'clube-presencas');

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Complexo')
  RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_org, v_facility, 'Tanque', 'indoor') RETURNING id INTO v_pool;

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, (SELECT id FROM app_user WHERE clerk_user_id = 'user_att_a'), 'active')
  RETURNING id INTO v_instructor;

  INSERT INTO class_group (organization_id, name, pool_id, lane, instructor_membership_id)
  VALUES (v_org, 'Iniciação 1', v_pool, 1, v_instructor) RETURNING id INTO v_group;

  INSERT INTO class_session (organization_id, class_group_id, pool_id, lane,
                             starts_at, duration_minutes, instructor_membership_id)
  VALUES (v_org, v_group, v_pool, 1, TIMESTAMPTZ '2026-09-08 18:00:00+01', 45, v_instructor)
  RETURNING id INTO v_session;

  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'Ana', 'Martins') RETURNING id INTO v_ana;
  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'João', 'Pereira') RETURNING id INTO v_joao;

  -- Absence is a recorded fact, not a missing row. "Nobody marked this class"
  -- and "João did not come" are different answers to different questions.
  INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                          recorded_by_membership_id)
  VALUES (v_org, v_session, v_ana,  'present', v_instructor),
         (v_org, v_session, v_joao, 'absent',  v_instructor);

  SELECT count(*) INTO n FROM attendance WHERE class_session_id = v_session;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 1a: expected two marks, got %', n;
  END IF;

  -- Signed, always. A row nobody put their name to is worth much less than no
  -- row at all — this is the evidence when a parent says their child was there.
  BEGIN
    INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                            recorded_by_membership_id)
    VALUES (v_org, v_session, v_ana, 'present', NULL);
    RAISE EXCEPTION 'FAIL test 1b: an unsigned mark was stored';
  EXCEPTION
    WHEN not_null_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 1: a class is marked one student at a time, and every mark is signed';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — one mark per student per class, and correcting it is an update
--
-- A second row saying something different would make "was Ana here?"
-- unanswerable, which is why this table has no archived_at: attendance is not
-- withdrawn, it is corrected.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_session uuid; v_ana uuid; v_instructor uuid; v_status text;
BEGIN
  v_org := (SELECT id FROM organization WHERE slug = 'clube-presencas');
  v_session := (SELECT id FROM class_session WHERE organization_id = v_org LIMIT 1);
  v_ana := (SELECT id FROM student WHERE first_name = 'Ana' AND organization_id = v_org);
  v_instructor := (SELECT id FROM membership WHERE organization_id = v_org LIMIT 1);

  BEGIN
    INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                            recorded_by_membership_id)
    VALUES (v_org, v_session, v_ana, 'excused', v_instructor);
    RAISE EXCEPTION 'FAIL test 2a: the same student was marked twice for one class';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  UPDATE attendance SET status = 'excused'
   WHERE class_session_id = v_session AND student_id = v_ana;

  SELECT status INTO v_status FROM attendance
   WHERE class_session_id = v_session AND student_id = v_ana;
  IF v_status <> 'excused' THEN
    RAISE EXCEPTION 'FAIL test 2b: the correction did not stick, status is %', v_status;
  END IF;

  -- POOLSE-13: late arrival is not a state any more, and the enum is the thing
  -- that makes that true rather than a convention somebody can forget.
  BEGIN
    UPDATE attendance SET status = 'late'
     WHERE class_session_id = v_session AND student_id = v_ana;
    RAISE EXCEPTION 'FAIL test 2c: a student was marked late';
  EXCEPTION
    WHEN invalid_text_representation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 2: one mark per student per class, corrected in place, never late';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — a student can be marked for a class they are not enrolled in
--
-- Trials, make-ups for a missed class, a sibling brought along. An operator who
-- cannot record what happened will record nothing, so enrollment supplies the
-- list to mark and does not gate what may be marked.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_session uuid; v_instructor uuid; v_visitor uuid; n int;
BEGIN
  v_org := (SELECT id FROM organization WHERE slug = 'clube-presencas');
  v_session := (SELECT id FROM class_session WHERE organization_id = v_org LIMIT 1);
  v_instructor := (SELECT id FROM membership WHERE organization_id = v_org LIMIT 1);

  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'Sofia', 'Visitante') RETURNING id INTO v_visitor;

  SELECT count(*) INTO n FROM enrollment WHERE student_id = v_visitor;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 3a: the visitor was seeded with an enrollment';
  END IF;

  INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                          recorded_by_membership_id, note)
  VALUES (v_org, v_session, v_visitor, 'present', v_instructor, 'Aula experimental');

  -- Blank is not a note. An untouched field sends one, and two ways of saying
  -- "nothing" in one column is how a register grows empty badges.
  BEGIN
    UPDATE attendance SET note = '   ' WHERE student_id = v_visitor;
    RAISE EXCEPTION 'FAIL test 3b: a blank note was stored';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 3: attendance attaches to the class, not to an enrollment';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — a marked class cannot be called off
--
-- Keep this one. Backlog round 3, story 5's last rule, and the reason it is a
-- trigger: the calendar is not the only thing that cancels a session. Adding an
-- August closure after a term has been taught runs `generate_sessions`, which
-- would otherwise cancel classes people attended without anybody being told.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_session uuid; v_status text;
BEGIN
  v_org := (SELECT id FROM organization WHERE slug = 'clube-presencas');
  v_session := (SELECT id FROM class_session WHERE organization_id = v_org LIMIT 1);

  BEGIN
    UPDATE class_session SET status = 'cancelled' WHERE id = v_session;
    RAISE EXCEPTION 'FAIL test 4a: a class with attendance recorded was cancelled';
  EXCEPTION
    WHEN restrict_violation THEN NULL;
  END;

  SELECT status INTO v_status FROM class_session WHERE id = v_session;
  IF v_status <> 'scheduled' THEN
    RAISE EXCEPTION 'FAIL test 4b: the class ended up %', v_status;
  END IF;

  -- The generator's path, which is the one that matters. A closure covering the
  -- day must not take a taught class down with it.
  INSERT INTO closure (organization_id, starts_on, ends_on, reason)
  VALUES (v_org, DATE '2026-09-08', DATE '2026-09-08', 'Obras imprevistas');

  BEGIN
    PERFORM generate_sessions(v_org, DATE '2026-09-01', DATE '2026-09-30');
    RAISE EXCEPTION 'FAIL test 4c: generation cancelled a class that had been marked';
  EXCEPTION
    WHEN restrict_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 4: a class somebody marked cannot be called off, by any path';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — an unmarked class is still cancellable, and a cancelled one restorable
--
-- The other half of test 4. A rule that refused every cancellation would be a
-- worse bug than the one it fixed.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_group uuid; v_pool uuid; v_instructor uuid; v_session uuid; v_status text;
BEGIN
  v_org := (SELECT id FROM organization WHERE slug = 'clube-presencas');
  v_group := (SELECT id FROM class_group WHERE organization_id = v_org LIMIT 1);
  v_pool := (SELECT id FROM pool WHERE organization_id = v_org LIMIT 1);
  v_instructor := (SELECT id FROM membership WHERE organization_id = v_org LIMIT 1);

  INSERT INTO class_session (organization_id, class_group_id, pool_id, lane,
                             starts_at, duration_minutes, instructor_membership_id)
  VALUES (v_org, v_group, v_pool, 2, TIMESTAMPTZ '2026-09-15 18:00:00+01', 45, v_instructor)
  RETURNING id INTO v_session;

  UPDATE class_session SET status = 'cancelled' WHERE id = v_session;
  SELECT status INTO v_status FROM class_session WHERE id = v_session;
  IF v_status <> 'cancelled' THEN
    RAISE EXCEPTION 'FAIL test 5a: an unmarked class refused to be cancelled';
  END IF;

  -- Only the transition *into* cancelled is guarded, so a closure being removed
  -- can still put a class back.
  UPDATE class_session SET status = 'scheduled' WHERE id = v_session;
  SELECT status INTO v_status FROM class_session WHERE id = v_session;
  IF v_status <> 'scheduled' THEN
    RAISE EXCEPTION 'FAIL test 5b: a cancelled class could not be restored';
  END IF;

  RAISE NOTICE 'PASS test 5: an unmarked class cancels, and restoring is unaffected';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — attendance cannot cross tenants
--
-- `class_session` gained its composite key in this migration, so this is also
-- the first proof that a mark cannot be hung off another club's class. RLS
-- would not catch that on its own: both rows pass their own policies.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_a uuid; v_b uuid; v_session_a uuid; v_student_a uuid;
  v_member_b uuid; v_student_b uuid; n int;
BEGIN
  v_a := (SELECT id FROM organization WHERE slug = 'clube-presencas');
  v_b := (SELECT id FROM organization WHERE slug = 'clube-outro-att');

  v_session_a := (SELECT id FROM class_session WHERE organization_id = v_a LIMIT 1);
  v_student_a := (SELECT id FROM student WHERE organization_id = v_a LIMIT 1);

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_b, (SELECT id FROM app_user WHERE clerk_user_id = 'user_att_b'), 'active')
  RETURNING id INTO v_member_b;
  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_b, 'Beatriz', 'Outro') RETURNING id INTO v_student_b;

  -- Another club's class.
  BEGIN
    INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                            recorded_by_membership_id)
    VALUES (v_b, v_session_a, v_student_b, 'present', v_member_b);
    RAISE EXCEPTION 'FAIL test 6a: a mark was hung off another tenant''s class';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  -- Another club's student, on our own class.
  BEGIN
    INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                            recorded_by_membership_id)
    VALUES (v_a, v_session_a, v_student_b, 'present',
            (SELECT id FROM membership WHERE organization_id = v_a LIMIT 1));
    RAISE EXCEPTION 'FAIL test 6b: another tenant''s student was marked present';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  SET LOCAL ROLE poolse_app;

  PERFORM set_config('app.organization_id', v_a::text, true);
  SELECT count(*) INTO n FROM attendance;
  IF n = 0 THEN
    RAISE EXCEPTION 'FAIL test 6c: the owning organization saw none of its own marks';
  END IF;

  -- The attack the whole schema exists to stop: a query with no WHERE clause.
  PERFORM set_config('app.organization_id', v_b::text, true);
  SELECT count(*) INTO n FROM attendance;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6d: an unscoped read returned % of another club''s marks', n;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS test 6: attendance is invisible and unreferenceable across tenants';
END $$;

ROLLBACK;
