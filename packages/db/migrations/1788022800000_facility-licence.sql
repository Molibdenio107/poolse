-- Up Migration
--
-- A subscription covers one facility.
--
-- ---------------------------------------------------------------------------
-- What this does and does not settle
-- ---------------------------------------------------------------------------
--
-- Backlog story **B4, "one facility per client", was rejected** and stays
-- rejected: a municipality with pools in two buildings must not be forced into
-- two Poolse organizations with two staff lists and two invoices. The schema
-- keeps `organization 1 —— N facility`, and `docs/data-model.md` open question 2
-- is unchanged.
--
-- This is the other half, which was never written down: **how many sites a
-- tenant may have is a commercial limit, not a modelling one.** The plan covers
-- one; a municipality with two buys a plan with two. The schema is what makes
-- that expressible at all — under B4 there would be nothing to sell.
--
-- ---------------------------------------------------------------------------
-- Why the database and not just the API
-- ---------------------------------------------------------------------------
--
-- Because the application layer already forgot. The POOLSE-55 reference seed
-- created a second facility to keep its demo bookings off a developer's own
-- club — a sensible-looking local decision that silently handed an organization
-- a site it had not bought, and nothing objected. A seed, a migration or a
-- script written tired is exactly the case CLAUDE.md's "enforced by the
-- database, not by the repository layer" is about.
--
-- So the count lives here. The API keeps its own check, and that is not
-- duplication: this one refuses, and that one explains — an operator who has
-- reached their limit should read a sentence about their plan, not a constraint
-- name.

ALTER TABLE organization
  ADD COLUMN max_facilities integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT organization_max_facilities_sane CHECK (max_facilities >= 1);

COMMENT ON COLUMN organization.max_facilities IS
  'How many live facilities this subscription allows. One by default; raised by '
  'the plan, never by the application. Archived sites do not count against it.';

/*
 * Existing tenants keep what they already have.
 *
 * A limit applied retroactively would put somebody over it the moment this runs,
 * and every later edit to those sites would fail against a rule nobody had
 * agreed to. The floor is what is already there; the default governs from here.
 */
UPDATE organization o
   SET max_facilities = greatest(1, (
         SELECT count(*) FROM facility f
          WHERE f.organization_id = o.id AND f.archived_at IS NULL
       ));

/*
 * The count, on insert and on un-archiving.
 *
 * **Archived sites do not count.** A club that closes a pool and opens another
 * has not bought a second licence, and making them ask us to archive one before
 * they can add the next is a support ticket for something they can see is right.
 *
 * `UPDATE OF archived_at` catches the other way in: restoring an archived
 * facility is an insert as far as the licence is concerned.
 */
CREATE FUNCTION facility_within_licence() RETURNS trigger AS $fn$
DECLARE
  v_allowed integer;
  v_live    integer;
BEGIN
  -- Only a row that is (or is becoming) live is worth counting.
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.archived_at IS NULL THEN
    -- An ordinary edit to a site that was already live changes no count.
    RETURN NEW;
  END IF;

  SELECT max_facilities INTO v_allowed
    FROM organization WHERE id = NEW.organization_id;

  SELECT count(*) INTO v_live
    FROM facility
   WHERE organization_id = NEW.organization_id
     AND archived_at IS NULL
     AND id <> NEW.id;

  IF v_live >= coalesce(v_allowed, 1) THEN
    /*
     * The message is parsed by the API, which turns it into a sentence about
     * the plan — the same contract `facility_closed_on_weekday` and its
     * siblings already use, and the reason the prefix is stable.
     */
    RAISE EXCEPTION 'facility_licence_exceeded: % of %', v_live, coalesce(v_allowed, 1)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER facility_licence
  BEFORE INSERT OR UPDATE OF archived_at ON facility
  FOR EACH ROW EXECUTE FUNCTION facility_within_licence();

-- Down Migration

DROP TRIGGER IF EXISTS facility_licence ON facility;
DROP FUNCTION IF EXISTS facility_within_licence();

ALTER TABLE organization
  DROP CONSTRAINT IF EXISTS organization_max_facilities_sane,
  DROP COLUMN IF EXISTS max_facilities;
