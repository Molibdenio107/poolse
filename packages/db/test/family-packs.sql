-- A family pack and who swam — POOLSE-204.
--
-- Test 1 (QA 1): a shared pack of 10; parent and child check in, each named;
--         two entries used, 8 left; both may be in the water at once, the
--         same person twice may not; a shared pass must name its swimmer.
-- Test 2 (QA 2): a personal pack refuses the child; with no name it is the holder's.
-- Test 3 (QA 5): an archived guardian link takes the child off the family pack.
-- Test 4: a child may hold a pass; a pass has one holder; a shareable product
--         sells at its base whatever the buyer's categories.
-- Test 5: another club reads nothing and pass_family answers nothing of it.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('bbbbbbbb-2040-4000-8000-000000000001', 'Clube Família A', 'clube-familia-a'),
  ('bbbbbbbb-2040-4000-8000-000000000002', 'Clube Família B', 'clube-familia-b');

INSERT INTO facility (id, organization_id, name) VALUES
  ('ffffffff-2040-4000-8000-000000000001', 'bbbbbbbb-2040-4000-8000-000000000001', 'Piscina A');

INSERT INTO pool (id, organization_id, facility_id, name) VALUES
  ('eeeeeeee-2040-4000-8000-0000000000aa', 'bbbbbbbb-2040-4000-8000-000000000001',
   'ffffffff-2040-4000-8000-000000000001', 'Tanque');

INSERT INTO membership (id, organization_id, status, first_name, last_name, email) VALUES
  ('dddddddd-2040-4000-8000-000000000001', 'bbbbbbbb-2040-4000-8000-000000000001', 'active', 'Marta', 'Mãe', 'marta-2040@example.test'),
  ('dddddddd-2040-4000-8000-000000000002', 'bbbbbbbb-2040-4000-8000-000000000001', 'active', 'Rui', 'Outro', 'rui-2040@example.test');

INSERT INTO student (id, organization_id, first_name, last_name) VALUES
  ('eeeeeeee-2040-4000-8000-000000000001', 'bbbbbbbb-2040-4000-8000-000000000001', 'Tomás', 'Filho'),
  ('eeeeeeee-2040-4000-8000-000000000002', 'bbbbbbbb-2040-4000-8000-000000000001', 'Inês', 'Filha');

INSERT INTO guardian_link (id, organization_id, student_id, guardian_membership_id, relationship, is_primary) VALUES
  ('99999999-2040-4000-8000-000000000001', 'bbbbbbbb-2040-4000-8000-000000000001',
   'eeeeeeee-2040-4000-8000-000000000001', 'dddddddd-2040-4000-8000-000000000001', 'Mãe', true),
  ('99999999-2040-4000-8000-000000000002', 'bbbbbbbb-2040-4000-8000-000000000001',
   'eeeeeeee-2040-4000-8000-000000000002', 'dddddddd-2040-4000-8000-000000000001', 'Mãe', true);

INSERT INTO pass_product (id, organization_id, facility_id, kind, name, entries, amount_cents, shareable) VALUES
  ('aaaaaaaa-2040-4000-8000-000000000001', 'bbbbbbbb-2040-4000-8000-000000000001',
   'ffffffff-2040-4000-8000-000000000001', 'pack', 'Pack família', 10, 6000, true),
  ('aaaaaaaa-2040-4000-8000-000000000002', 'bbbbbbbb-2040-4000-8000-000000000001',
   'ffffffff-2040-4000-8000-000000000001', 'pack', 'Pack 10', 10, 4000, false);

-- The sale's own line is a deferred check at commit; this file rolls back.
INSERT INTO pass (id, organization_id, facility_id, product_id, membership_id, kind, entries, valid_from, shared) VALUES
  ('cccccccc-2040-4000-8000-000000000001', 'bbbbbbbb-2040-4000-8000-000000000001',
   'ffffffff-2040-4000-8000-000000000001', 'aaaaaaaa-2040-4000-8000-000000000001',
   'dddddddd-2040-4000-8000-000000000001', 'pack', 10, club_today(), true),
  ('cccccccc-2040-4000-8000-000000000002', 'bbbbbbbb-2040-4000-8000-000000000001',
   'ffffffff-2040-4000-8000-000000000001', 'aaaaaaaa-2040-4000-8000-000000000002',
   'dddddddd-2040-4000-8000-000000000001', 'pack', 10, club_today(), false);

SELECT set_config('app.organization_id', 'bbbbbbbb-2040-4000-8000-000000000001', true);
SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-2040-4000-8000-000000000001';
  v_pool uuid := 'eeeeeeee-2040-4000-8000-0000000000aa';
  v_marta uuid := 'dddddddd-2040-4000-8000-000000000001';
  v_tomas uuid := 'eeeeeeee-2040-4000-8000-000000000001';
  v_family uuid := 'cccccccc-2040-4000-8000-000000000001';
  v_personal uuid := 'cccccccc-2040-4000-8000-000000000002';
  v_left integer;
  v_holder uuid;
  ok boolean;
