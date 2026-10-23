-- Advancement by age at the end of a season — POOLSE-112.
--
-- Test 1 is QA 1: a nine-year-old in a level that stops at eight is proposed
-- when the next season is published. Test 2 is QA 3, the one most likely to be
-- got wrong: a child above *two* bands skips to the first level whose band fits,
-- in the club's drag-and-drop order — never "the next one, and then the next".
-- Test 3 pins BA rule 5 (never down) and test 4 the idempotence a nightly run
-- depends on: a second run queues nothing, and a person's dismissal is kept.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES ('Clube Idades', 'clube-idades');
UPDATE organization SET max_facilities = 20 WHERE slug = 'clube-idades';

/*
 * A ladder of four, banded in months: Bebés (to 3y), Adaptação (3–6), Iniciação
 * (6–8), Aperfeiçoamento (8–12). The season starts on 2027-09-01, which is the
 * day every age below is judged on.
 */
DO $$
DECLARE
  v_org uuid; v_season uuid; v_next uuid;
  v_l0 uuid; v_l1 uuid; v_l2 uuid; v_l3 uuid;
  v_g1 uuid;
  v_nine uuid; v_seven uuid; v_eleven uuid; v_toddler uuid; v_left uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-idades';
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina');

  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_org, '2026/2027', DATE '2026-09-01', DATE '2027-07-31', 'published')
  RETURNING id INTO v_season;
  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_org, '2027/2028', DATE '2027-09-01', DATE '2028-07-31', 'draft')
  RETURNING id INTO v_next;

  INSERT INTO student_level (organization_id, name, sort_order, min_age_months, max_age_months)
  VALUES (v_org, 'Bebés', 1, 6, 36) RETURNING id INTO v_l0;
  INSERT INTO student_level (organization_id, name, sort_order, min_age_months, max_age_months)
  VALUES (v_org, 'Adaptação', 2, 36, 72) RETURNING id INTO v_l1;
  INSERT INTO student_level (organization_id, name, sort_order, min_age_months, max_age_months)
  VALUES (v_org, 'Iniciação', 3, 72, 96) RETURNING id INTO v_l2;
  INSERT INTO student_level (organization_id, name, sort_order, min_age_months, max_age_months)
  VALUES (v_org, 'Aperfeiçoamento', 4, 96, 144) RETURNING id INTO v_l3;

  INSERT INTO class_group (organization_id, facility_id, season_id, name, capacity, level_id)
  VALUES (v_org, (SELECT id FROM facility WHERE organization_id = v_org LIMIT 1),
          v_season, 'Adaptação A', 8, v_l1) RETURNING id INTO v_g1;

  -- Nine on the first day of 2027/28, in a level that stops at eight: QA 1.
  INSERT INTO student (organization_id, first_name, last_name, level_id, birth_date)
  VALUES (v_org, 'Nove', 'Anos', v_l2, DATE '2018-06-15') RETURNING id INTO v_nine;
  -- Seven, still in Adaptação (3–6): above its band, and Iniciação (6–8) fits.
  INSERT INTO student (organization_id, first_name, last_name, level_id, birth_date)
  VALUES (v_org, 'Sete', 'Anos', v_l1, DATE '2020-03-10') RETURNING id INTO v_seven;
  -- Eleven, still in Adaptação: above two bands — Iniciação stops at eight too,
  -- so the fit is Aperfeiçoamento. QA 3.
  INSERT INTO student (organization_id, first_name, last_name, level_id, birth_date)
  VALUES (v_org, 'Onze', 'Anos', v_l1, DATE '2016-01-20') RETURNING id INTO v_eleven;
  -- Two, placed in Adaptação (from 3): below the band, never proposed down. BA 5.
  INSERT INTO student (organization_id, first_name, last_name, level_id, birth_date)
  VALUES (v_org, 'Dois', 'Anos', v_l1, DATE '2025-05-05') RETURNING id INTO v_toddler;
  -- Nine and gone: ended enrolment, no fee line. Not advanced.
  INSERT INTO student (organization_id, first_name, last_name, level_id, birth_date)
  VALUES (v_org, 'Saiu', 'Anos', v_l2, DATE '2018-06-15') RETURNING id INTO v_left;

  INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
  VALUES (v_org, v_g1, v_seven, 'active'), (v_org, v_g1, v_eleven, 'active'),
         (v_org, v_g1, v_toddler, 'active');
  INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on, ended_on)
  VALUES (v_org, v_g1, v_left, 'ended', DATE '2026-09-01', DATE '2027-01-31');

  CREATE TEMP TABLE fixture AS
  SELECT v_org AS org, v_season AS season, v_next AS next,
         v_l0 AS l0, v_l1 AS l1, v_l2 AS l2, v_l3 AS l3,
         v_nine AS nine, v_seven AS seven, v_eleven AS eleven,
         v_toddler AS toddler, v_left AS gone;
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 (QA 1): publishing the next season proposes by age, reason idade
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_count int; v_to uuid; v_reason text; v_season uuid;
BEGIN
  SELECT * INTO f FROM fixture;

  SELECT propose_age_advancements(f.org, f.next) INTO v_count;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'FAIL test 1: queued %, expected 3 (nove, sete, onze)', v_count;
  END IF;

  SELECT to_level_id, reason::text, season_id INTO v_to, v_reason, v_season
    FROM transfer_proposal WHERE student_id = f.nine AND status = 'pending';
  IF v_to IS DISTINCT FROM f.l3 THEN
    RAISE EXCEPTION 'FAIL test 1: the nine-year-old was not proposed into Aperfeiçoamento';
  END IF;
  IF v_reason <> 'age' OR v_season IS DISTINCT FROM f.next THEN
    RAISE EXCEPTION 'FAIL test 1: the proposal does not say idade and the season';
  END IF;

  RAISE NOTICE 'PASS test 1 (QA 1): a child above the band is proposed when the season is published';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 (QA 3): above two bands skips to the first level whose band fits
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_to uuid;
BEGIN
  SELECT * INTO f FROM fixture;

  SELECT to_level_id INTO v_to
    FROM transfer_proposal WHERE student_id = f.eleven AND status = 'pending';
  IF v_to IS DISTINCT FROM f.l3 THEN
    RAISE EXCEPTION 'FAIL test 2: the eleven-year-old stopped at Iniciação instead of skipping it';
  END IF;

  SELECT to_level_id INTO v_to
    FROM transfer_proposal WHERE student_id = f.seven AND status = 'pending';
  IF v_to IS DISTINCT FROM f.l2 THEN
    RAISE EXCEPTION 'FAIL test 2: the seven-year-old was not proposed into Iniciação';
  END IF;

  RAISE NOTICE 'PASS test 2 (QA 3): the target is the first level whose band fits';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 (BA 5): below the band is flagged, never proposed; a departed child
