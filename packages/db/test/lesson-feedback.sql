-- A student's feedback after a lesson — POOLSE-116.
--
--   1. **Only a lesson that happened, with the student in it.** Cancelled,
--      not yet ended, not marked present, or past the window: each refused by
--      the trigger with its code in DETAIL, which the API turns into a 409.
--   2. **One live row per lesson and student**; an edit inside the window
--      passes the same trigger, and archiving frees the slot.
--   3. **Nothing deletes it**, and another club reads none of it.
--
-- Retention (mood kept, words and author cleared) is asserted where the clock
-- can be moved: `retention.integration.test.ts`.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_fb_teacher', 'prof@feedback.pt', 'Marta', 'Silva', NULL, now());

INSERT INTO organization (id, name, slug) VALUES
  ('f1160000-0000-0000-0000-000000000001', 'Clube Feedback', 'clube-feedback'),
  ('f1160000-0000-0000-0000-000000000002', 'Clube Ao Lado', 'clube-ao-lado-fb');
UPDATE organization SET max_facilities = 20 WHERE id::text LIKE 'f1160000%';

INSERT INTO season (organization_id, name, starts_on, ends_on)
VALUES ('f1160000-0000-0000-0000-000000000001', 'Época', DATE '2020-01-01', DATE '2035-12-31');

CREATE TEMP TABLE fx (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT ON fx TO poolse_app;

DO $$
DECLARE
  v_org uuid := 'f1160000-0000-0000-0000-000000000001';
  v_facility uuid; v_pool uuid; v_teacher uuid; v_guardian uuid; v_group uuid;
  v_ana uuid; v_joao uuid;
  v_done uuid; v_old uuid; v_future uuid; v_cancelled uuid;
BEGIN
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Complexo') RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_org, v_facility, 'Tanque', 'indoor') RETURNING id INTO v_pool;
  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, (SELECT id FROM app_user WHERE clerk_user_id = 'user_fb_teacher'), 'active')
  RETURNING id INTO v_teacher;
  INSERT INTO membership (organization_id, status, email, first_name, last_name)
  VALUES (v_org, 'active', 'mae@feedback.pt', 'Rosa', 'Martins') RETURNING id INTO v_guardian;
  INSERT INTO class_group (organization_id, season_id, name, pool_id, instructor_membership_id)
  VALUES (v_org, (SELECT id FROM season WHERE organization_id = v_org), 'Iniciação', v_pool, v_teacher)
  RETURNING id INTO v_group;

  INSERT INTO student (organization_id, first_name, last_name) VALUES (v_org, 'Ana', 'Martins') RETURNING id INTO v_ana;
  INSERT INTO student (organization_id, first_name, last_name) VALUES (v_org, 'João', 'Pereira') RETURNING id INTO v_joao;

  INSERT INTO class_session (organization_id, class_group_id, pool_id, starts_at, duration_minutes, instructor_membership_id)
  VALUES (v_org, v_group, v_pool, now() - interval '2 days', 45, v_teacher) RETURNING id INTO v_done;
  INSERT INTO class_session (organization_id, class_group_id, pool_id, starts_at, duration_minutes, instructor_membership_id)
  VALUES (v_org, v_group, v_pool, now() - interval '20 days', 45, v_teacher) RETURNING id INTO v_old;
  INSERT INTO class_session (organization_id, class_group_id, pool_id, starts_at, duration_minutes, instructor_membership_id)
  VALUES (v_org, v_group, v_pool, now() - interval '10 minutes', 45, v_teacher) RETURNING id INTO v_future;
  INSERT INTO class_session (organization_id, class_group_id, pool_id, starts_at, duration_minutes, instructor_membership_id, status)
  VALUES (v_org, v_group, v_pool, now() - interval '3 days', 45, v_teacher, 'cancelled') RETURNING id INTO v_cancelled;

  INSERT INTO attendance (organization_id, class_session_id, student_id, status, recorded_by_membership_id) VALUES
    (v_org, v_done, v_ana, 'present', v_teacher),
    (v_org, v_done, v_joao, 'absent', v_teacher),
    (v_org, v_old, v_ana, 'present', v_teacher),
    (v_org, v_future, v_ana, 'present', v_teacher);

  INSERT INTO fx VALUES ('org', v_org), ('guardian', v_guardian), ('ana', v_ana), ('joao', v_joao),
    ('done', v_done), ('old', v_old), ('future', v_future), ('cancelled', v_cancelled);
