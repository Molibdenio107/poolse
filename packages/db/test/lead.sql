-- Online pre-registration — POOLSE-69.
--
-- The public boundary is two definer functions, so most of this file is about
-- what they refuse *silently*: an unknown slug, a closed club, another club's
-- level id and a club past its ceiling all leave the caller with the same
-- nothing. Test 5 is the trial seat, refused in the database with its numbers.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug, public_registration_open) VALUES
  ('f6900000-0000-0000-0000-000000000001', 'Clube Aberto', 'clube-aberto', true),
  ('f6900000-0000-0000-0000-000000000002', 'Clube Fechado', 'clube-fechado', false);
UPDATE organization SET max_facilities = 20
 WHERE id IN ('f6900000-0000-0000-0000-000000000001', 'f6900000-0000-0000-0000-000000000002');

DO $$
DECLARE
  v_open uuid := 'f6900000-0000-0000-0000-000000000001';
  v_shut uuid := 'f6900000-0000-0000-0000-000000000002';
  v_facility uuid; v_pool uuid; v_season uuid; v_level uuid; v_other_level uuid;
  v_group uuid; v_session uuid; v_ana uuid;
BEGIN
  INSERT INTO facility (organization_id, name, timezone)
  VALUES (v_open, 'Piscina Aberta', 'Europe/Lisbon') RETURNING id INTO v_facility;
  INSERT INTO pool (organization_id, facility_id, name)
  VALUES (v_open, v_facility, 'Tanque') RETURNING id INTO v_pool;
  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (v_open, '2026/2027', DATE '2026-09-01', DATE '2027-07-31') RETURNING id INTO v_season;
  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_open, 'Iniciação', 1) RETURNING id INTO v_level;
  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_shut, 'Do outro clube', 1) RETURNING id INTO v_other_level;

  -- A turma of one, full, with an occurrence next week.
  INSERT INTO class_group (organization_id, facility_id, season_id, name, capacity, level_id)
  VALUES (v_open, v_facility, v_season, 'Iniciação A', 1, v_level) RETURNING id INTO v_group;
  INSERT INTO student (organization_id, first_name, last_name, level_id)
  VALUES (v_open, 'Ana', 'Costa', v_level) RETURNING id INTO v_ana;
  INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
  VALUES (v_open, v_group, v_ana, 'active');
  INSERT INTO class_session (organization_id, class_group_id, pool_id,
                             starts_at, duration_minutes, ends_at)
  VALUES (v_open, v_group, v_pool, now() + interval '7 days', 45,
          now() + interval '7 days 45 minutes')
  RETURNING id INTO v_session;

  CREATE TEMP TABLE fixture AS
  SELECT v_open AS org, v_level AS level, v_other_level AS other_level,
         v_facility AS facility, v_group AS grp, v_session AS session, v_ana AS ana;
  GRANT SELECT ON fixture TO poolse_app;
END $$;

-- The public path runs with no tenant context. A stray GUC naming another club
-- must not matter, so it is set to one.
SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'f6900000-0000-0000-0000-000000000002', true);

-- ---------------------------------------------------------------------------
-- Test 1 — the form shows an open club's names and nothing else
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_form jsonb;
BEGIN
  v_form := public_lead_form('clube-aberto');
  IF v_form IS NULL THEN
    RAISE EXCEPTION 'FAIL test 1a: an open club has no form';
  END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_form) k)
     <> ARRAY['ageOfMajority', 'clubName', 'complaintsRegime', 'complaintsUrl', 'facilities', 'levels', 'regulations'] THEN
    RAISE EXCEPTION 'FAIL test 1a: the form carries keys %', v_form;
  END IF;
  IF jsonb_array_length(v_form->'levels') <> 1 THEN
    RAISE EXCEPTION 'FAIL test 1a: the form offers % levels, expected 1', v_form->'levels';
  END IF;
  RAISE NOTICE 'PASS test 1a: an open club''s form is its name, sites and levels';

  IF public_lead_form('clube-fechado') IS NOT NULL
     OR public_lead_form('nao-existe') IS NOT NULL
     OR public_lead_form('Bad Slug!') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 1b: a closed or unknown club has a form';
  END IF;
  RAISE NOTICE 'PASS test 1b: closed, unknown and malformed look the same';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — a submit writes for an open club only, and returns nothing either way
-- ---------------------------------------------------------------------------

