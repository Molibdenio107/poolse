-- Settlement and chasing — phase 2.3.
--
-- Two of these are the reason the file exists.
--
-- **Test 3** is the status precedence, and it is the one to keep if the file is
-- ever cut down. A partly paid document that is past its due date is still
-- overdue — half of nothing arriving on time is still late — and a credited
-- document is owed by nobody whatever was paid against it. Both are the kind of
-- rule that gets "simplified" into the wrong order by somebody reading the
-- CASE from the bottom.
--
-- **Test 4** is the credit note that cannot be paid. Money entered against one
-- is money entered against the wrong document, and there are two ways in — the
-- document page today, and whatever reconciles a bank feed in 2.4 — so the rule
-- lives here rather than in a screen.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_stl', 'stl@clube.pt', 'Rui', 'Fonseca', NULL, '2026-09-01 09:00:00+00');

INSERT INTO organization (id, name, slug) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Clube Cobranças', 'clube-cobrancas'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Clube Rival',      'clube-rival-s');

INSERT INTO facility (id, organization_id, name) VALUES
  ('e1111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Piscina Municipal'),
  ('f1111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Sede Rival');

-- ---------------------------------------------------------------------------
-- Two documents to settle: one due in the future, one already late
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  v_fac uuid := 'e1111111-1111-1111-1111-111111111111';
  v_series uuid; v_level uuid; v_period uuid; v_plan uuid; v_student uuid;
  v_fee uuid;
BEGIN
  SELECT id INTO v_series FROM invoice_series
   WHERE facility_id = v_fac AND kind = 'invoice';

  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_org, 'Iniciação', 1) RETURNING id INTO v_level;

  INSERT INTO fee_period (organization_id, facility_id, name, months, is_default, sort_order)
  VALUES (v_org, v_fac, 'Mensal', 1, true, 1) RETURNING id INTO v_period;

  INSERT INTO fee_plan (organization_id, facility_id, kind, level_id, lessons_per_week,
                        amount_cents, vat_exempt)
  VALUES (v_org, v_fac, 'mensalidade', v_level, 2, 4500, true) RETURNING id INTO v_plan;

  INSERT INTO student (id, organization_id, first_name, last_name, birth_date)
  VALUES ('e2222222-2222-2222-2222-222222222221', v_org, 'Carlos', 'Nunes', DATE '1968-01-20');
  v_student := 'e2222222-2222-2222-2222-222222222221';

  INSERT INTO student_fee (id, organization_id, student_id, fee_plan_id, fee_period_id,
                           amount_cents, starts_on)
  VALUES ('e3333333-3333-3333-3333-333333333331', v_org, v_student, v_plan, v_period,
          4500, DATE '2026-09-01');
  v_fee := 'e3333333-3333-3333-3333-333333333331';

  /*
   * Both dated relative to `current_date` rather than to a fixed day.
   *
   * A fixture that pins "overdue" to a calendar date passes for three weeks a
   * month and fails for one, which is a fixture that cannot tell a regression
   * from a Tuesday — the lesson round 9 learned from the three date-dependent
   * fee tests.
   */
  -- `due_on >= issued_on` is a CHECK, so the late one is dated as a real late
  -- document is: issued five weeks ago and due ten days back.
  INSERT INTO invoice (id, organization_id, facility_id, series_id, issued_on, due_on,
                       payer_student_id, payer_name)
  VALUES ('e4444444-4444-4444-4444-444444444441', v_org, v_fac, v_series,
          current_date, current_date + 30, v_student, 'Carlos Nunes'),
         ('e4444444-4444-4444-4444-444444444442', v_org, v_fac, v_series,
          current_date - 40, current_date - 10, v_student, 'Carlos Nunes');

  INSERT INTO invoice_line (organization_id, invoice_id, student_id, student_fee_id,
                            student_name, kind, period_start, amount_cents)
  VALUES (v_org, 'e4444444-4444-4444-4444-444444444441', v_student, v_fee,
          'Carlos Nunes', 'mensalidade', DATE '2026-10-01', 4500),
         (v_org, 'e4444444-4444-4444-4444-444444444442', v_student, v_fee,
          'Carlos Nunes', 'mensalidade', DATE '2026-11-01', 4500);
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — a payment is a row, and two of them add up
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  v_doc uuid := 'e4444444-4444-4444-4444-444444444441';
  paid int;
