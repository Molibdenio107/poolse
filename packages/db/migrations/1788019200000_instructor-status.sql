-- Up Migration
--
-- "Sem professor" is a state somebody sets, not a blank somebody reads — POOLSE-53.
--
-- The club named this as its main problem: a season is built optimistically in
-- July and the staffing catches up in September, so at any moment there is a set
-- of slots with nobody in them, and the club's way of tracking that set is to
-- squint at a printout covered in red `???`.
--
-- ---------------------------------------------------------------------------
-- Why this is a trigger and not a computed column
-- ---------------------------------------------------------------------------
--
-- The ticket's Dev note names the failure mode exactly: it is tempting to derive
-- "uncovered = no instructor resolved", and that quietly erases `to_define`. The
-- two states look identical in the data and mean opposite things to a manager:
--
--   * `to_define` — we know, and we have not decided. Not yet a problem.
--   * `uncovered` — we have decided, and nobody is covering it. A problem.
--
-- A blank is not evidence of which, so the column is read, never derived. What
-- *is* automatic is the one transition that carries no judgement: a booking with
-- somebody teaching it is `assigned`, and the database can see that for itself.
--
-- So this is a state machine, in the schema, because the instructor can change
-- from three directions — the booking's own override, the turma's instructor,
-- and the partner group's own teacher — and a rule that lives in one repository
-- method is a rule the other two paths do not have.
--
--   instructor resolves            -> assigned
--   partner brings their own       -> external
--   was assigned, instructor gone  -> to_define   (never uncovered: that is an accusation)
--   to_define / uncovered          -> left exactly as the operator set them
--
-- `external` becomes **derived from `partner_group.brings_own_instructor`**
-- rather than set by hand. That is what the parcerias migration already said the
-- column was for — "this is what makes a booking's `instructor_status`
-- `external`" — and the demo seed agrees row for row. Writing it down as a rule
-- means a club that ticks the box on an existing group gets its grid corrected
-- instead of keeping a stale alert.

/*
 * The honest default for a brand-new row.
 *
 * It was `assigned`, which claims a fact about a booking nobody has staffed. The
 * trigger below corrects it upwards the moment an instructor resolves, so the
 * default only ever applies to a booking that genuinely has nobody.
 */
ALTER TABLE class_schedule ALTER COLUMN instructor_status SET DEFAULT 'to_define';

CREATE FUNCTION class_schedule_instructor_state() RETURNS trigger AS $fn$
DECLARE
  v_resolved   uuid;
  v_brings_own boolean;
BEGIN
  -- An archived booking is history. Rewriting its state would edit the record of
  -- what was true when it was retired.
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  /*
   * The instructor actually running it: the booking's override if it has one,
   * otherwise the turma's own. The same precedence the grid reads with, and it
   * has to be the same or the alert and the cell disagree about one booking.
   */
  v_resolved := NEW.instructor_membership_id;

  IF v_resolved IS NULL AND NEW.class_group_id IS NOT NULL THEN
    SELECT cg.instructor_membership_id INTO v_resolved
      FROM class_group cg
     WHERE cg.id = NEW.class_group_id
       AND cg.organization_id = NEW.organization_id;
  END IF;

  IF NEW.partner_group_id IS NOT NULL THEN
    SELECT pg.brings_own_instructor INTO v_brings_own
      FROM partner_group pg
     WHERE pg.id = NEW.partner_group_id
       AND pg.organization_id = NEW.organization_id;
  END IF;

  IF v_resolved IS NOT NULL THEN
    /*
     * An explicitly assigned membership beats the group's own teacher. A club
     * that puts one of its own people on a school's booking has said something
     * specific about that booking, and the group's default must not overrule it.
     */
    NEW.instructor_status := 'assigned';
  ELSIF coalesce(v_brings_own, false) THEN
    NEW.instructor_status := 'external';
  ELSIF NEW.instructor_status IN ('assigned', 'external') THEN
    -- The instructor went away, or the partner stopped sending one. Back to
    -- "not decided" — the operator escalates to `uncovered`, the system does not.
    NEW.instructor_status := 'to_define';
  END IF;

  -- `to_define` and `uncovered` fall through untouched. That is the whole point:
  -- the system never converts one into the other in either direction.
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

