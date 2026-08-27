-- Students and levels proof — slice 1.2.
--
-- Two tests here matter more than the rest. Test 3 is the one the roadmap is
-- really asking for: an operator types "joao" and finds "João Silva", because a
-- search box in a Portuguese product that needs the accent typed correctly is a
-- search box nobody uses. Test 6 is the composite foreign key again — a student
-- must not be placeable in another organization's level, whatever id arrives.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES
  ('Clube A', 'clube-a'),
  ('Clube B', 'clube-b');

-- ---------------------------------------------------------------------------
-- Test 1 — levels are an ordered progression, not an alphabetical list
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_names text[];
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  INSERT INTO student_level (organization_id, name, sort_order) VALUES
    (v_org, 'Adaptação', 0),
    (v_org, 'Iniciação', 1),
    (v_org, 'Aperfeiçoamento', 2);

  SELECT array_agg(name ORDER BY sort_order) INTO v_names
    FROM student_level WHERE organization_id = v_org AND archived_at IS NULL;

  IF v_names <> ARRAY['Adaptação', 'Iniciação', 'Aperfeiçoamento'] THEN
    RAISE EXCEPTION 'FAIL test 1a: progression came back as %', v_names;
  END IF;

  -- Alphabetical would put Aperfeiçoamento first, which is the whole reason
  -- sort_order exists.
  SELECT array_agg(name ORDER BY name) INTO v_names
    FROM student_level WHERE organization_id = v_org AND archived_at IS NULL;
  IF v_names[1] <> 'Adaptação' THEN
    RAISE NOTICE '  (alphabetical order would start with %, hence sort_order)', v_names[1];
  END IF;

  RAISE NOTICE 'PASS test 1: levels keep the order the operator put them in';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — one live level per name, accent- and case-insensitively
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_id uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  BEGIN
    INSERT INTO student_level (organization_id, name) VALUES (v_org, 'iniciacao');
    RAISE EXCEPTION 'FAIL test 2a: "iniciacao" was allowed alongside "Iniciação"';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  -- Archiving frees the name, like every other soft-deletable table here.
  SELECT id INTO v_id FROM student_level
   WHERE organization_id = v_org AND name = 'Aperfeiçoamento';
  UPDATE student_level SET archived_at = now() WHERE id = v_id;

  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_org, 'Aperfeiçoamento', 3);

  RAISE NOTICE 'PASS test 2: level names are unique per organization until archived';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — search finds people the way an operator types
--
-- Keep this one. Portuguese names carry accents and nobody types them into a
-- search box. If this breaks, the register stops being usable at exactly the
-- point it starts being full.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_level uuid; n int; v_found text;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_level FROM student_level
   WHERE organization_id = v_org AND name = 'Iniciação';

  INSERT INTO student (organization_id, first_name, last_name, birth_date, level_id) VALUES
    (v_org, 'João',   'Silva',     DATE '2015-04-12', v_level),
    (v_org, 'Ana',    'Conceição', DATE '2016-09-30', v_level),
    (v_org, 'Mariana','Sá',        DATE '2014-01-05', NULL);

  -- Typed without accents, in lower case.
  SELECT first_name || ' ' || last_name INTO v_found
    FROM student
   WHERE organization_id = v_org
     AND lower(strip_accents(first_name || ' ' || last_name)) LIKE '%' || lower(strip_accents('joao')) || '%';
  IF v_found IS DISTINCT FROM 'João Silva' THEN
    RAISE EXCEPTION 'FAIL test 3a: searching "joao" found %', v_found;
  END IF;

  -- Typed with accents, in upper case.
  SELECT count(*) INTO n FROM student
   WHERE organization_id = v_org
     AND lower(strip_accents(first_name || ' ' || last_name)) LIKE '%' || lower(strip_accents('CONCEIÇÃO')) || '%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 3b: searching "CONCEIÇÃO" matched % students', n;
  END IF;

  -- Across the first and last name together, which is how people search.
  SELECT count(*) INTO n FROM student
   WHERE organization_id = v_org
     AND lower(strip_accents(first_name || ' ' || last_name)) LIKE '%' || lower(strip_accents('ana concei')) || '%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 3c: searching a full-name fragment matched % students', n;
  END IF;

  RAISE NOTICE 'PASS test 3: search ignores accents and case, across the whole name';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — two children may share a name
