-- A category on the person — POOLSE-202.
--
-- Test 1: the top-ranked category comes first, and rank is not sort_order.
-- Test 2: expired is not live; 20 days left is "expiring" and still live.
-- Test 3: a membership and the student whose login it is are one person.
-- Test 4: exactly one person, short notes with no document number, one live row
--         per category, and a removed one can come back.
-- Test 5: anonymising the student clears notes and proof_seen_by.
-- Test 6: another club reads and writes nothing, and the key refuses a row
--         across clubs.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('bbbbbbbb-2020-4000-8000-000000000001', 'Clube Categoria A', 'clube-categoria-a'),
  ('bbbbbbbb-2020-4000-8000-000000000002', 'Clube Categoria B', 'clube-categoria-b');

INSERT INTO membership (id, organization_id, status, first_name, last_name, email) VALUES
  ('dddddddd-2020-4000-8000-000000000001', 'bbbbbbbb-2020-4000-8000-000000000001', 'active', 'Ana', 'Costa', 'ana-2020@example.test'),
  ('dddddddd-2020-4000-8000-000000000002', 'bbbbbbbb-2020-4000-8000-000000000001', 'active', 'Rui', 'Office', 'rui-2020@example.test'),
  ('dddddddd-2020-4000-8000-000000000003', 'bbbbbbbb-2020-4000-8000-000000000002', 'active', 'Rita', 'Costa', 'rita-2020@example.test');

INSERT INTO student (id, organization_id, first_name, last_name, membership_id) VALUES
  ('eeeeeeee-2020-4000-8000-000000000001', 'bbbbbbbb-2020-4000-8000-000000000001', 'Ana', 'Costa', 'dddddddd-2020-4000-8000-000000000001'),
  ('eeeeeeee-2020-4000-8000-000000000002', 'bbbbbbbb-2020-4000-8000-000000000001', 'Tomás', 'Costa', NULL);

-- Sénior is displayed second but ranks first.
INSERT INTO fee_category (id, organization_id, name, sort_order, rank) VALUES
  ('cccccccc-2020-4000-8000-000000000001', 'bbbbbbbb-2020-4000-8000-000000000001', 'Sócio', 0, 1),
  ('cccccccc-2020-4000-8000-000000000002', 'bbbbbbbb-2020-4000-8000-000000000001', 'Sénior', 1, 0),
  ('cccccccc-2020-4000-8000-000000000003', 'bbbbbbbb-2020-4000-8000-000000000001', 'Estudante', 2, 2),
  ('cccccccc-2020-4000-8000-000000000009', 'bbbbbbbb-2020-4000-8000-000000000002', 'Sénior', 0, 0);

SELECT set_config('app.organization_id', 'bbbbbbbb-2020-4000-8000-000000000001', true);
SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-2020-4000-8000-000000000001';
  v_ana uuid := 'dddddddd-2020-4000-8000-000000000001';
  v_office uuid := 'dddddddd-2020-4000-8000-000000000002';
  v_ana_student uuid := 'eeeeeeee-2020-4000-8000-000000000001';
  v_tomas uuid := 'eeeeeeee-2020-4000-8000-000000000002';
  v_socio uuid := 'cccccccc-2020-4000-8000-000000000001';
  v_senior uuid := 'cccccccc-2020-4000-8000-000000000002';
  v_estudante uuid := 'cccccccc-2020-4000-8000-000000000003';
  v_row uuid;
  v_names text[];
  ok boolean;