BEGIN
  INSERT INTO invoice_payment (organization_id, invoice_id, amount_cents, paid_on, source)
  VALUES (v_org, v_doc, 2000, current_date - 2, 'manual'),
         (v_org, v_doc, 2500, current_date, 'mbway');

  SELECT coalesce(sum(amount_cents), 0)::int INTO paid
    FROM invoice_payment WHERE invoice_id = v_doc AND archived_at IS NULL;

  IF paid <> 4500 THEN RAISE EXCEPTION 'FAIL test 1a: expected 4500, got %', paid; END IF;

  -- Soft-deleted, never destroyed: an entry against the wrong document has to
  -- be removable without taking the record of the mistake with it.
  UPDATE invoice_payment SET archived_at = now()
   WHERE invoice_id = v_doc AND amount_cents = 2000;

  SELECT coalesce(sum(amount_cents), 0)::int INTO paid
    FROM invoice_payment WHERE invoice_id = v_doc AND archived_at IS NULL;

  IF paid <> 2500 THEN RAISE EXCEPTION 'FAIL test 1b: expected 2500, got %', paid; END IF;

  -- And a payment of nothing is not a payment.
  DECLARE ok boolean := false;
  BEGIN
    BEGIN
      INSERT INTO invoice_payment (organization_id, invoice_id, amount_cents)
      VALUES (v_org, v_doc, 0);
    EXCEPTION WHEN check_violation THEN ok := true;
    END;
    IF NOT ok THEN RAISE EXCEPTION 'FAIL test 1c: a payment of zero was accepted'; END IF;
  END;

  RAISE NOTICE 'PASS test 1: payments are rows, they sum, and an archived one stops counting';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — no status column exists, and there must not be one
--
-- The assertion is deliberately about the *schema*: a later migration adding a
-- convenience column here would need a worker to keep it true, and this is the
-- thing that would notice.
-- ---------------------------------------------------------------------------

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_name = 'invoice' AND column_name IN ('status', 'is_overdue', 'settled_on', 'paid_cents');

  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL test 2: invoice grew a stored status column — it is derived, by design';
  END IF;

  RAISE NOTICE 'PASS test 2: a document''s state is derived, never stored';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — the status precedence
--
-- The one to keep. Credited beats everything; paid beats overdue; a partly paid
-- document that is late is still overdue.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v text;
BEGIN
  v := invoice_status('invoice', false, 4500, 0, current_date + 30);
  IF v <> 'open' THEN RAISE EXCEPTION 'FAIL test 3a: expected open, got %', v; END IF;

  v := invoice_status('invoice', false, 4500, 2000, current_date + 30);
  IF v <> 'partly_paid' THEN RAISE EXCEPTION 'FAIL test 3b: expected partly_paid, got %', v; END IF;

  v := invoice_status('invoice', false, 4500, 4500, current_date + 30);
  IF v <> 'paid' THEN RAISE EXCEPTION 'FAIL test 3c: expected paid, got %', v; END IF;

  v := invoice_status('invoice', false, 4500, 0, current_date - 1);
  IF v <> 'overdue' THEN RAISE EXCEPTION 'FAIL test 3d: expected overdue, got %', v; END IF;

  -- Half of nothing arriving on time is still late.
  v := invoice_status('invoice', false, 4500, 2000, current_date - 1);
  IF v <> 'overdue' THEN RAISE EXCEPTION 'FAIL test 3e: a late part-payment was not overdue, got %', v; END IF;

  -- Paid beats overdue: a document settled after its due date is settled.
  v := invoice_status('invoice', false, 4500, 4500, current_date - 1);
  IF v <> 'paid' THEN RAISE EXCEPTION 'FAIL test 3f: a late but settled document read %', v; END IF;

  -- Credited beats everything, including a payment made before it was credited.
  v := invoice_status('invoice', true, 4500, 2000, current_date - 1);
  IF v <> 'credited' THEN RAISE EXCEPTION 'FAIL test 3g: expected credited, got %', v; END IF;

  -- A credit note is nobody's debt.
  v := invoice_status('credit_note', false, 4500, 0, current_date - 1);
  IF v <> 'credit_note' THEN RAISE EXCEPTION 'FAIL test 3h: expected credit_note, got %', v; END IF;

  -- An overpayment settles rather than breaking the ladder.
  v := invoice_status('invoice', false, 4500, 5000, current_date - 1);
  IF v <> 'paid' THEN RAISE EXCEPTION 'FAIL test 3i: an overpayment read %', v; END IF;

  RAISE NOTICE 'PASS test 3: credited beats paid beats overdue, and a late part-payment is still late';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — a credit note cannot be paid
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  v_fac uuid := 'e1111111-1111-1111-1111-111111111111';
  v_credit_series uuid; v_note uuid; ok boolean := false;