SELECT submit_lead('clube-aberto', jsonb_build_object(
  'swimmerFirstName', 'Tomás', 'swimmerLastName', 'Reis',
  'swimmerBirthDate', '2018-03-04', 'guardianName', 'Marta Reis',
  'guardianRelationship', 'Mãe', 'email', 'marta@example.pt',
  'preferredDays', jsonb_build_array(2, 4),
  'levelId', (SELECT level FROM fixture)::text,
  'facilityId', (SELECT facility FROM fixture)::text,
  'consentTextVersion', '2026-10-13', 'locale', 'pt-PT'));

SELECT submit_lead('clube-fechado', jsonb_build_object(
  'swimmerFirstName', 'X', 'swimmerLastName', 'Y', 'swimmerBirthDate', '2018-01-01',
  'email', 'x@example.pt', 'consentTextVersion', '2026-10-13'));
SELECT submit_lead('nao-existe', jsonb_build_object(
  'swimmerFirstName', 'X', 'swimmerLastName', 'Y', 'swimmerBirthDate', '2018-01-01',
  'email', 'x@example.pt', 'consentTextVersion', '2026-10-13'));

-- Another club's level id: dropped to "no preference", not refused.
SELECT submit_lead('clube-aberto', jsonb_build_object(
  'swimmerFirstName', 'Inês', 'swimmerLastName', 'Lima', 'swimmerBirthDate', '1990-05-05',
  'email', 'ines@example.pt', 'levelId', (SELECT other_level FROM fixture)::text,
  'consentTextVersion', '2026-10-13'));

RESET ROLE;

DO $$
DECLARE f RECORD; v_count int; v_tomas RECORD; v_ines RECORD;
BEGIN
  SELECT * INTO f FROM fixture;
  SELECT count(*) INTO v_count FROM lead WHERE organization_id <> f.org
     AND organization_id = 'f6900000-0000-0000-0000-000000000002';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL test 2a: a closed club received % leads', v_count;
  END IF;

  SELECT * INTO v_tomas FROM lead WHERE swimmer_first_name = 'Tomás';
  IF v_tomas.id IS NULL OR v_tomas.organization_id <> f.org
     OR v_tomas.level_id <> f.level OR v_tomas.preferred_days <> '{2,4}'::smallint[]
     OR v_tomas.consented_at IS NULL OR v_tomas.status <> 'new' THEN
    RAISE EXCEPTION 'FAIL test 2a: the open club''s lead is wrong: %', row_to_json(v_tomas);
  END IF;
  RAISE NOTICE 'PASS test 2a: an open club gets the lead, with consent and time; a closed one nothing';

  SELECT * INTO v_ines FROM lead WHERE swimmer_first_name = 'Inês';
  IF v_ines.id IS NULL OR v_ines.level_id IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 2b: another club''s level id was kept or refused: %', row_to_json(v_ines);
  END IF;
  RAISE NOTICE 'PASS test 2b: another club''s level id becomes no preference';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — the per-club ceiling drops silently
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;
DO $$
DECLARE i int; v_count int;
BEGIN
  FOR i IN 1..40 LOOP
    PERFORM submit_lead('clube-aberto', jsonb_build_object(
      'swimmerFirstName', 'Spam', 'swimmerLastName', i::text,
      'swimmerBirthDate', '2015-01-01', 'email', 'spam@example.pt',
      'consentTextVersion', '2026-10-13'));
  END LOOP;
END $$;
RESET ROLE;

DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM lead
   WHERE organization_id = 'f6900000-0000-0000-0000-000000000001';
  IF v_count <> 30 THEN
    RAISE EXCEPTION 'FAIL test 3: % leads in ten minutes, expected the ceiling of 30', v_count;
  END IF;
  RAISE NOTICE 'PASS test 3: a club takes thirty leads in ten minutes and drops the rest';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — a lead is the club's own: invisible elsewhere, never deleted
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'f6900000-0000-0000-0000-000000000002', true);
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM lead;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL test 4a: another club sees % leads', v_count;
  END IF;
  RAISE NOTICE 'PASS test 4a: another club sees none of them';
END $$;

SELECT set_config('app.organization_id', 'f6900000-0000-0000-0000-000000000001', true);
DO $$
BEGIN
  BEGIN
    DELETE FROM lead;
    RAISE EXCEPTION 'FAIL test 4b: the tenant role deleted a lead';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 4b: a lead is archived, never deleted';
  END;

  BEGIN
    UPDATE lead SET level_id = (SELECT other_level FROM fixture)
     WHERE swimmer_first_name = 'Tomás';
    RAISE EXCEPTION 'FAIL test 4c: a lead pointed at another club''s level';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS test 4c: the composite key refuses another club''s level';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — an aula experimental takes a seat, and a full occurrence refuses
