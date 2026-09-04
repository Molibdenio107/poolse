-- Skills in four states — POOLSE-20.
--
-- Test 3 is the one to keep. `skill_thresholds_met` is what stops a skill being
-- signed off the first day it is tried, and it counts *attendance*, not sessions
-- that existed — a child absent for six weeks has not had six lessons. Getting
-- that wrong would make the threshold pass for exactly the students it exists to
-- protect.
--
-- Test 2 is the other. The stamps are in a trigger because every write path —
-- the grid, a single correction, an import — must produce the same ones, and a
-- level's completion date silently becoming "the day somebody edited a note" is
-- the kind of wrong nobody notices until a certificate is printed.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES ('Clube Competências', 'clube-competencias'),
                                             ('Clube Alheio', 'clube-alheio-skills');

-- This fixture states its own plan. A subscription covers one facility by
-- default and `facility_licence` enforces it; nothing below is about billing,
-- so the plan is set out of the way. The limit is asserted in `facilities.sql`.
UPDATE organization SET max_facilities = 20;



SELECT provision_app_user('user_skill', 'inst@skills.pt', 'Marta', 'Reis', NULL,
                          '2026-08-26 09:00:00+00');

-- ---------------------------------------------------------------------------
-- Test 1: a level has skills, ordered, and names do not repeat within it
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_level uuid; v_other uuid; v_names text[];
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-competencias';

  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_org, 'Nível A', 0) RETURNING id INTO v_level;
  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_org, 'Nível B', 1) RETURNING id INTO v_other;

  INSERT INTO skill (organization_id, level_id, name, sort_order) VALUES
    (v_org, v_level, 'Flutuação ventral', 0),
    (v_org, v_level, 'Respiração', 1),
    (v_org, v_level, 'Deslize', 2);

  SELECT array_agg(name ORDER BY sort_order) INTO v_names
    FROM skill WHERE level_id = v_level AND archived_at IS NULL;

  IF v_names <> ARRAY['Flutuação ventral', 'Respiração', 'Deslize'] THEN
    RAISE EXCEPTION 'FAIL test 1: skills came back as %', v_names;
  END IF;

  -- Twice in the same level is a mistake, whatever the casing.
  BEGIN
    INSERT INTO skill (organization_id, level_id, name) VALUES (v_org, v_level, 'RESPIRAÇÃO');
    RAISE EXCEPTION 'FAIL test 1: a duplicate skill name was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- The same name in a different level is not a duplicate: "Respiração" means
  -- something harder at Nível B, and both levels teach it.
  INSERT INTO skill (organization_id, level_id, name) VALUES (v_org, v_other, 'Respiração');

  RAISE NOTICE 'PASS test 1: skills belong to a level, are ordered, and are unique within it';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: the stamps are the trigger's, not the caller's
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_skill uuid; v_student uuid; v_when timestamptz; v_started date;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-competencias';
  SELECT id INTO v_skill FROM skill WHERE name = 'Deslize';

  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'Íris', 'Mendes') RETURNING id INTO v_student;

  -- Starting the skill stamps the day it began.
  INSERT INTO skill_progress (organization_id, student_id, skill_id, state)
  VALUES (v_org, v_student, v_skill, 'started');

  SELECT started_on INTO v_started FROM skill_progress
   WHERE student_id = v_student AND skill_id = v_skill;
  IF v_started IS NULL THEN
    RAISE EXCEPTION 'FAIL test 2: started_on was not stamped';
  END IF;

  -- Not attained, so no attained_at — the check constraint ties the two together.
  IF EXISTS (
    SELECT 1 FROM skill_progress
     WHERE student_id = v_student AND skill_id = v_skill AND attained_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'FAIL test 2: attained_at was set before the skill was attained';
  END IF;

  UPDATE skill_progress SET state = 'attained'
   WHERE student_id = v_student AND skill_id = v_skill;

  SELECT attained_at INTO v_when FROM skill_progress
   WHERE student_id = v_student AND skill_id = v_skill;
  IF v_when IS NULL THEN
    RAISE EXCEPTION 'FAIL test 2: attained_at was not stamped';
  END IF;

  -- Re-saving must not move the sign-off date.
  UPDATE skill_progress SET recorded_by_membership_id = NULL
   WHERE student_id = v_student AND skill_id = v_skill;

  IF (SELECT attained_at FROM skill_progress
       WHERE student_id = v_student AND skill_id = v_skill) <> v_when THEN
    RAISE EXCEPTION 'FAIL test 2: re-saving moved the sign-off date';
  END IF;

  -- And going back clears it. A skill that is no longer attained has no date on
  -- which it was.
  UPDATE skill_progress SET state = 'tested'
   WHERE student_id = v_student AND skill_id = v_skill;

  IF (SELECT attained_at FROM skill_progress
       WHERE student_id = v_student AND skill_id = v_skill) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 2: attained_at survived a correction';
  END IF;

  -- The started day survives it, though: they did not start again.
  IF (SELECT started_on FROM skill_progress
       WHERE student_id = v_student AND skill_id = v_skill) <> v_started THEN
    RAISE EXCEPTION 'FAIL test 2: a correction moved started_on';
  END IF;

  RAISE NOTICE 'PASS test 2: started_on and attained_at are stamped, kept and cleared correctly';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: thresholds count attended lessons, not elapsed classes
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_level uuid; v_skill uuid; v_student uuid;
  v_facility uuid; v_pool uuid; v_group uuid; v_membership uuid;
  v_session uuid; v_day date;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-competencias';
  SELECT id INTO v_level FROM student_level WHERE organization_id = v_org AND name = 'Nível A';

  -- Three lessons, and at least a week.
  INSERT INTO skill (organization_id, level_id, name, min_days, min_lessons)
  VALUES (v_org, v_level, 'Mergulho', 7, 3) RETURNING id INTO v_skill;

  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'Vasco', 'Lima') RETURNING id INTO v_student;

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina')
  RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name)
  VALUES (v_org, v_facility, 'Tanque') RETURNING id INTO v_pool;

  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, 'Época de teste', DATE '2020-01-01', DATE '2030-12-31');

  INSERT INTO class_group (organization_id, season_id, name, pool_id, level_id)
  VALUES (v_org, (SELECT id FROM season WHERE organization_id = v_org),
          'Turma A', v_pool, v_level)
  RETURNING id INTO v_group;

  SELECT id INTO v_membership FROM app_user WHERE clerk_user_id = 'user_skill';
  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_membership, 'active') RETURNING id INTO v_membership;

  -- Started a fortnight ago, so the days threshold is satisfied.
  INSERT INTO skill_progress (organization_id, student_id, skill_id, state, started_on)
  VALUES (v_org, v_student, v_skill, 'started', current_date - 14);

  -- No attendance yet: three lessons are required, so not yet.
  IF skill_thresholds_met(v_org, v_student, v_skill) THEN
    RAISE EXCEPTION 'FAIL test 3: thresholds passed with no lessons attended';
  END IF;

  -- Four classes happened; the student was present at two and absent at two.
  FOR i IN 1..4 LOOP
    v_day := current_date - (12 - i * 2);

    INSERT INTO class_session (organization_id, class_group_id, pool_id,
                               starts_at, duration_minutes, status)
    VALUES (v_org, v_group, v_pool, v_day::timestamptz + interval '18 hours', 45, 'completed')
    RETURNING id INTO v_session;

    INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                            recorded_by_membership_id)
    VALUES (v_org, v_session, v_student,
            (CASE WHEN i <= 2 THEN 'present' ELSE 'absent' END)::attendance_status,
            v_membership);
  END LOOP;

  -- Two present out of four. The threshold is three lessons, and absences are
  -- not lessons — this is the assertion the whole function exists for.
  IF skill_thresholds_met(v_org, v_student, v_skill) THEN
    RAISE EXCEPTION 'FAIL test 3: absences were counted as lessons attended';
  END IF;

  -- A third attendance tips it.
  INSERT INTO class_session (organization_id, class_group_id, pool_id,
                             starts_at, duration_minutes, status)
  VALUES (v_org, v_group, v_pool, (current_date - 1)::timestamptz + interval '18 hours',
          45, 'completed')
  RETURNING id INTO v_session;

  INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                          recorded_by_membership_id)
  VALUES (v_org, v_session, v_student, 'present', v_membership);

  IF NOT skill_thresholds_met(v_org, v_student, v_skill) THEN
    RAISE EXCEPTION 'FAIL test 3: thresholds still refused after three lessons';
  END IF;

  RAISE NOTICE 'PASS test 3: thresholds count attended lessons, and absences are not lessons';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: a skill with no thresholds is always ready
