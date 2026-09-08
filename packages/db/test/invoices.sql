-- Invoicing — phase 2.2.
--
-- Four of these are the reason the file exists, and they are the ones to keep
-- if it is ever cut down.
--
-- **Test 3** is the rule the whole module rests on: a rolled-back document
-- takes its number back with it. This is the difference between a column and a
-- Postgres sequence, and a "tidy-up" that replaces one with the other would
-- pass every other test here while quietly making the series gappy — which is
-- the one thing a numbering series may not be.
--
-- **Test 4** proves the document cannot be edited or deleted by the
-- application, which is a privilege rather than a trigger and therefore easy to
-- undo by accident in a later migration.
--
-- **Test 6** is the double-billing guard, and **test 7** is the half of it
-- everybody forgets: after a credit note the occurrence is chargeable again,
-- because that is how a club fixes a document it got wrong.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_inv', 'inv@clube.pt', 'Rui', 'Fonseca', NULL, '2026-09-01 09:00:00+00');

-- Fixed ids: tests 4 and 10 run as `poolse_app` with RLS on, where a lookup by
-- name returns nothing.
INSERT INTO organization (id, name, slug, invoice_series_prefix) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Clube Faturas', 'clube-faturas', 'A'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Clube Rival',   'clube-rival-f', 'A');

-- This fixture states its own plan: a subscription covers one facility and the
-- licence trigger enforces it. Test 2 needs two sites in one club.
UPDATE organization SET max_facilities = 20;

INSERT INTO facility (id, organization_id, name) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Piscina Municipal'),
  ('d1111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Sede Rival');

-- ---------------------------------------------------------------------------
-- The people and the fee lines every test below charges
-- ---------------------------------------------------------------------------
--
-- A guardian with two children — the sibling pair the roadmap names — and an
-- adult with no guardian at all, who is their own payer.

DO $$
DECLARE
  v_org uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_fac uuid := 'c1111111-1111-1111-1111-111111111111';
  v_guardian uuid; v_level uuid; v_mensal uuid; v_plan uuid;
  v_ana uuid; v_rita uuid; v_carlos uuid;
BEGIN
  INSERT INTO membership (organization_id, status, first_name, last_name,
                          email, phone, tax_number, address)
  VALUES (v_org, 'active', 'Maria', 'Alves Costa', 'maria@exemplo.pt',
          '912345678', '123456789', 'Rua das Flores 12, Braga')
  RETURNING id INTO v_guardian;
  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_guardian, 'guardian');

  INSERT INTO student (id, organization_id, first_name, last_name, birth_date) VALUES
    ('c2222222-2222-2222-2222-222222222221', v_org, 'Ana',  'Costa', DATE '2016-03-04'),
    ('c2222222-2222-2222-2222-222222222222', v_org, 'Rita', 'Costa', DATE '2018-04-11'),
    -- No guardian link, and old enough: the adult path, and their own payer.
    ('c2222222-2222-2222-2222-222222222223', v_org, 'Carlos', 'Nunes', DATE '1968-01-20');
  v_ana    := 'c2222222-2222-2222-2222-222222222221';
  v_rita   := 'c2222222-2222-2222-2222-222222222222';
  v_carlos := 'c2222222-2222-2222-2222-222222222223';

  INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id,
                             relationship, is_primary)
  VALUES (v_org, v_ana,  v_guardian, 'mãe', true),
         (v_org, v_rita, v_guardian, 'mãe', true);

  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_org, 'Iniciação', 1) RETURNING id INTO v_level;

  INSERT INTO fee_period (organization_id, facility_id, name, months, is_default, sort_order)
  VALUES (v_org, v_fac, 'Mensal', 1, true, 1) RETURNING id INTO v_mensal;

  INSERT INTO fee_plan (organization_id, facility_id, kind, level_id, lessons_per_week,
                        amount_cents, vat_exempt)
  VALUES (v_org, v_fac, 'mensalidade', v_level, 2, 4500, true) RETURNING id INTO v_plan;

  -- One mensalidade each. Fixed ids, for the reason the students have them.
  INSERT INTO student_fee (id, organization_id, student_id, fee_plan_id, fee_period_id,
                           amount_cents, starts_on)
  VALUES ('c3333333-3333-3333-3333-333333333331', v_org, v_ana,    v_plan, v_mensal, 4500, DATE '2026-09-01'),
         ('c3333333-3333-3333-3333-333333333332', v_org, v_rita,   v_plan, v_mensal, 4500, DATE '2026-09-01'),
         ('c3333333-3333-3333-3333-333333333333', v_org, v_carlos, v_plan, v_mensal, 4500, DATE '2026-09-01');
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — a facility is born with both its books
--
-- A site with no series cannot issue anything, and the failure would arrive
-- months later at the one moment a club is trying to invoice. So it is a
-- trigger, and this asserts the trigger rather than the API remembering.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_fac uuid := 'c1111111-1111-1111-1111-111111111111';
  n int; v_prefix text;
