-- The platform admin area, proved at the database — slice 1.
--
-- Two properties, and they point in opposite directions:
--
--   1. A tenant connection cannot see the platform's tables at all. Platform
--      administration is not a tenant role, so it must not be visible as one.
--   2. The platform connection CAN read across tenants — but only the seven
--      tables the overview needs, and only for reading.
--
-- The second is the one worth a test, because it is the one that can go wrong
-- quietly. A `FOR SELECT TO poolse_platform USING (true)` policy that was never
-- created leaves a screen that shows nothing, which reads as "no tenants yet";
-- a grant that went too far leaves a read-only area that can write.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- Two tenants, seeded as the owner
-- ---------------------------------------------------------------------------

INSERT INTO organization (id, name, slug) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Clube P', 'clube-p'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Clube Q', 'clube-q');

INSERT INTO facility (id, organization_id, name) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Sede P'),
  ('d1111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Sede Q');

INSERT INTO platform_admin (clerk_user_id, note) VALUES ('user_test_operator', 'Teste');

-- ---------------------------------------------------------------------------
-- Test 1 — the tenant connection cannot read the platform's tables
--
-- Two independent reasons it cannot: the grant was revoked, and RLS is on with
-- no policy naming poolse_app. Either alone would do; the assertion is that at
-- least one holds, which is what `insufficient_privilege` proves.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM platform_admin;
    RAISE EXCEPTION 'FAIL test 1a: the tenant role read platform_admin (% rows)', n;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 1a: platform_admin is refused to the tenant role';
  END;

  BEGIN
    SELECT count(*) INTO n FROM platform_audit_log;
    RAISE EXCEPTION 'FAIL test 1b: the tenant role read platform_audit_log (% rows)', n;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 1b: platform_audit_log is refused to the tenant role';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — and it still sees only its own tenant, exactly as before
--
-- The platform policies are `TO poolse_platform`, so they must be invisible from
-- here. A permissive policy written without the `TO` clause would open every
-- tenant's rows to every tenant, and this is the assertion that would catch it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM organization;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 2: the tenant role sees % organizations, not just its own', n;
  END IF;
  RAISE NOTICE 'PASS test 2: the platform policies are invisible to the tenant role';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 3 — the platform connection reads across tenants, with no GUC set
--
-- No `set_config('app.organization_id', …)` anywhere below. That is the point:
-- the platform role is admitted by a policy that reads no GUC, so an unscoped
-- query is the normal case here rather than the bug it is everywhere else.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_platform;
SELECT set_config('app.organization_id', '', true);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM organization
   WHERE id IN ('cccccccc-cccc-cccc-cccc-cccccccccccc',
                'dddddddd-dddd-dddd-dddd-dddddddddddd');
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 3a: the platform role sees % of the 2 seeded tenants', n;
  END IF;

  SELECT count(*) INTO n FROM facility
   WHERE id IN ('c1111111-1111-1111-1111-111111111111',
                'd1111111-1111-1111-1111-111111111111');
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 3b: the platform role sees % of the 2 seeded facilities', n;
  END IF;

  SELECT count(*) INTO n FROM platform_admin WHERE clerk_user_id = 'user_test_operator';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 3c: the platform role cannot read its own admin list';
  END IF;

  RAISE NOTICE 'PASS test 3: the platform role reads across tenants, unscoped';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — and no further than the seven tables it was granted
--
-- The reason this area does not use BYPASSRLS. A bypassing role would pass this
-- read and every other one in the schema, including the medical notes in
-- `student_sensitive`. Reach is an allowlist here, so widening it is a reviewed
-- line of SQL rather than a consequence of existing.
-- ---------------------------------------------------------------------------

DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM student;
    RAISE EXCEPTION 'FAIL test 4a: the platform role read the student register (% rows)', n;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 4a: the platform role cannot read a tenant''s students';
  END;

  BEGIN
    SELECT count(*) INTO n FROM student_sensitive;
    RAISE EXCEPTION 'FAIL test 4b: the platform role read student_sensitive (% rows)', n;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 4b: the platform role cannot read medical notes';
  END;

  BEGIN
    SELECT count(*) INTO n FROM invoice;
    RAISE EXCEPTION 'FAIL test 4c: the platform role read a tenant''s invoices (% rows)', n;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 4c: the platform role cannot read invoices';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — read-only means read-only
--
-- Nothing on the platform side writes into a tenant's data in slice 1, and the
-- grants say so. When extending a trial lands it will be a named function, not a
-- widened grant, and this assertion is what forces that conversation.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  BEGIN
    UPDATE organization SET name = 'Apropriado' WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    RAISE EXCEPTION 'FAIL test 5a: the platform role rewrote a tenant''s name';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 5a: the platform role cannot write to organization';
  END;

  /*
   * Still refused after slice 3 widened the grant, and that is the assertion
   * doing its job. The platform role gained UPDATE on six *named* columns; a
   * bare `GRANT UPDATE ON organization` would have been one word shorter and
   * would have handed over the name, the slug, the VAT number and archived_at
   * with them. This block never moved and it still passes.
   */
  BEGIN
    UPDATE organization SET archived_at = now()
     WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    RAISE EXCEPTION 'FAIL test 5c: the platform role deleted a tenant';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 5c: the platform role cannot archive a tenant';
  END;

  BEGIN
    DELETE FROM organization WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    RAISE EXCEPTION 'FAIL test 5d: the platform role deleted an organization row';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 5d: the platform role cannot DELETE an organization';
  END;

  BEGIN
    INSERT INTO organization (name, slug) VALUES ('Inventado', 'inventado');
    RAISE EXCEPTION 'FAIL test 5e: the platform role created an organization';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 5e: signup is still the only way a tenant comes into being';
  END;

  BEGIN
    INSERT INTO platform_admin (clerk_user_id) VALUES ('user_self_promoted');
    RAISE EXCEPTION 'FAIL test 5b: the platform role added itself an administrator';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 5b: the platform role cannot grant platform access';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — but it does write its own audit trail
--
-- The one table it inserts into, and the reason the interceptor can record a
-- read in the same transaction as the read itself.
-- ---------------------------------------------------------------------------

DO $$
DECLARE n int;
BEGIN
  INSERT INTO platform_audit_log (clerk_user_id, action, organization_id, detail)
  VALUES ('user_test_operator', 'tenants.listed', NULL, '{"search":"clube"}'::jsonb);

  SELECT count(*) INTO n FROM platform_audit_log WHERE action = 'tenants.listed';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 6a: the platform role could not record its own read';
  END IF;

  BEGIN
    UPDATE platform_audit_log SET action = 'nothing.happened';
    RAISE EXCEPTION 'FAIL test 6b: the platform role rewrote its own audit trail';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 6: the trail is append-only, even to the operator';
  END;
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 8 — request stats: the tenant writes, and cannot read
--
-- Deliberately asymmetric, and the asymmetry is the design. The interceptor runs
-- in the request path as poolse_app, so that role must be able to upsert its own
-- tenant's row — but no screen in the tenant app has any business showing a
-- club its own error rate, let alone anybody else's. So `WITH CHECK` admits the
-- current tenant and `USING` admits it too (the upsert's ON CONFLICT has to find
-- the row), while the only thing that can read across tenants is the operator.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

