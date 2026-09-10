-- Planned maintenance — slice 4.3.
--
-- Three things here are worth asserting rather than trusting.
--
-- **A task is about one thing, and that thing is at this site.** The three
-- target columns are independent and optional so módulo 2 can grow into them,
-- and all three route through `facility_id` — MATCH SIMPLE, so a null target
-- skips its key entirely and a present one must satisfy it in full. A task at
-- one site naming a room at another must be impossible in the schema, not
-- merely unusual in the repository: RLS does not catch it, because both rows
-- pass their own policies.
--
-- **`interval_days` is NOT NULL and positive.** It is the boundary with
-- `maintenance_request`: a job with no cadence is a request, and that table
-- already does it well. A zero interval would mean permanently overdue, which
-- nobody types on purpose.
--
-- **A completion outlives nothing.** The reference to its task is not cascaded,
-- deliberately: only a teardown genuinely deletes a task, and a cascade would be
-- a path by which a mistyped delete quietly took a year of compliance history
-- with it.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_mt', 'mt@clube.pt', 'Rui', 'Fonseca', NULL, '2026-09-10 09:00:00+00');

-- Fixed ids: the RLS test runs as `poolse_app`, where a lookup by name returns
-- nothing and a null id would let an assertion pass for the wrong reason.
INSERT INTO organization (id, name, slug) VALUES
  ('77777777-7777-7777-7777-777777777777', 'Clube Manutenção', 'clube-manutencao'),
  ('88888888-8888-8888-8888-888888888888', 'Clube Vizinho M',  'clube-vizinho-m');

-- This fixture states its own plan: a subscription covers one facility and
-- `facility_licence` enforces it. Nothing below is about billing, and two sites
-- are exactly what the composite-key test needs.
UPDATE organization SET max_facilities = 20;

INSERT INTO facility (id, organization_id, name) VALUES
  ('71111111-1111-1111-1111-111111111111', '77777777-7777-7777-7777-777777777777', 'Piscina Municipal'),
  ('72222222-2222-2222-2222-222222222222', '77777777-7777-7777-7777-777777777777', 'Piscina do Bairro'),
  ('81111111-1111-1111-1111-111111111111', '88888888-8888-8888-8888-888888888888', 'Sede Vizinha');

INSERT INTO space (id, organization_id, facility_id, name, type) VALUES
  ('73333333-3333-3333-3333-333333333331', '77777777-7777-7777-7777-777777777777',
   '71111111-1111-1111-1111-111111111111', 'Sala de máquinas', 'technical'),
  ('73333333-3333-3333-3333-333333333332', '77777777-7777-7777-7777-777777777777',
   '72222222-2222-2222-2222-222222222222', 'Sala do outro sítio', 'technical');

-- ---------------------------------------------------------------------------
-- Test 1 — a task, its target, and the cadence it must carry
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := '77777777-7777-7777-7777-777777777777';
  v_fac uuid := '71111111-1111-1111-1111-111111111111';
  v_task uuid;
  n int;
BEGIN
  -- About a room.
  INSERT INTO maintenance_task (organization_id, facility_id, space_id, title, interval_days)
  VALUES (v_org, v_fac, '73333333-3333-3333-3333-333333333331', 'Contralavagem', 7)
  RETURNING id INTO v_task;

  -- About nothing in particular, which is legitimate: "test the emergency
  -- lighting" belongs to the site rather than to any one room.
  INSERT INTO maintenance_task (organization_id, facility_id, title, interval_days)
  VALUES (v_org, v_fac, 'Luzes de emergência', 30);

  SELECT count(*) INTO n FROM maintenance_task WHERE facility_id = v_fac;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 1a: expected two tasks, found %', n;
  END IF;

  BEGIN
    INSERT INTO maintenance_task (organization_id, facility_id, title, interval_days)
    VALUES (v_org, v_fac, 'Sem periodicidade', 0);
    RAISE EXCEPTION 'FAIL test 1b: a zero-day interval was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO maintenance_task (organization_id, facility_id, title, interval_days)
    VALUES (v_org, v_fac, '   ', 7);
    RAISE EXCEPTION 'FAIL test 1c: a blank title was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- A job with no cadence is a request, and that table exists. The column is
  -- NOT NULL so the two cannot be confused.
  BEGIN
    INSERT INTO maintenance_task (organization_id, facility_id, title, interval_days)
    VALUES (v_org, v_fac, 'Uma vez só', NULL);
    RAISE EXCEPTION 'FAIL test 1d: a task with no cadence was accepted';
  EXCEPTION WHEN not_null_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 1: a task carries a title and a real cadence, and may name nothing';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — the target is at this site, and the composite key is what says so
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := '77777777-7777-7777-7777-777777777777';
  v_fac uuid := '71111111-1111-1111-1111-111111111111';
BEGIN
  -- A room at the club's *other* site. Same tenant, so RLS is perfectly happy;
  -- only the key through `facility_id` refuses it.
  BEGIN
    INSERT INTO maintenance_task (organization_id, facility_id, space_id, title, interval_days)
    VALUES (v_org, v_fac, '73333333-3333-3333-3333-333333333332', 'Sala de outro sítio', 30);
    RAISE EXCEPTION 'FAIL test 2: a task named a room at another site';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 2: a target has to be at the site the task belongs to';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — completions, and the reference that is deliberately not cascaded
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := '77777777-7777-7777-7777-777777777777';
  v_task uuid;
  v_member uuid;
  n int;