BEGIN
  SELECT count(*) INTO n FROM invoice_series WHERE facility_id = v_fac;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL test 1a: expected 2 series, got %', n; END IF;

  SELECT count(*) INTO n FROM invoice_series WHERE facility_id = v_fac AND is_default;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL test 1b: expected both series to be default, got %', n; END IF;

  -- The prefix comes from the organization's own column, which has sat unused
  -- in the schema since the first migration.
  SELECT prefix INTO v_prefix FROM invoice_series
   WHERE facility_id = v_fac AND kind = 'invoice';
  IF v_prefix <> 'A' THEN
    RAISE EXCEPTION 'FAIL test 1c: expected prefix A, got %', v_prefix;
  END IF;

  RAISE NOTICE 'PASS test 1: a new facility gets a fatura book and a credit note book';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — a second site in one club does not reuse the first site's prefix
--
-- The prefix is unique per organization, not per facility: the club is one
-- legal entity and two sites both numbering `FT A/1` would issue two different
-- documents under one number.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_second uuid; v_prefix text; n int;
BEGIN
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina do Bairro')
  RETURNING id INTO v_second;

  SELECT prefix INTO v_prefix FROM invoice_series
   WHERE facility_id = v_second AND kind = 'invoice';
  IF v_prefix <> 'A2' THEN
    RAISE EXCEPTION 'FAIL test 2a: expected the first free prefix A2, got %', v_prefix;
  END IF;

  SELECT count(DISTINCT prefix) INTO n FROM invoice_series
   WHERE organization_id = v_org AND kind = 'invoice';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL test 2b: two sites share a prefix'; END IF;

  -- The other club may use A, because a document number identifies a document
  -- within its own club and nowhere else.
  SELECT prefix INTO v_prefix FROM invoice_series
   WHERE facility_id = 'd1111111-1111-1111-1111-111111111111' AND kind = 'invoice';
  IF v_prefix <> 'A' THEN
    RAISE EXCEPTION 'FAIL test 2c: another tenant was pushed off prefix A, got %', v_prefix;
  END IF;

  RAISE NOTICE 'PASS test 2: a prefix is unique per club and shared across clubs';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — the number is the database's to give, and a rollback returns it
--
-- The load-bearing test. A Postgres sequence would pass the first half and fail
-- the second: `nextval` is not transactional, so a rolled-back document leaves
-- a gap that nothing can explain to an auditor.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_fac uuid := 'c1111111-1111-1111-1111-111111111111';
  v_series uuid; v_no text; v_number int; ok boolean := false;