END $$;

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'f1160000-0000-0000-0000-000000000001', true);

-- ---------------------------------------------------------------------------
-- Test 1 — each refusal, with its code
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := (SELECT id FROM fx WHERE name = 'org');
  v_author uuid := (SELECT id FROM fx WHERE name = 'guardian');
  v_detail text;
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
      ('cancelled', 'ana',  'feedback_cancelled'),
      ('future',    'ana',  'feedback_too_early|'),
      ('done',      'joao', 'feedback_not_present|absent'),
      ('old',       'joao', 'feedback_not_present|none'),
      ('old',       'ana',  'feedback_window_closed|')
    ) AS t(session, student, expected) LOOP
    v_detail := NULL;
    BEGIN
      INSERT INTO lesson_feedback (organization_id, class_session_id, student_id, mood, author_membership_id)
      VALUES (v_org, (SELECT id FROM fx WHERE name = c.session), (SELECT id FROM fx WHERE name = c.student), 4, v_author);
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    END;
    IF v_detail IS NULL OR v_detail NOT LIKE c.expected || '%' THEN
      RAISE EXCEPTION 'FAIL test 1 (% / %): expected %, got %', c.session, c.student, c.expected, v_detail;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS test 1: cancelled, too early, not present and a closed window are each refused with their code';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — one live row, edited in place, archived to free the slot
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := (SELECT id FROM fx WHERE name = 'org');
  v_author uuid := (SELECT id FROM fx WHERE name = 'guardian');
  v_done uuid := (SELECT id FROM fx WHERE name = 'done');
  v_ana uuid := (SELECT id FROM fx WHERE name = 'ana');
  v_id uuid;
  ok boolean;
BEGIN
  INSERT INTO lesson_feedback (organization_id, class_session_id, student_id, mood, comment, author_membership_id)
  VALUES (v_org, v_done, v_ana, 5, 'Gostei muito.', v_author) RETURNING id INTO v_id;

  ok := false;
  BEGIN
    INSERT INTO lesson_feedback (organization_id, class_session_id, student_id, mood, author_membership_id)
    VALUES (v_org, v_done, v_ana, 3, v_author);
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2a: two live feedbacks for one lesson'; END IF;

  UPDATE lesson_feedback SET mood = 4, comment = 'Gostei.' WHERE id = v_id;
  IF (SELECT mood FROM lesson_feedback WHERE id = v_id) <> 4 THEN
    RAISE EXCEPTION 'FAIL test 2b: an edit inside the window did not save';
  END IF;

  ok := false;
  BEGIN
    UPDATE lesson_feedback SET comment = repeat('a', 501) WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2c: a 501-character comment was stored'; END IF;

  UPDATE lesson_feedback SET archived_at = now() WHERE id = v_id;
  INSERT INTO lesson_feedback (organization_id, class_session_id, student_id, mood, author_membership_id)
  VALUES (v_org, v_done, v_ana, 2, v_author);
  RAISE NOTICE 'PASS test 2: one live row, edited in place, 500 characters at most, and archiving frees the slot';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — nothing deletes it; another club reads none of it
-- ---------------------------------------------------------------------------

DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    DELETE FROM lesson_feedback;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3a: the app deleted a feedback'; END IF;

  ok := false;
  BEGIN
    UPDATE lesson_feedback SET anonymised_at = now();
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3b: the app anonymised a feedback (that is retention''s)'; END IF;
END $$;

SELECT set_config('app.organization_id', 'f1160000-0000-0000-0000-000000000002', true);

DO $$
BEGIN
  IF (SELECT count(*) FROM lesson_feedback) <> 0 THEN
    RAISE EXCEPTION 'FAIL test 3c: another club read a feedback';
  END IF;
  RAISE NOTICE 'PASS test 3: nothing deletes a feedback, and another club reads none';
END $$;

ROLLBACK;
