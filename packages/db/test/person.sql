-- One person, many roles — POOLSE-17, and the rewritten POOLSE-04.
--
-- Test 2 is the one to keep. The whole ticket exists because a senior student
-- who is also somebody's encarregado was two records for one human; this asserts
-- that they are one membership holding two roles, and that both the register and
-- the guardian's own page reach the same row.
--
-- Test 4 is the other. `membership_identity_belongs_to_one_owner` is what stops
-- the bug CLAUDE.md warns about in decision 3 — a name written to the club's own
-- columns for somebody Clerk already names would appear to save and be reverted
-- by the next webhook. The database refuses it rather than trusting every write
-- path to remember.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES ('Clube Pessoa', 'clube-pessoa'),
                                             ('Clube Terceiro', 'clube-terceiro');

SELECT provision_app_user('user_person', 'staff@pessoa.pt', 'Sofia', 'Marques', NULL,
                          '2026-08-26 09:00:00+00');

-- ---------------------------------------------------------------------------
-- Test 1: a guardian with no login is a real person
--
-- Almost no encarregado de educação has an account. A model that required one
-- would be a model nobody could use, so this is the ordinary case, not the edge.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_guardian uuid; v_student uuid; v_name text;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-pessoa';

  INSERT INTO membership (organization_id, status, first_name, last_name,
                          email, phone, tax_number)
  VALUES (v_org, 'active', 'Maria', 'Alves Costa', 'maria@exemplo.pt',
          '912345678', '123456789')
  RETURNING id INTO v_guardian;

  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_guardian, 'guardian');

  INSERT INTO student (organization_id, first_name, last_name, birth_date)
  VALUES (v_org, 'Rita', 'Costa', DATE '2018-04-11') RETURNING id INTO v_student;

  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id,
                             relationship, is_primary)
  VALUES (v_org, v_student, v_guardian, 'mãe', true);

  SELECT person_name(v_guardian) INTO v_name;
  IF v_name <> 'Maria Alves Costa' THEN
    RAISE EXCEPTION 'FAIL test 1: person_name returned %', v_name;
  END IF;

  RAISE NOTICE 'PASS test 1: a guardian with no login is a person with a name';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: one human, two roles, reached from both directions
--
-- The case the ticket is named for: a senior student who is also a grandchild's
-- encarregado. One membership, two roles, one phone number.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_person uuid; v_self uuid; v_grandchild uuid;
  v_roles int; v_responsible int; v_people int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-pessoa';

  INSERT INTO membership (organization_id, status, first_name, last_name,
                          phone, tax_number, birth_date)
  VALUES (v_org, 'active', 'Armando', 'Seabra', '939111222', '987654321',
          DATE '1952-03-02')
  RETURNING id INTO v_person;

  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_person, 'student'), (v_org, v_person, 'guardian');

  -- He swims himself…
  INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
  VALUES (v_org, 'Armando', 'Seabra', DATE '1952-03-02', v_person)
  RETURNING id INTO v_self;

  -- …and brings his granddaughter.
  INSERT INTO student (organization_id, first_name, last_name, birth_date)
  VALUES (v_org, 'Beatriz', 'Seabra', DATE '2019-09-30') RETURNING id INTO v_grandchild;

  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id,
                             relationship, is_primary)
  VALUES (v_org, v_grandchild, v_person, 'avô', true);

  SELECT count(*) INTO v_roles FROM membership_role
   WHERE membership_id = v_person AND archived_at IS NULL;

  SELECT count(*) INTO v_responsible FROM guardian_link
   WHERE guardian_membership_id = v_person AND archived_at IS NULL;

  -- The People list counts humans, not roles. Two roles must not be two rows.
  SELECT count(*) INTO v_people FROM membership
   WHERE organization_id = v_org AND archived_at IS NULL AND tax_number = '987654321';

  IF v_roles <> 2 OR v_responsible <> 1 OR v_people <> 1 THEN
    RAISE EXCEPTION
      'FAIL test 2: % roles, % students responsible for, % rows for one human',
      v_roles, v_responsible, v_people;
  END IF;

  -- And the register reaches the same human from the student side.
  IF (SELECT membership_id FROM student WHERE id = v_self) <> v_person THEN
    RAISE EXCEPTION 'FAIL test 2: the student does not point at the person';
  END IF;

  RAISE NOTICE 'PASS test 2: a senior student who is also an encarregado is one person';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: the relationship belongs to the pair, not to the person
--
-- The same woman is a grandmother to one child and a legal guardian to another.
-- Storing it on her would force one answer for both.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_guardian uuid; v_a uuid; v_b uuid; v_kinds int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-pessoa';

  INSERT INTO membership (organization_id, status, first_name, last_name, tax_number)
  VALUES (v_org, 'active', 'Ana', 'Freitas', '111222333') RETURNING id INTO v_guardian;

  INSERT INTO student (organization_id, first_name, last_name) VALUES (v_org, 'Duarte', 'Freitas')
  RETURNING id INTO v_a;
  INSERT INTO student (organization_id, first_name, last_name) VALUES (v_org, 'Leonor', 'Pinto')
  RETURNING id INTO v_b;

  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship)
  VALUES (v_org, v_a, v_guardian, 'avó'),
         (v_org, v_b, v_guardian, 'tutora legal');

  SELECT count(DISTINCT relationship) INTO v_kinds
    FROM guardian_link WHERE guardian_membership_id = v_guardian;

  IF v_kinds <> 2 THEN
    RAISE EXCEPTION 'FAIL test 3: one person could not hold two relationships';
  END IF;

  -- Twice to the same child is still once.
  BEGIN
    INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id)
    VALUES (v_org, v_a, v_guardian);
    RAISE EXCEPTION 'FAIL test 3: a guardian was linked to the same student twice';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS test 3: relationship lives on the link, and a pair links once';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: Clerk owns the name where there is a login