BEGIN
  SELECT id INTO v_series FROM invoice_series
   WHERE facility_id = v_fac AND kind = 'invoice';

  -- Supplying one is refused outright: application code that could hold a
  -- number is application code that could lose one.
  BEGIN
    INSERT INTO invoice (organization_id, facility_id, series_id, number, document_no,
                         due_on, payer_student_id, payer_name)
    VALUES (v_org, v_fac, v_series, 99, 'FT A/99', DATE '2026-10-08',
            'c2222222-2222-2222-2222-222222222223', 'Carlos Nunes');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3a: a caller was allowed to choose a number'; END IF;

  INSERT INTO invoice (organization_id, facility_id, series_id, due_on,
                       payer_student_id, payer_name)
  VALUES (v_org, v_fac, v_series, DATE '2026-10-08',
          'c2222222-2222-2222-2222-222222222223', 'Carlos Nunes')
  RETURNING number, document_no INTO v_number, v_no;

  IF v_number <> 1 OR v_no <> 'FT A/1' THEN
    RAISE EXCEPTION 'FAIL test 3b: first document was % (%)', v_no, v_number;
  END IF;

  -- A document that is written and then rolled back must give its number back.
  BEGIN
    INSERT INTO invoice (organization_id, facility_id, series_id, due_on,
                         payer_student_id, payer_name)
    VALUES (v_org, v_fac, v_series, DATE '2026-10-08',
            'c2222222-2222-2222-2222-222222222223', 'Carlos Nunes')
    RETURNING number INTO v_number;
    IF v_number <> 2 THEN RAISE EXCEPTION 'FAIL test 3c: expected 2, got %', v_number; END IF;
    RAISE EXCEPTION 'rollback this one';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'rollback this one' THEN RAISE; END IF;
  END;

  INSERT INTO invoice (organization_id, facility_id, series_id, due_on,
                       payer_student_id, payer_name)
  VALUES (v_org, v_fac, v_series, DATE '2026-10-08',
          'c2222222-2222-2222-2222-222222222223', 'Carlos Nunes')
  RETURNING number INTO v_number;

  IF v_number <> 2 THEN
    RAISE EXCEPTION 'FAIL test 3d: the series is gappy — expected 2 after a rollback, got %', v_number;
  END IF;

  RAISE NOTICE 'PASS test 3: numbers are allocated by the database and a rollback leaves no gap';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — the application cannot edit or delete a document
--
-- Said with a privilege rather than a trigger: a missing GRANT cannot be
-- forgotten by application code, and there is no code path to review.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  ok boolean := false;
BEGIN
  SET LOCAL ROLE poolse_app;
  PERFORM set_config('app.organization_id', v_org::text, true);

  BEGIN
    UPDATE invoice SET notes = 'corrigido' WHERE organization_id = v_org;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4a: an issued document was edited'; END IF;

  ok := false;
  BEGIN
    DELETE FROM invoice WHERE organization_id = v_org;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4b: an issued document was deleted'; END IF;

  ok := false;
  BEGIN
    DELETE FROM invoice_line WHERE organization_id = v_org;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4c: a document line was deleted'; END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS test 4: a document is written once — no UPDATE, no DELETE';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — a fatura cannot be numbered in the credit note book
--
-- A composite foreign key carrying the kind, rather than a trigger: a key
-- cannot be raced and cannot be dropped without somebody meaning to.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_fac uuid := 'c1111111-1111-1111-1111-111111111111';
  v_credit_series uuid; ok boolean := false;
BEGIN
  SELECT id INTO v_credit_series FROM invoice_series
   WHERE facility_id = v_fac AND kind = 'credit_note';

  BEGIN
    INSERT INTO invoice (organization_id, facility_id, series_id, kind, due_on,
                         payer_student_id, payer_name)
    VALUES (v_org, v_fac, v_credit_series, 'invoice', DATE '2026-10-08',
            'c2222222-2222-2222-2222-222222222223', 'Carlos Nunes');
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 5a: a fatura was numbered in the credit note book'; END IF;

  -- And a credit note names what it corrects, while an invoice names nothing.
  ok := false;
  BEGIN
    INSERT INTO invoice (organization_id, facility_id, series_id, kind, due_on,
                         payer_student_id, payer_name)
    VALUES (v_org, v_fac, v_credit_series, 'credit_note', DATE '2026-10-08',
            'c2222222-2222-2222-2222-222222222223', 'Carlos Nunes');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 5b: a credit note corrected nothing'; END IF;

  RAISE NOTICE 'PASS test 5: the document type and its book cannot disagree';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — one live charge per occurrence, and the refusal names the document
