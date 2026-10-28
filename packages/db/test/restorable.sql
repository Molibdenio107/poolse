-- A backup restores — POOLSE-89.
--
-- pg_restore rebuilds every index and constraint with `search_path` set to ''.
-- A function inside one of them that calls another of our functions without
-- `public.` then fails, and the restore with it — which is how the first drill
-- found that no dump of this database could be restored. This rebuilds every
-- index built on an expression or a predicate under the same condition, over
-- rows that make each function run. The full drill is
-- `pnpm --filter @poolse/db backup:test`; this is the cheap guard that runs
-- with every `pnpm db:test`.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('f0890000-0000-0000-0000-000000000001', 'Clube Restauro', 'clube-restauro');

DO $$
DECLARE v_org uuid := 'f0890000-0000-0000-0000-000000000001'; v_site uuid;
BEGIN
  INSERT INTO facility (organization_id, name, timezone) VALUES (v_org, 'Sede', 'Europe/Lisbon') RETURNING id INTO v_site;
  -- The name-order indexes run name_sort_key → surname_units → strip_accents.
  INSERT INTO student (organization_id, first_name, last_name) VALUES (v_org, 'Inês', 'da Conceição e Sá');
  -- The closure exclusion runs closure_span → closure_half_day_cut.
  INSERT INTO closure (organization_id, facility_id, starts_on, ends_on, reason, part_of_day)
  VALUES (v_org, v_site, DATE '2027-03-09', DATE '2027-03-09', 'Manhã de obras', 'morning');
END $$;

SET LOCAL search_path = '';

DO $$
DECLARE v_index regclass; v_count int := 0;
BEGIN
  FOR v_index IN
    SELECT i.indexrelid::regclass
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND (i.indexprs IS NOT NULL OR i.indpred IS NOT NULL)
  LOOP
    BEGIN
      EXECUTE pg_catalog.format('REINDEX INDEX %s', v_index);
      v_count := v_count + 1;
    EXCEPTION WHEN undefined_function OR undefined_table OR undefined_object THEN
      RAISE EXCEPTION 'FAIL test 1: % cannot be rebuilt with an empty search_path, as pg_restore does: %', v_index, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'PASS test 1: all % expression and partial indexes rebuild with an empty search_path', v_count;
END $$;

ROLLBACK;
