-- The editable staff record — POOLSE-39.
--
-- Test 2 is the whole ticket. Its Dev section names the failure precisely: "a
-- re-invite that silently orphans the old Person and starts a new one, losing
-- the audit trail and any turma assignments." This asserts the opposite — the
-- membership row is the same row afterwards, and everything hanging off it is
-- still hanging off it.
--
-- The mechanism is the *absence* of new machinery. A re-invite is an invitation
-- pointing at the membership that already exists, and `accept_invitation` binds
-- `invitation.membership_id` to whoever accepts. No second membership is ever
-- created, so there is nothing to orphan.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES ('Clube Pessoal', 'clube-pessoal');

-- The instructor as they are today, and the account they will move to.
SELECT provision_app_user('user_old', 'antiga@clube.pt', 'Sofia', 'Brito', NULL,
                          '2026-08-26 09:00:00+00');
SELECT provision_app_user('user_new', 'nova@clube.pt', 'Sofia', 'Brito', NULL,
                          '2026-08-26 09:00:00+00');

-- ---------------------------------------------------------------------------
-- Test 1: notes are the club's, and blank is not a value
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_person uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-pessoal';

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, (SELECT id FROM app_user WHERE clerk_user_id = 'user_old'), 'active')
  RETURNING id INTO v_person;

  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_person, 'instructor');

  UPDATE membership SET notes = 'Treina aos sábados' WHERE id = v_person;

  BEGIN
    UPDATE membership SET notes = '   ' WHERE id = v_person;
    RAISE EXCEPTION 'FAIL test 1: a blank note was stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Clearing it entirely is fine; an empty note and no note are the same thing.
  UPDATE membership SET notes = NULL WHERE id = v_person;
  UPDATE membership SET notes = 'Treina aos sábados' WHERE id = v_person;

  RAISE NOTICE 'PASS test 1: notes are stored, and blank is refused';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — 39.4: a re-invite moves the login and nothing else
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_person uuid; v_old_user uuid; v_new_user uuid;
  v_facility uuid; v_pool uuid; v_level uuid; v_group uuid;
  v_invitation uuid; v_status text; v_bound uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-pessoal';
  SELECT id INTO v_person FROM membership WHERE organization_id = v_org;
  SELECT id INTO v_old_user FROM app_user WHERE clerk_user_id = 'user_old';
  SELECT id INTO v_new_user FROM app_user WHERE clerk_user_id = 'user_new';

  -- Give them something to lose: a turma they teach.
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina')
  RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name, lane_count)
  VALUES (v_org, v_facility, 'Tanque', 4) RETURNING id INTO v_pool;
  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_org, 'Nível', 0) RETURNING id INTO v_level;
  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_org, 'Época', DATE '2020-01-01', DATE '2030-12-31');

  INSERT INTO class_group (organization_id, season_id, name, pool_id, level_id,
                           instructor_membership_id)
  VALUES (v_org, (SELECT id FROM season WHERE organization_id = v_org),
          'Turma da Sofia', v_pool, v_level, v_person)
  RETURNING id INTO v_group;

  /*
   * The re-invite: an invitation pointing at the membership that already exists,
   * rather than at a fresh placeholder. That single difference is the feature.
   */
  INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at,
                          membership_id)
  VALUES (v_org, 'nova@clube.pt', ARRAY['instructor']::member_role[],
          'rehash', now() + interval '7 days', v_person)
  RETURNING id INTO v_invitation;

  -- Until it is accepted, the existing login is untouched — 39.6.
  IF (SELECT app_user_id FROM membership WHERE id = v_person) <> v_old_user THEN
    RAISE EXCEPTION 'FAIL test 2: the login moved before the invite was accepted';
  END IF;

  SELECT o_status, o_membership_id INTO v_status, v_bound
    FROM accept_invitation('rehash', 'user_new', now());

  IF v_status <> 'accepted' THEN
    RAISE EXCEPTION 'FAIL test 2: acceptance returned %', v_status;
  END IF;

  -- The same membership, not a new one. This is the assertion the ticket is about.
  IF v_bound <> v_person THEN
    RAISE EXCEPTION 'FAIL test 2: acceptance bound a different membership';
  END IF;

  IF (SELECT app_user_id FROM membership WHERE id = v_person) <> v_new_user THEN
    RAISE EXCEPTION 'FAIL test 2: the login did not move to the new account';
  END IF;

  -- One live membership in the club, not two.
  IF (SELECT count(*) FROM membership
       WHERE organization_id = v_org AND archived_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'FAIL test 2: a second membership was created';
  END IF;

  -- And everything that hung off them still does.
  IF NOT EXISTS (
    SELECT 1 FROM class_group
     WHERE id = v_group AND instructor_membership_id = v_person
  ) THEN
    RAISE EXCEPTION 'FAIL test 2: the turma lost its instructor';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM membership_role
     WHERE membership_id = v_person AND role = 'instructor' AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'FAIL test 2: the role did not survive the move';
  END IF;

  IF (SELECT notes FROM membership WHERE id = v_person) <> 'Treina aos sábados' THEN
    RAISE EXCEPTION 'FAIL test 2: the record lost its notes';
  END IF;

  RAISE NOTICE 'PASS test 2 (39.4): a re-invite moves the login and keeps the person whole';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — 39.5: a cancelled re-invite cannot then be accepted
-- ---------------------------------------------------------------------------

-- Outside the block: `SELECT fn()` with no INTO is a statement, not something a
-- DO block can hold.
SELECT provision_app_user('user_third', 'terceira@clube.pt', 'Sofia', 'Brito', NULL,
                          '2026-08-26 09:00:00+00');

DO $$
DECLARE
  v_org uuid; v_person uuid; v_status text;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-pessoal';
  SELECT id INTO v_person FROM membership WHERE organization_id = v_org;

  INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at,
                          membership_id)
  VALUES (v_org, 'terceira@clube.pt', ARRAY['instructor']::member_role[],
          'cancelhash', now() + interval '7 days', v_person);

  -- Cancelled, as the record's "cancel" control does.
  UPDATE invitation SET revoked_at = now() WHERE token_hash = 'cancelhash';

  SELECT o_status INTO v_status FROM accept_invitation('cancelhash', 'user_third', now());

  IF v_status <> 'revoked' THEN
    RAISE EXCEPTION 'FAIL test 3: a cancelled re-invite returned %', v_status;
  END IF;

  -- And the login stayed where it was.
  IF (SELECT app_user_id FROM membership WHERE id = v_person)
     <> (SELECT id FROM app_user WHERE clerk_user_id = 'user_new') THEN
    RAISE EXCEPTION 'FAIL test 3: a cancelled re-invite moved the login anyway';
  END IF;

  RAISE NOTICE 'PASS test 3 (39.5): a cancelled re-invite cannot be redeemed';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — 39.9: staff and student are one record