--
-- The rule the module exists to keep: a family is never charged twice for one
-- month. It has to hold across the monthly run and the per-student action
-- alike, which are two code paths, so it is enforced here.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_fac uuid := 'c1111111-1111-1111-1111-111111111111';
  v_series uuid; v_first uuid; v_second uuid; v_detail text; ok boolean := false;
BEGIN
  SELECT id INTO v_series FROM invoice_series
   WHERE facility_id = v_fac AND kind = 'invoice';

  INSERT INTO invoice (id, organization_id, facility_id, series_id, due_on,
                       payer_student_id, payer_name)
  VALUES ('c4444444-4444-4444-4444-444444444441', v_org, v_fac, v_series, DATE '2026-10-08',
          'c2222222-2222-2222-2222-222222222223', 'Carlos Nunes');
  v_first := 'c4444444-4444-4444-4444-444444444441';

  INSERT INTO invoice_line (organization_id, invoice_id, student_id, student_fee_id,
                            student_name, kind, description, period_start, amount_cents,
                            vat_exempt, vat_exemption_reason)
  VALUES (v_org, v_first, 'c2222222-2222-2222-2222-222222222223',
          'c3333333-3333-3333-3333-333333333333', 'Carlos Nunes', 'mensalidade',
          'Mensalidade Iniciação — outubro', DATE '2026-10-01', 4500,
          true, 'Art. 9.º CIVA');

  -- The line's copy of its document's kind is filled by the trigger when a
  -- caller does not send it, exactly as `student_fee.kind` is.
  IF NOT EXISTS (SELECT 1 FROM invoice_line
                  WHERE invoice_id = v_first AND document_kind = 'invoice') THEN
    RAISE EXCEPTION 'FAIL test 6a: document_kind was not filled from the document';
  END IF;

  -- The same occurrence again, on a second document.
  INSERT INTO invoice (id, organization_id, facility_id, series_id, due_on,
                       payer_student_id, payer_name)
  VALUES ('c4444444-4444-4444-4444-444444444442', v_org, v_fac, v_series, DATE '2026-10-08',
          'c2222222-2222-2222-2222-222222222223', 'Carlos Nunes');
  v_second := 'c4444444-4444-4444-4444-444444444442';

  BEGIN
    INSERT INTO invoice_line (organization_id, invoice_id, student_id, student_fee_id,
                              student_name, kind, description, period_start, amount_cents)
    VALUES (v_org, v_second, 'c2222222-2222-2222-2222-222222222223',
            'c3333333-3333-3333-3333-333333333333', 'Carlos Nunes', 'mensalidade',
            'Mensalidade Iniciação — outubro', DATE '2026-10-01', 4500);
  EXCEPTION WHEN unique_violation THEN
    ok := true;
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  END;

  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 6b: October was charged twice'; END IF;

  -- The figures travel as structure. The API turns this into a 409 carrying the
  -- document number as a field, and the sentence is composed where the locale is.
  IF v_detail <> 'invoice_line_already_charged|FT A/3' THEN
    RAISE EXCEPTION 'FAIL test 6c: the refusal did not name the document — DETAIL was %', v_detail;
  END IF;

  RAISE NOTICE 'PASS test 6: an occurrence is charged once, and the refusal says where';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — after a credit note the occurrence is chargeable again
