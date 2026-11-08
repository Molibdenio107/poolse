-- A pass price per category — POOLSE-203.
--
-- Test 1 (QA 1): base 40 €, Sénior 30 €, no combination; Sénior + Sócio pays 30 €.
-- Test 2 (QA 2): a typed Sénior + Sócio at 27 € wins.
-- Test 3 (QA 3, Rui 08-11-2026): Sócio ranked above Sénior and unpriced → the
--         next ranked with a price (Sénior 30 €), never the base for that reason.
-- Test 4 (QA 4): Sénior expired yesterday → the base price.
-- Test 5: one set, one spelling; another club's category is refused; another
--         club reads nothing and the function answers nothing of it.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('bbbbbbbb-2030-4000-8000-000000000001', 'Clube Preço A', 'clube-preco-a'),
  ('bbbbbbbb-2030-4000-8000-000000000002', 'Clube Preço B', 'clube-preco-b');

INSERT INTO facility (id, organization_id, name) VALUES
  ('ffffffff-2030-4000-8000-000000000001', 'bbbbbbbb-2030-4000-8000-000000000001', 'Piscina A');

INSERT INTO membership (id, organization_id, status, first_name, last_name, email) VALUES
  ('dddddddd-2030-4000-8000-000000000001', 'bbbbbbbb-2030-4000-8000-000000000001', 'active', 'Ana', 'Costa', 'ana-2030@example.test'),
  ('dddddddd-2030-4000-8000-000000000002', 'bbbbbbbb-2030-4000-8000-000000000001', 'active', 'Rui', 'Só', 'rui-2030@example.test');

INSERT INTO fee_category (id, organization_id, name, sort_order, rank) VALUES
  ('cccccccc-2030-4000-8000-000000000001', 'bbbbbbbb-2030-4000-8000-000000000001', 'Sénior', 0, 0),
  ('cccccccc-2030-4000-8000-000000000002', 'bbbbbbbb-2030-4000-8000-000000000001', 'Sócio', 1, 1),
  ('cccccccc-2030-4000-8000-000000000009', 'bbbbbbbb-2030-4000-8000-000000000002', 'Rival', 0, 0);

INSERT INTO pass_product (id, organization_id, facility_id, kind, name, entries, amount_cents) VALUES
  ('aaaaaaaa-2030-4000-8000-000000000001', 'bbbbbbbb-2030-4000-8000-000000000001',
   'ffffffff-2030-4000-8000-000000000001', 'pack', 'Pack 10', 10, 4000);

-- Ana holds Sénior and Sócio; Rui holds nothing.
INSERT INTO person_category (id, organization_id, membership_id, fee_category_id, proof_seen_on, valid_until) VALUES
  ('99999999-2030-4000-8000-000000000001', 'bbbbbbbb-2030-4000-8000-000000000001',
   'dddddddd-2030-4000-8000-000000000001', 'cccccccc-2030-4000-8000-000000000001', club_today() - 10, NULL),
  ('99999999-2030-4000-8000-000000000002', 'bbbbbbbb-2030-4000-8000-000000000001',
   'dddddddd-2030-4000-8000-000000000001', 'cccccccc-2030-4000-8000-000000000002', club_today() - 10, NULL);

SELECT set_config('app.organization_id', 'bbbbbbbb-2030-4000-8000-000000000001', true);
SET LOCAL ROLE poolse_app;

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-2030-4000-8000-000000000001';
  v_product uuid := 'aaaaaaaa-2030-4000-8000-000000000001';
  v_ana uuid := 'dddddddd-2030-4000-8000-000000000001';
  v_rui uuid := 'dddddddd-2030-4000-8000-000000000002';
  v_senior uuid := 'cccccccc-2030-4000-8000-000000000001';
  v_socio uuid := 'cccccccc-2030-4000-8000-000000000002';
  r record;
  ok boolean;
