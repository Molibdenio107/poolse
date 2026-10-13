-- Laboratory results — POOLSE-72.
--
-- The isolation half: a report cannot name another club's pool, its values
-- cannot attach to another club's report, a negative count is refused, and
-- nothing here is ever deleted by the tenant login.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('f7200000-0000-0000-0000-000000000001', 'Clube Lab A', 'clube-lab-a'),
  ('f7200000-0000-0000-0000-000000000002', 'Clube Lab B', 'clube-lab-b');
UPDATE organization SET max_facilities = 20
 WHERE id IN ('f7200000-0000-0000-0000-000000000001', 'f7200000-0000-0000-0000-000000000002');

DO $$
DECLARE v_fa uuid; v_fb uuid; v_pa uuid; v_pb uuid; v_ra uuid;
BEGIN
  INSERT INTO facility (organization_id, name, timezone)
  VALUES ('f7200000-0000-0000-0000-000000000001', 'Sede A', 'Europe/Lisbon') RETURNING id INTO v_fa;
  INSERT INTO facility (organization_id, name, timezone)
  VALUES ('f7200000-0000-0000-0000-000000000002', 'Sede B', 'Europe/Lisbon') RETURNING id INTO v_fb;
  INSERT INTO pool (organization_id, facility_id, name, use)
  VALUES ('f7200000-0000-0000-0000-000000000001', v_fa, 'Tanque A', 'learning') RETURNING id INTO v_pa;
  INSERT INTO pool (organization_id, facility_id, name)
  VALUES ('f7200000-0000-0000-0000-000000000002', v_fb, 'Tanque B') RETURNING id INTO v_pb;
  INSERT INTO lab_result (organization_id, pool_id, sampled_at)
  VALUES ('f7200000-0000-0000-0000-000000000001', v_pa, now() - interval '1 day') RETURNING id INTO v_ra;

  CREATE TEMP TABLE fixture AS SELECT v_pa AS pool_a, v_pb AS pool_b, v_ra AS report_a;
  GRANT SELECT ON fixture TO poolse_app;
END $$;

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'f7200000-0000-0000-0000-000000000002', true);

DO $$
DECLARE f RECORD; v_count int;
BEGIN
  SELECT * INTO f FROM fixture;

  SELECT count(*) INTO v_count FROM lab_result;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL test 1: club B sees % of club A''s reports', v_count;
  END IF;
  RAISE NOTICE 'PASS test 1: a club sees none of another club''s lab results';

  BEGIN
    INSERT INTO lab_result (organization_id, pool_id, sampled_at)
    VALUES ('f7200000-0000-0000-0000-000000000002', f.pool_a, now());
    RAISE EXCEPTION 'FAIL test 2: a report named another club''s pool';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS test 2: the composite key refuses another club''s pool';
  END;

  BEGIN
    INSERT INTO lab_result_value (organization_id, lab_result_id, parameter, value, unit)
    VALUES ('f7200000-0000-0000-0000-000000000002', f.report_a, 'e_coli', 0, 'ufc/100 mL');
    RAISE EXCEPTION 'FAIL test 3: a value attached to another club''s report';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS test 3: values cannot attach to another club''s report';
  END;
END $$;

SELECT set_config('app.organization_id', 'f7200000-0000-0000-0000-000000000001', true);

DO $$
DECLARE f RECORD;
BEGIN
  SELECT * INTO f FROM fixture;

  BEGIN
    INSERT INTO lab_result_value (organization_id, lab_result_id, parameter, value, unit)
    VALUES ('f7200000-0000-0000-0000-000000000001', f.report_a, 'e_coli', -1, 'ufc/100 mL');
    RAISE EXCEPTION 'FAIL test 4: a negative count was stored';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS test 4: a negative count is refused';
  END;

  BEGIN
    DELETE FROM lab_result;
    RAISE EXCEPTION 'FAIL test 5: the tenant role deleted a lab result';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 5: a lab result is archived, never deleted';
  END;

  BEGIN
    UPDATE lab_result_value SET value = 0;
    RAISE EXCEPTION 'FAIL test 6: a stored value was edited';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 6: a value is written with its report and never edited';
  END;

  BEGIN
    UPDATE lab_result_alert SET parameters = '{e_coli}';
    RAISE EXCEPTION 'FAIL test 7: an alert''s parameters were rewritten';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 7: an alert says what it said; only its delivery is stamped';
  END;
END $$;

RESET ROLE;

ROLLBACK;