DO $$
DECLARE n int;
BEGIN
  INSERT INTO tenant_request_stats (
    organization_id, bucket, request_count, count_4xx, count_5xx, p95_latency_ms,
    last_request_at
  ) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', date_trunc('hour', now()),
            10, 1, 0, 42, now());

  -- The upsert the flush actually performs: counts add, p95 takes the larger.
  INSERT INTO tenant_request_stats (
    organization_id, bucket, request_count, count_4xx, count_5xx, p95_latency_ms,
    last_request_at
  ) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', date_trunc('hour', now()),
            5, 0, 2, 17, now())
  ON CONFLICT (organization_id, bucket) DO UPDATE SET
    request_count  = tenant_request_stats.request_count + excluded.request_count,
    count_5xx      = tenant_request_stats.count_5xx     + excluded.count_5xx,
    p95_latency_ms = greatest(tenant_request_stats.p95_latency_ms,
                              excluded.p95_latency_ms);

  SELECT request_count INTO n FROM tenant_request_stats
   WHERE organization_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  IF n <> 15 THEN
    RAISE EXCEPTION 'FAIL test 8a: the upsert made request_count %, not 15', n;
  END IF;

  SELECT p95_latency_ms INTO n FROM tenant_request_stats
   WHERE organization_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  IF n <> 42 THEN
    RAISE EXCEPTION 'FAIL test 8b: p95 merged to % rather than taking the larger', n;
  END IF;

  RAISE NOTICE 'PASS test 8: the tenant writes its own bucket, and the upsert merges';
END $$;

-- ---------------------------------------------------------------------------
-- Test 9 — and cannot reach another tenant's, in either direction
-- ---------------------------------------------------------------------------

DO $$
DECLARE n int;
BEGIN
  -- Reading across: the policy is keyed on the GUC, so this sees only its own.
  SELECT count(*) INTO n FROM tenant_request_stats;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 9a: a tenant sees % stat rows, not just its own', n;
  END IF;

  -- Writing across: refused by WITH CHECK, as everywhere else in the schema.
  BEGIN
    INSERT INTO tenant_request_stats (organization_id, bucket, last_request_at)
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', date_trunc('hour', now()), now());
    RAISE EXCEPTION 'FAIL test 9b: a tenant wrote stats against another tenant';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 9: a tenant cannot read or write another tenant''s stats';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Test 10 — an unscoped tenant connection reads nothing at all
--
-- The property the whole schema rests on, asserted for the newest table: a query
-- that forgets its scope returns nothing rather than everything.
-- ---------------------------------------------------------------------------

SELECT set_config('app.organization_id', '', true);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM tenant_request_stats;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 10: an unscoped connection read % stat rows', n;
  END IF;
  RAISE NOTICE 'PASS test 10: an unscoped tenant connection reads no stats';
END $$;

-- ---------------------------------------------------------------------------
-- Test 11 — the operator reads every tenant's, and writes none
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_platform;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM tenant_request_stats
   WHERE organization_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL test 11a: the operator cannot read a tenant''s stats';
  END IF;

  BEGIN
    UPDATE tenant_request_stats SET count_5xx = 0;
    RAISE EXCEPTION 'FAIL test 11b: the operator rewrote a tenant''s error count';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS test 11: the operator reads every tenant''s stats and writes none';
  END;
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 12 — the constraints that keep a bucket a bucket
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  BEGIN
    INSERT INTO tenant_request_stats (organization_id, bucket, last_request_at)
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', now(), now());
    RAISE EXCEPTION 'FAIL test 12a: an un-truncated bucket was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 500 characters, enforced by the column rather than by whichever code path
  -- wrote it. A Postgres error quoting the row that violated a constraint is the
  -- realistic way a student's name would reach this table.
  BEGIN
    INSERT INTO tenant_request_stats (
      organization_id, bucket, last_request_at, last_error_at, last_error_route,
      last_error_message
    ) VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', date_trunc('hour', now()),
              now(), now(), 'GET /x', repeat('x', 501));
    RAISE EXCEPTION 'FAIL test 12b: a 501-character error message was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- An error stamp with no route is half a fact.
  BEGIN
    INSERT INTO tenant_request_stats (
      organization_id, bucket, last_request_at, last_error_at
    ) VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', date_trunc('hour', now()),
              now(), now());
    RAISE EXCEPTION 'FAIL test 12c: an error with no route was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 12: a bucket is hourly, a message is bounded, an error names a route';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — the two columns the overview reports against
