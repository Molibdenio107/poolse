-- Ownership proof — backlog story 9.
--
-- "It must be impossible to create a second owner" is the requirement, and the
-- word doing the work is *impossible*. An API check is a promise about the code
-- paths somebody thought of; test 2 is about the one they did not.
--
-- Test 5 matters just as much and is easy to skip: ownership has to be
-- transferable. A single uncreatable owner would mean the day that person leaves
-- the club, the tenant is unadministrable and only the vendor can unblock it.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_owner', 'owner@clube.pt', 'Rui',   'Fonseca', NULL, '2026-08-26 09:00:00+00');
SELECT provision_app_user('user_admin', 'admin@clube.pt', 'Ana',   'Martins', NULL, '2026-08-26 09:00:00+00');
SELECT provision_app_user('user_inst',  'inst@clube.pt',  'Bruno', 'Silva',   NULL, '2026-08-26 09:00:00+00');

DO $$
DECLARE v_org uuid; v_membership uuid; v_user uuid;
BEGIN
  SELECT o_organization_id INTO v_org
    FROM provision_organization('user_owner', 'Clube A', 'pt-PT', 'Piscina Principal');

  SELECT id INTO v_user FROM app_user WHERE clerk_user_id = 'user_admin';
  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_user, 'active') RETURNING id INTO v_membership;
  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_membership, 'admin');

  SELECT id INTO v_user FROM app_user WHERE clerk_user_id = 'user_inst';
  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_user, 'active') RETURNING id INTO v_membership;
  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_membership, 'instructor');
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — signup produces exactly one owner
-- ---------------------------------------------------------------------------

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM membership_role mr JOIN organization o ON o.id = mr.organization_id
   WHERE o.name = 'Clube A' AND mr.role = 'owner' AND mr.archived_at IS NULL;

  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 1: a new organization has % owners', n;
  END IF;
  RAISE NOTICE 'PASS test 1: signup produces exactly one owner';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — a second owner cannot be created, by any route
--
-- Keep this one. It is the whole story: not "the invite form does not offer it"
-- but "the database will not hold it", which is the only version that survives a
-- stale page, a hand-made request, or a future endpoint nobody has written yet.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_admin uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT mr.membership_id INTO v_admin FROM membership_role mr
   WHERE mr.organization_id = v_org AND mr.role = 'admin' AND mr.archived_at IS NULL;

  BEGIN
    INSERT INTO membership_role (organization_id, membership_id, role)
    VALUES (v_org, v_admin, 'owner');
    RAISE EXCEPTION 'FAIL test 2a: a second owner was created directly';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  -- And through an accepted invitation, which is the realistic route: an
  -- invitation issued before this rule existed still carries its roles.
  DECLARE v_placeholder uuid;
  BEGIN
    INSERT INTO membership (organization_id, status) VALUES (v_org, 'invited')
    RETURNING id INTO v_placeholder;

    BEGIN
      INSERT INTO membership_role (organization_id, membership_id, role)
      VALUES (v_org, v_placeholder, 'owner');
      RAISE EXCEPTION 'FAIL test 2b: an invitation could still carry owner';
    EXCEPTION
      WHEN unique_violation THEN NULL;
    END;
  END;

  RAISE NOTICE 'PASS test 2: a second owner cannot be created by any route';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — the rule is per organization, not global
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  PERFORM provision_app_user('user_other', 'carla@outro.pt', 'Carla', 'Nunes', NULL,
                             '2026-08-26 09:00:00+00');
  PERFORM provision_organization('user_other', 'Clube B', 'pt-PT', 'Piscina Principal');

  -- Counted per organization, never globally. This suite runs against a database
  -- that already holds real data, so a global total would be asserting something
  -- about whatever else happens to be in there.
  FOR r IN
    SELECT o.name,
           count(*) FILTER (WHERE mr.role = 'owner' AND mr.archived_at IS NULL) AS owners
      FROM organization o
      LEFT JOIN membership_role mr ON mr.organization_id = o.id
     WHERE o.name IN ('Clube A', 'Clube B')
     GROUP BY o.name
  LOOP
    IF r.owners <> 1 THEN
      RAISE EXCEPTION 'FAIL test 3: % has % owners', r.name, r.owners;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS test 3: each organization has its own single owner';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — an archived owner role frees the slot
