-- The plan for one lesson — round 6, ticket 4.3.
--
-- A new tenant table with a policy nobody tests is a policy that may not work,
-- so test 3 is the one that earns its place: another club's plans must be
-- invisible, and a plan naming another club's turma must be refused by the
-- composite key rather than by anybody remembering to scope a query.
--
-- The other two cover what the schema carries on behalf of the API: one plan
-- per turma per date, and never a blank one.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_lp', 'lp@clube.pt', 'Rui', 'Fonseca', NULL, '2026-09-01 09:00:00+00');

INSERT INTO organization (id, name, slug) VALUES
  ('99999999-8888-4444-8888-999999999999', 'Clube Plano', 'clube-plano'),
  ('99999999-9999-4444-8888-999999999999', 'Clube Vizinho LP', 'clube-vizinho-lp');

DO $$
DECLARE v_org uuid; v_fac uuid; v_season uuid; v_group uuid; v_member uuid;
BEGIN
  v_org := '99999999-8888-4444-8888-999999999999';

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Municipal')
  RETURNING id INTO v_fac;

  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_org, '2026/27', '2026-09-01', '2027-07-31', 'published')
  RETURNING id INTO v_season;

  INSERT INTO membership (organization_id, status, first_name, last_name, email)
  VALUES (v_org, 'active', 'Ana', 'Ribeiro', 'ana.lp@clube.pt')
  RETURNING id INTO v_member;

  INSERT INTO class_group (organization_id, facility_id, season_id, name, instructor_membership_id)
  VALUES (v_org, v_fac, v_season, 'Iniciados A', v_member)
  RETURNING id INTO v_group;

  -- Two Tuesdays of the same turma. The ordinary case this table exists for.
  INSERT INTO lesson_plan (organization_id, class_group_id, on_date, body, updated_by) VALUES
    (v_org, v_group, '2026-09-08', E'400 m aquecimento\n8 × 25 costas', v_member),
    (v_org, v_group, '2026-09-15', E'Viragens\nPernada com prancha', v_member);
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — one plan per turma per date
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_group uuid; v_member uuid; ok boolean := false;
BEGIN
  v_org := '99999999-8888-4444-8888-999999999999';
  SELECT id INTO v_group FROM class_group WHERE organization_id = v_org;
  SELECT id INTO v_member FROM membership WHERE organization_id = v_org;

  -- The failure this prevents is two people writing Tuesday's plan at once and
  -- the club ending up with two, one of which nobody ever reads again. The
  -- editor upserts; this is what makes the upsert a real guarantee.
  BEGIN
    INSERT INTO lesson_plan (organization_id, class_group_id, on_date, body, updated_by)
    VALUES (v_org, v_group, '2026-09-08', 'Outro plano', v_member);
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 1: one lesson took two plans';
  END IF;

  /*
   * And the index is partial, so clearing a plan frees the date.
   *
   * The API deletes rather than archives, but the column exists and a plain
   * unique constraint would make an archived row block the next season's
   * Tuesday — the rule CLAUDE.md states for every soft-deletable table.
   */
  UPDATE lesson_plan SET archived_at = now()
   WHERE organization_id = v_org AND on_date = '2026-09-08';

  INSERT INTO lesson_plan (organization_id, class_group_id, on_date, body, updated_by)
  VALUES (v_org, v_group, '2026-09-08', 'O plano novo', v_member);

  RAISE NOTICE 'PASS test 1: one plan per lesson, and archiving one frees the day';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — a blank plan is not a plan
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_group uuid; v_member uuid; ok boolean := false;
BEGIN
  v_org := '99999999-8888-4444-8888-999999999999';
  SELECT id INTO v_group FROM class_group WHERE organization_id = v_org;
  SELECT id INTO v_member FROM membership WHERE organization_id = v_org;

  -- Clearing the box means "there is no plan", and the API removes the row. A
  -- row of whitespace would be a plan that exists, shows as written, and says
  -- nothing — which is worse than none, because a colleague would stop looking.
  BEGIN
    INSERT INTO lesson_plan (organization_id, class_group_id, on_date, body, updated_by)
    VALUES (v_org, v_group, '2026-09-22', '   ', v_member);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 2: a plan of spaces was accepted';
  END IF;

  RAISE NOTICE 'PASS test 2: a blank plan is refused';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — the tenant boundary
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_other uuid; v_group uuid;
  v_other_fac uuid; v_other_season uuid; v_other_group uuid; v_other_member uuid;
  v_seen integer; ok boolean := false;
BEGIN
  v_org := '99999999-8888-4444-8888-999999999999';
  v_other := '99999999-9999-4444-8888-999999999999';

  SELECT id INTO v_group FROM class_group WHERE organization_id = v_org;

  INSERT INTO facility (organization_id, name) VALUES (v_other, 'Piscina Vizinha')
  RETURNING id INTO v_other_fac;
  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_other, '2026/27', '2026-09-01', '2027-07-31', 'published')
  RETURNING id INTO v_other_season;
  INSERT INTO membership (organization_id, status, first_name, last_name, email)
  VALUES (v_other, 'active', 'Bruno', 'Costa', 'bruno.lp@vizinho.pt')
  RETURNING id INTO v_other_member;
  INSERT INTO class_group (organization_id, facility_id, season_id, name)
  VALUES (v_other, v_other_fac, v_other_season, 'Adultos B')
  RETURNING id INTO v_other_group;

  -- The neighbour writing a plan against the first club's turma. The composite
  -- key is the only thing standing in the way, and it is enough — both rows pass
  -- their own policy, so RLS would never notice.
  BEGIN
    INSERT INTO lesson_plan (organization_id, class_group_id, on_date, body, updated_by)
    VALUES (v_other, v_group, '2026-09-08', 'Plano roubado', v_other_member);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 3: a club planned another club''s turma';
  END IF;

  -- An ordinary plan of their own is theirs alone.
  INSERT INTO lesson_plan (organization_id, class_group_id, on_date, body, updated_by)
  VALUES (v_other, v_other_group, '2026-09-08', 'O nosso plano', v_other_member);

  /*
   * `SET LOCAL ROLE poolse_app` before counting, and it is the whole point.
   *
   * This file runs as the owner, which bypasses row-level security — a count
   * taken without switching role sees every club's rows and would pass whatever
   * the policy said.
   */
  SET LOCAL ROLE poolse_app;
  PERFORM set_config('app.organization_id', v_other::text, true);
  SELECT count(*) INTO v_seen FROM lesson_plan;

  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'FAIL test 3b: scoped to one club, saw % rows instead of 1', v_seen;
  END IF;

  -- And no tenant at all sees nothing, rather than everything.
  PERFORM set_config('app.organization_id', '', true);
  SELECT count(*) INTO v_seen FROM lesson_plan;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'FAIL test 3c: no tenant set saw % rows instead of none', v_seen;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS test 3: a lesson plan stops at the tenant boundary';
END $$;

ROLLBACK;
