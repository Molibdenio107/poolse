-- Up Migration
--
-- A turma belongs to a site — POOLSE-42's prerequisite.
--
-- Today a `class_group` reaches a facility only through its *nullable* `pool_id`,
-- so a turma created before anybody picked a lane belongs to no site at all.
-- That is fine while a turma is only ever read on its own; it stops being fine
-- the moment prices are a property of the facility, because "which price list
-- applies to this turma" then has no answer for exactly the turmas an operator
-- has not finished setting up.
--
-- **The column is NOT NULL and it is backfilled**, rather than nullable with the
-- lookup falling back to the pool. A nullable one would leave the same hole in a
-- second place, and every reader would have to remember the fallback. One
-- required answer beats two optional ones that have to agree.
--
-- The backfill has two sources, in order: the pool the turma already uses, and
-- otherwise the organization's own facility. Every organization has one from the
-- moment it is provisioned, so the second source always exists — and if it ever
-- does not, `SET NOT NULL` fails the migration rather than inventing a site.

ALTER TABLE class_group ADD COLUMN facility_id uuid;

-- The turmas that already say where they swim.
UPDATE class_group cg
   SET facility_id = p.facility_id
  FROM pool p
 WHERE p.id = cg.pool_id
   AND p.organization_id = cg.organization_id;

/*
 * The rest: the club's own site.
 *
 * Oldest first, so a club that has since opened a second site gets the original
 * one rather than whichever row the planner happened to return. Archived
 * facilities are eligible on purpose — a turma that ran at a site since closed
 * belonged to that site, and rewriting history to the surviving one would be a
 * lie about where those lessons happened.
 */
UPDATE class_group cg
   SET facility_id = (
         SELECT f.id
           FROM facility f
          WHERE f.organization_id = cg.organization_id
          ORDER BY f.created_at, f.id
          LIMIT 1
       )
 WHERE cg.facility_id IS NULL;

ALTER TABLE class_group ALTER COLUMN facility_id SET NOT NULL;

COMMENT ON COLUMN class_group.facility_id IS
  'The site this turma belongs to. Required, so a facility-scoped price list '
  'always has an answer — unlike pool_id, which is null until a lane is picked.';

/*
 * A turma's site and its pool's site are the same site.
 *
 * Said as a composite foreign key rather than a trigger, so it cannot be got
 * wrong by any path. `pool` needs the matching unique for it to point at.
 *
 * A null `pool_id` satisfies this: a foreign key with any null column is not
 * checked under MATCH SIMPLE, which is exactly the behaviour wanted here — a
 * turma with no lane yet still has a site.
 */
ALTER TABLE pool ADD CONSTRAINT pool_facility_id_uq UNIQUE (organization_id, facility_id, id);

ALTER TABLE class_group
  ADD CONSTRAINT class_group_facility_fkey
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id);

ALTER TABLE class_group
  ADD CONSTRAINT class_group_pool_matches_facility
  FOREIGN KEY (organization_id, facility_id, pool_id)
    REFERENCES pool (organization_id, facility_id, id);

/*
 * A turma that named a pool has already said where it is.
 *
 * The site is not a second fact to be kept in step with the first — it *is* the
 * pool's site. So a caller that supplies a pool need not supply a facility, and
 * one that supplies neither is asked for the facility by the NOT NULL above.
 *
 * This is deliberately not a guess. Where there is no pool the trigger fills in
 * nothing and the insert fails, because "the club's only facility" is the wrong
 * answer the day a club opens its second site — which is exactly the case this
 * column exists to serve.
 */
CREATE FUNCTION class_group_facility_from_pool() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.pool_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- On insert: fill it in. On update: follow the pool, but only when the caller
  -- moved the pool and did not say anything about the facility themselves.
  IF NEW.facility_id IS NULL
     OR (TG_OP = 'UPDATE'
         AND NEW.pool_id IS DISTINCT FROM OLD.pool_id
         AND NEW.facility_id IS NOT DISTINCT FROM OLD.facility_id)
  THEN
    SELECT p.facility_id INTO NEW.facility_id FROM pool p WHERE p.id = NEW.pool_id;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER class_group_facility_from_pool
  BEFORE INSERT OR UPDATE ON class_group
  FOR EACH ROW EXECUTE FUNCTION class_group_facility_from_pool();

-- "Which turmas run at this site" — the question the price list asks.
CREATE INDEX class_group_facility_idx
  ON class_group (organization_id, facility_id)
  WHERE archived_at IS NULL;

-- Down Migration

DROP TRIGGER IF EXISTS class_group_facility_from_pool ON class_group;
DROP FUNCTION IF EXISTS class_group_facility_from_pool();

DROP INDEX IF EXISTS class_group_facility_idx;

ALTER TABLE class_group
  DROP CONSTRAINT IF EXISTS class_group_pool_matches_facility;
ALTER TABLE class_group
  DROP CONSTRAINT IF EXISTS class_group_facility_fkey;

ALTER TABLE pool DROP CONSTRAINT IF EXISTS pool_facility_id_uq;

ALTER TABLE class_group DROP COLUMN IF EXISTS facility_id;