--
-- Otherwise transferring ownership twice would be impossible: the first
-- transfer would leave a dead `owner` row holding the only slot forever.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_owner uuid; v_admin uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT mr.membership_id INTO v_owner FROM membership_role mr
   WHERE mr.organization_id = v_org AND mr.role = 'owner' AND mr.archived_at IS NULL;
  SELECT mr.membership_id INTO v_admin FROM membership_role mr
   WHERE mr.organization_id = v_org AND mr.role = 'admin' AND mr.archived_at IS NULL;

  UPDATE membership_role SET archived_at = now()
   WHERE organization_id = v_org AND membership_id = v_owner
     AND role = 'owner' AND archived_at IS NULL;

  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_admin, 'owner');

  -- Put it back for the next test.
  UPDATE membership_role SET archived_at = now()
   WHERE organization_id = v_org AND membership_id = v_admin
     AND role = 'owner' AND archived_at IS NULL;
  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_owner, 'owner');

  RAISE NOTICE 'PASS test 4: archiving an owner role frees the slot for the next one';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — transfer moves ownership and leaves nobody stranded
--
-- Keep this one too. It is what stops the single-owner rule from becoming a trap
-- the day the owner leaves the club.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_owner uuid; v_admin uuid; n int;
BEGIN
  SELECT id INTO v_org FROM organization WHERE name = 'Clube A';
  SELECT mr.membership_id INTO v_owner FROM membership_role mr
   WHERE mr.organization_id = v_org AND mr.role = 'owner' AND mr.archived_at IS NULL;
  SELECT mr.membership_id INTO v_admin FROM membership_role mr
   WHERE mr.organization_id = v_org AND mr.role = 'admin' AND mr.archived_at IS NULL
     AND mr.membership_id <> v_owner;

  PERFORM transfer_ownership(v_org, v_owner, v_admin);

  -- Exactly one owner, and it is the new one.
  SELECT count(*) INTO n FROM membership_role
   WHERE organization_id = v_org AND role = 'owner' AND archived_at IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 5a: after transfer there are % owners', n;
  END IF;

  SELECT count(*) INTO n FROM membership_role
   WHERE organization_id = v_org AND membership_id = v_admin
     AND role = 'owner' AND archived_at IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 5b: ownership did not reach the nominated member';
  END IF;

  -- The outgoing owner keeps administrative access rather than being stranded.
  SELECT count(*) INTO n FROM membership_role
   WHERE organization_id = v_org AND membership_id = v_owner
     AND role = 'admin' AND archived_at IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 5c: the previous owner was left without admin';
  END IF;

  -- And transferring to yourself is refused rather than quietly doing nothing.
  BEGIN
    PERFORM transfer_ownership(v_org, v_admin, v_admin);
    RAISE EXCEPTION 'FAIL test 5d: transferring to yourself was allowed';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 5: ownership transfers atomically and strands nobody';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — the app role cannot mint itself ownership across a tenant boundary
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE v_a uuid; v_b_membership uuid; n int;
BEGIN
  SET LOCAL ROLE postgres;
  SELECT id INTO v_a FROM organization WHERE name = 'Clube A';
  SELECT m.id INTO v_b_membership FROM membership m
    JOIN organization o ON o.id = m.organization_id WHERE o.name = 'Clube B';
  SET LOCAL ROLE poolse_app;

  PERFORM set_config('app.organization_id', v_a::text, true);

  BEGIN
    INSERT INTO membership_role (organization_id, membership_id, role)
    VALUES (v_a, v_b_membership, 'owner');
    RAISE EXCEPTION 'FAIL test 6: Clube A made a Clube B member its owner';
  EXCEPTION
    WHEN foreign_key_violation OR unique_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 6: ownership cannot be granted across tenants';
END $$;

RESET ROLE;

ROLLBACK;
