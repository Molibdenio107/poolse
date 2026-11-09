-- *Fez 18 anos* — POOLSE-207.
--
-- Test 1 (QA 3): a student who came of age last week with a parental link is
--         pending; a review of that majority clears them; archiving the review
--         brings them back.
-- Test 2: an acompanhante's link, a 17-year-old, a majority 90 days ago and a
--         declared date are never pending.
-- Test 3 (QA 5): another club reads no review, cannot write one onto this
--         club's student, and majority_pending answers nothing of it.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('bbbbbbbb-2070-4000-8000-000000000001', 'Clube Dezoito', 'clube-dezoito'),
  ('bbbbbbbb-2070-4000-8000-000000000002', 'Clube Alheio', 'clube-alheio-2070');

INSERT INTO membership (id, organization_id, status, first_name, last_name) VALUES
  ('dddddddd-2070-4000-8000-000000000001', 'bbbbbbbb-2070-4000-8000-000000000001', 'active', 'Mãe', 'Dezoito'),
  ('dddddddd-2070-4000-8000-000000000002', 'bbbbbbbb-2070-4000-8000-000000000001', 'active', 'Secretaria', 'Dezoito'),
  ('dddddddd-2070-4000-8000-000000000003', 'bbbbbbbb-2070-4000-8000-000000000002', 'active', 'Outra', 'Secretaria');

-- c1 came of age 5 days ago; c2 is supported; c3 is 17; c4 came of age 90 days
-- ago; c5 is of age by a declared date only.
INSERT INTO student (id, organization_id, first_name, last_name, birth_date) VALUES
  ('eeeeeeee-2070-4000-8000-0000000000c1', 'bbbbbbbb-2070-4000-8000-000000000001', 'Fez', 'Agora',
   (club_today() - interval '18 years' - interval '5 days')::date),
  ('eeeeeeee-2070-4000-8000-0000000000c2', 'bbbbbbbb-2070-4000-8000-000000000001', 'Tem', 'Acompanhante',
   (club_today() - interval '18 years' - interval '5 days')::date),
  ('eeeeeeee-2070-4000-8000-0000000000c3', 'bbbbbbbb-2070-4000-8000-000000000001', 'Ainda', 'Menor',
   (club_today() - interval '17 years')::date),
  ('eeeeeeee-2070-4000-8000-0000000000c4', 'bbbbbbbb-2070-4000-8000-000000000001', 'Fez', 'Antes',
   (club_today() - interval '18 years' - interval '90 days')::date),
  ('eeeeeeee-2070-4000-8000-0000000000c5', 'bbbbbbbb-2070-4000-8000-000000000001', 'Data', 'Declarada',
   (club_today() - interval '18 years' - interval '5 days')::date);
UPDATE student SET birth_date_declared_at = now() WHERE id = 'eeeeeeee-2070-4000-8000-0000000000c5';

INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, kind)
SELECT 'bbbbbbbb-2070-4000-8000-000000000001', s, 'dddddddd-2070-4000-8000-000000000001',
       CASE WHEN s = 'eeeeeeee-2070-4000-8000-0000000000c2'::uuid THEN 'accompanying' ELSE 'parental' END::guardian_link_kind
  FROM unnest(ARRAY['eeeeeeee-2070-4000-8000-0000000000c1', 'eeeeeeee-2070-4000-8000-0000000000c2',
                    'eeeeeeee-2070-4000-8000-0000000000c3', 'eeeeeeee-2070-4000-8000-0000000000c4',
                    'eeeeeeee-2070-4000-8000-0000000000c5']::uuid[]) AS s;

SELECT set_config('app.organization_id', 'bbbbbbbb-2070-4000-8000-000000000001', true);
SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_org  uuid := 'bbbbbbbb-2070-4000-8000-000000000001';
  v_now  uuid := 'eeeeeeee-2070-4000-8000-0000000000c1';
  v_on   date;
  v_id   uuid;
BEGIN
  -- Test 1.
  SELECT majority_on INTO v_on FROM majority_pending(v_org) WHERE student_id = v_now;
  IF v_on IS DISTINCT FROM club_today() - 5 THEN
    RAISE EXCEPTION 'test 1: the student who came of age is not pending (got %)', v_on;
  END IF;
  INSERT INTO majority_review (organization_id, student_id, majority_on, action, reviewed_by)
  VALUES (v_org, v_now, v_on, 'confirmed', 'dddddddd-2070-4000-8000-000000000002')
  RETURNING id INTO v_id;
  IF EXISTS (SELECT 1 FROM majority_pending(v_org) WHERE student_id = v_now) THEN
    RAISE EXCEPTION 'test 1: a reviewed student is still pending';
  END IF;
  UPDATE majority_review SET archived_at = now() WHERE id = v_id;
  IF NOT EXISTS (SELECT 1 FROM majority_pending(v_org) WHERE student_id = v_now) THEN
    RAISE EXCEPTION 'test 1: an archived review did not bring the row back';
  END IF;
  RAISE NOTICE 'test 1: pending until reviewed, and a revert brings it back';

  -- Test 2.
  IF (SELECT count(*) FROM majority_pending(v_org)) <> 1 THEN
    RAISE EXCEPTION 'test 2: % pending, expected only the one who came of age',
      (SELECT count(*) FROM majority_pending(v_org));
  END IF;
  RAISE NOTICE 'test 2: acompanhante, minor, old majority and declared date are never pending';
END;
$$;

-- Test 3.
SELECT set_config('app.organization_id', 'bbbbbbbb-2070-4000-8000-000000000002', true);
DO $$
DECLARE v_failed boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM majority_review)
     OR EXISTS (SELECT 1 FROM majority_pending('bbbbbbbb-2070-4000-8000-000000000001')) THEN
    RAISE EXCEPTION 'test 3: another club reads the reviews';
  END IF;
  BEGIN
    INSERT INTO majority_review (organization_id, student_id, majority_on, action, reviewed_by)
    VALUES ('bbbbbbbb-2070-4000-8000-000000000002', 'eeeeeeee-2070-4000-8000-0000000000c1',
            club_today(), 'confirmed', 'dddddddd-2070-4000-8000-000000000003');
  EXCEPTION WHEN foreign_key_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'test 3: a review crossed clubs'; END IF;
  RAISE NOTICE 'test 3: another club reads and writes none of it';
END;
$$;

ROLLBACK;
