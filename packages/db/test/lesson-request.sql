-- What a teacher asks of the office — POOLSE-198.
--
-- Test 1: one open of each kind per lesson, and a closed one frees the place.
-- Test 2: a closed row says how. Test 3: another club reads and writes nothing, a
-- composite key refuses a row across clubs, and the words cannot be rewritten or
-- the row deleted.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('bbbbbbbb-1980-4000-8000-000000000001', 'Clube Pedido A', 'clube-pedido-a'),
  ('bbbbbbbb-1980-4000-8000-000000000002', 'Clube Pedido B', 'clube-pedido-b');

INSERT INTO membership (id, organization_id, status, first_name, last_name, email) VALUES
  ('dddddddd-1980-4000-8000-000000000001', 'bbbbbbbb-1980-4000-8000-000000000001', 'active', 'Ana', 'Costa', 'ana-1980@example.test'),
  ('dddddddd-1980-4000-8000-000000000002', 'bbbbbbbb-1980-4000-8000-000000000002', 'active', 'Rita', 'Costa', 'rita-1980@example.test');

CREATE TEMP TABLE t1980 (id uuid) ON COMMIT DROP;
GRANT SELECT ON t1980 TO poolse_app;

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1980-4000-8000-000000000001';
  v_who uuid := 'dddddddd-1980-4000-8000-000000000001';
  v_session uuid;
  v_first uuid;
  ok boolean;
BEGIN
  ALTER TABLE lesson_request DROP CONSTRAINT lesson_request_organization_id_class_session_id_fkey;
  v_session := gen_random_uuid();

  -- Test 1.
  INSERT INTO lesson_request (organization_id, class_session_id, kind, requested_by_membership_id, note)
  VALUES (v_org, v_session, 'substitute', v_who, 'Doente') RETURNING id INTO v_first;
  INSERT INTO t1980 VALUES (v_first);

  ok := false;
  BEGIN
    INSERT INTO lesson_request (organization_id, class_session_id, kind, requested_by_membership_id)
    VALUES (v_org, v_session, 'substitute', v_who);
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  ASSERT ok, 'one open of a kind per lesson';

  INSERT INTO lesson_request (organization_id, class_session_id, kind, requested_by_membership_id)
  VALUES (v_org, v_session, 'cancelled', v_who);

  -- Test 2.
  ok := false;
  BEGIN
    UPDATE lesson_request SET closed_at = now() WHERE id = v_first;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  ASSERT ok, 'a closed row says how';

  UPDATE lesson_request SET closed_at = now(), outcome = 'withdrawn' WHERE id = v_first;
  INSERT INTO lesson_request (organization_id, class_session_id, kind, requested_by_membership_id)
  VALUES (v_org, v_session, 'substitute', v_who);

  -- Test 3: a person of another club is refused by the key.
  ok := false;
  BEGIN
    INSERT INTO lesson_request (organization_id, class_session_id, kind, requested_by_membership_id)
    VALUES (v_org, gen_random_uuid(), 'substitute', 'dddddddd-1980-4000-8000-000000000002');
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  ASSERT ok, 'a person of another club is refused by the key';
END $$;

SELECT set_config('app.organization_id', 'bbbbbbbb-1980-4000-8000-000000000002', true);
SET LOCAL ROLE poolse_app;

DO $$
DECLARE ok boolean;
BEGIN
  ASSERT (SELECT count(*) FROM lesson_request) = 0, 'another club reads nothing';
  ok := false;
  BEGIN
    INSERT INTO lesson_request (organization_id, class_session_id, kind, requested_by_membership_id)
    VALUES ('bbbbbbbb-1980-4000-8000-000000000001', gen_random_uuid(), 'substitute',
            'dddddddd-1980-4000-8000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'another club writes nothing';
END $$;

SELECT set_config('app.organization_id', 'bbbbbbbb-1980-4000-8000-000000000001', true);

DO $$
DECLARE ok boolean;
BEGIN
  ASSERT (SELECT count(*) FROM lesson_request) > 0, 'the club reads its own';
  ok := false;
  BEGIN
    UPDATE lesson_request SET note = 'Outra coisa';
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'the words cannot be rewritten';
  ok := false;
  BEGIN
    DELETE FROM lesson_request;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'the record cannot be deleted';
END $$;

RESET ROLE;
ROLLBACK;
