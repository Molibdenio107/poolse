-- Up Migration
--
-- No two escalões may claim exactly the same ages for the same sex — round 5.
--
-- **The rule is duplicates, not overlaps**, by decision. A club's ladder has
-- programmes that legitimately run alongside it — natação adaptada from ten
-- upwards, masters from twenty-five — and a rule against every overlap would
-- refuse a real timetable. Two escalões with the *identical* range and the same
-- members, though, are one escalão entered twice: nothing can tell an operator
-- which of them a child belongs in.
--
-- **Enforced on write, not by a unique index.** An index is checked against
-- every existing row the moment it is built, so a club whose ladder already
-- holds a duplicate — and one does, "Masters" and "Natação Senior", both 25+ —
-- could not migrate at all until somebody edited their data. A migration that
-- refuses to run until a customer changes their ladder is a migration that will
-- be run with the check deleted. The trigger refuses the duplicate the next time
-- either row is written, which is when a person is present to be told.
--
-- Only escalões that actually declare a range are covered. A club that has never
-- set ages has every escalão unbounded, and refusing that would refuse the
-- normal case rather than a mistake.

CREATE FUNCTION student_level_range_is_free() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_other text;
BEGIN
  -- An archived escalão claims nothing, and neither does one with no range.
  IF NEW.archived_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.min_age_months IS NULL AND NEW.max_age_months IS NULL THEN RETURN NEW; END IF;

  SELECT o.name INTO v_other
    FROM student_level o
   WHERE o.organization_id = NEW.organization_id
     AND o.id <> NEW.id
     AND o.archived_at IS NULL
     AND coalesce(o.min_age_months, -1) = coalesce(NEW.min_age_months, -1)
     AND coalesce(o.max_age_months, -1) = coalesce(NEW.max_age_months, -1)
     -- Per sex: a mixed escalão carries both flags and so is checked against the
     -- boys' ladder and the girls' alike, which is right — it admits both.
     AND ((o.admits_male AND NEW.admits_male) OR (o.admits_female AND NEW.admits_female))
   LIMIT 1;

  IF v_other IS NOT NULL THEN
    /*
     * unique_violation, and a constraint name, so the API can tell this apart
     * from a duplicate *name* without reading the sentence. Both are 23505 and
     * they want different messages beside different boxes.
     */
    RAISE EXCEPTION 'escalao_range_taken: % already covers exactly these ages', v_other
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'student_level_range_uq';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION student_level_range_is_free() IS
  'Refuses a second escalão with the identical age range for the same sex. '
  'Overlaps are allowed and warned about in the interface: a real ladder has '
  'programmes running alongside it.';

CREATE TRIGGER student_level_range_free
  BEFORE INSERT OR UPDATE OF min_age_months, max_age_months, admits_male, admits_female,
                             archived_at
  ON student_level
  FOR EACH ROW EXECUTE FUNCTION student_level_range_is_free();

-- Down Migration

DROP TRIGGER IF EXISTS student_level_range_free ON student_level;
DROP FUNCTION IF EXISTS student_level_range_is_free();
