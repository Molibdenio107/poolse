-- A student's level per sport — POOLSE-148.
--
-- Swimming's level is `student.level_id` and nothing else may sit there; every
-- other sport's level is a `student_sport_level` row on that sport's own ladder.
-- Asserted: both rules refuse in the database, one live row per student and
-- sport, and nothing crosses tenants.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug, enabled_sports) VALUES
  ('14800000-0000-4444-8888-000000000001', 'Clube Dois Desportos', 'clube-dois-desportos', '{pool,tennis}'),
  ('14800000-0000-4444-8888-000000000002', 'Clube Alheio', 'clube-alheio-148', '{pool,tennis}');

INSERT INTO student_level (id, organization_id, name, sort_order, sport_id) VALUES
  ('14800000-0000-4444-8888-0000000000a1', '14800000-0000-4444-8888-000000000001', 'Golfinhos', 0, 'pool'),
  ('14800000-0000-4444-8888-0000000000a2', '14800000-0000-4444-8888-000000000001', 'Ténis 1', 0, 'tennis'),
  ('14800000-0000-4444-8888-0000000000a3', '14800000-0000-4444-8888-000000000001', 'Ténis 2', 1, 'tennis'),
  ('14800000-0000-4444-8888-0000000000b2', '14800000-0000-4444-8888-000000000002', 'Ténis Alheio', 0, 'tennis');

INSERT INTO student (id, organization_id, first_name, last_name, level_id) VALUES
  ('14800000-0000-4444-8888-0000000000c1', '14800000-0000-4444-8888-000000000001', 'Ana', 'Dupla',
   '14800000-0000-4444-8888-0000000000a1');

-- Test 1 — a tennis level beside the swimming one.
DO $$
BEGIN
  INSERT INTO student_sport_level (organization_id, student_id, sport_id, level_id)
  VALUES ('14800000-0000-4444-8888-000000000001', '14800000-0000-4444-8888-0000000000c1', 'tennis',
          '14800000-0000-4444-8888-0000000000a2');
  IF (SELECT level_id FROM student WHERE id = '14800000-0000-4444-8888-0000000000c1')
     <> '14800000-0000-4444-8888-0000000000a1' THEN
    RAISE EXCEPTION 'FAIL test 1: the swimming level moved';
  END IF;
  RAISE NOTICE 'PASS test 1: a student holds a swimming and a tennis level at once';
END $$;

-- Test 2 — the sport rules, both homes.
DO $$
DECLARE ok boolean;
BEGIN
  ok := false;
  BEGIN
    UPDATE student SET level_id = '14800000-0000-4444-8888-0000000000a2'
     WHERE id = '14800000-0000-4444-8888-0000000000c1';
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2a: a tennis level was written as the swimming level'; END IF;

  ok := false;
  BEGIN
    UPDATE student_sport_level SET level_id = '14800000-0000-4444-8888-0000000000a1'
     WHERE student_id = '14800000-0000-4444-8888-0000000000c1';
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2b: a swimming level sat on the tennis row'; END IF;

  ok := false;
  BEGIN
    INSERT INTO student_sport_level (organization_id, student_id, sport_id, level_id)
    VALUES ('14800000-0000-4444-8888-000000000001', '14800000-0000-4444-8888-0000000000c1', 'pool',
            '14800000-0000-4444-8888-0000000000a1');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2c: a row for swimming, a second home'; END IF;
  RAISE NOTICE 'PASS test 2: each level sits only on its own sport''s ladder';
END $$;

-- Test 3 — one live row per student and sport; a level change is an update.
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO student_sport_level (organization_id, student_id, sport_id, level_id)
    VALUES ('14800000-0000-4444-8888-000000000001', '14800000-0000-4444-8888-0000000000c1', 'tennis',
            '14800000-0000-4444-8888-0000000000a3');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3: two live tennis levels'; END IF;
  UPDATE student_sport_level SET level_id = '14800000-0000-4444-8888-0000000000a3'
   WHERE student_id = '14800000-0000-4444-8888-0000000000c1' AND sport_id = 'tennis';
  RAISE NOTICE 'PASS test 3: one live level per sport, moved by an update';
END $$;

-- Test 4 — another club's level cannot be referenced, and RLS hides the rows.
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    UPDATE student_sport_level SET level_id = '14800000-0000-4444-8888-0000000000b2'
     WHERE student_id = '14800000-0000-4444-8888-0000000000c1';
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4a: another club''s level was referenced'; END IF;
  RAISE NOTICE 'PASS test 4a: a cross-tenant level is refused';
END $$;

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', '14800000-0000-4444-8888-000000000002', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM student_sport_level) THEN
    RAISE EXCEPTION 'FAIL test 4b: another club read our student''s level';
  END IF;
  RAISE NOTICE 'PASS test 4b: the rows are invisible to another club';
END $$;
RESET ROLE;

ROLLBACK;
