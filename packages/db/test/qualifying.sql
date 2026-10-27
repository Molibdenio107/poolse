-- Gap to qualify — POOLSE-85.
--
-- `qualifying_gaps()` is the one definition of a valid time, so the QA scenarios
-- that are about *which* time counts live here: the age band by birth year and
-- gender (QA 1), the gap (QA 2), no course conversion (QA 3), official meets
-- only (QA 4), the window (QA 5), no birth date (QA 6) — and the composite key
-- that keeps a time's age group and standard in one season.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug)
VALUES ('c1c1c1c1-0000-0000-0000-000000000085', 'Clube Mínimos', 'clube-minimos');

DO $$
DECLARE
  v_org uuid := 'c1c1c1c1-0000-0000-0000-000000000085';
  v_season uuid; v_old_season uuid;
  v_girls uuid; v_boys uuid; v_old_group uuid;
  v_std uuid; v_windowed uuid;
  v_ana uuid; v_rui uuid; v_nobody uuid;
  v_official uuid; v_friendly uuid;
  v_row record;
  v_count integer;
BEGIN
  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_org, '2026/2027', DATE '2026-09-01', DATE '2027-07-31', 'published')
  RETURNING id INTO v_season;
  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_org, '2025/2026', DATE '2025-09-01', DATE '2026-07-31', 'archived')
  RETURNING id INTO v_old_season;

  -- Juvenis: girls a year earlier.
  INSERT INTO federation_age_group (organization_id, season_id, name, gender, born_from, born_to)
  VALUES (v_org, v_season, 'Juvenis', 'female', 2011, 2012) RETURNING id INTO v_girls;
  INSERT INTO federation_age_group (organization_id, season_id, name, gender, born_from, born_to)
  VALUES (v_org, v_season, 'Juvenis', 'male', 2010, 2011) RETURNING id INTO v_boys;
  INSERT INTO federation_age_group (organization_id, season_id, name, gender, born_from, born_to)
  VALUES (v_org, v_old_season, 'Juvenis', 'female', 2010, 2011) RETURNING id INTO v_old_group;

  INSERT INTO student (organization_id, first_name, last_name, birth_date, gender)
  VALUES (v_org, 'Ana', 'Lopes', DATE '2012-05-01', 'female') RETURNING id INTO v_ana;
  INSERT INTO student (organization_id, first_name, last_name, birth_date, gender)
  VALUES (v_org, 'Rui', 'Costa', DATE '2012-05-01', 'male') RETURNING id INTO v_rui;
  INSERT INTO student (organization_id, first_name, last_name, gender)
  VALUES (v_org, 'Sem', 'Data', 'female') RETURNING id INTO v_nobody;

  -- QA 1 — the band is birth year and gender.
  IF NOT federation_age_group_admits('female', 2011::smallint, 2012::smallint, DATE '2012-05-01', 'female')
     OR federation_age_group_admits('male', 2010::smallint, 2011::smallint, DATE '2012-05-01', 'male') THEN
    RAISE EXCEPTION 'FAIL test 1: a girl born 2012 is Juvenis and a boy born 2012 is not';
  END IF;
  IF federation_age_group_admits(NULL, NULL, NULL, NULL, 'female') THEN
    RAISE EXCEPTION 'FAIL test 1b: no birth date was admitted to an open band';
  END IF;
  RAISE NOTICE 'PASS test 1: the band is birth year and gender, and no birth date fits nothing';

  INSERT INTO qualifying_standard (organization_id, season_id, name)
  VALUES (v_org, v_season, 'Nacionais de Juvenis') RETURNING id INTO v_std;
  INSERT INTO qualifying_time (organization_id, season_id, standard_id, age_group_id, stroke, distance_m, course, time_ms)
  VALUES (v_org, v_season, v_std, v_girls, 'freestyle', 100, 'lcm', 65000),
         (v_org, v_season, v_std, v_girls, 'backstroke', 100, 'lcm', 72000);

  -- The composite key: an age group from last season under this season's standard.
  BEGIN
    INSERT INTO qualifying_time (organization_id, season_id, standard_id, age_group_id, stroke, distance_m, course, time_ms)
    VALUES (v_org, v_season, v_std, v_old_group, 'freestyle', 50, 'lcm', 30000);
    RAISE EXCEPTION 'FAIL test 7: last season''s band was accepted under this season''s standard';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS test 7: a time''s band and standard share one season';
  END;

  INSERT INTO swim_meet (organization_id, name, course, starts_on, ends_on, official)
  VALUES (v_org, 'Regional de Inverno', 'lcm', DATE '2026-12-05', DATE '2026-12-06', true)
  RETURNING id INTO v_official;
  INSERT INTO swim_meet (organization_id, name, course, starts_on, ends_on, official)
  VALUES (v_org, 'Convívio', 'lcm', DATE '2027-01-10', DATE '2027-01-10', false)
  RETURNING id INTO v_friendly;

  -- An official 1:04.20 in 50 m; a faster friendly; a faster typed time; a faster 25 m time.
  INSERT INTO student_record (organization_id, student_id, stroke, distance_m, course, time_ms, swum_on, meet_id)
  VALUES (v_org, v_ana, 'freestyle', 100, 'lcm', 64200, DATE '2026-12-05', v_official),
         (v_org, v_ana, 'freestyle', 100, 'lcm', 63000, DATE '2027-01-10', v_friendly),
         (v_org, v_ana, 'freestyle', 100, 'scm', 61000, DATE '2026-12-05', v_official),
         (v_org, v_ana, 'backstroke', 100, 'scm', 70000, DATE '2026-12-05', v_official);
  INSERT INTO student_record (organization_id, student_id, stroke, distance_m, course, time_ms, swum_on)
  VALUES (v_org, v_ana, 'freestyle', 100, 'lcm', 62000, DATE '2027-01-11');

  -- QA 2 and 4 — the official 50 m time is the one read.
  SELECT * INTO v_row FROM qualifying_gaps(v_std, v_ana) WHERE stroke = 'freestyle';
  IF v_row.best_ms IS DISTINCT FROM 64200 OR v_row.entry_ms <> 65000 OR v_row.best_meet <> 'Regional de Inverno' THEN
    RAISE EXCEPTION 'FAIL test 2: expected the official 64200 against 65000, got % against %', v_row.best_ms, v_row.entry_ms;
  END IF;
  RAISE NOTICE 'PASS test 2/4: the gap reads the official same-course best, not a friendly or a typed time';

  -- QA 3 — a 25 m time is never a 50 m time.
  SELECT * INTO v_row FROM qualifying_gaps(v_std, v_ana) WHERE stroke = 'backstroke';
  IF v_row.best_ms IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 3: a 25 m backstroke was compared with a 50 m entry time';
  END IF;
  RAISE NOTICE 'PASS test 3: no valid time in the other course, and nothing converted';

  -- QA 1 again, through the function: Rui is not Juvenis this season.
  SELECT count(*) INTO v_count FROM qualifying_gaps(v_std, v_rui);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL test 1c: a boy born 2012 was given the girls'' Juvenis times';
  END IF;

  -- QA 6 — no birth date, no rows.
  SELECT count(*) INTO v_count FROM qualifying_gaps(v_std, v_nobody);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL test 6: a swimmer with no birth date was placed in a band';
  END IF;
  RAISE NOTICE 'PASS test 6: no birth date, no band, no rows';

  -- QA 5 — a window that starts after the official swim leaves no valid time.
  INSERT INTO qualifying_standard (organization_id, season_id, name, window_from)
  VALUES (v_org, v_season, 'Nacionais de Verão', DATE '2027-01-01') RETURNING id INTO v_windowed;
  INSERT INTO qualifying_time (organization_id, season_id, standard_id, age_group_id, stroke, distance_m, course, time_ms)
  VALUES (v_org, v_season, v_windowed, v_girls, 'freestyle', 100, 'lcm', 65000);
  SELECT * INTO v_row FROM qualifying_gaps(v_windowed, v_ana);
  IF v_row.best_ms IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 5: a time before the window counted';
  END IF;
  RAISE NOTICE 'PASS test 5: the window decides which swims count';

  -- An archived meet takes its results out of the gap.
  UPDATE swim_meet SET archived_at = now() WHERE id = v_official;
  SELECT * INTO v_row FROM qualifying_gaps(v_std, v_ana) WHERE stroke = 'freestyle';
  IF v_row.best_ms IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 8: an archived meet''s result still qualified';
  END IF;
  RAISE NOTICE 'PASS test 8: an archived meet no longer qualifies anybody';

  -- POOLSE-115 — a time can make the entry without being the best, and the
  -- printed meet marks it. Two official swims under 1:05.00: the gap reads the
  -- faster, and both are attempts that made it.
  INSERT INTO swim_meet (organization_id, name, course, starts_on, ends_on, official)
  VALUES (v_org, 'Torneio de Fevereiro', 'lcm', DATE '2027-02-01', DATE '2027-02-01', true)
  RETURNING id INTO v_official;
  INSERT INTO student_record (organization_id, student_id, stroke, distance_m, course, time_ms, swum_on, meet_id)
  VALUES (v_org, v_ana, 'freestyle', 100, 'lcm', 64800, DATE '2027-02-01', v_official);
  INSERT INTO swim_meet (organization_id, name, course, starts_on, ends_on, official)
  VALUES (v_org, 'Torneio de Março', 'lcm', DATE '2027-03-01', DATE '2027-03-01', true)
  RETURNING id INTO v_friendly;
  INSERT INTO student_record (organization_id, student_id, stroke, distance_m, course, time_ms, swum_on, meet_id)
  VALUES (v_org, v_ana, 'freestyle', 100, 'lcm', 64500, DATE '2027-03-01', v_friendly);

  SELECT count(*) INTO v_count FROM qualifying_attempts(v_std, v_ana) a
   WHERE a.stroke = 'freestyle' AND a.time_ms <= a.entry_ms;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL test 9: expected two attempts under the entry time, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM qualifying_gaps(v_std, v_ana);
  SELECT * INTO v_row FROM qualifying_gaps(v_std, v_ana) WHERE stroke = 'freestyle';
  IF v_count <> 2 OR v_row.best_ms IS DISTINCT FROM 64500 OR v_row.best_meet <> 'Torneio de Março' THEN
    RAISE EXCEPTION 'FAIL test 9b: the gap is not one row per entry with the fastest attempt (% rows, best %)',
      v_count, v_row.best_ms;
  END IF;
  RAISE NOTICE 'PASS test 9: every valid swim under the entry is an attempt; the gap keeps the fastest';
END $$;

ROLLBACK;
