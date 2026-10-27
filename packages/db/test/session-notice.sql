-- Vou / Não vou — POOLSE-90 slice 2.
--
--   1. **Only before the lesson, only a turma's, never a cancelled one** — each
--      refused by the trigger with its code in DETAIL.
--   2. **One row per lesson and student, the last answer**, and no row touches
--      `attendance`.
--   3. **Who answers** — `family_may_answer()`: a live guardian; the student's
--      own login from 12 or on the adult path; never on a missing birth date.
--   4. **Nothing deletes a notice, and another club reads none.**
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('f0900000-0000-0000-0000-000000000001', 'Clube Avisos', 'clube-avisos'),
  ('f0900000-0000-0000-0000-000000000002', 'Clube Do Lado', 'clube-do-lado-avisos');
UPDATE organization SET max_facilities = 20 WHERE id::text LIKE 'f0900000%';

INSERT INTO season (organization_id, name, starts_on, ends_on)
VALUES ('f0900000-0000-0000-0000-000000000001', 'Época', DATE '2020-01-01', DATE '2035-12-31');

CREATE TEMP TABLE fx (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT ON fx TO poolse_app;

DO $$
DECLARE
  v_org uuid := 'f0900000-0000-0000-0000-000000000001';
  v_facility uuid; v_pool uuid; v_teacher uuid; v_mother uuid; v_group uuid;
  v_eleven_login uuid; v_twelve_login uuid; v_adult_login uuid; v_undated_login uuid;
  v_ana uuid; v_eleven uuid; v_twelve uuid; v_adult uuid; v_undated uuid;
  v_coming uuid; v_started uuid; v_cancelled uuid; v_partner uuid;
BEGIN
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Complexo') RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_org, v_facility, 'Tanque', 'indoor') RETURNING id INTO v_pool;
  INSERT INTO membership (organization_id, status, email, first_name, last_name)
  VALUES (v_org, 'active', 'prof@avisos.pt', 'Marta', 'Silva') RETURNING id INTO v_teacher;
  INSERT INTO membership (organization_id, status, email, first_name, last_name)
  VALUES (v_org, 'active', 'mae@avisos.pt', 'Rosa', 'Martins') RETURNING id INTO v_mother;
  INSERT INTO membership (organization_id, status, email, first_name, last_name) VALUES (v_org, 'active', 'onze@avisos.pt', 'Onze', 'Login') RETURNING id INTO v_eleven_login;
  INSERT INTO membership (organization_id, status, email, first_name, last_name) VALUES (v_org, 'active', 'doze@avisos.pt', 'Doze', 'Login') RETURNING id INTO v_twelve_login;
  INSERT INTO membership (organization_id, status, email, first_name, last_name) VALUES (v_org, 'active', 'adulto@avisos.pt', 'Adulto', 'Login') RETURNING id INTO v_adult_login;
  INSERT INTO membership (organization_id, status, email, first_name, last_name) VALUES (v_org, 'active', 'semdata@avisos.pt', 'Sem', 'Login') RETURNING id INTO v_undated_login;

  INSERT INTO class_group (organization_id, season_id, name, pool_id, instructor_membership_id)
  VALUES (v_org, (SELECT id FROM season WHERE organization_id = v_org), 'Iniciação', v_pool, v_teacher)
  RETURNING id INTO v_group;

  INSERT INTO student (organization_id, first_name, last_name, birth_date)
  VALUES (v_org, 'Ana', 'Martins', club_today() - interval '8 years') RETURNING id INTO v_ana;
  INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
  VALUES (v_org, 'Onze', 'Anos', club_today() - interval '11 years', v_eleven_login) RETURNING id INTO v_eleven;
  INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
  VALUES (v_org, 'Doze', 'Anos', club_today() - interval '12 years', v_twelve_login) RETURNING id INTO v_twelve;
  INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
  VALUES (v_org, 'Adulto', 'Sozinho', club_today() - interval '30 years', v_adult_login) RETURNING id INTO v_adult;
  INSERT INTO student (organization_id, first_name, last_name, membership_id)
  VALUES (v_org, 'Sem', 'Data', v_undated_login) RETURNING id INTO v_undated;

  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
  VALUES (v_org, v_ana, v_mother, 'Mãe', true),
         (v_org, v_eleven, v_mother, 'Mãe', true),
         (v_org, v_twelve, v_mother, 'Mãe', true);

  INSERT INTO class_session (organization_id, class_group_id, pool_id, starts_at, duration_minutes, instructor_membership_id)
  VALUES (v_org, v_group, v_pool, now() + interval '2 days', 45, v_teacher) RETURNING id INTO v_coming;
  INSERT INTO class_session (organization_id, class_group_id, pool_id, starts_at, duration_minutes, instructor_membership_id)
  VALUES (v_org, v_group, v_pool, now() - interval '5 minutes', 45, v_teacher) RETURNING id INTO v_started;
  INSERT INTO class_session (organization_id, class_group_id, pool_id, starts_at, duration_minutes, instructor_membership_id, status)
  VALUES (v_org, v_group, v_pool, now() + interval '3 days', 45, v_teacher, 'cancelled') RETURNING id INTO v_cancelled;
  INSERT INTO class_session (organization_id, pool_id, starts_at, duration_minutes, instructor_membership_id)
  VALUES (v_org, v_pool, now() + interval '4 days', 45, v_teacher) RETURNING id INTO v_partner;

  INSERT INTO fx VALUES ('org', v_org), ('mother', v_mother), ('ana', v_ana),
    ('eleven', v_eleven), ('eleven_login', v_eleven_login), ('twelve', v_twelve), ('twelve_login', v_twelve_login),
    ('adult', v_adult), ('adult_login', v_adult_login), ('undated', v_undated), ('undated_login', v_undated_login),
    ('coming', v_coming), ('started', v_started), ('cancelled', v_cancelled), ('partner', v_partner);
END $$;

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'f0900000-0000-0000-0000-000000000001', true);