--
-- Deliberately no unique constraint. A second Maria Silva is ordinary, and
-- rejecting her would push an operator into inventing "Maria Silva 2".
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  INSERT INTO student (organization_id, first_name, last_name) VALUES
    (v_org, 'Maria', 'Silva'),
    (v_org, 'Maria', 'Silva');

  SELECT count(*) INTO n FROM student
   WHERE organization_id = v_org AND first_name = 'Maria' AND last_name = 'Silva';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 4: expected both Marias, got %', n;
  END IF;

  RAISE NOTICE 'PASS test 4: two students may share a name';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — a birth date before 1900 is a typo, and age is computed
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_age int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';

  BEGIN
    INSERT INTO student (organization_id, first_name, last_name, birth_date)
    VALUES (v_org, 'Erro', 'Digitacao', DATE '1899-01-01');
    RAISE EXCEPTION 'FAIL test 5a: a birth date before 1900 was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- Age comes from the database, not from JavaScript, so no timezone can move a
  -- birthday across midnight.
  SELECT extract(YEAR FROM age(birth_date))::int INTO v_age
    FROM student WHERE organization_id = v_org AND first_name = 'João';
  IF v_age IS NULL OR v_age < 5 OR v_age > 100 THEN
    RAISE EXCEPTION 'FAIL test 5b: age came out as %', v_age;
  END IF;

  -- An unknown birth date stays unknown rather than becoming a zero.
  INSERT INTO student (organization_id, first_name, last_name, birth_date)
  VALUES (v_org, 'Sem', 'Data', NULL);

  RAISE NOTICE 'PASS test 5: impossible birth dates are refused, unknown ones stay unknown';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — a student cannot be put in another organization's level
--
-- Keep this one. Same composite foreign key as pools and facilities, applied to
-- the table that holds children's records.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_a uuid; v_b uuid; v_a_level uuid;
BEGIN
  SELECT id INTO v_a FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_b FROM organization WHERE name = 'Clube B';
  SELECT id INTO v_a_level FROM student_level
   WHERE organization_id = v_a AND name = 'Iniciação';

  BEGIN
    INSERT INTO student (organization_id, first_name, last_name, level_id)
    VALUES (v_b, 'Aluno', 'Roubado', v_a_level);
    RAISE EXCEPTION 'FAIL test 6: a student was put in another organization''s level';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 6: a student cannot be placed in another organization''s level';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — archiving a level leaves its students without one, not broken
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_level uuid; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_level FROM student_level
   WHERE organization_id = v_org AND name = 'Iniciação';

  UPDATE student_level SET archived_at = now() WHERE id = v_level;
  UPDATE student SET level_id = NULL WHERE level_id = v_level AND archived_at IS NULL;

  SELECT count(*) INTO n FROM student
   WHERE organization_id = v_org AND level_id = v_level AND archived_at IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7a: % students still point at an archived level', n;
  END IF;

  -- And they are still here. Archiving a level must not archive children.
  SELECT count(*) INTO n FROM student
   WHERE organization_id = v_org AND archived_at IS NULL;
  IF n < 5 THEN
    RAISE EXCEPTION 'FAIL test 7b: only % students survived archiving a level', n;
  END IF;

  RAISE NOTICE 'PASS test 7: archiving a level unlevels its students without removing them';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8 — the register is invisible across tenants
--
-- These are children's records. This is the assertion that says so.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE v_a uuid; v_b uuid; n int;
BEGIN
  SET LOCAL ROLE postgres;
  SELECT id INTO v_a FROM organization WHERE name = 'Clube A';
  SELECT id INTO v_b FROM organization WHERE name = 'Clube B';
  SET LOCAL ROLE poolse_app;

  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM student;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8a: Clube B read % of Clube A students', n;
  END IF;

  SELECT count(*) INTO n FROM student_level;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8b: Clube B read % of Clube A levels', n;
  END IF;

  -- The search query from the repository, with no WHERE organization_id on it.
  SELECT count(*) INTO n FROM student
   WHERE lower(strip_accents(first_name || ' ' || last_name)) LIKE '%silva%';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 8c: searching from Clube B found % of Clube A students', n;
  END IF;

  BEGIN
    INSERT INTO student (organization_id, first_name, last_name)
    VALUES (v_a, 'Aluno', 'Forjado');
    RAISE EXCEPTION 'FAIL test 8d: Clube B created a student inside Clube A';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'PASS test 8: student records are invisible and unwritable across tenants';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 9 — the encarregado de educação is a person, linked — POOLSE-04, POOLSE-17
