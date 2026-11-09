-- A parent's link stops counting at 18, an acompanhante's does not — POOLSE-206.
--
-- Test 1 (QA 1): a student 18 today with a parental link is on the adult path;
--         one who turns 18 tomorrow is not, and the parent still answers.
-- Test 2 (QA 2): a 30-year-old with an accompanying link is on the guardian
--         path, and the acompanhante answers for them.
-- Test 3 (QA 4): a former parent's shared pack does not carry the adult son;
--         the payer is still the parent (rule 4).
-- Test 4 (QA 6): a person is refused as their own guardian, on insert and on
--         update, in words; a person merge archives such a link instead.
-- Test 5 (QA 8): a 17-year-old, and an adult with only a declared date or none,
--         keep the parental link granting.
-- Test 6 (QA 7): another club's session reads none of these links.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('bbbbbbbb-2060-4000-8000-000000000001', 'Clube Maioridade', 'clube-maioridade'),
  ('bbbbbbbb-2060-4000-8000-000000000002', 'Clube Outro', 'clube-outro-2060');

INSERT INTO facility (id, organization_id, name) VALUES
  ('ffffffff-2060-4000-8000-000000000001', 'bbbbbbbb-2060-4000-8000-000000000001', 'Piscina M');

INSERT INTO membership (id, organization_id, status, first_name, last_name, email) VALUES
  ('dddddddd-2060-4000-8000-000000000001', 'bbbbbbbb-2060-4000-8000-000000000001', 'active', 'Mãe', 'Lopes', 'mae-2060@example.test'),
  ('dddddddd-2060-4000-8000-000000000002', 'bbbbbbbb-2060-4000-8000-000000000001', 'active', 'Acompanhante', 'Silva', 'acomp-2060@example.test'),
  ('dddddddd-2060-4000-8000-000000000003', 'bbbbbbbb-2060-4000-8000-000000000001', 'active', 'Filho', 'Lopes', 'filho-2060@example.test'),
  ('dddddddd-2060-4000-8000-000000000004', 'bbbbbbbb-2060-4000-8000-000000000001', 'active', 'Ana', 'Própria', 'ana-2060@example.test'),
  ('dddddddd-2060-4000-8000-000000000005', 'bbbbbbbb-2060-4000-8000-000000000001', 'active', 'Ana', 'Duplicada', NULL);

-- c1 is 18 today; c2 turns 18 tomorrow; c3 is 30 and supported; c4 is 17;
-- c5 is an adult by a declared date only; c6 has no date; c7 is Ana's own record.
INSERT INTO student (id, organization_id, first_name, last_name, birth_date, membership_id) VALUES
  ('eeeeeeee-2060-4000-8000-0000000000c1', 'bbbbbbbb-2060-4000-8000-000000000001', 'Faz', 'Hoje',
   (club_today() - interval '18 years')::date, 'dddddddd-2060-4000-8000-000000000003'),
  ('eeeeeeee-2060-4000-8000-0000000000c2', 'bbbbbbbb-2060-4000-8000-000000000001', 'Faz', 'Amanhã',
   (club_today() - interval '18 years' + interval '1 day')::date, NULL),
  ('eeeeeeee-2060-4000-8000-0000000000c3', 'bbbbbbbb-2060-4000-8000-000000000001', 'Maior', 'Acompanhado',
   (club_today() - interval '30 years')::date, NULL),
  ('eeeeeeee-2060-4000-8000-0000000000c4', 'bbbbbbbb-2060-4000-8000-000000000001', 'Tem', 'Dezassete',
   (club_today() - interval '17 years')::date, NULL),
  ('eeeeeeee-2060-4000-8000-0000000000c5', 'bbbbbbbb-2060-4000-8000-000000000001', 'Data', 'Declarada',
   (club_today() - interval '25 years')::date, NULL),
  ('eeeeeeee-2060-4000-8000-0000000000c6', 'bbbbbbbb-2060-4000-8000-000000000001', 'Sem', 'Data',
   NULL, NULL),
  ('eeeeeeee-2060-4000-8000-0000000000c7', 'bbbbbbbb-2060-4000-8000-000000000001', 'Ana', 'Própria',
   (club_today() - interval '36 years')::date, 'dddddddd-2060-4000-8000-000000000004');

