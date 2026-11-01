-- Up Migration

-- Advancement per sport — POOLSE-148, slice C.
--
-- A student holds a level in each sport they do (slice A), so advancement runs
-- on each sport's ladder on its own. Three repairs and one definition:
--
-- **`next_level` and `age_fit_level` stay on the level's own ladder.** Both
-- picked "the next level" by `sort_order` across every level of the club, which
-- was right while there was one ladder and became wrong the day a club had a
-- second: a swimmer finishing *Golfinhos* could be proposed into *Ténis 2*.
--
-- **`age_band_standing` judges every level a student holds** — the swimming one
-- on the record and each other sport's row — one row per level, so a child in two
-- sports can be above their swimming band and within their tennis one.
--
-- **`student_level_in(student, sport)`** is the one definition of "this student's
-- level in this sport", read by the confirmation and the automatic mode.

CREATE OR REPLACE FUNCTION next_level(p_organization_id uuid, p_level_id uuid) RETURNS uuid
LANGUAGE sql STABLE
AS $fn$
  SELECT n.id
    FROM student_level cur
    JOIN student_level n
      ON n.organization_id = cur.organization_id
     AND n.archived_at IS NULL
     -- The same sport's ladder (POOLSE-148): each sport advances on its own.
     AND n.sport_id = cur.sport_id
     AND (n.sort_order, n.name) > (cur.sort_order, cur.name)
   WHERE cur.id = p_level_id
     AND cur.organization_id = p_organization_id
   ORDER BY n.sort_order, n.name
   LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION age_fit_level(
  p_organization_id uuid,
  p_from_level_id   uuid,
  p_age_months      integer,
  p_gender          student_gender
) RETURNS uuid
LANGUAGE sql STABLE
AS $fn$
  SELECT n.id
    FROM student_level cur
    JOIN student_level n
      ON n.organization_id = cur.organization_id
     AND n.archived_at IS NULL
     -- The same sport's ladder (POOLSE-148).
     AND n.sport_id = cur.sport_id
     AND (n.sort_order, n.name) > (cur.sort_order, cur.name)
   WHERE cur.id = p_from_level_id
     AND cur.organization_id = p_organization_id
     AND (n.min_age_months IS NULL OR n.min_age_months <= p_age_months)
     AND (n.max_age_months IS NULL OR n.max_age_months >= p_age_months)
     AND (p_gender IS NULL
          OR (p_gender = 'male' AND n.admits_male)
          OR (p_gender = 'female' AND n.admits_female))
   ORDER BY n.sort_order, n.name
   LIMIT 1;
$fn$;

CREATE FUNCTION student_level_in(p_student_id uuid, p_sport text) RETURNS uuid
LANGUAGE sql STABLE
AS $fn$
  SELECT CASE WHEN p_sport = 'pool'
              THEN (SELECT s.level_id FROM student s WHERE s.id = p_student_id)
              ELSE (SELECT x.level_id FROM student_sport_level x
                     WHERE x.student_id = p_student_id AND x.sport_id = p_sport
                       AND x.archived_at IS NULL)
         END;
$fn$;
COMMENT ON FUNCTION student_level_in(uuid, text) IS
  'POOLSE-148: a student''s level in one sport — swimming''s on the record, every other sport''s in student_sport_level.';