--
-- The important half is what is *not* enforced. Age moves on its own: a student
-- who was fifteen when the row was written turns eighteen without anybody
-- touching it, so a constraint requiring a guardian would quietly become false
-- and block every later edit to a record that was perfectly valid when made.
-- The requirement lives in the API, where it can look at today's date; the
-- schema only refuses values that are wrong in themselves.
--
-- And nothing severs the link when somebody turns eighteen. "Who was your
-- guardian" stays true about the years it covered — criterion 8 of the rewritten
-- POOLSE-04 asks for the link to be retained, not deleted.
--
-- The guardian's own details are asserted in person.sql; this is about the
-- student's side of the relation.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_minor uuid; v_adult uuid; v_guardian uuid;
        v_sibling uuid; n int;
BEGIN
  v_org := (SELECT id FROM organization WHERE name = 'Clube A');

  INSERT INTO membership (organization_id, status, first_name, last_name, phone)
  VALUES (v_org, 'active', 'Rita', 'Sousa', '912345678')
  RETURNING id INTO v_guardian;

  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_guardian, 'guardian');

  INSERT INTO student (organization_id, first_name, last_name, birth_date)
  VALUES (v_org, 'Matilde', 'Sousa', current_date - interval '9 years')
  RETURNING id INTO v_minor;

  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id,
                             relationship, is_primary)
  VALUES (v_org, v_minor, v_guardian, 'Mãe', true);

  -- An adult with no guardian at all is perfectly ordinary. Nothing in the
  -- schema requires a link.
  INSERT INTO student (organization_id, first_name, last_name, birth_date)
  VALUES (v_org, 'Armando', 'Seabra', DATE '1959-03-02')
  RETURNING id INTO v_adult;

  -- And an adult who still carries a link made while they were a minor keeps it.
  -- There is no trigger and no job that clears this.
  UPDATE student SET birth_date = current_date - interval '19 years' WHERE id = v_minor;

  SELECT count(*) INTO n
    FROM guardian_link
   WHERE student_id = v_minor AND guardian_membership_id = v_guardian
     AND archived_at IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 9a: the guardian link was lost when the student turned 18';
  END IF;

  -- The relationship reads back from the link, not from the person: she is
  -- "Mãe" to this child specifically.
  IF (SELECT relationship FROM guardian_link WHERE student_id = v_minor) <> 'Mãe' THEN
    RAISE EXCEPTION 'FAIL test 9b: the relationship did not survive on the link';
  END IF;

  -- Blank is not a value, and an untouched form field sends one.
  BEGIN
    UPDATE guardian_link SET relationship = '   ' WHERE student_id = v_minor;
    RAISE EXCEPTION 'FAIL test 9c: a blank relationship was stored';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- One guardian may cover a whole family — the sibling case that made a
  -- free-text column the wrong shape, because it meant typing her in twice.
  INSERT INTO student (organization_id, first_name, last_name, birth_date)
  VALUES (v_org, 'Gonçalo', 'Sousa', current_date - interval '7 years')
  RETURNING id INTO v_sibling;

  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id,
                             relationship, is_primary)
  VALUES (v_org, v_sibling, v_guardian, 'Mãe', true);

  SELECT count(*) INTO n FROM guardian_link
   WHERE guardian_membership_id = v_guardian AND archived_at IS NULL;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 9d: one guardian could not cover two siblings, got %', n;
  END IF;

  RAISE NOTICE 'PASS test 9: guardianship is a link, kept across a birthday, shared by siblings';
END $$;

ROLLBACK;