UPDATE student SET birth_date_declared_at = now() WHERE id = 'eeeeeeee-2060-4000-8000-0000000000c5';

INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary, kind) VALUES
  ('bbbbbbbb-2060-4000-8000-000000000001', 'eeeeeeee-2060-4000-8000-0000000000c1', 'dddddddd-2060-4000-8000-000000000001', 'Mãe', true, 'parental'),
  ('bbbbbbbb-2060-4000-8000-000000000001', 'eeeeeeee-2060-4000-8000-0000000000c2', 'dddddddd-2060-4000-8000-000000000001', 'Mãe', true, 'parental'),
  ('bbbbbbbb-2060-4000-8000-000000000001', 'eeeeeeee-2060-4000-8000-0000000000c3', 'dddddddd-2060-4000-8000-000000000002', NULL, true, 'accompanying'),
  ('bbbbbbbb-2060-4000-8000-000000000001', 'eeeeeeee-2060-4000-8000-0000000000c4', 'dddddddd-2060-4000-8000-000000000001', 'Mãe', true, 'parental'),
  ('bbbbbbbb-2060-4000-8000-000000000001', 'eeeeeeee-2060-4000-8000-0000000000c5', 'dddddddd-2060-4000-8000-000000000001', 'Mãe', true, 'parental'),
  ('bbbbbbbb-2060-4000-8000-000000000001', 'eeeeeeee-2060-4000-8000-0000000000c6', 'dddddddd-2060-4000-8000-000000000001', 'Mãe', true, 'parental');

INSERT INTO pass_product (id, organization_id, facility_id, kind, name, entries, amount_cents, shareable) VALUES
  ('aaaaaaaa-2060-4000-8000-000000000001', 'bbbbbbbb-2060-4000-8000-000000000001',
   'ffffffff-2060-4000-8000-000000000001', 'pack', 'Pack família', 10, 6000, true);

-- The sale's own line is a deferred check at commit; this file rolls back.
INSERT INTO pass (id, organization_id, facility_id, product_id, membership_id, kind, entries, valid_from, shared) VALUES
  ('cccccccc-2060-4000-8000-000000000001', 'bbbbbbbb-2060-4000-8000-000000000001',
   'ffffffff-2060-4000-8000-000000000001', 'aaaaaaaa-2060-4000-8000-000000000001',
   'dddddddd-2060-4000-8000-000000000001', 'pack', 10, club_today(), true);

SELECT set_config('app.organization_id', 'bbbbbbbb-2060-4000-8000-000000000001', true);
SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_org    uuid := 'bbbbbbbb-2060-4000-8000-000000000001';
  v_mae    uuid := 'dddddddd-2060-4000-8000-000000000001';
  v_acomp  uuid := 'dddddddd-2060-4000-8000-000000000002';
  v_today  uuid := 'eeeeeeee-2060-4000-8000-0000000000c1';
  v_tomorrow uuid := 'eeeeeeee-2060-4000-8000-0000000000c2';
  v_supported uuid := 'eeeeeeee-2060-4000-8000-0000000000c3';
  v_ana    uuid := 'eeeeeeee-2060-4000-8000-0000000000c7';
  v_failed boolean;