BEGIN
  SELECT id INTO v_credit_series FROM invoice_series
   WHERE facility_id = v_fac AND kind = 'credit_note';

  INSERT INTO invoice (organization_id, facility_id, series_id, kind, corrects_invoice_id,
                       due_on, payer_student_id, payer_name)
  VALUES (v_org, v_fac, v_credit_series, 'credit_note', 'e4444444-4444-4444-4444-444444444442',
          current_date, 'e2222222-2222-2222-2222-222222222221', 'Carlos Nunes')
  RETURNING id INTO v_note;

  BEGIN
    INSERT INTO invoice_payment (organization_id, invoice_id, amount_cents)
    VALUES (v_org, v_note, 4500);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;

  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4: money was recorded against a credit note'; END IF;
  RAISE NOTICE 'PASS test 4: a credit note reduces what is owed and cannot itself be paid';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — a chase is a record of a person having asked
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  v_doc uuid := 'e4444444-4444-4444-4444-444444444442';
  n int; v_last date;
BEGIN
  INSERT INTO invoice_chase (organization_id, invoice_id, chased_on, channel, note)
  VALUES (v_org, v_doc, current_date - 7, 'email', 'Primeiro aviso'),
         (v_org, v_doc, current_date - 1, 'phone', 'Falei com a mãe; paga sexta');

  SELECT count(*)::int, max(chased_on) INTO n, v_last
    FROM invoice_chase WHERE invoice_id = v_doc AND archived_at IS NULL;

  IF n <> 2 THEN RAISE EXCEPTION 'FAIL test 5a: expected 2 chases, got %', n; END IF;

  -- The number that matters before somebody picks up the telephone: when was
  -- this family last asked, and how many times.
  IF v_last <> current_date - 1 THEN
    RAISE EXCEPTION 'FAIL test 5b: the most recent chase was %', v_last;
  END IF;

  RAISE NOTICE 'PASS test 5: chases are a history, not a flag';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — the tenant boundary on both new tables
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  v_rival uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  n int; ok boolean := false;
BEGIN
  SET LOCAL ROLE poolse_app;
  PERFORM set_config('app.organization_id', v_rival::text, true);

  SELECT count(*) INTO n FROM invoice_payment;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 6a: the rival club saw % payments', n; END IF;

  SELECT count(*) INTO n FROM invoice_chase;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 6b: the rival club saw % chases', n; END IF;

  BEGIN
    INSERT INTO invoice_payment (organization_id, invoice_id, amount_cents)
    VALUES (v_org, 'e4444444-4444-4444-4444-444444444441', 1000);
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN ok := true;
  END;

  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 6c: a cross-tenant payment was written'; END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS test 6: payments and chases are scoped to their tenant';
END $$;

ROLLBACK;