CREATE OR REPLACE FUNCTION age_band_standing(p_organization_id uuid, p_on date)
RETURNS TABLE (
  student_id uuid,
  level_id   uuid,
  age_months integer,
  standing   text,
  fits       uuid
)
LANGUAGE sql STABLE
AS $fn$
  SELECT s.id,
         l.id,
         age_in_months(s.birth_date, p_on),
         CASE
           WHEN l.max_age_months IS NOT NULL
            AND age_in_months(s.birth_date, p_on) > l.max_age_months THEN 'above'
           WHEN l.min_age_months IS NOT NULL
            AND age_in_months(s.birth_date, p_on) < l.min_age_months THEN 'below'
           ELSE 'within'
         END,
         CASE
           WHEN l.max_age_months IS NOT NULL
            AND age_in_months(s.birth_date, p_on) > l.max_age_months
             THEN age_fit_level(p_organization_id, l.id,
                                age_in_months(s.birth_date, p_on), s.gender)
         END
    FROM student s
    -- Every level the student holds, one row each (POOLSE-148): the swimming
    -- level on the record and each other sport's row.
    JOIN LATERAL (
      SELECT s.level_id AS level_id
      UNION ALL
      SELECT x.level_id FROM student_sport_level x
       WHERE x.student_id = s.id AND x.organization_id = s.organization_id
         AND x.archived_at IS NULL
    ) held ON held.level_id IS NOT NULL
    JOIN student_level l
      ON l.id = held.level_id AND l.organization_id = s.organization_id
   WHERE s.organization_id = p_organization_id
     AND s.archived_at IS NULL
     AND s.birth_date IS NOT NULL
     AND l.archived_at IS NULL
     AND student_left_on(s.id) IS NULL;
$fn$;

-- Down Migration

DROP FUNCTION IF EXISTS student_level_in(uuid, text);

CREATE OR REPLACE FUNCTION next_level(p_organization_id uuid, p_level_id uuid) RETURNS uuid
LANGUAGE sql STABLE
AS $fn$
  SELECT n.id
    FROM student_level cur
    JOIN student_level n
      ON n.organization_id = cur.organization_id
     AND n.archived_at IS NULL
     -- Strictly after, in the order the club dragged them into. Ties on
     -- sort_order break on name so the answer is total and stable.
     AND (n.sort_order, n.name) > (cur.sort_order, cur.name)
   WHERE cur.id = p_level_id
     AND cur.organization_id = p_organization_id
   ORDER BY n.sort_order, n.name
   LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION age_fit_level(
  p_organization_id uuid,
  p_from_level_id   uuid,
  p_age_months      integer,
  p_gender          student_gender
) RETURNS uuid
LANGUAGE sql STABLE
AS $fn$
  SELECT n.id
    FROM student_level cur
    JOIN student_level n
      ON n.organization_id = cur.organization_id
     AND n.archived_at IS NULL
     AND (n.sort_order, n.name) > (cur.sort_order, cur.name)
   WHERE cur.id = p_from_level_id
     AND cur.organization_id = p_organization_id
     AND (n.min_age_months IS NULL OR n.min_age_months <= p_age_months)
     AND (n.max_age_months IS NULL OR n.max_age_months >= p_age_months)
     AND (p_gender IS NULL
          OR (p_gender = 'male' AND n.admits_male)
          OR (p_gender = 'female' AND n.admits_female))
   ORDER BY n.sort_order, n.name
   LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION age_band_standing(p_organization_id uuid, p_on date)
RETURNS TABLE (
  student_id uuid,
  level_id   uuid,
  age_months integer,
  standing   text,
  fits       uuid
)
LANGUAGE sql STABLE
AS $fn$
  SELECT s.id,
         l.id,
         age_in_months(s.birth_date, p_on),
         CASE
           WHEN l.max_age_months IS NOT NULL
            AND age_in_months(s.birth_date, p_on) > l.max_age_months THEN 'above'
           WHEN l.min_age_months IS NOT NULL
            AND age_in_months(s.birth_date, p_on) < l.min_age_months THEN 'below'
           ELSE 'within'
         END,
         CASE
           WHEN l.max_age_months IS NOT NULL
            AND age_in_months(s.birth_date, p_on) > l.max_age_months
             THEN age_fit_level(p_organization_id, l.id,
                                age_in_months(s.birth_date, p_on), s.gender)
         END
    FROM student s
    JOIN student_level l
      ON l.id = s.level_id AND l.organization_id = s.organization_id
   WHERE s.organization_id = p_organization_id
     AND s.archived_at IS NULL
     AND s.birth_date IS NOT NULL
     AND l.archived_at IS NULL
     AND student_left_on(s.id) IS NULL;
$fn$;

