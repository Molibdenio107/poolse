-- The complaints regime and the operating regulation — POOLSE-73.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('f7300000-0000-0000-0000-000000000001', 'Clube Avisos A', 'clube-avisos-a'),
  ('f7300000-0000-0000-0000-000000000002', 'Clube Avisos B', 'clube-avisos-b');

DO $$
DECLARE v_fa uuid; v_fb uuid;
BEGIN
  INSERT INTO facility (organization_id, name, timezone)
  VALUES ('f7300000-0000-0000-0000-000000000001', 'Sede A', 'Europe/Lisbon') RETURNING id INTO v_fa;
  INSERT INTO facility (organization_id, name, timezone)
  VALUES ('f7300000-0000-0000-0000-000000000002', 'Sede B', 'Europe/Lisbon') RETURNING id INTO v_fb;
  CREATE TEMP TABLE fixture AS SELECT v_fa AS fa, v_fb AS fb;
  GRANT SELECT ON fixture TO poolse_app;
END $$;

DO $$
BEGIN
  BEGIN
    UPDATE organization SET complaints_regime = 'public_service'
     WHERE id = 'f7300000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'FAIL test 1: a public service was saved with no platform address';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS test 1: a public service must name its complaints platform';
  END;
END $$;

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'f7300000-0000-0000-0000-000000000001', true);

DO $$
DECLARE f RECORD; v_id uuid;
BEGIN
  SELECT * INTO f FROM fixture;

  BEGIN
    INSERT INTO facility_regulation (organization_id, facility_id, effective_from, body)
    VALUES ('f7300000-0000-0000-0000-000000000001', f.fb, current_date, 'X');
    RAISE EXCEPTION 'FAIL test 2: a regulation named another club''s facility';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS test 2: the composite key refuses another club''s facility';
  END;

  INSERT INTO facility_regulation (organization_id, facility_id, effective_from, body)
  VALUES ('f7300000-0000-0000-0000-000000000001', f.fa, current_date - 1, 'Regras.')
  RETURNING id INTO v_id;
  IF facility_regulation_current(f.fa) IS DISTINCT FROM v_id THEN
    RAISE EXCEPTION 'FAIL test 3: the version in force was not found';
  END IF;
  RAISE NOTICE 'PASS test 3: the latest version whose day has come is in force';

  BEGIN
    UPDATE facility_regulation SET body = 'Reescrito.' WHERE id = v_id;
    RAISE EXCEPTION 'FAIL test 4: a published version was edited';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 4: a version is never edited';
  END;

  BEGIN
    DELETE FROM facility_regulation;
    RAISE EXCEPTION 'FAIL test 5: the tenant role deleted a version';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 5: a version is withdrawn, never deleted';
  END;
END $$;

RESET ROLE;

ROLLBACK;