--
-- `comped` is the free pilot: a live tenant deliberately not billed, which is
-- neither `active` (it would look like revenue) nor `trialing` (it would look
-- like it was about to lapse).
--
-- `max_management_users` is null-means-unlimited, like every other ceiling in
-- this schema, and never zero — a quota of nought is a tenant nobody can log
-- into, which is a state no operator means to create.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_status text; v_max int;
BEGIN
  UPDATE organization SET subscription_status = 'comped', max_management_users = 25
   WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  SELECT subscription_status::text, max_management_users INTO v_status, v_max
    FROM organization WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  IF v_status <> 'comped' OR v_max <> 25 THEN
    RAISE EXCEPTION 'FAIL test 7a: the pilot tenant came back as % / %', v_status, v_max;
  END IF;

  SELECT max_management_users INTO v_max
    FROM organization WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  IF v_max IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 7b: an unstated quota defaulted to % instead of unlimited', v_max;
  END IF;

  BEGIN
    UPDATE organization SET max_management_users = 0
     WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    RAISE EXCEPTION 'FAIL test 7c: a quota of zero was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS test 7: comped is a status, and a quota is null or positive';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Test 13 — and the six columns it *may* write
--
-- The other half of test 5. Slice 3 gave the operator exactly the columns an
-- action changes; these are them, written from the platform connection with no
-- GUC set, which is the shape every platform statement has.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_platform;
SELECT set_config('app.organization_id', '', true);

DO $$
DECLARE v_status text; v_reason text;
BEGIN
  UPDATE organization
     SET subscription_status  = 'comped',
         trial_ends_at        = now() + interval '30 days',
         max_facilities       = 3,
         max_management_users = 25,
         suspended_at         = now(),
         suspension_reason    = 'Fatura por regularizar.'
   WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  SELECT subscription_status::text, suspension_reason INTO v_status, v_reason
    FROM organization WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  IF v_status <> 'comped' OR v_reason IS NULL THEN
    RAISE EXCEPTION 'FAIL test 13a: the six granted columns did not take (% / %)',
      v_status, v_reason;
  END IF;

  RAISE NOTICE 'PASS test 13: the operator may set a plan, a trial and a suspension';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 14 — a suspension is never half a fact
--
-- The pair moves together or not at all. The person who meets this is a club
-- owner at 08:00 being told their account is closed; "suspended" with no
-- sentence beneath it is a support call that starts from nothing.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  BEGIN
    UPDATE organization SET suspended_at = now(), suspension_reason = NULL
     WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    RAISE EXCEPTION 'FAIL test 14a: a suspension with no reason was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE organization SET suspended_at = NULL, suspension_reason = 'órfã'
     WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    RAISE EXCEPTION 'FAIL test 14b: a reason with no suspension was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE organization SET suspended_at = now(), suspension_reason = '   '
     WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    RAISE EXCEPTION 'FAIL test 14c: a blank reason was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE organization SET suspended_at = now(), suspension_reason = repeat('x', 501)
     WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    RAISE EXCEPTION 'FAIL test 14d: a 501-character reason was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS test 14: a suspension carries a sentence, and a sentence needs a suspension';
END $$;

-- ---------------------------------------------------------------------------
-- Test 15 — suspension is not a subscription status
--
-- The two most tempting things to conflate here and the most expensive. A club
-- whose card expired on Tuesday is past due; it is also mid-lesson with thirty
-- children in the water. Both columns exist and only one of them shuts a door.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_suspended timestamptz;
BEGIN
  UPDATE organization SET subscription_status = 'past_due'
   WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  SELECT suspended_at INTO v_suspended
    FROM organization WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  IF v_suspended IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 15: past_due closed the tenant''s door';
  END IF;

  RAISE NOTICE 'PASS test 15: billing state and access state are two facts';
END $$;

ROLLBACK;
