-- At 18 the family is told, and a parent's consent awaits the young adult — POOLSE-208.
--
-- Test 1 (QA 1): a student coming of age today with a mother (parental, with an
--         email, an English login) and their own email: the job writes two
--         notices, in each recipient's locale; run again, it writes none.
-- Test 2 (QA 2): an acompanhante's student, a minor and a declared date write nothing.
-- Test 3: a consent the mother signed awaits the young adult; one they signed
--         themselves, or a minor's, does not.
-- Test 4: another club reads no notice and writes none for this club.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('bbbbbbbb-2080-4000-8000-000000000001', 'Clube Aviso', 'clube-aviso-2080'),
  ('bbbbbbbb-2080-4000-8000-000000000002', 'Clube Fora', 'clube-fora-2080');

INSERT INTO app_user (id, clerk_user_id, locale) VALUES
  ('aaaaaaaa-2080-4000-8000-000000000001', 'user_2080_mother', 'en');

INSERT INTO membership (id, organization_id, app_user_id, status, first_name, last_name, email) VALUES
  ('dddddddd-2080-4000-8000-000000000001', 'bbbbbbbb-2080-4000-8000-000000000001', 'aaaaaaaa-2080-4000-8000-000000000001', 'active', NULL, NULL, NULL),
  ('dddddddd-2080-4000-8000-000000000002', 'bbbbbbbb-2080-4000-8000-000000000001', NULL, 'active', 'Acomp', 'Aviso', 'acomp-2080@example.test'),
  ('dddddddd-2080-4000-8000-000000000003', 'bbbbbbbb-2080-4000-8000-000000000001', NULL, 'active', 'Jovem', 'Aviso', 'jovem-2080@example.test');

UPDATE app_user SET cached_email = 'mae-2080@example.test' WHERE id = 'aaaaaaaa-2080-4000-8000-000000000001';

-- c1 comes of age today; c2 is supported and comes of age today; c3 is 12; c4 by a declared date.
INSERT INTO student (id, organization_id, first_name, last_name, birth_date, membership_id) VALUES
  ('eeeeeeee-2080-4000-8000-0000000000c1', 'bbbbbbbb-2080-4000-8000-000000000001', 'Jovem', 'Aviso',
   (club_today() - interval '18 years')::date, 'dddddddd-2080-4000-8000-000000000003'),
  ('eeeeeeee-2080-4000-8000-0000000000c2', 'bbbbbbbb-2080-4000-8000-000000000001', 'Apoiado', 'Aviso',
   (club_today() - interval '18 years')::date, NULL),
  ('eeeeeeee-2080-4000-8000-0000000000c3', 'bbbbbbbb-2080-4000-8000-000000000001', 'Menor', 'Aviso',
   (club_today() - interval '12 years')::date, NULL),
  ('eeeeeeee-2080-4000-8000-0000000000c4', 'bbbbbbbb-2080-4000-8000-000000000001', 'Declarado', 'Aviso',
   (club_today() - interval '18 years')::date, NULL);
UPDATE student SET birth_date_declared_at = now() WHERE id = 'eeeeeeee-2080-4000-8000-0000000000c4';

INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, is_primary, kind) VALUES
  ('bbbbbbbb-2080-4000-8000-000000000001', 'eeeeeeee-2080-4000-8000-0000000000c1', 'dddddddd-2080-4000-8000-000000000001', true, 'parental'),
  ('bbbbbbbb-2080-4000-8000-000000000001', 'eeeeeeee-2080-4000-8000-0000000000c2', 'dddddddd-2080-4000-8000-000000000002', true, 'accompanying'),
  ('bbbbbbbb-2080-4000-8000-000000000001', 'eeeeeeee-2080-4000-8000-0000000000c3', 'dddddddd-2080-4000-8000-000000000001', true, 'parental'),
  ('bbbbbbbb-2080-4000-8000-000000000001', 'eeeeeeee-2080-4000-8000-0000000000c4', 'dddddddd-2080-4000-8000-000000000001', true, 'parental');

INSERT INTO consent (id, organization_id, student_id, kind, granted, granted_by_membership_id) VALUES
  ('cccccccc-2080-4000-8000-000000000001', 'bbbbbbbb-2080-4000-8000-000000000001', 'eeeeeeee-2080-4000-8000-0000000000c1',
   'photo', true, 'dddddddd-2080-4000-8000-000000000001'),
  ('cccccccc-2080-4000-8000-000000000002', 'bbbbbbbb-2080-4000-8000-000000000001', 'eeeeeeee-2080-4000-8000-0000000000c1',
   'medical_data', true, 'dddddddd-2080-4000-8000-000000000003'),
  ('cccccccc-2080-4000-8000-000000000003', 'bbbbbbbb-2080-4000-8000-000000000001', 'eeeeeeee-2080-4000-8000-0000000000c3',
   'photo', true, 'dddddddd-2080-4000-8000-000000000001');

SELECT set_config('app.organization_id', 'bbbbbbbb-2080-4000-8000-000000000001', true);
SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-2080-4000-8000-000000000001';
  v_written integer;
BEGIN
  -- Test 1.
  v_written := majority_notices_write(v_org);
  IF v_written <> 2 THEN RAISE EXCEPTION 'test 1: % notices written, expected 2', v_written; END IF;
  IF NOT EXISTS (SELECT 1 FROM majority_notice WHERE kind = 'parent' AND email = 'mae-2080@example.test'
                    AND locale = 'en' AND payer) THEN
    RAISE EXCEPTION 'test 1: the mother''s notice is not hers, in English, as payer';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majority_notice WHERE kind = 'student' AND email = 'jovem-2080@example.test'
                    AND locale = 'pt-PT') THEN
    RAISE EXCEPTION 'test 1: the student''s notice is missing';
  END IF;
  IF majority_notices_write(v_org) <> 0 THEN RAISE EXCEPTION 'test 1: a rerun wrote again'; END IF;
  RAISE NOTICE 'test 1: two notices, each in its locale, and a rerun writes none';

  -- Test 2.
  IF EXISTS (SELECT 1 FROM majority_notice WHERE student_id <> 'eeeeeeee-2080-4000-8000-0000000000c1') THEN
    RAISE EXCEPTION 'test 2: an acompanhante, a minor or a declared date wrote a notice';
  END IF;
  RAISE NOTICE 'test 2: acompanhante, minor and declared date are never told';

  -- Test 3.
  IF NOT consent_awaits_self(v_org, 'cccccccc-2080-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'test 3: the mother''s photo consent does not await the young adult';
  END IF;
  IF consent_awaits_self(v_org, 'cccccccc-2080-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'test 3: a consent they signed themselves awaits them';
  END IF;
  IF consent_awaits_self(v_org, 'cccccccc-2080-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'test 3: a minor''s consent awaits them';
  END IF;
  RAISE NOTICE 'test 3: only a parent''s consent on an adult awaits confirmation';
END;
$$;

-- Test 4.
SELECT set_config('app.organization_id', 'bbbbbbbb-2080-4000-8000-000000000002', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM majority_notice) THEN RAISE EXCEPTION 'test 4: another club reads notices'; END IF;
  IF majority_notices_write('bbbbbbbb-2080-4000-8000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'test 4: another club wrote notices for this one';
  END IF;
  IF consent_awaits_self('bbbbbbbb-2080-4000-8000-000000000001', 'cccccccc-2080-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'test 4: another club reads a consent';
  END IF;
  RAISE NOTICE 'test 4: another club reads and writes none of it';
END;
$$;

ROLLBACK;