BEGIN
  -- Test 1: Sócio on the membership, Sénior on the student record of the same person.
  INSERT INTO person_category (organization_id, membership_id, fee_category_id, proof_seen_on, proof_seen_by)
  VALUES (v_org, v_ana, v_socio, club_today(), v_office);
  INSERT INTO person_category (organization_id, student_id, fee_category_id, proof_seen_on, proof_seen_by, valid_until, notes)
  VALUES (v_org, v_ana_student, v_senior, club_today() - 10, v_office, club_today() + 20, 'Cartão de cidadão')
  RETURNING id INTO v_row;

  SELECT array_agg(name) INTO v_names FROM person_categories(v_org, v_ana, NULL);
  ASSERT v_names = ARRAY['Sénior', 'Sócio'], format('rank, not sort_order, orders them (test 1, 3): %s', v_names);
  SELECT array_agg(name) INTO v_names FROM person_categories(v_org, NULL, v_ana_student);
  ASSERT v_names = ARRAY['Sénior', 'Sócio'], 'from the student side too (test 3)';

  -- Test 2: 20 days left is expiring and still valid; yesterday is not.
  ASSERT person_category_status(club_today() + 20) = 'expiring', 'twenty days is expiring';
  ASSERT person_category_status(club_today() + 31) = 'live', 'thirty-one days is live';
  ASSERT person_category_status(club_today()) = 'expiring', 'today is still valid';
  ASSERT person_category_status(club_today() - 1) = 'expired', 'yesterday is expired';
  ASSERT person_category_status(NULL) = 'live', 'no expiry is live';

  INSERT INTO person_category (organization_id, student_id, fee_category_id, proof_seen_on, proof_seen_by, valid_until)
  VALUES (v_org, v_tomas, v_estudante, club_today() - 400, v_office, club_today() - 1);
  ASSERT NOT EXISTS (SELECT 1 FROM person_categories(v_org, NULL, v_tomas)), 'an expired category is not live (test 2)';

  -- Test 4.
  ok := false;
  BEGIN
    INSERT INTO person_category (organization_id, membership_id, student_id, fee_category_id, proof_seen_on)
    VALUES (v_org, v_ana, v_tomas, v_socio, club_today());
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  ASSERT ok, 'exactly one person';

  ok := false;
  BEGIN
    INSERT INTO person_category (organization_id, student_id, fee_category_id, proof_seen_on, notes)
    VALUES (v_org, v_tomas, v_socio, club_today(), 'Cartão 12345678');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  ASSERT ok, 'no document number in the notes';

  ok := false;
  BEGIN
    INSERT INTO person_category (organization_id, membership_id, fee_category_id, proof_seen_on)
    VALUES (v_org, v_ana, v_socio, club_today());
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  ASSERT ok, 'one live row per person per category';

  UPDATE person_category SET archived_at = now() WHERE membership_id = v_ana AND fee_category_id = v_socio;
  INSERT INTO person_category (organization_id, membership_id, fee_category_id, proof_seen_on)
  VALUES (v_org, v_ana, v_socio, club_today());
END $$;

-- Test 5: anonymisation (as retention does it, outside the app role).
RESET ROLE;
UPDATE student SET anonymised_at = now() WHERE id = 'eeeeeeee-2020-4000-8000-000000000001';
DO $$
BEGIN
  ASSERT (SELECT notes IS NULL AND proof_seen_by IS NULL FROM person_category
           WHERE student_id = 'eeeeeeee-2020-4000-8000-000000000001'),
         'anonymising the student clears what was proven';
END $$;

-- Test 6.
SELECT set_config('app.organization_id', 'bbbbbbbb-2020-4000-8000-000000000002', true);
SET LOCAL ROLE poolse_app;

DO $$
DECLARE ok boolean;
BEGIN
  ASSERT (SELECT count(*) FROM person_category) = 0, 'another club reads nothing';
  ASSERT NOT EXISTS (SELECT 1 FROM person_categories('bbbbbbbb-2020-4000-8000-000000000001',
                                                     'dddddddd-2020-4000-8000-000000000001', NULL)),
         'the function reads nothing of another club';

  ok := false;
  BEGIN
    INSERT INTO person_category (organization_id, membership_id, fee_category_id, proof_seen_on)
    VALUES ('bbbbbbbb-2020-4000-8000-000000000001', 'dddddddd-2020-4000-8000-000000000001',
            'cccccccc-2020-4000-8000-000000000001', club_today());
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'another club writes nothing';

  -- Own club, but a person of the other club: the composite key refuses it.
  ok := false;
  BEGIN
    INSERT INTO person_category (organization_id, membership_id, fee_category_id, proof_seen_on)
    VALUES ('bbbbbbbb-2020-4000-8000-000000000002', 'dddddddd-2020-4000-8000-000000000001',
            'cccccccc-2020-4000-8000-000000000009', club_today());
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  ASSERT ok, 'a person of another club is refused by the key';

  ok := false;
  BEGIN
    DELETE FROM person_category;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'nothing is deleted: removal is archive';
END $$;

RESET ROLE;
ROLLBACK;