-- with its numbers
-- ---------------------------------------------------------------------------

DO $$
DECLARE f RECORD; v_detail text;
BEGIN
  SELECT * INTO f FROM fixture;

  BEGIN
    UPDATE lead SET status = 'trial_booked', trial_session_id = f.session, decided_at = now()
     WHERE swimmer_first_name = 'Tomás';
    RAISE EXCEPTION 'FAIL test 5a: a trial went into a full occurrence';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    IF v_detail <> 'trial_capacity|1|1' THEN
      RAISE EXCEPTION 'FAIL test 5a: the refusal carried %', v_detail;
    END IF;
    RAISE NOTICE 'PASS test 5a: a full occurrence refuses a trial with trial_capacity|1|1';
  END;

  -- A second place in the turma: the trial takes it.
  UPDATE class_group SET capacity = 2 WHERE id = f.grp;
  UPDATE lead SET status = 'trial_booked', trial_session_id = f.session, decided_at = now()
   WHERE swimmer_first_name = 'Tomás';
  IF session_free_seats(f.session) <> 0 THEN
    RAISE EXCEPTION 'FAIL test 5b: a trial guest did not take a seat (% free)',
      session_free_seats(f.session);
  END IF;
  RAISE NOTICE 'PASS test 5b: a booked trial takes the place session_free_seats counts';

  BEGIN
    UPDATE lead SET status = 'trial_booked', trial_session_id = f.session, decided_at = now()
     WHERE swimmer_first_name = 'Inês';
    RAISE EXCEPTION 'FAIL test 5c: a second trial took the same last place';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS test 5c: two trials cannot share the last place';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — retention archives an old unconverted lead, and keeps the rest
-- ---------------------------------------------------------------------------

RESET ROLE;
UPDATE lead SET created_at = now() - interval '13 months'
 WHERE swimmer_first_name IN ('Inês', 'Spam');
SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'f6900000-0000-0000-0000-000000000001', true);

DO $$
DECLARE v_archived int; v_left int; v_total int;
BEGIN
  v_archived := archive_stale_leads();
  SELECT count(*) INTO v_left FROM lead WHERE archived_at IS NULL;
  SELECT count(*) INTO v_total FROM lead;
  IF v_archived <> 29 OR v_left <> 1 OR v_total <> 30 THEN
    RAISE EXCEPTION 'FAIL test 6: archived %, live %, total % (expected 29, 1, 30)',
      v_archived, v_left, v_total;
  END IF;
  RAISE NOTICE 'PASS test 6: old unconverted leads are archived, not deleted';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 7 — slugs (13-10-2026 sweep): every name fits the shape, and a slug a
-- club once held is never handed to another
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_short text; v_long text; v_org uuid; v_slug text;
BEGIN
  v_short := slugify('GD');
  v_long := slugify('Clube de Natação e Atividades Aquáticas da Junta de Freguesia de Santo António');
  IF v_short !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(v_short) < 3
     OR length(v_long) > 50 OR v_long ~ '-$' THEN
    RAISE EXCEPTION 'FAIL test 7a: slugify gave % and %', v_short, v_long;
  END IF;
  RAISE NOTICE 'PASS test 7a: a two-letter and a 78-character name both make a valid slug';

  -- Clube Aberto gives up its slug; a new club named the same is not given it.
  UPDATE organization SET slug = 'clube-aberto-lisboa' WHERE slug = 'clube-aberto';
  INSERT INTO organization (name, slug) VALUES ('Clube Aberto', 'clube-aberto')
  RETURNING id, slug INTO v_org, v_slug;
  IF v_slug = 'clube-aberto' THEN
    RAISE EXCEPTION 'FAIL test 7b: a new club was handed a slug another club held';
  END IF;
  RAISE NOTICE 'PASS test 7b: provisioning steps past a retired slug (got %)', v_slug;
END $$;

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'f6900000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  BEGIN
    UPDATE organization SET slug = 'clube-aberto'
     WHERE id = 'f6900000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'FAIL test 7c: a club took another club''s retired slug';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS test 7c: another club''s retired slug is refused';
  END;
END $$;

SELECT set_config('app.organization_id', 'f6900000-0000-0000-0000-000000000001', true);
UPDATE organization SET slug = 'clube-aberto' WHERE id = 'f6900000-0000-0000-0000-000000000001';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organization WHERE slug = 'clube-aberto'
                    AND id = 'f6900000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL test 7d: a club could not go back to its own slug';
  END IF;
  RAISE NOTICE 'PASS test 7d: a club may go back to its own old slug';
END $$;

RESET ROLE;

ROLLBACK;
