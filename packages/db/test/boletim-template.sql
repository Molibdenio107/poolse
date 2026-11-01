-- A club's own boletim de sócio — POOLSE-142.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('f1420000-0000-0000-0000-000000000001', 'Clube Boletim A', 'clube-boletim-a'),
  ('f1420000-0000-0000-0000-000000000002', 'Clube Boletim B', 'clube-boletim-b');

DO $$
DECLARE v_fa uuid; v_fb uuid; v_ma uuid; v_mb uuid;
BEGIN
  INSERT INTO membership (organization_id, status, email, first_name, last_name)
  VALUES ('f1420000-0000-0000-0000-000000000001', 'active', 'dono@boletim-a.pt', 'Ana', 'Sousa') RETURNING id INTO v_ma;
  INSERT INTO membership (organization_id, status, email, first_name, last_name)
  VALUES ('f1420000-0000-0000-0000-000000000002', 'active', 'dono@boletim-b.pt', 'Bruno', 'Reis') RETURNING id INTO v_mb;
  INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
  VALUES ('f1420000-0000-0000-0000-000000000001', 'boletim_template', 'f1420000-0000-0000-0000-000000000001/boletim_template/x.jpg', 'image/jpeg', 900, 'boletim.jpg', v_ma)
  RETURNING id INTO v_fa;
  INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
  VALUES ('f1420000-0000-0000-0000-000000000002', 'boletim_template', 'f1420000-0000-0000-0000-000000000002/boletim_template/x.jpg', 'image/jpeg', 900, 'boletim.jpg', v_mb)
  RETURNING id INTO v_fb;
  CREATE TEMP TABLE fixture AS SELECT v_fa AS fa, v_fb AS fb;
  GRANT SELECT ON fixture TO poolse_app;
END $$;

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'f1420000-0000-0000-0000-000000000001', true);

DO $$
DECLARE f RECORD; v_t uuid; ok boolean;
BEGIN
  SELECT * INTO f FROM fixture;
  INSERT INTO boletim_template (organization_id, file_id)
  VALUES ('f1420000-0000-0000-0000-000000000001', f.fa) RETURNING id INTO v_t;
  INSERT INTO boletim_template_field (organization_id, template_id, field, x, y)
  VALUES ('f1420000-0000-0000-0000-000000000001', v_t, 'name', 0.2, 0.18),
         ('f1420000-0000-0000-0000-000000000001', v_t, 'locality', 0.2, 0.31),
         ('f1420000-0000-0000-0000-000000000001', v_t, 'locality', 0.17, 0.45);
  RAISE NOTICE 'PASS test 1: a template takes placements, the same field twice included';

  ok := false;
  BEGIN
    INSERT INTO boletim_template (organization_id, file_id) VALUES ('f1420000-0000-0000-0000-000000000001', f.fa);
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2: a club held two live templates'; END IF;
  UPDATE boletim_template SET archived_at = now() WHERE id = v_t;
  INSERT INTO boletim_template (organization_id, file_id) VALUES ('f1420000-0000-0000-0000-000000000001', f.fa);
  INSERT INTO boletim_template (organization_id, kind, file_id) VALUES ('f1420000-0000-0000-0000-000000000001', 'fpn_declaration', f.fa);
  INSERT INTO boletim_template (organization_id, kind, file_id) VALUES ('f1420000-0000-0000-0000-000000000001', 'fpn_declaration_minor', f.fa);
  ok := false;
  BEGIN
    INSERT INTO boletim_template (organization_id, kind, file_id) VALUES ('f1420000-0000-0000-0000-000000000001', 'fpn_declaration', f.fa);
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2: a club held two live FPN declarations of one kind'; END IF;
  ok := false;
  BEGIN
    INSERT INTO boletim_template (organization_id, kind, file_id) VALUES ('f1420000-0000-0000-0000-000000000001', 'id_document', f.fa);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 2: an ID photograph was filed as a form to print'; END IF;
  UPDATE boletim_template SET archived_at = now() WHERE kind <> 'socio_form' AND archived_at IS NULL;
  RAISE NOTICE 'PASS test 2: one live template per club and kind; an archived one leaves room';

  ok := false;
  BEGIN
    INSERT INTO boletim_template_field (organization_id, template_id, field, x, y)
    VALUES ('f1420000-0000-0000-0000-000000000001', v_t, 'name', 1.2, 0.5);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3: a placement off the page was kept'; END IF;
  ok := false;
  BEGIN
    INSERT INTO boletim_template_field (organization_id, template_id, field, x, y, size_pt)
    VALUES ('f1420000-0000-0000-0000-000000000001', v_t, 'name', 0.5, 0.5, 50);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 3: a 50 pt placement was kept'; END IF;
  RAISE NOTICE 'PASS test 3: a placement stays on the page and between 6 and 24 pt';

  ok := false;
  BEGIN
    INSERT INTO boletim_template (organization_id, file_id) VALUES ('f1420000-0000-0000-0000-000000000002', f.fb);
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4: the app wrote a template into another club'; END IF;
  ok := false;
  UPDATE boletim_template SET archived_at = now() WHERE archived_at IS NULL;
  BEGIN
    -- Another club's file: the composite key refuses it whatever the policy says.
    INSERT INTO boletim_template (organization_id, file_id) VALUES ('f1420000-0000-0000-0000-000000000001', f.fb);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 4: a template was pointed at another club''s file'; END IF;
  RAISE NOTICE 'PASS test 4: a template never reaches another club';

  ok := false;
  BEGIN
    UPDATE boletim_template_field SET x = 0.3 WHERE template_id = v_t;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 5: the app moved a saved placement in place'; END IF;
  ok := false;
  BEGIN
    DELETE FROM boletim_template_field WHERE template_id = v_t;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL test 5: the app deleted a placement'; END IF;
  RAISE NOTICE 'PASS test 5: placements are archived and replaced, never edited or deleted';
END $$;

SELECT set_config('app.organization_id', 'f1420000-0000-0000-0000-000000000002', true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM boletim_template) OR EXISTS (SELECT 1 FROM boletim_template_field) THEN
    RAISE EXCEPTION 'FAIL test 6: another club''s template was visible';
  END IF;
  RAISE NOTICE 'PASS test 6: a club sees no other club''s template';
END $$;

RESET ROLE;

ROLLBACK;
