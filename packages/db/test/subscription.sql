-- The operator's subscription, proved at the database — slice 2.4.
--
-- Three properties, and the first is the one that would go wrong quietly:
--
--   1. **One customer is one organization.** The webhook resolves an event to a
--      club through `stripe_customer_id`; a duplicate would apply somebody's
--      payment to somebody else's club, and nothing on any screen would say so.
--   2. **A tenant cannot see or write the billing trail.** `stripe_event` is
--      the platform's book, like `platform_audit_log`.
--   3. **The platform role may write the billing columns and nothing else.** It
--      could already write `subscription_status`; what it must still not be able
--      to touch is the club's name. `billing_interval` joined the list with
--      POOLSE-60 and is asserted here with the rest.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Clube R', 'clube-r'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Clube S', 'clube-s');

-- ---------------------------------------------------------------------------
-- Test 1 — one Stripe customer belongs to one club
-- ---------------------------------------------------------------------------

DO $$
DECLARE ok boolean;
BEGIN
  UPDATE organization SET stripe_customer_id = 'cus_test_1'
   WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

  ok := false;
  BEGIN
    UPDATE organization SET stripe_customer_id = 'cus_test_1'
     WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 1a: two clubs shared one Stripe customer';
  END IF;

  -- And null is not a value: most clubs have never subscribed, and a plain
  -- unique constraint would let exactly one of them be so.
  UPDATE organization SET stripe_customer_id = NULL
   WHERE id IN ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'ffffffff-ffff-ffff-ffff-ffffffffffff');

  RAISE NOTICE 'PASS test 1: one customer is one club, and no customer is not a clash';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — the billing trail is not a tenant's to read or write
-- ---------------------------------------------------------------------------

INSERT INTO stripe_event (id, type, organization_id)
VALUES ('evt_test_1', 'customer.subscription.updated', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true);

DO $$
DECLARE n integer; ok boolean;
BEGIN
  ok := false;
  BEGIN
    SELECT count(*) INTO n FROM stripe_event;
    -- A revoked SELECT raises; a policy that matches nothing returns 0. Either
    -- is a pass, and both are asserted because they are independent.
    IF n <> 0 THEN
      RAISE EXCEPTION 'FAIL test 2a: a tenant read % billing events', n;
    END IF;
    ok := true;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2a: a tenant read the billing trail'; END IF;

  ok := false;
  BEGIN
    INSERT INTO stripe_event (id, type) VALUES ('evt_forged', 'invoice.paid');
  EXCEPTION WHEN insufficient_privilege OR generated_always THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2b: a tenant wrote a billing event'; END IF;

  RAISE NOTICE 'PASS test 2: the billing trail is the platform''s book, not a tenant''s';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 3 — an event id is applied once, however many times it is delivered
-- ---------------------------------------------------------------------------

DO $$
DECLARE ok boolean;
BEGIN
  ok := false;
  BEGIN
    INSERT INTO stripe_event (id, type) VALUES ('evt_test_1', 'customer.subscription.updated');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 3: the same delivery was recorded twice — a retry would double-apply';
  END IF;

  RAISE NOTICE 'PASS test 3: a redelivered event cannot be applied a second time';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — the platform role writes billing state and nothing else
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_platform;

DO $$
DECLARE v_name text; ok boolean;
BEGIN
  UPDATE organization
     SET plan = 'poolse_full',
         billing_interval = 'yearly',
         subscription_status = 'active',
         stripe_customer_id = 'cus_test_2',
         stripe_subscription_id = 'sub_test_2',
         subscription_current_period_end = now() + interval '30 days',
         subscription_cancel_at_period_end = false
   WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

  -- It writes its own book in the same breath, which is what makes the change
  -- accountable: there is no path to these columns that leaves no entry.
  INSERT INTO stripe_event (id, type, organization_id, changed)
  VALUES ('evt_test_2', 'customer.subscription.updated',
          'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '{"plan": {"after": "poolse_full"}}'::jsonb);

  ok := false;
  BEGIN
    UPDATE organization SET name = 'Clube Roubado'
     WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 4a: the platform role renamed a club';
  END IF;

  -- And it still cannot delete a tenant, which slice 3 settled and this slice
  -- must not have widened by adding columns to the same grant.
  ok := false;
  BEGIN
    DELETE FROM organization WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4b: the platform role deleted a tenant'; END IF;

  SELECT name INTO v_name FROM organization WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  IF v_name <> 'Clube R' THEN RAISE EXCEPTION 'FAIL test 4c: the name moved'; END IF;

  RAISE NOTICE 'PASS test 4: the platform role moves billing state and cannot touch the club';
END $$;

RESET ROLE;

ROLLBACK;