BEGIN
  SELECT id INTO v_task FROM maintenance_task WHERE title = 'Contralavagem';

  -- The person who did the work, with no login: the ordinary case for club
  -- staff, and the one an inner join to `app_user` would drop.
  INSERT INTO membership (organization_id, status, first_name, last_name, email)
  VALUES (v_org, 'active', 'Sandra', 'Maia', 'sandra.mt@clube.pt')
  RETURNING id INTO v_member;

  INSERT INTO maintenance_task_completion
    (organization_id, task_id, performed_at, performed_by, note)
  VALUES (v_org, v_task, now() - interval '3 days', v_member, 'Pressão normal'),
         (v_org, v_task, now() - interval '10 days', v_member, NULL);

  SELECT count(*) INTO n FROM maintenance_task_completion WHERE task_id = v_task;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 3a: expected two completions, found %', n;
  END IF;

  -- Not cascaded. Only a teardown genuinely deletes a task, and a cascade would
  -- be a path by which a mistyped delete took the history with it.
  BEGIN
    DELETE FROM maintenance_task WHERE id = v_task;
    RAISE EXCEPTION 'FAIL test 3b: deleting a task took its history with it';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  -- A blank note is not a note.
  BEGIN
    INSERT INTO maintenance_task_completion (organization_id, task_id, performed_by, note)
    VALUES (v_org, v_task, v_member, '  ');
    RAISE EXCEPTION 'FAIL test 3c: a blank note was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  RAISE NOTICE 'PASS test 3: completions hang off their task and do not die with it';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — the due rule, in SQL, against real rows
--
-- The same four ordered branches `maintenance.repository.ts` uses. Asserted here
-- as well as in the integration tests because this is the rule the whole feature
-- is, and a fixture with rows in it is the cheapest place to pin the boundary
-- between "done three days ago on a seven-day interval" and "ten days ago".
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := '77777777-7777-7777-7777-777777777777';
  v_fac uuid := '71111111-1111-1111-1111-111111111111';
  v_never uuid; v_paused uuid; v_task uuid;
  v_state text;
BEGIN
  SELECT id INTO v_task FROM maintenance_task WHERE title = 'Contralavagem';
  SELECT id INTO v_never FROM maintenance_task WHERE title = 'Luzes de emergência';

  INSERT INTO maintenance_task (organization_id, facility_id, title, interval_days, active)
  VALUES (v_org, v_fac, 'Suspensa', 1, false)
  RETURNING id INTO v_paused;

  -- Done three days ago on a seven-day interval: on schedule.
  SELECT CASE
           WHEN NOT t.active THEN 'paused'
           WHEN c.last_done_at IS NULL THEN 'due'
           WHEN now() - c.last_done_at > make_interval(days => t.interval_days) THEN 'due'
           ELSE 'scheduled'
         END
    INTO v_state
    FROM maintenance_task t
    LEFT JOIN LATERAL (
      SELECT max(tc.performed_at) AS last_done_at
        FROM maintenance_task_completion tc
       WHERE tc.task_id = t.id AND tc.archived_at IS NULL
    ) c ON true
   WHERE t.id = v_task;

  IF v_state <> 'scheduled' THEN
    RAISE EXCEPTION 'FAIL test 4a: three days into a seven-day interval read as %', v_state;
  END IF;

  -- Never done: due. An absence of history is not evidence that the work
  -- happened, and treating it as fine would hide what this exists to surface.
  SELECT CASE
           WHEN NOT t.active THEN 'paused'
           WHEN c.last_done_at IS NULL THEN 'due'
           ELSE 'scheduled'
         END
    INTO v_state
    FROM maintenance_task t
    LEFT JOIN LATERAL (
      SELECT max(tc.performed_at) AS last_done_at
        FROM maintenance_task_completion tc
       WHERE tc.task_id = t.id AND tc.archived_at IS NULL
    ) c ON true
   WHERE t.id = v_never;

  IF v_state <> 'due' THEN
    RAISE EXCEPTION 'FAIL test 4b: a task nobody has ever done read as %', v_state;
  END IF;

  -- Archiving the recent completion puts the task back to due: a deleted
  -- completion did not happen.
  UPDATE maintenance_task_completion SET archived_at = now()
   WHERE task_id = v_task AND performed_at > now() - interval '5 days';

  SELECT CASE
           WHEN now() - c.last_done_at > make_interval(days => t.interval_days) THEN 'due'
           ELSE 'scheduled'
         END
    INTO v_state
    FROM maintenance_task t
    LEFT JOIN LATERAL (
      SELECT max(tc.performed_at) AS last_done_at
        FROM maintenance_task_completion tc
       WHERE tc.task_id = t.id AND tc.archived_at IS NULL
    ) c ON true
   WHERE t.id = v_task;

  IF v_state <> 'due' THEN
    RAISE EXCEPTION 'FAIL test 4c: removing the recent completion left the task %', v_state;
  END IF;

  RAISE NOTICE 'PASS test 4: never done is due, a deleted completion did not happen';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — tasks and their history are the tenant's own
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_a uuid := '77777777-7777-7777-7777-777777777777';
  v_b uuid := '88888888-8888-8888-8888-888888888888';
  n int;
BEGIN
  PERFORM set_config('app.organization_id', v_b::text, true);

  SELECT count(*) INTO n FROM maintenance_task WHERE organization_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 5a: the neighbouring club could read % of our tasks', n;
  END IF;

  SELECT count(*) INTO n FROM maintenance_task_completion WHERE organization_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 5b: the neighbouring club could read % of our history', n;
  END IF;

  PERFORM set_config('app.organization_id', v_a::text, true);

  SELECT count(*) INTO n FROM maintenance_task WHERE organization_id = v_a;
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL test 5c: our own tasks were not visible to us';
  END IF;

  RAISE NOTICE 'PASS test 5: tasks and completions are visible only to their own tenant';
END $$;

RESET ROLE;

ROLLBACK;