-- is left alone
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_count int; v_standing text;
BEGIN
  SELECT * INTO f FROM fixture;

  SELECT count(*) INTO v_count FROM transfer_proposal
   WHERE student_id IN (f.toddler, f.gone);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL test 3: % proposals for a toddler or a departed child', v_count;
  END IF;

  SELECT standing INTO v_standing
    FROM age_band_standing(f.org, DATE '2027-09-01') WHERE student_id = f.toddler;
  IF v_standing IS DISTINCT FROM 'below' THEN
    RAISE EXCEPTION 'FAIL test 3: the toddler reads as % rather than below', v_standing;
  END IF;

  RAISE NOTICE 'PASS test 3 (BA 5): below the band is a flag, and a departed child is not advanced';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: a second run queues nothing, and a dismissal is kept for that season
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_count int;
BEGIN
  SELECT * INTO f FROM fixture;

  SELECT propose_age_advancements(f.org, f.next) INTO v_count;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL test 4: a second run queued % proposals', v_count;
  END IF;

  UPDATE transfer_proposal SET status = 'dismissed' WHERE student_id = f.seven;
  SELECT propose_age_advancements(f.org, f.next) INTO v_count;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL test 4: a dismissed child was proposed again for the same season';
  END IF;

  -- One level only: the queue's Propor button. Nobody new in Iniciação now.
  SELECT propose_age_advancements(f.org, f.next, f.l2) INTO v_count;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL test 4: the per-level run queued % proposals', v_count;
  END IF;

  RAISE NOTICE 'PASS test 4: generation is idempotent and keeps a person''s dismissal';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: the family's addresses — guardians, else the student
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_addresses text[]; v_guardian uuid;
BEGIN
  SELECT * INTO f FROM fixture;

  UPDATE student SET contact_email = 'nove@familia.pt' WHERE id = f.nine;
  SELECT level_change_recipients(f.org, f.nine) INTO v_addresses;
  IF v_addresses <> ARRAY['nove@familia.pt'] THEN
    RAISE EXCEPTION 'FAIL test 5: with no guardian the student''s own address was expected, got %', v_addresses;
  END IF;

  INSERT INTO membership (organization_id, status, first_name, last_name, email)
  VALUES (f.org, 'active', 'Mãe', 'Anos', 'mae@familia.pt') RETURNING id INTO v_guardian;
  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id)
  VALUES (f.org, f.nine, v_guardian);

  SELECT level_change_recipients(f.org, f.nine) INTO v_addresses;
  IF v_addresses <> ARRAY['mae@familia.pt'] THEN
    RAISE EXCEPTION 'FAIL test 5: with a guardian only the guardian is told, got %', v_addresses;
  END IF;

  RAISE NOTICE 'PASS test 5 (BA 4): the guardian is told, else the student';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: notices are tenant data, and the club writes its own mode
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_other uuid; v_visible int;
BEGIN
  SELECT * INTO f FROM fixture;

  INSERT INTO level_change_notice
    (organization_id, student_id, from_level_name, to_level_name, reason, recipients)
  VALUES (f.org, f.nine, 'Iniciação', 'Aperfeiçoamento', 'age', ARRAY['nove@familia.pt']);

  INSERT INTO organization (name, slug) VALUES ('Clube Outro', 'clube-outro-idades')
  RETURNING id INTO v_other;

  PERFORM set_config('app.organization_id', v_other::text, true);
  SET LOCAL ROLE poolse_app;
  SELECT count(*) INTO v_visible FROM level_change_notice;
  RESET ROLE;
  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6: another tenant saw % notices', v_visible;
  END IF;

  PERFORM set_config('app.organization_id', f.org::text, true);
  SET LOCAL ROLE poolse_app;
  UPDATE organization SET advancement_mode = 'apply' WHERE id = f.org;
  BEGIN
    UPDATE level_change_notice SET from_level_name = 'x';
    RAISE EXCEPTION 'FAIL test 6: the app rewrote a notice''s words';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;

  RAISE NOTICE 'PASS test 6: notices are invisible to another tenant, insert-only, and the mode is the club''s to set';
END $$;

ROLLBACK;
