-- Subscriptions paid outside Stripe, proved at the database — POOLSE-63.
--
-- Four properties, and the first is the one this slice exists for:
--
--   1. **A manual subscription cannot be forgotten.** An active one without an
--      end date is refused by the schema, so the failure mode the ticket names —
--      flip a club to active, forget, they run free for two years — is not a
--      thing an operator can do by hand or by mistake.
--   2. **`manual_payment` is insert-only.** A record that can be edited is not a
--      record; the enforcement is a missing privilege, because application code
--      cannot forget one.
--   3. **It is the platform's book, not a tenant's.** A club cannot read what it
--      or anybody else paid Poolse.
--   4. **The grant widened by exactly two columns.** `billing_mode` and
--      `paid_through` joined it; the club's name and the DELETE that was refused
--      before are refused still.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('11111111-2222-3333-4444-555555555555', 'Clube Manual', 'clube-manual'),
  ('66666666-7777-8888-9999-aaaaaaaaaaaa', 'Clube Stripe', 'clube-stripe');

-- ---------------------------------------------------------------------------
-- Test 1 — an active manual subscription must say what it is paid up to
-- ---------------------------------------------------------------------------

DO $$
DECLARE ok boolean;
BEGIN
  ok := false;
  BEGIN
    UPDATE organization
       SET billing_mode = 'manual', subscription_status = 'active', paid_through = NULL
     WHERE id = '11111111-2222-3333-4444-555555555555';
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 1a: a manual club is active for ever with no end date';
  END IF;

  -- With a date it is ordinary.
  UPDATE organization
     SET billing_mode = 'manual',
         subscription_status = 'active',
         paid_through = current_date + 30
   WHERE id = '11111111-2222-3333-4444-555555555555';

  /*
   * And a *lapsed* manual club with no date is allowed, which is the half that
   * makes the constraint usable: the CHECK binds only an active subscription, so
   * a club marked manual before the first money arrives is a real state.
   */
  UPDATE organization
     SET subscription_status = 'past_due', paid_through = NULL
   WHERE id = '11111111-2222-3333-4444-555555555555';

  -- Put it back where the rest of the file expects it.
  UPDATE organization
     SET subscription_status = 'active', paid_through = current_date + 30
   WHERE id = '11111111-2222-3333-4444-555555555555';

  RAISE NOTICE 'PASS test 1: an active manual subscription cannot be open-ended';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — a payment is written once and never edited
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_platform;

DO $$
DECLARE ok boolean; v_count int;
BEGIN
  INSERT INTO manual_payment (
    organization_id, amount_cents, received_on, method, covers_from, covers_to,
    note, recorded_by_clerk_user_id
  ) VALUES (
    '11111111-2222-3333-4444-555555555555', 12000, current_date, 'bank_transfer',
    current_date, current_date + 30, 'Transferência de outubro', 'user_operator'
  );

  ok := false;
  BEGIN
    UPDATE manual_payment SET amount_cents = 1
     WHERE organization_id = '11111111-2222-3333-4444-555555555555';
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2a: a recorded payment was edited'; END IF;

  ok := false;
  BEGIN
    DELETE FROM manual_payment
     WHERE organization_id = '11111111-2222-3333-4444-555555555555';
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2b: a recorded payment was deleted'; END IF;

  -- A payment of nothing is not a payment; it would move paid_through on the
  -- strength of no money.
  ok := false;
  BEGIN
    INSERT INTO manual_payment (
      organization_id, amount_cents, received_on, method, covers_to,
      recorded_by_clerk_user_id
    ) VALUES (
      '11111111-2222-3333-4444-555555555555', 0, current_date, 'cash',
      current_date + 30, 'user_operator'
    );
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2c: a payment of zero was recorded'; END IF;

  -- A period that ends before it starts is a typo, not a payment.
  ok := false;
  BEGIN
    INSERT INTO manual_payment (
      organization_id, amount_cents, received_on, method, covers_from, covers_to,
      recorded_by_clerk_user_id
    ) VALUES (
      '11111111-2222-3333-4444-555555555555', 100, current_date, 'cash',
      current_date + 30, current_date, 'user_operator'
    );
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2d: a payment covered a reversed period'; END IF;

  SELECT count(*) INTO v_count FROM manual_payment
   WHERE organization_id = '11111111-2222-3333-4444-555555555555';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL test 2e: expected exactly one payment, found %', v_count;
  END IF;

  RAISE NOTICE 'PASS test 2: a payment is insert-only, positive and ordered';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 3 — what a club paid Poolse is not the club's to read
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', '11111111-2222-3333-4444-555555555555', true);

DO $$
DECLARE ok boolean;
BEGIN
  ok := false;
  BEGIN
    PERFORM 1 FROM manual_payment;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 3a: a tenant connection read the operator''s revenue';
  END IF;

  ok := false;
  BEGIN
    INSERT INTO manual_payment (
      organization_id, amount_cents, received_on, method, covers_to,
      recorded_by_clerk_user_id
    ) VALUES (
      '11111111-2222-3333-4444-555555555555', 1, current_date, 'cash',
      current_date, 'user_forged'
    );
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 3b: a tenant connection recorded a payment to itself';
  END IF;

  RAISE NOTICE 'PASS test 3: the operator''s revenue is invisible to every club';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 4 — the grant widened by exactly two columns
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_platform;

DO $$
DECLARE ok boolean; v_name text;
BEGIN
  -- The two this slice added.
  UPDATE organization
     SET billing_mode = 'comped'
   WHERE id = '66666666-7777-8888-9999-aaaaaaaaaaaa';

  UPDATE organization
     SET paid_through = current_date + 60
   WHERE id = '11111111-2222-3333-4444-555555555555';

  -- And nothing else moved with them. The assertion slice 3 made, unchanged.
  ok := false;
  BEGIN
    UPDATE organization SET name = 'Clube Roubado'
     WHERE id = '11111111-2222-3333-4444-555555555555';
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4a: the platform role renamed a club'; END IF;

  ok := false;
  BEGIN
    DELETE FROM organization WHERE id = '66666666-7777-8888-9999-aaaaaaaaaaaa';
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4b: the platform role deleted a tenant'; END IF;

  SELECT name INTO v_name FROM organization
   WHERE id = '11111111-2222-3333-4444-555555555555';
  IF v_name <> 'Clube Manual' THEN RAISE EXCEPTION 'FAIL test 4c: the name moved'; END IF;

  RAISE NOTICE 'PASS test 4: billing mode and paid-through are writable, the club is not';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 5 — the grace period has one definition
-- ---------------------------------------------------------------------------
--
-- Beside `trial_period()` and the two that follow it. The clock reads it rather
-- than holding its own literal, so this assertion is what stops the number being
-- changed in one place and not the other.

DO $$
DECLARE v_grace interval;
BEGIN
  SELECT manual_grace_period() INTO v_grace;
  IF v_grace <> interval '15 days' THEN
    RAISE EXCEPTION 'FAIL test 5: the manual grace period is %, not 15 days', v_grace;
  END IF;

  RAISE NOTICE 'PASS test 5: the grace a late club gets is defined once, in SQL';
END $$;

ROLLBACK;