BEGIN
  SELECT * INTO r FROM pass_price_for(v_org, v_product, v_rui);
  ASSERT r.amount_cents = 4000 AND r.category_names IS NULL, 'nobody special pays the base';
  SELECT * INTO r FROM pass_price_for(v_org, v_product, NULL);
  ASSERT r.amount_cents = 4000, 'an anonymous entry pays the base';

  -- Test 1.
  INSERT INTO pass_product_price (organization_id, facility_id, product_id, category_ids, amount_cents)
  VALUES (v_org, 'ffffffff-2030-4000-8000-000000000001', v_product, ARRAY[v_senior], 3000);
  SELECT * INTO r FROM pass_price_for(v_org, v_product, v_ana);
  ASSERT r.amount_cents = 3000 AND r.category_names = 'Sénior', format('QA 1: %s', r);

  -- Test 3: Sócio ranks first and has no price; Sénior's price still applies.
  UPDATE fee_category SET rank = CASE id WHEN v_socio THEN 0 ELSE 1 END WHERE id IN (v_senior, v_socio);
  SELECT * INTO r FROM pass_price_for(v_org, v_product, v_ana);
  ASSERT r.amount_cents = 3000, format('QA 3: next ranked with a price: %s', r);
  -- ...and with Sócio priced, Sócio's price wins.
  INSERT INTO pass_product_price (organization_id, facility_id, product_id, category_ids, amount_cents)
  VALUES (v_org, 'ffffffff-2030-4000-8000-000000000001', v_product, ARRAY[v_socio], 3500);
  SELECT * INTO r FROM pass_price_for(v_org, v_product, v_ana);
  ASSERT r.amount_cents = 3500 AND r.category_names = 'Sócio', format('QA 3: top ranked: %s', r);
  UPDATE fee_category SET rank = CASE id WHEN v_senior THEN 0 ELSE 1 END WHERE id IN (v_senior, v_socio);

  -- Test 2: the combination, spelled sorted.
  INSERT INTO pass_product_price (organization_id, facility_id, product_id, category_ids, amount_cents)
  VALUES (v_org, 'ffffffff-2030-4000-8000-000000000001', v_product,
          ARRAY(SELECT unnest(ARRAY[v_senior, v_socio]) ORDER BY 1), 2700);
  SELECT * INTO r FROM pass_price_for(v_org, v_product, v_ana);
  ASSERT r.amount_cents = 2700 AND r.category_names = 'Sénior + Sócio', format('QA 2: %s', r);

  -- Test 5: one spelling per set.
  ok := false;
  BEGIN
    INSERT INTO pass_product_price (organization_id, facility_id, product_id, category_ids, amount_cents)
    VALUES (v_org, 'ffffffff-2030-4000-8000-000000000001', v_product, ARRAY[v_senior, v_senior], 100);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  ASSERT ok, 'a set has no repeats';
  ok := false;
  BEGIN
    INSERT INTO pass_product_price (organization_id, facility_id, product_id, category_ids, amount_cents)
    VALUES (v_org, 'ffffffff-2030-4000-8000-000000000001', v_product, ARRAY[v_senior], 100);
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  ASSERT ok, 'one live price per exact set';
  ok := false;
  BEGIN
    INSERT INTO pass_product_price (organization_id, facility_id, product_id, category_ids, amount_cents)
    VALUES (v_org, 'ffffffff-2030-4000-8000-000000000001', v_product,
            ARRAY['cccccccc-2030-4000-8000-000000000009'::uuid], 100);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  ASSERT ok, 'another club''s category is refused';
END $$;

-- Test 4: Sénior expired yesterday. Sócio alone has a price (3500) from test 3.
RESET ROLE;
UPDATE person_category SET proof_seen_on = club_today() - 400, valid_until = club_today() - 1
 WHERE id = '99999999-2030-4000-8000-000000000001';
UPDATE pass_product_price SET archived_at = now()
 WHERE product_id = 'aaaaaaaa-2030-4000-8000-000000000001'
   AND category_ids = ARRAY['cccccccc-2030-4000-8000-000000000002'::uuid];
SET LOCAL ROLE poolse_app;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM pass_price_for('bbbbbbbb-2030-4000-8000-000000000001',
                                      'aaaaaaaa-2030-4000-8000-000000000001',
                                      'dddddddd-2030-4000-8000-000000000001');
  ASSERT r.amount_cents = 4000 AND r.category_names IS NULL, format('QA 4: expired is the base: %s', r);
END $$;

SELECT set_config('app.organization_id', 'bbbbbbbb-2030-4000-8000-000000000002', true);

DO $$
DECLARE ok boolean;
BEGIN
  ASSERT (SELECT count(*) FROM pass_product_price) = 0, 'another club reads nothing';
  ASSERT NOT EXISTS (SELECT 1 FROM pass_price_for('bbbbbbbb-2030-4000-8000-000000000001',
                                                  'aaaaaaaa-2030-4000-8000-000000000001',
                                                  'dddddddd-2030-4000-8000-000000000001')),
         'the function answers nothing of another club';
  ok := false;
  BEGIN
    DELETE FROM pass_product_price;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'a price is archived, never deleted';
END $$;

RESET ROLE;
ROLLBACK;
