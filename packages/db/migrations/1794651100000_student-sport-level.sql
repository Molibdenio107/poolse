-- Up Migration

-- A student holds a level in each sport they do — POOLSE-148, slice A.
--
-- POOLSE-126 put every level on one sport's ladder; a student still held one
-- `level_id`, so a child in swimming and tennis could be on only one of them
-- (Rui, 01-11-2026: "a student can have 1 or more sports, and hold different
-- levels for different sports").
--
-- **The swimming level stays where it is.** `student.level_id` is read by a dozen
-- places — the register, prices by level, the FPN forms, the import, advancement
-- — and all of them are about swimming. Leaving it as the swimming level keeps
-- every one of them right with no edit, and a trigger now holds it to the
-- swimming ladder. Every other sport's level is a row here. Two homes, one rule:
-- `setStudentLevelIn` is the only writer and picks the home from the level's own
-- sport, so no caller decides.
--
-- **At most one live level per student per sport**, by partial unique index; a
-- change archives nothing, it updates the row (the audit log holds the history,
-- as it does for the column).

CREATE TABLE student_sport_level (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  student_id      uuid NOT NULL,
  sport_id        text NOT NULL REFERENCES sport (id),
  level_id        uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, level_id) REFERENCES student_level (organization_id, id),
  -- Swimming's level is `student.level_id`; a row for it would be a second home.
  CONSTRAINT student_sport_level_not_pool CHECK (sport_id <> 'pool')
);

COMMENT ON TABLE student_sport_level IS
  'POOLSE-148: a student''s level in a sport other than swimming (swimming''s is student.level_id). '
  'One live row per student and sport; written only through setStudentLevelIn.';

CREATE UNIQUE INDEX student_sport_level_live_uq
  ON student_sport_level (organization_id, student_id, sport_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER student_sport_level_updated_at BEFORE UPDATE ON student_sport_level
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE student_sport_level ENABLE ROW LEVEL SECURITY;
CREATE POLICY student_sport_level_tenant ON student_sport_level
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Insert, change the level, archive; never delete. A column grant needs the
-- table-wide privilege revoked first (POOLSE-73).
REVOKE ALL ON student_sport_level FROM poolse_app;
GRANT SELECT, INSERT ON student_sport_level TO poolse_app;
GRANT UPDATE (level_id, archived_at) ON student_sport_level TO poolse_app;

-- The level must be on the row's own sport's ladder — the rule the form could
-- forget. `student_level.sport_id` never changes (POOLSE-126), so checking the
-- row is enough.
CREATE FUNCTION student_sport_level_matches() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only a level of this club on another ladder is this trigger's to refuse; a
  -- level that is not the club's at all is the composite foreign key's answer.
  IF EXISTS (
    SELECT 1 FROM student_level l
     WHERE l.id = NEW.level_id AND l.organization_id = NEW.organization_id
       AND l.sport_id <> NEW.sport_id
  ) THEN
    RAISE EXCEPTION 'student_sport_level_mismatch: the level is not on % ladder', NEW.sport_id
      USING ERRCODE = 'check_violation', DETAIL = 'sport_level_mismatch|' || NEW.sport_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER student_sport_level_matches
  BEFORE INSERT OR UPDATE OF level_id, sport_id ON student_sport_level
  FOR EACH ROW EXECUTE FUNCTION student_sport_level_matches();

-- What is already there: a student whose single level is another sport's moves
-- that level to its own row, and the column clears. Before the trigger below,
-- which would otherwise refuse the clean-up's own rows.
INSERT INTO student_sport_level (organization_id, student_id, sport_id, level_id)
SELECT s.organization_id, s.id, l.sport_id, s.level_id
  FROM student s
  JOIN student_level l ON l.id = s.level_id AND l.organization_id = s.organization_id
 WHERE l.sport_id <> 'pool';

UPDATE student s SET level_id = NULL
  FROM student_level l
 WHERE l.id = s.level_id AND l.organization_id = s.organization_id
   AND l.sport_id <> 'pool';

-- And from here on `student.level_id` is the swimming level only.
CREATE FUNCTION student_level_is_pool() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- As above: another ladder of this club is refused here, another club's
  -- level by the foreign key.
  IF NEW.level_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM student_level l
     WHERE l.id = NEW.level_id AND l.organization_id = NEW.organization_id
       AND l.sport_id <> 'pool'
  ) THEN
    RAISE EXCEPTION 'student_level_not_pool: student.level_id is the swimming level'
      USING ERRCODE = 'check_violation', DETAIL = 'sport_level_mismatch|pool';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER student_level_is_pool
  BEFORE INSERT OR UPDATE OF level_id ON student
  FOR EACH ROW EXECUTE FUNCTION student_level_is_pool();

-- Down Migration

DROP TRIGGER IF EXISTS student_level_is_pool ON student;
DROP FUNCTION IF EXISTS student_level_is_pool();

-- A level that left the column goes back to it, where the student has no swimming level.
UPDATE student s SET level_id = x.level_id
  FROM student_sport_level x
 WHERE x.student_id = s.id AND x.organization_id = s.organization_id
   AND x.archived_at IS NULL AND s.level_id IS NULL;

DROP TABLE IF EXISTS student_sport_level;
DROP FUNCTION IF EXISTS student_sport_level_matches();