--
-- The half that is easy to forget, and the reason the guard is a constraint
-- trigger rather than a partial unique index: "live" means "not since
-- credited", which needs a join an index cannot do. Crediting and re-issuing is
-- how a club fixes a document it got wrong.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_fac uuid := 'c1111111-1111-1111-1111-111111111111';
  v_credit_series uuid; v_series uuid; v_note uuid; v_fresh uuid;
  v_original_line uuid; v_no text;
BEGIN
  SELECT id INTO v_credit_series FROM invoice_series
   WHERE facility_id = v_fac AND kind = 'credit_note';
  SELECT id INTO v_series FROM invoice_series
   WHERE facility_id = v_fac AND kind = 'invoice';
  SELECT id INTO v_original_line FROM invoice_line
   WHERE invoice_id = 'c4444444-4444-4444-4444-444444444441';

  INSERT INTO invoice (organization_id, facility_id, series_id, kind, corrects_invoice_id,
                       due_on, payer_student_id, payer_name)
  VALUES (v_org, v_fac, v_credit_series, 'credit_note', 'c4444444-4444-4444-4444-444444444441',
          DATE '2026-10-08', 'c2222222-2222-2222-2222-222222222223', 'Carlos Nunes')
  RETURNING id, document_no INTO v_note, v_no;

  -- Its own book, its own sequence: the first credit note is NC A/1 whatever
  -- number the invoice it corrects carries.
  IF v_no <> 'NC A/1' THEN
    RAISE EXCEPTION 'FAIL test 7a: expected NC A/1, got %', v_no;
  END IF;

  INSERT INTO invoice_line (organization_id, invoice_id, student_id, student_fee_id,
                            credits_invoice_line_id, student_name, kind, description,
                            period_start, amount_cents)
  VALUES (v_org, v_note, 'c2222222-2222-2222-2222-222222222223',
          'c3333333-3333-3333-3333-333333333333', v_original_line, 'Carlos Nunes',
          'mensalidade', 'Mensalidade Iniciação — outubro', DATE '2026-10-01', 4500);

  -- And now October may be charged again.
  INSERT INTO invoice (organization_id, facility_id, series_id, due_on,
                       payer_student_id, payer_name)
  VALUES (v_org, v_fac, v_series, DATE '2026-10-08',
          'c2222222-2222-2222-2222-222222222223', 'Carlos Nunes')
  RETURNING id INTO v_fresh;

  INSERT INTO invoice_line (organization_id, invoice_id, student_id, student_fee_id,
                            student_name, kind, description, period_start, amount_cents)
  VALUES (v_org, v_fresh, 'c2222222-2222-2222-2222-222222222223',
          'c3333333-3333-3333-3333-333333333333', 'Carlos Nunes', 'mensalidade',
          'Mensalidade Iniciação — outubro (corrigida)', DATE '2026-10-01', 4000);

  -- One credit per document, though: a document credited twice makes "has this
  -- been corrected" have two answers.
  DECLARE ok boolean := false;
  BEGIN
    BEGIN
      INSERT INTO invoice (organization_id, facility_id, series_id, kind, corrects_invoice_id,
                           due_on, payer_student_id, payer_name)
      VALUES (v_org, v_fac, v_credit_series, 'credit_note', 'c4444444-4444-4444-4444-444444444441',
              DATE '2026-10-08', 'c2222222-2222-2222-2222-222222222223', 'Carlos Nunes');
    EXCEPTION WHEN unique_violation THEN ok := true;
    END;
    IF NOT ok THEN RAISE EXCEPTION 'FAIL test 7c: a document was credited twice'; END IF;
  END;

  RAISE NOTICE 'PASS test 7: a credited occurrence can be charged again, and once only';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8 — a line may not disagree with its document about what it is
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO invoice_line (organization_id, invoice_id, document_kind, student_id,
                              student_fee_id, student_name, kind, description,
                              period_start, amount_cents)
    VALUES (v_org, 'c4444444-4444-4444-4444-444444444442', 'credit_note',
            'c2222222-2222-2222-2222-222222222221',
            'c3333333-3333-3333-3333-333333333331', 'Ana Costa', 'mensalidade',
            'Mensalidade Iniciação — novembro', DATE '2026-11-01', 4500);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;

  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 8: a line claimed to be a credit note on a fatura'; END IF;
  RAISE NOTICE 'PASS test 8: the line''s copy of its kind is checked, not just filled';