/*
 * No column list, deliberately.
 *
 * Scoping it to the instructor columns would be faster and would miss the case
 * that matters: a booking whose state drifted for any other reason stays wrong
 * until somebody edits exactly the right field. Every write is a chance to be
 * right, and the body is three cheap lookups.
 */
CREATE TRIGGER class_schedule_instructor_state
  BEFORE INSERT OR UPDATE ON class_schedule
  FOR EACH ROW EXECUTE FUNCTION class_schedule_instructor_state();

/*
 * The turma's instructor changed, so its bookings' states did too.
 *
 * Only the bookings with no override of their own: a booking that names its own
 * substitute is not affected by who the turma's regular instructor is, and
 * touching it would bump `updated_at` for nothing.
 */
CREATE FUNCTION class_group_restate_bookings() RETURNS trigger AS $fn$
BEGIN
  UPDATE class_schedule
     SET instructor_status = instructor_status
   WHERE class_group_id = NEW.id
     AND organization_id = NEW.organization_id
     AND instructor_membership_id IS NULL
     AND archived_at IS NULL;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER class_group_instructor_state
  AFTER UPDATE OF instructor_membership_id ON class_group
  FOR EACH ROW
  WHEN (NEW.instructor_membership_id IS DISTINCT FROM OLD.instructor_membership_id)
  EXECUTE FUNCTION class_group_restate_bookings();

-- The school stopped sending its teacher, or started. Same idea.
CREATE FUNCTION partner_group_restate_bookings() RETURNS trigger AS $fn$
BEGIN
  UPDATE class_schedule
     SET instructor_status = instructor_status
   WHERE partner_group_id = NEW.id
     AND organization_id = NEW.organization_id
     AND archived_at IS NULL;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER partner_group_instructor_state
  AFTER UPDATE OF brings_own_instructor ON partner_group
  FOR EACH ROW
  WHEN (NEW.brings_own_instructor IS DISTINCT FROM OLD.brings_own_instructor)
  EXECUTE FUNCTION partner_group_restate_bookings();

/*
 * The backfill, expressed as the rule itself rather than as a copy of it.
 *
 * `SET instructor_status = instructor_status` is a real update, so the BEFORE
 * trigger fires and recomputes every live booking. A hand-written CASE here
 * would be a second definition of the state machine, free to drift from the
 * first — this way there is exactly one.
 *
 * `updated_at` is switched off across it. Every booking in the database did not
 * change tonight; a normalisation stamping today's date on all of them would
 * make the audit trail say otherwise.
 */
ALTER TABLE class_schedule DISABLE TRIGGER class_schedule_updated_at;
UPDATE class_schedule SET instructor_status = instructor_status WHERE archived_at IS NULL;
ALTER TABLE class_schedule ENABLE TRIGGER class_schedule_updated_at;

/*
 * No index for the counter, on purpose.
 *
 * The obvious one is `(organization_id, season_id, instructor_status)` and it
 * would never be used: a turma booking's `season_id` is null and its season
 * comes from its turma, so every season query is
 * `coalesce(cs.season_id, cg.season_id)` — which no index on the column alone
 * can serve. The counts are taken from the grid's own rows, in the request that
 * already loaded them, so there is nothing here to speed up.
 */

-- Down Migration

DROP TRIGGER IF EXISTS partner_group_instructor_state ON partner_group;
DROP FUNCTION IF EXISTS partner_group_restate_bookings();

DROP TRIGGER IF EXISTS class_group_instructor_state ON class_group;
DROP FUNCTION IF EXISTS class_group_restate_bookings();

DROP TRIGGER IF EXISTS class_schedule_instructor_state ON class_schedule;
DROP FUNCTION IF EXISTS class_schedule_instructor_state();

/*
 * The default goes back. The *rows* do not, and cannot: the normalisation above
 * overwrote states with no record of what they were, so a rollback leaves the
 * data as this migration left it. That is the honest outcome — the alternative
 * is a shadow column kept forever against a rollback nobody will run.
 */
ALTER TABLE class_schedule ALTER COLUMN instructor_status SET DEFAULT 'assigned';