--
-- The common case, and it must not need configuring. A club that does not work
-- this way sets neither number and nothing stands in their way.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_skill uuid; v_student uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-competencias';
  SELECT id INTO v_skill FROM skill WHERE name = 'Flutuação ventral';
  SELECT id INTO v_student FROM student
   WHERE organization_id = v_org AND first_name = 'Vasco';

  IF NOT skill_thresholds_met(v_org, v_student, v_skill) THEN
    RAISE EXCEPTION 'FAIL test 4: a skill with no thresholds was refused';
  END IF;

  RAISE NOTICE 'PASS test 4: a skill with no thresholds needs no lessons counted';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: an override has to say who and why
--
-- The escape hatch is what makes thresholds safe to have. Recording who used it
-- is what stops it becoming the normal path.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_skill uuid; v_student uuid; v_membership uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-competencias';
  SELECT id INTO v_skill FROM skill WHERE name = 'Mergulho';
  SELECT id INTO v_student FROM student
   WHERE organization_id = v_org AND first_name = 'Vasco';
  SELECT id INTO v_membership FROM membership WHERE organization_id = v_org LIMIT 1;

  BEGIN
    UPDATE skill_progress
       SET state = 'attained', override_by_membership_id = v_membership
     WHERE student_id = v_student AND skill_id = v_skill;
    RAISE EXCEPTION 'FAIL test 5: an override was accepted with no reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  UPDATE skill_progress
     SET state = 'attained',
         override_by_membership_id = v_membership,
         override_reason = 'Avaliado em prova aberta'
   WHERE student_id = v_student AND skill_id = v_skill;

  RAISE NOTICE 'PASS test 5: an override records who used it and why';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: progress cannot cross tenants, and is invisible across them
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_a uuid; v_b uuid; v_skill_a uuid; v_student_b uuid; v_level_b uuid;
BEGIN
  SELECT id INTO v_a FROM organization WHERE slug = 'clube-competencias';
  SELECT id INTO v_b FROM organization WHERE slug = 'clube-alheio-skills';

  SELECT id INTO v_skill_a FROM skill WHERE organization_id = v_a LIMIT 1;

  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_b, 'Nível deles', 0) RETURNING id INTO v_level_b;
  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_b, 'Aluno', 'Alheio') RETURNING id INTO v_student_b;

  -- The composite key, not RLS: both rows pass their own policy.
  BEGIN
    INSERT INTO skill_progress (organization_id, student_id, skill_id, state)
    VALUES (v_b, v_student_b, v_skill_a, 'started');
    RAISE EXCEPTION 'FAIL test 6: a student was marked on another tenant''s skill';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- And a skill cannot be hung off another tenant's level.
  BEGIN
    INSERT INTO skill (organization_id, level_id, name)
    VALUES (v_b, (SELECT id FROM student_level WHERE organization_id = v_a LIMIT 1), 'Roubada');
    RAISE EXCEPTION 'FAIL test 6: a skill was hung off another tenant''s level';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 6: skills and progress cannot cross tenants';
END $$;

DO $$
DECLARE
  v_b uuid;
BEGIN
  SELECT id INTO v_b FROM organization WHERE slug = 'clube-alheio-skills';
  PERFORM set_config('app.organization_id', v_b::text, true);
END $$;

SET ROLE poolse_app;

DO $$
DECLARE
  v_visible int;
BEGIN
  SELECT count(*) INTO v_visible FROM skill_progress;
  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7: % of another tenant''s progress rows were visible', v_visible;
  END IF;

  SELECT count(*) INTO v_visible FROM skill;
  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7: % of another tenant''s skills were visible', v_visible;
  END IF;

  RAISE NOTICE 'PASS test 7: skills and progress are invisible across tenants';
END $$;

RESET ROLE;

ROLLBACK;
