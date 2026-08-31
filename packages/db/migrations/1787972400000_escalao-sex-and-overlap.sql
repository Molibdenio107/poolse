-- Up Migration
--
-- Escalões admit one sex or both, and a student may carry the same choice — round 5.
--
-- **A club's ladder is not always mixed.** "Cadetes femininos dos 8 aos 11" and
-- "Cadetes masculinos dos 8 aos 12" are two escalões with the same name,
-- overlapping ages and different members. Two flags rather than one enum,
-- because "both" is a real answer and the commonest one — an enum would need a
-- third value meaning "the other two at once".
--
-- **A student carries the same choice**, optional. Blank is the ordinary state
-- of an imported row, and a blank must never block an enrolment.
--
-- The rule that no two escalões may claim the *same* range is the migration
-- after this one, so that this half applies to a club whose ladder still has a
-- duplicate in it.

-- ---------------------------------------------------------------------------
-- Who an escalão admits
-- ---------------------------------------------------------------------------

ALTER TABLE student_level
  ADD COLUMN admits_male boolean NOT NULL DEFAULT true,
  ADD COLUMN admits_female boolean NOT NULL DEFAULT true;

-- An escalão nobody can join is a typo, not a policy.
ALTER TABLE student_level
  ADD CONSTRAINT student_level_admits_somebody CHECK (admits_male OR admits_female);

COMMENT ON COLUMN student_level.admits_male IS
  'Both true is misto, which is the default and most clubs. Untick one and the '
  'escalão is for the other sex — which is what lets two of them share a name.';

/*
 * The name is unique per set of members, not per club.
 *
 * "Cadetes" for the girls and "Cadetes" for the boys are two rows an operator
 * reads as one word, and refusing the second would force a club to rename its
 * own escalões to suit the database.
 */
DROP INDEX IF EXISTS student_level_name_uq;
CREATE UNIQUE INDEX student_level_name_uq
  ON student_level (organization_id, lower(strip_accents(name)), admits_male, admits_female)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- The same choice on a student
-- ---------------------------------------------------------------------------

/*
 * A closed set only a developer changes, so an enum. Nullable on purpose:
 * imports arrive with the column half empty, and "nobody has recorded it" has to
 * be representable or the first spreadsheet will invent an answer.
 */
CREATE TYPE student_sex AS ENUM ('male', 'female');

ALTER TABLE student ADD COLUMN sex student_sex;

COMMENT ON COLUMN student.sex IS
  'Optional. Matched against an escalão''s admits_male/admits_female for display '
  'and warnings only — nothing here refuses an enrolment, exactly as the age '
  'range does not.';

-- Down Migration

ALTER TABLE student DROP COLUMN IF EXISTS sex;
DROP TYPE IF EXISTS student_sex;

DROP INDEX IF EXISTS student_level_name_uq;

/*
 * The old index is unique per name alone, so a club that took advantage of the
 * new rule has two rows it refuses. Archive the later of each pair rather than
 * deleting a club's ladder — the earlier row is the one that predates this
 * migration, and archiving is how everything else here is undone.
 */
UPDATE student_level l
   SET archived_at = now()
 WHERE archived_at IS NULL
   AND EXISTS (
     SELECT 1 FROM student_level other
      WHERE other.organization_id = l.organization_id
        AND other.archived_at IS NULL
        AND lower(strip_accents(other.name)) = lower(strip_accents(l.name))
        AND (other.created_at, other.id) < (l.created_at, l.id)
   );

CREATE UNIQUE INDEX student_level_name_uq
  ON student_level (organization_id, lower(strip_accents(name)))
  WHERE archived_at IS NULL;

ALTER TABLE student_level DROP CONSTRAINT IF EXISTS student_level_admits_somebody;

ALTER TABLE student_level
  DROP COLUMN IF EXISTS admits_female,
  DROP COLUMN IF EXISTS admits_male;
