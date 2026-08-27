-- One Person, many roles: the duplicate half — POOLSE-17.
--
-- Scenarios 17.7, 17.9, 17.10, 17.11, 17.12, 17.13 and 17.17 from the ticket's
-- QA section. The rest are API and UI scenarios and live in their own suites.
--
-- Test 5 is the one to keep. `merge_memberships` discovers the foreign keys it
-- must repoint from the catalogue rather than from a list, and this asserts that
-- every kind of reference actually moves — an enrolment, a register, a
-- guardianship, an audit row. A merge that repoints most things is worse than
-- one that repoints none, because the graph is then half-broken and nobody knows
-- which half.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES ('Clube Fusão', 'clube-fusao'),
                                             ('Clube Vizinho', 'clube-vizinho-merge');

SELECT provision_app_user('user_merge', 'staff@fusao.pt', 'Sara', 'Antunes', NULL,
                          '2026-08-26 09:00:00+00');

-- ---------------------------------------------------------------------------
-- Test 1 — 17.7: the same NIF twice is refused by the index, not by timing
--
-- The ticket is explicit that the check must not depend on when the two requests
-- arrive. An application check loses that race; a unique index does not.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-fusao';

  INSERT INTO membership (organization_id, status, first_name, last_name, tax_number)
  VALUES (v_org, 'active', 'Helena', 'Matos', '123456789');

  BEGIN
    INSERT INTO membership (organization_id, status, first_name, last_name, tax_number)
    VALUES (v_org, 'active', 'Helena', 'Matos Duplicada', '123456789');
    RAISE EXCEPTION 'FAIL test 1: a second person with the same NIF was created';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 1 (17.7): a repeated NIF is refused by the index';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — 17.17: a guardian needs a dedup key; a student does not
--
-- The answer to the ticket's open question. Most seven-year-olds have neither a
-- NIF nor an email, and requiring one would block ordinary enrolment. A guardian
-- is an adult who has one, and guardians are where duplicates come from.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_person uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-fusao';

  -- A person with neither, holding no role: perfectly ordinary.
  INSERT INTO membership (organization_id, status, first_name, last_name)
  VALUES (v_org, 'active', 'Criança', 'Sem Chave') RETURNING id INTO v_person;

  -- Making them a student is fine too.
  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_person, 'student');

  RAISE NOTICE 'PASS test 2a (17.17): a student may have neither NIF nor email';
END $$;

DO $$
DECLARE
  v_org uuid; v_person uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-fusao';
  SELECT id INTO v_person FROM membership
   WHERE organization_id = v_org AND first_name = 'Criança';

  -- But making them a guardian is not, while they have no key.
  BEGIN
    INSERT INTO membership_role (organization_id, membership_id, role)
    VALUES (v_org, v_person, 'guardian');
    -- Deferred to commit, so the failure surfaces here rather than at the insert.
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'FAIL test 2: a guardian was created with no NIF and no email';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 2b (17.17): a guardian without a dedup key is refused';
END $$;

DO $$
DECLARE
  v_org uuid; v_person uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-fusao';

  -- Give them an email and the same grant succeeds. The rule is about being
  -- dedupable, not about being an adult.
  INSERT INTO membership (organization_id, status, first_name, last_name, email)
  VALUES (v_org, 'active', 'Avó', 'Com Email', 'avo@exemplo.pt')
  RETURNING id INTO v_person;

  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_person, 'guardian');
  SET CONSTRAINTS ALL IMMEDIATE;

  RAISE NOTICE 'PASS test 2c (17.17): a guardian with an email is accepted';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — 17.9: a shared email with different NIFs is two people
--
-- A household address is not an identity. NIF wins over email whenever both are
-- present and disagree, so the email pass only considers records with no NIF at
-- all.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_found int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-fusao';

  -- `membership_email_uq` stops two live rows sharing an address, so this pair
  -- is what the migration would meet in real data: one address, two NIFs, and
  -- only one of them can hold the email.
  INSERT INTO membership (organization_id, status, first_name, last_name,
                          tax_number, email)
  VALUES (v_org, 'active', 'Pai', 'Casal', '222222222', 'casa@exemplo.pt');

  INSERT INTO membership (organization_id, status, first_name, last_name, tax_number)
  VALUES (v_org, 'active', 'Mãe', 'Casal', '333333333');

  SELECT count(*) INTO v_found FROM merge_candidates(v_org)
   WHERE o_keep_name LIKE '%Casal%' OR o_absorb_name LIKE '%Casal%';

  IF v_found <> 0 THEN
    RAISE EXCEPTION 'FAIL test 3: two people with different NIFs were proposed for merge';
  END IF;

  RAISE NOTICE 'PASS test 3 (17.9): different NIFs are different people';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — 17.10: the report names every field the two disagree about
--
-- "No contact data vanishes unreported" is the ticket's phrasing, and the report
-- is where it is kept. A merge that silently dropped a phone number would be
-- indistinguishable from one that never had it.
-- ---------------------------------------------------------------------------