--
-- A Person who is both is edited from either section and it is the same row, so
-- a phone number corrected in Staff is the number Alunos shows.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_person uuid; v_student uuid; v_user uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-pessoal';
  SELECT id INTO v_person FROM membership WHERE organization_id = v_org;
  SELECT app_user_id INTO v_user FROM membership WHERE id = v_person;

  INSERT INTO student (organization_id, first_name, last_name, membership_id)
  VALUES (v_org, 'Sofia', 'Brito', v_person) RETURNING id INTO v_student;

  -- Their own number, because they have an account. Editing it from either
  -- section writes the same column.
  UPDATE app_user SET contact_phone = '939000111' WHERE id = v_user;

  IF (SELECT coalesce(u.contact_phone, m.phone)
        FROM membership m LEFT JOIN app_user u ON u.id = m.app_user_id
       WHERE m.id = v_person) <> '939000111' THEN
    RAISE EXCEPTION 'FAIL test 4: the resolved phone is not the one just saved';
  END IF;

  -- And the student side reaches the same person.
  IF (SELECT membership_id FROM student WHERE id = v_student) <> v_person THEN
    RAISE EXCEPTION 'FAIL test 4: the student points at a different person';
  END IF;

  RAISE NOTICE 'PASS test 4 (39.9): staff and student are sections of one record';
END $$;


-- ---------------------------------------------------------------------------
-- Test 5: a re-invite accepted by the OLD account must not delete the person
--
-- Found in review, and the worst defect of the sweep. POOLSE-39 attaches a
-- re-invite to the person's *existing* membership — that is the whole design,
-- and it is right. `accept_invitation`'s second branch then treated
-- `invitation.membership_id` as a placeholder to retire without asking whether
-- it was the very membership the acceptor already holds.
--
-- So somebody who clicked their own re-invite link while still signed in as
-- their old address had their roles revoked, their membership archived, and a
-- cheerful "accepted" returned. The POOLSE-39 commit claimed this could not
-- happen; the test it shipped with accepted as the *new* account, which is the
-- path that works.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_user uuid; v_m uuid; v_status text; v_bound uuid;
  v_archived timestamptz; v_roles int;
BEGIN
  INSERT INTO organization (name, slug) VALUES ('Clube Reconvite', 'clube-reconvite')
  RETURNING id INTO v_org;

  PERFORM provision_app_user('user_reinvite', 'antiga@clube.pt', 'Sofia', 'Antunes',
                             NULL, now());
  SELECT id INTO v_user FROM app_user WHERE clerk_user_id = 'user_reinvite';

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_user, 'active') RETURNING id INTO v_m;
  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_m, 'instructor');

  -- reinvite(): an invitation to a new address, pointing at the membership they
  -- already have.
  INSERT INTO invitation (organization_id, membership_id, email, token_hash, roles,
                          expires_at, invited_by_membership_id)
  VALUES (v_org, v_m, 'nova@clube.pt', repeat('r', 64),
          ARRAY['instructor']::member_role[], now() + interval '7 days', v_m);

  -- They click it while still signed in as the old account.
  SELECT o_status, o_membership_id INTO v_status, v_bound
    FROM accept_invitation(repeat('r', 64), 'user_reinvite', now());

  SELECT archived_at INTO v_archived FROM membership WHERE id = v_m;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 5: accepting a re-invite archived the staff member';
  END IF;

  SELECT count(*) INTO v_roles FROM membership_role
   WHERE membership_id = v_m AND archived_at IS NULL;
  IF v_roles <> 1 THEN
    RAISE EXCEPTION 'FAIL test 5: % live roles left, expected 1', v_roles;
  END IF;

  -- And it bound to the person, not to a row it had just killed.
  IF v_bound <> v_m THEN
    RAISE EXCEPTION 'FAIL test 5: bound to % rather than the staff membership', v_bound;
  END IF;

  RAISE NOTICE 'PASS test 5: a re-invite accepted by its own account keeps the person whole';
END $$;

ROLLBACK;