BEGIN
  ASSERT (SELECT count(*) FROM pass_family(v_org, v_family)) = 3, 'the payer and two children';
  ASSERT (SELECT count(*) FROM pass_family(v_org, v_personal)) = 1, 'a personal pass is its holder alone';

  -- Test 1.
  ok := false;
  BEGIN
    INSERT INTO pass_check_in (organization_id, pass_id, pool_id) VALUES (v_org, v_family, v_pool);
  EXCEPTION WHEN check_violation THEN ok := SQLERRM LIKE '%who is swimming%';
  END;
  ASSERT ok, 'a family pack names its swimmer';

  INSERT INTO pass_check_in (organization_id, pass_id, pool_id, membership_id) VALUES (v_org, v_family, v_pool, v_marta);
  INSERT INTO pass_check_in (organization_id, pass_id, pool_id, student_id) VALUES (v_org, v_family, v_pool, v_tomas);
  SELECT entries_left INTO v_left FROM pass_current WHERE id = v_family;
  ASSERT v_left = 8, format('QA 1: 8 left, got %s', v_left);
  ASSERT (SELECT count(*) FROM pass_check_in WHERE pass_id = v_family
           AND (membership_id IS NOT NULL OR student_id IS NOT NULL)) = 2, 'each entry names its person';

  ok := false;
  BEGIN
    INSERT INTO pass_check_in (organization_id, pass_id, pool_id, student_id) VALUES (v_org, v_family, v_pool, v_tomas);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  ASSERT ok, 'the same person is not in the water twice';

  -- Test 2.
  ok := false;
  BEGIN
    INSERT INTO pass_check_in (organization_id, pass_id, pool_id, student_id) VALUES (v_org, v_personal, v_pool, v_tomas);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  ASSERT ok, 'QA 2: a personal pack refuses the child';
  ok := false;
  BEGIN
    INSERT INTO pass_check_in (organization_id, pass_id, pool_id, membership_id)
    VALUES (v_org, v_personal, v_pool, 'dddddddd-2040-4000-8000-000000000002');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  ASSERT ok, 'nor anybody else';
  INSERT INTO pass_check_in (organization_id, pass_id, pool_id) VALUES (v_org, v_personal, v_pool)
  RETURNING membership_id INTO v_holder;
  ASSERT v_holder = v_marta, 'no name on a personal pass is its holder';

  -- Test 4: a shareable product is priced at its base.
  ASSERT (SELECT amount_cents FROM pass_price_for(v_org, 'aaaaaaaa-2040-4000-8000-000000000001', v_marta)) = 6000,
         'a family pack sells at its base';

  ok := false;
  BEGIN
    INSERT INTO pass (organization_id, facility_id, product_id, membership_id, student_id, kind, entries, valid_from)
    VALUES (v_org, 'ffffffff-2040-4000-8000-000000000001', 'aaaaaaaa-2040-4000-8000-000000000002',
            v_marta, v_tomas, 'pack', 10, club_today());
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  ASSERT ok, 'one holder';

  INSERT INTO pass (organization_id, facility_id, product_id, student_id, kind, entries, valid_from)
  VALUES (v_org, 'ffffffff-2040-4000-8000-000000000001', 'aaaaaaaa-2040-4000-8000-000000000002',
          v_tomas, 'pack', 10, club_today());
END $$;

-- Test 3: the link archived (an office write, here as the owner).
RESET ROLE;
UPDATE guardian_link SET archived_at = now() WHERE id = '99999999-2040-4000-8000-000000000002';
SET LOCAL ROLE poolse_app;

DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO pass_check_in (organization_id, pass_id, pool_id, student_id)
    VALUES ('bbbbbbbb-2040-4000-8000-000000000001', 'cccccccc-2040-4000-8000-000000000001',
            'eeeeeeee-2040-4000-8000-0000000000aa', 'eeeeeeee-2040-4000-8000-000000000002');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  ASSERT ok, 'QA 5: an archived link takes the child off the family pack';
END $$;

-- Test 5.
SELECT set_config('app.organization_id', 'bbbbbbbb-2040-4000-8000-000000000002', true);

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM pass) = 0, 'another club reads no pass';
  ASSERT (SELECT count(*) FROM pass_check_in) = 0, 'nor a check-in';
  ASSERT NOT EXISTS (SELECT 1 FROM pass_family('bbbbbbbb-2040-4000-8000-000000000001',
                                               'cccccccc-2040-4000-8000-000000000001')),
         'pass_family answers nothing of another club';
END $$;

RESET ROLE;
ROLLBACK;
