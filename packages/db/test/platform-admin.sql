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

ROLLBACK;