-- Test 1 — each refusal, with its code
DO $$
DECLARE
  v_org uuid := (SELECT id FROM fx WHERE name = 'org');
  v_detail text;
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
      ('started',   'notice_closed|'),
      ('cancelled', 'notice_not_offered|cancelled'),
      ('partner',   'notice_not_offered|no_turma')
    ) AS t(session, expected) LOOP
    v_detail := NULL;
    BEGIN
      INSERT INTO session_notice (organization_id, class_session_id, student_id, going, answered_by_membership_id)
      VALUES (v_org, (SELECT id FROM fx WHERE name = c.session), (SELECT id FROM fx WHERE name = 'ana'), false,
              (SELECT id FROM fx WHERE name = 'mother'));
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    END;
    IF v_detail IS NULL OR v_detail NOT LIKE c.expected || '%' THEN
      RAISE EXCEPTION 'FAIL test 1 (%): expected %, got %', c.session, c.expected, v_detail;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS test 1: started, cancelled and no-turma lessons are refused with their code';
END $$;

-- Test 2 — one row, the last answer, and attendance untouched
DO $$
DECLARE
  v_org uuid := (SELECT id FROM fx WHERE name = 'org');
  v_coming uuid := (SELECT id FROM fx WHERE name = 'coming');
  v_ana uuid := (SELECT id FROM fx WHERE name = 'ana');
  v_mother uuid := (SELECT id FROM fx WHERE name = 'mother');
BEGIN
  INSERT INTO session_notice (organization_id, class_session_id, student_id, going, answered_by_membership_id)
  VALUES (v_org, v_coming, v_ana, true, v_mother)
  ON CONFLICT (organization_id, class_session_id, student_id)
  DO UPDATE SET going = excluded.going, answered_by_membership_id = excluded.answered_by_membership_id, answered_at = now();
  INSERT INTO session_notice (organization_id, class_session_id, student_id, going, answered_by_membership_id)
  VALUES (v_org, v_coming, v_ana, false, v_mother)
  ON CONFLICT (organization_id, class_session_id, student_id)
  DO UPDATE SET going = excluded.going, answered_by_membership_id = excluded.answered_by_membership_id, answered_at = now();

  IF (SELECT count(*) FROM session_notice WHERE class_session_id = v_coming) <> 1
     OR (SELECT going FROM session_notice WHERE class_session_id = v_coming) THEN
    RAISE EXCEPTION 'FAIL test 2a: expected one row, the last answer (Não vou)';
  END IF;
  IF EXISTS (SELECT 1 FROM attendance WHERE class_session_id = v_coming) THEN
    RAISE EXCEPTION 'FAIL test 2b: a notice wrote attendance';
  END IF;
  RAISE NOTICE 'PASS test 2: one row per lesson and student, the last answer wins, attendance untouched';
END $$;

-- Test 3 — who answers
DO $$
DECLARE
  v_org uuid := (SELECT id FROM fx WHERE name = 'org');
  f boolean;
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
      ('ana',     'mother',        true,  'a guardian answers for an eight-year-old'),
      ('ana',     'eleven_login',  false, 'a stranger does not'),
      ('eleven',  'eleven_login',  false, 'an eleven-year-old with a login does not'),
      ('twelve',  'twelve_login',  true,  'a twelve-year-old with a login does'),
      ('twelve',  'mother',        true,  'and so does their guardian'),
      ('adult',   'adult_login',   true,  'an adult-path student does'),
      ('undated', 'undated_login', false, 'no birth date is never a guess')
    ) AS t(student, who, expected, why) LOOP
    f := family_may_answer(v_org, (SELECT id FROM fx WHERE name = c.student), (SELECT id FROM fx WHERE name = c.who));
    IF f IS DISTINCT FROM c.expected THEN
      RAISE EXCEPTION 'FAIL test 3: %', c.why;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS test 3: a guardian; the student from 12 or on the adult path; never on a missing birth date';
END $$;

-- Test 4 — nothing deletes it; another club reads none
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    DELETE FROM session_notice;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4a: the app deleted a notice'; END IF;
END $$;

SELECT set_config('app.organization_id', 'f0900000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM session_notice) <> 0 THEN
    RAISE EXCEPTION 'FAIL test 4b: another club read a notice';
  END IF;
  RAISE NOTICE 'PASS test 4: nothing deletes a notice, and another club reads none';
END $$;

ROLLBACK;