BEGIN
  -- Test 1.
  IF NOT student_is_adult_path(v_org, v_today) THEN
    RAISE EXCEPTION 'test 1: 18 today with a parental link is not on the adult path';
  END IF;
  IF student_is_adult_path(v_org, v_tomorrow) THEN
    RAISE EXCEPTION 'test 1: 18 tomorrow is already on the adult path';
  END IF;
  IF family_may_answer(v_org, v_today, v_mae) THEN
    RAISE EXCEPTION 'test 1: the former parent still answers for an adult';
  END IF;
  IF NOT family_may_answer(v_org, v_tomorrow, v_mae) THEN
    RAISE EXCEPTION 'test 1: the parent of a minor no longer answers';
  END IF;
  IF (SELECT count(*) FROM guardian_access WHERE student_id = v_today) <> 0 THEN
    RAISE EXCEPTION 'test 1: guardian_access still lists the parental link of an adult';
  END IF;
  RAISE NOTICE 'test 1: a parental link stops granting on the 18th birthday';

  -- Test 2.
  IF student_is_adult_path(v_org, v_supported) THEN
    RAISE EXCEPTION 'test 2: a supported adult is on the adult path';
  END IF;
  IF NOT family_may_answer(v_org, v_supported, v_acomp) THEN
    RAISE EXCEPTION 'test 2: the acompanhante cannot answer';
  END IF;
  RAISE NOTICE 'test 2: an accompanying link grants at any age';

  -- Test 3.
  IF EXISTS (SELECT 1 FROM pass_family(v_org, 'cccccccc-2060-4000-8000-000000000001') pf
              WHERE pf.student_id = v_today) THEN
    RAISE EXCEPTION 'test 3: the adult son is on his mother''s family pack';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pass_family(v_org, 'cccccccc-2060-4000-8000-000000000001') pf
                  WHERE pf.student_id = 'eeeeeeee-2060-4000-8000-0000000000c4') THEN
    RAISE EXCEPTION 'test 3: the 17-year-old left the family pack';
  END IF;
  IF invoice_payer_membership_id(v_org, v_today) IS DISTINCT FROM v_mae THEN
    RAISE EXCEPTION 'test 3: the former parent stopped being the payer';
  END IF;
  RAISE NOTICE 'test 3: a former parent keeps the payer role and nothing on the pack';

  -- Test 4.
  v_failed := false;
  BEGIN
    INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id)
    VALUES (v_org, v_ana, 'dddddddd-2060-4000-8000-000000000004');
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'guardian_is_self%' THEN RAISE; END IF;
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'test 4: a self-guardian insert was accepted'; END IF;

  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id)
  VALUES (v_org, v_ana, v_acomp);
  v_failed := false;
  BEGIN
    UPDATE guardian_link SET guardian_membership_id = 'dddddddd-2060-4000-8000-000000000004'
     WHERE student_id = v_ana AND archived_at IS NULL;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'guardian_is_self%' THEN RAISE; END IF;
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'test 4: a self-guardian update was accepted'; END IF;

  -- A duplicate record of Ana is her guardian; merging it into her archives the link.
  UPDATE guardian_link SET guardian_membership_id = 'dddddddd-2060-4000-8000-000000000005'
   WHERE student_id = v_ana AND archived_at IS NULL;
  PERFORM merge_memberships(v_org, 'dddddddd-2060-4000-8000-000000000004', 'dddddddd-2060-4000-8000-000000000005');
  IF EXISTS (SELECT 1 FROM guardian_link WHERE student_id = v_ana AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'test 4: a merge left Ana as her own guardian';
  END IF;
  RAISE NOTICE 'test 4: nobody is their own guardian, and a merge archives the link';

  -- Test 5.
  IF student_is_adult_path(v_org, 'eeeeeeee-2060-4000-8000-0000000000c4')
     OR NOT family_may_answer(v_org, 'eeeeeeee-2060-4000-8000-0000000000c4', v_mae) THEN
    RAISE EXCEPTION 'test 5: a 17-year-old changed';
  END IF;
  IF student_is_adult_path(v_org, 'eeeeeeee-2060-4000-8000-0000000000c5')
     OR NOT family_may_answer(v_org, 'eeeeeeee-2060-4000-8000-0000000000c5', v_mae) THEN
    RAISE EXCEPTION 'test 5: a declared date made an adult';
  END IF;
  IF student_is_adult_path(v_org, 'eeeeeeee-2060-4000-8000-0000000000c6')
     OR NOT family_may_answer(v_org, 'eeeeeeee-2060-4000-8000-0000000000c6', v_mae) THEN
    RAISE EXCEPTION 'test 5: no date made an adult';
  END IF;
  RAISE NOTICE 'test 5: missing or declared data never makes an adult';
END;
$$;

-- Test 6.
SELECT set_config('app.organization_id', 'bbbbbbbb-2060-4000-8000-000000000002', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM guardian_access)
     OR EXISTS (SELECT 1 FROM guardian_access WHERE organization_id = 'bbbbbbbb-2060-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'test 6: another club reads the links';
  END IF;
  IF family_may_answer('bbbbbbbb-2060-4000-8000-000000000001', 'eeeeeeee-2060-4000-8000-0000000000c4',
                       'dddddddd-2060-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'test 6: another club''s session sees a link grant';
  END IF;
  RAISE NOTICE 'test 6: another club reads none of it';
END;
$$;

ROLLBACK;