END $$;

-- ---------------------------------------------------------------------------
-- Test 9 — who the document is addressed to, and the VAT inside its amounts
--
-- The sibling pair is the case: two children, one guardian, one payer — which
-- is what puts them on one document rather than two.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_ana uuid := 'c2222222-2222-2222-2222-222222222221';
  v_rita uuid := 'c2222222-2222-2222-2222-222222222222';
  v_carlos uuid := 'c2222222-2222-2222-2222-222222222223';
  v_payer_a uuid; v_payer_r uuid; v_payer_c uuid; v_vat int;
BEGIN
  v_payer_a := invoice_payer_membership_id(v_org, v_ana);
  v_payer_r := invoice_payer_membership_id(v_org, v_rita);
  v_payer_c := invoice_payer_membership_id(v_org, v_carlos);

  IF v_payer_a IS NULL OR v_payer_a <> v_payer_r THEN
    RAISE EXCEPTION 'FAIL test 9a: two siblings resolved to different payers';
  END IF;
  IF v_payer_c IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 9b: an adult with no guardian was given one';
  END IF;

  -- 23 % already inside €12,30 is €2,30. The gross is what a club advertises
  -- and what the fee plan holds; the tax is what is inside it.
  v_vat := invoice_vat_cents(1230, 23);
  IF v_vat <> 230 THEN RAISE EXCEPTION 'FAIL test 9c: expected 230, got %', v_vat; END IF;

  -- Exempt and zero-rated both carry no tax; what tells them apart is the flag,
  -- never the rate.
  IF invoice_vat_cents(4500, 0) <> 0 THEN
    RAISE EXCEPTION 'FAIL test 9d: a zero rate produced tax';
  END IF;

  RAISE NOTICE 'PASS test 9: siblings share a payer, an adult is their own, and VAT is inside the amount';
END $$;

-- ---------------------------------------------------------------------------
-- Test 10 — the tenant boundary on all three tables
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_rival uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_their_series uuid; n int; ok boolean := false;
BEGIN
  -- Read as the owner, before the role switch: the point of test 10d is that
  -- knowing another club's ids buys nothing.
  SELECT id INTO v_their_series FROM invoice_series
   WHERE organization_id = v_org AND kind = 'invoice'
     AND facility_id = 'c1111111-1111-1111-1111-111111111111';

  SET LOCAL ROLE poolse_app;
  PERFORM set_config('app.organization_id', v_rival::text, true);

  SELECT count(*) INTO n FROM invoice;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 10a: the rival club saw % documents', n; END IF;

  SELECT count(*) INTO n FROM invoice_line;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 10b: the rival club saw % lines', n; END IF;

  SELECT count(*) INTO n FROM invoice_series WHERE organization_id = v_org;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 10c: the rival club saw % series', n; END IF;

  -- And cannot write into the other club's book while holding every one of its
  -- ids. Two mechanisms refuse it and the allocation gets there first: the
  -- series it is told to number in is not visible, so there is no number to
  -- give. The policy's WITH CHECK is behind that, for a document that somehow
  -- got one.
  BEGIN
    INSERT INTO invoice (organization_id, facility_id, series_id, due_on,
                         payer_student_id, payer_name)
    VALUES (v_org, 'c1111111-1111-1111-1111-111111111111', v_their_series,
            DATE '2026-10-08', 'c2222222-2222-2222-2222-222222222223', 'Carlos Nunes');
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN ok := true;
  END;

  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 10d: a cross-tenant document was written'; END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS test 10: invoices, lines and series are all scoped to their tenant';
END $$;

ROLLBACK;