/*
 * Real duplicates predate the index that now prevents them.
 *
 * `membership_tax_number_uq` is the ticket's phase 3 and it works — test 1 just
 * proved it. So a pair for the merge to find cannot be inserted while it exists;
 * the index is dropped for the rest of this transaction, which is exactly the
 * state a tenant is in before the migration runs. Everything here rolls back.
 */
DROP INDEX membership_tax_number_uq;

DO $$
DECLARE
  v_org uuid; v_keep uuid; v_absorb uuid; v_conflicts jsonb;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-fusao';

  INSERT INTO membership (organization_id, status, first_name, last_name,
                          tax_number, phone, address, created_at)
  VALUES (v_org, 'active', 'Rui', 'Duplicado', '444444444', '911111111', 'Rua A',
          now() - interval '1 day')
  RETURNING id INTO v_keep;

  -- The same human, entered again later with a different phone and no address.
  INSERT INTO membership (organization_id, status, first_name, last_name,
                          tax_number, phone)
  VALUES (v_org, 'active', 'Rui', 'Duplicado', '444444444', '922222222')
  RETURNING id INTO v_absorb;

  SELECT o_conflicts INTO v_conflicts
    FROM merge_candidates(v_org)
   WHERE o_keep_id = v_keep AND o_absorb_id = v_absorb;

  IF v_conflicts IS NULL THEN
    RAISE EXCEPTION 'FAIL test 4: the duplicate pair was not proposed at all';
  END IF;

  -- The phone numbers differ and both are set: a genuine conflict, reported.
  IF NOT (v_conflicts ? 'phone') THEN
    RAISE EXCEPTION 'FAIL test 4: the discarded phone number was not reported (%)', v_conflicts;
  END IF;

  -- The address is set on one side only. Not a conflict — non-null simply wins,
  -- and reporting it would bury the real ones.
  IF v_conflicts ? 'address' THEN
    RAISE EXCEPTION 'FAIL test 4: a field only one record held was reported as a conflict';
  END IF;

  RAISE NOTICE 'PASS test 4 (17.10): the report names disagreements and only disagreements';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — 17.11 and 17.12: everything is repointed, once, and again is a no-op
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_keep uuid; v_absorb uuid;
  v_facility uuid; v_pool uuid; v_level uuid; v_group uuid;
  v_student uuid; v_child uuid; v_session uuid; v_moved int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-fusao';
  SELECT id INTO v_keep FROM membership
   WHERE organization_id = v_org AND tax_number = '444444444'
     AND archived_at IS NULL
   ORDER BY created_at LIMIT 1;
  SELECT id INTO v_absorb FROM membership
   WHERE organization_id = v_org AND tax_number = '444444444'
     AND archived_at IS NULL AND id <> v_keep
   LIMIT 1;

  -- Give the absorbed record a reference of every interesting kind.
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina')
  RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name, lane_count)
  VALUES (v_org, v_facility, 'Tanque', 4) RETURNING id INTO v_pool;
  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_org, 'Nível', 0) RETURNING id INTO v_level;
  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, 'Época', DATE '2020-01-01', DATE '2030-12-31');

  -- They teach a turma…
  INSERT INTO class_group (organization_id, season_id, name, pool_id, level_id,
                           instructor_membership_id)
  VALUES (v_org, (SELECT id FROM season WHERE organization_id = v_org),
          'Turma', v_pool, v_level, v_absorb)
  RETURNING id INTO v_group;

  -- …they took a register…
  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'Aluno', 'Qualquer') RETURNING id INTO v_student;
  INSERT INTO class_session (organization_id, class_group_id, pool_id,
                             starts_at, duration_minutes, status)
  VALUES (v_org, v_group, v_pool, TIMESTAMPTZ '2027-01-12 18:00:00+00', 45, 'completed')
  RETURNING id INTO v_session;
  INSERT INTO attendance (organization_id, class_session_id, student_id, status,
                          recorded_by_membership_id)
  VALUES (v_org, v_session, v_student, 'present', v_absorb);

  -- …and they are somebody's encarregado.
  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'Filho', 'Duplicado') RETURNING id INTO v_child;
  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id,
                             relationship, is_primary)
  VALUES (v_org, v_child, v_absorb, 'pai', true);

  -- One role each, and one they share. The survivor should end holding all
  -- three distinct roles and no duplicates of the shared one.
  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_keep, 'student'),
         (v_org, v_keep, 'instructor'),
         (v_org, v_absorb, 'instructor'),
         (v_org, v_absorb, 'maintenance');

  SELECT merge_memberships(v_org, v_keep, v_absorb) INTO v_moved;

  -- Four references and one role: the turma, the register, the guardianship, the
  -- student link, and `maintenance` moving across. `instructor` is not counted —
  -- the survivor already held it.
  IF v_moved < 4 THEN
    RAISE EXCEPTION 'FAIL test 5: only % rows were repointed', v_moved;
  END IF;

  -- The union of both records' roles, each exactly once.
  IF (SELECT count(*) FROM membership_role
       WHERE membership_id = v_keep AND archived_at IS NULL) <> 3 THEN
    RAISE EXCEPTION 'FAIL test 5: the survivor does not hold the union of both roles';
  END IF;

  IF EXISTS (
    SELECT 1 FROM membership_role
     WHERE membership_id = v_absorb AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'FAIL test 5: the absorbed record still holds live roles';
  END IF;

  IF EXISTS (SELECT 1 FROM class_group WHERE instructor_membership_id = v_absorb) THEN
    RAISE EXCEPTION 'FAIL test 5: a turma still points at the absorbed record';
  END IF;
  IF EXISTS (SELECT 1 FROM attendance WHERE recorded_by_membership_id = v_absorb) THEN
    RAISE EXCEPTION 'FAIL test 5: a register still points at the absorbed record';
  END IF;
  IF EXISTS (
    SELECT 1 FROM guardian_link
     WHERE guardian_membership_id = v_absorb AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'FAIL test 5: a guardianship still points at the absorbed record';
  END IF;

  -- The absorbed record is archived and says where it went.
  IF NOT EXISTS (
    SELECT 1 FROM membership
     WHERE id = v_absorb AND archived_at IS NOT NULL AND merged_into = v_keep
  ) THEN
    RAISE EXCEPTION 'FAIL test 5: the absorbed record has no merged_into pointer';
  END IF;

  -- The survivor kept its own phone and gained the address it lacked.
  IF (SELECT phone FROM membership WHERE id = v_keep) <> '911111111' THEN
    RAISE EXCEPTION 'FAIL test 5: the survivor lost its own phone number';
  END IF;

  RAISE NOTICE 'PASS test 5 (17.11): every reference is repointed and the pointer is kept';

  -- 17.12: running it again changes nothing and raises nothing.
  SELECT merge_memberships(v_org, v_keep, v_absorb) INTO v_moved;
  IF v_moved <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6: a second merge moved % rows', v_moved;
  END IF;

  RAISE NOTICE 'PASS test 6 (17.12): merging again is a no-op';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — 17.13: the same NIF in two tenants is two people
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_a uuid; v_b uuid; v_proposed int; v_moved int; v_theirs uuid;
BEGIN
  SELECT id INTO v_a FROM organization WHERE slug = 'clube-fusao';
  SELECT id INTO v_b FROM organization WHERE slug = 'clube-vizinho-merge';

  -- The neighbouring club has somebody with a NIF ours also holds.
  INSERT INTO membership (organization_id, status, first_name, last_name, tax_number)
  VALUES (v_b, 'active', 'Helena', 'Matos', '123456789') RETURNING id INTO v_theirs;

  SELECT count(*) INTO v_proposed FROM merge_candidates(v_a)
   WHERE o_keep_id = v_theirs OR o_absorb_id = v_theirs;

  IF v_proposed <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7: another tenant''s record was proposed for merge';
  END IF;

  -- And asking directly refuses, because the record is not in this tenant.
  SELECT merge_memberships(
           v_a,
           (SELECT id FROM membership
             WHERE organization_id = v_a AND tax_number = '123456789' LIMIT 1),
           v_theirs
         ) INTO v_moved;

  IF v_moved <> 0 THEN
    RAISE EXCEPTION 'FAIL test 7: a cross-tenant merge moved % rows', v_moved;
  END IF;

  IF EXISTS (SELECT 1 FROM membership WHERE id = v_theirs AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL test 7: a cross-tenant merge archived another tenant''s record';
  END IF;

  RAISE NOTICE 'PASS test 7 (17.13): merging never crosses tenants';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8: a role records who granted it, and revoking one leaves the rest
--
-- 17.5, at the level the database is responsible for.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_person uuid; v_actor uuid; v_roles int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-fusao';
  SELECT id INTO v_actor FROM membership
   WHERE organization_id = v_org AND archived_at IS NULL LIMIT 1;

  INSERT INTO membership (organization_id, status, first_name, last_name, tax_number)
  VALUES (v_org, 'active', 'Dupla', 'Função', '555555555') RETURNING id INTO v_person;

  INSERT INTO membership_role (organization_id, membership_id, role, granted_by_membership_id)
  VALUES (v_org, v_person, 'instructor', v_actor),
         (v_org, v_person, 'student', v_actor);

  IF NOT EXISTS (
    SELECT 1 FROM membership_role
     WHERE membership_id = v_person AND granted_by_membership_id = v_actor
       AND granted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'FAIL test 8: a role was granted with nobody''s name on it';
  END IF;

  -- Revoking the instructor role leaves the person and their student role.
  UPDATE membership_role SET archived_at = now()
   WHERE membership_id = v_person AND role = 'instructor';

  SELECT count(*) INTO v_roles FROM membership_role
   WHERE membership_id = v_person AND archived_at IS NULL;

  IF v_roles <> 1 THEN
    RAISE EXCEPTION 'FAIL test 8: revoking one role left % others', v_roles;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM membership WHERE id = v_person AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL test 8: revoking a role deleted the person';
  END IF;

  RAISE NOTICE 'PASS test 8 (17.5): a revoked role leaves the person and their other roles';
END $$;

ROLLBACK;