--
-- Decision 3, enforced. Writing a name here for somebody Clerk names would
-- appear to work and be reverted by the next webhook — the bug that reproduces
-- only sometimes.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_user uuid; v_membership uuid; v_name text;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-pessoa';
  SELECT id INTO v_user FROM app_user WHERE clerk_user_id = 'user_person';

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_user, 'active') RETURNING id INTO v_membership;

  BEGIN
    UPDATE membership SET first_name = 'Impostora' WHERE id = v_membership;
    RAISE EXCEPTION 'FAIL test 4: a name was written over Clerk''s';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS test 4: a membership with a login cannot hold its own name';
  END;

  -- And the resolved name comes from the cache.
  SELECT person_name(v_membership) INTO v_name;
  IF v_name <> 'Sofia Marques' THEN
    RAISE EXCEPTION 'FAIL test 4: person_name returned % rather than Clerk''s', v_name;
  END IF;

  -- Poolse's own fields are still Poolse's, and are writable.
  UPDATE membership SET phone = '966000111', tax_number = '555444333'
   WHERE id = v_membership;

  RAISE NOTICE 'PASS test 5: person_name reads Clerk, phone and NIF stay ours';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: a duplicate is refused rather than created
--
-- Criterion 9. Two operators adding the same grandmother at the same moment do
-- not each get one — the second is told she is already there.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-pessoa';

  BEGIN
    INSERT INTO membership (organization_id, status, first_name, last_name, tax_number)
    VALUES (v_org, 'active', 'Ana', 'Freitas Duplicada', '111222333');
    RAISE EXCEPTION 'FAIL test 6: a second person with the same NIF was created';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS test 6: a NIF already known to the club is refused';
  END;

  BEGIN
    INSERT INTO membership (organization_id, status, first_name, last_name, email)
    VALUES (v_org, 'active', 'Maria', 'Outra', 'maria@exemplo.pt');
    RAISE EXCEPTION 'FAIL test 6: a second person with the same email was created';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS test 7: an email already known to the club is refused';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Test 8: at most one primary contact
--
-- Who to ring first must have one answer. Two is a question nobody at the
-- poolside can resolve.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_student uuid; v_one uuid; v_two uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-pessoa';

  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'Tomás', 'Nunes') RETURNING id INTO v_student;

  INSERT INTO membership (organization_id, status, first_name, last_name, tax_number)
  VALUES (v_org, 'active', 'Pai', 'Nunes', '222333444') RETURNING id INTO v_one;
  INSERT INTO membership (organization_id, status, first_name, last_name, tax_number)
  VALUES (v_org, 'active', 'Mãe', 'Nunes', '333444555') RETURNING id INTO v_two;

  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, is_primary)
  VALUES (v_org, v_student, v_one, true);

  BEGIN
    INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, is_primary)
    VALUES (v_org, v_student, v_two, true);
    RAISE EXCEPTION 'FAIL test 8: a student got two primary contacts';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- A second guardian who is not primary is fine, and expected.
  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, is_primary)
  VALUES (v_org, v_student, v_two, false);

  RAISE NOTICE 'PASS test 8: one primary contact, any number of guardians';
END $$;

-- ---------------------------------------------------------------------------
-- Test 9: guardianship cannot cross tenants
--
-- The composite key, not RLS. Both rows pass their own policy; only
-- `(organization_id, guardian_membership_id)` refuses the reference.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_a uuid; v_b uuid; v_guardian_b uuid; v_student_a uuid;
BEGIN
  SELECT id INTO v_a FROM organization WHERE slug = 'clube-pessoa';
  SELECT id INTO v_b FROM organization WHERE slug = 'clube-terceiro';

  INSERT INTO membership (organization_id, status, first_name, last_name)
  VALUES (v_b, 'active', 'Estranha', 'Pessoa') RETURNING id INTO v_guardian_b;

  SELECT id INTO v_student_a FROM student
   WHERE organization_id = v_a AND first_name = 'Rita';

  BEGIN
    INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id)
    VALUES (v_a, v_student_a, v_guardian_b);
    RAISE EXCEPTION 'FAIL test 9: another tenant''s person became a guardian';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS test 9: guardianship cannot cross tenants';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Test 10: guardian links are invisible across tenants
--
-- The policy, this time. Everything above ran unscoped as the owner; this runs
-- as the application role, which is how the API reaches the data.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_b uuid;
BEGIN
  SELECT id INTO v_b FROM organization WHERE slug = 'clube-terceiro';
  PERFORM set_config('app.organization_id', v_b::text, true);
END $$;

SET ROLE poolse_app;

DO $$
DECLARE
  v_visible int;
BEGIN
  SELECT count(*) INTO v_visible FROM guardian_link;

  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'FAIL test 10: % of another tenant''s guardian links were visible',
      v_visible;
  END IF;

  RAISE NOTICE 'PASS test 10: guardian links are invisible across tenants';
END $$;

RESET ROLE;

ROLLBACK;
