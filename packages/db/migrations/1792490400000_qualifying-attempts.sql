-- Up Migration

-- POOLSE-115: a printed meet marks each result that met an entry time (Mín.).
--
-- `qualifying_gaps()` was the one definition of a valid time — same course,
-- official live meet, inside the window (else the season) — but it only ever
-- answered with the *best* such time, and a result can make a mínimo without
-- being the swimmer's best. Copying its WHERE clause into the meet read would be
-- two definitions of "counts", which agree until one is edited.
--
-- So the definition moves here, one row per (entry time asked of a swimmer ×
-- valid time they swam for it), with a null-record row when they swam none, and
-- `qualifying_gaps()` becomes "the fastest attempt per entry" over it. Its output
-- is unchanged, row for row: DISTINCT ON the entry and the swimmer is exactly the
-- old LATERAL ... LIMIT 1, ordered the same way.
--
-- Plain SQL functions, invoker's rights: RLS on every table they read applies.

CREATE FUNCTION qualifying_attempts(p_standard uuid DEFAULT NULL, p_student uuid DEFAULT NULL)
RETURNS TABLE (
  entry_id      uuid,
  standard_id   uuid,
  student_id    uuid,
  age_group_id  uuid,
  stroke        swim_stroke,
  distance_m    integer,
  course        swim_course,
  entry_ms      integer,
  record_id     uuid,
  time_ms       integer,
  swum_on       date,
  meet_name     text
)
LANGUAGE sql STABLE
AS $$
  WITH std AS (
    SELECT q.id, q.season_id,
           coalesce(q.window_from, se.starts_on) AS valid_from,
           coalesce(q.window_to, se.ends_on)     AS valid_to
      FROM qualifying_standard q
      JOIN season se ON se.id = q.season_id AND se.organization_id = q.organization_id
     WHERE q.archived_at IS NULL
       AND (p_standard IS NULL OR q.id = p_standard)
  ),
  eligible AS (
    SELECT std.id AS standard_id, std.valid_from, std.valid_to, s.id AS student_id, g.id AS age_group_id
      FROM std
      JOIN federation_age_group g ON g.season_id = std.season_id AND g.archived_at IS NULL
      JOIN student s ON s.archived_at IS NULL
                    AND (p_student IS NULL OR s.id = p_student)
                    AND federation_age_group_admits(g.gender, g.born_from, g.born_to, s.birth_date, s.gender)
  )
  SELECT qt.id, e.standard_id, e.student_id, e.age_group_id, qt.stroke, qt.distance_m, qt.course,
         qt.time_ms, v.id, v.time_ms, v.swum_on, v.meet_name
    FROM eligible e
    JOIN qualifying_time qt ON qt.standard_id = e.standard_id
                           AND qt.age_group_id = e.age_group_id
                           AND qt.archived_at IS NULL
    LEFT JOIN LATERAL (
      SELECT r.id, r.time_ms, r.swum_on, sm.name AS meet_name
        FROM student_record r
        JOIN swim_meet sm ON sm.id = r.meet_id AND sm.organization_id = r.organization_id
       WHERE r.student_id = e.student_id
         AND r.archived_at IS NULL
         AND sm.archived_at IS NULL
         AND sm.official
         AND r.stroke = qt.stroke
         AND r.distance_m = qt.distance_m
         AND r.course = qt.course
         AND r.swum_on BETWEEN e.valid_from AND e.valid_to
    ) v ON true
$$;

COMMENT ON FUNCTION qualifying_attempts(uuid, uuid) IS
  'POOLSE-115: the one definition of a valid time (same course, official live meet, inside '
  'the window else the season), one row per entry time and valid attempt. qualifying_gaps() '
  'is its fastest attempt; the meet read marks attempts at or under the entry time.';

CREATE OR REPLACE FUNCTION qualifying_gaps(p_standard uuid DEFAULT NULL, p_student uuid DEFAULT NULL)
RETURNS TABLE (
  standard_id   uuid,
  student_id    uuid,
  age_group_id  uuid,
  stroke        swim_stroke,
  distance_m    integer,
  course        swim_course,
  entry_ms      integer,
  best_ms       integer,
  best_swum_on  date,
  best_meet     text
)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT ON (a.entry_id, a.student_id)
         a.standard_id, a.student_id, a.age_group_id, a.stroke, a.distance_m, a.course,
         a.entry_ms, a.time_ms, a.swum_on, a.meet_name
    FROM qualifying_attempts(p_standard, p_student) a
   ORDER BY a.entry_id, a.student_id, a.time_ms NULLS LAST, a.swum_on
$$;

COMMENT ON FUNCTION qualifying_gaps(uuid, uuid) IS
  'POOLSE-85: each entry time asked of a swimmer, with their best valid time or null — the '
  'fastest row of qualifying_attempts(). Read by Progressão and the Mínimos board.';

-- Down Migration

CREATE OR REPLACE FUNCTION qualifying_gaps(p_standard uuid DEFAULT NULL, p_student uuid DEFAULT NULL)
RETURNS TABLE (
  standard_id   uuid,
  student_id    uuid,
  age_group_id  uuid,
  stroke        swim_stroke,
  distance_m    integer,
  course        swim_course,
  entry_ms      integer,
  best_ms       integer,
  best_swum_on  date,
  best_meet     text
)
LANGUAGE sql STABLE
AS $$
  WITH std AS (
    SELECT q.id, q.season_id,
           coalesce(q.window_from, se.starts_on) AS valid_from,
           coalesce(q.window_to, se.ends_on)     AS valid_to
      FROM qualifying_standard q
      JOIN season se ON se.id = q.season_id AND se.organization_id = q.organization_id
     WHERE q.archived_at IS NULL
       AND (p_standard IS NULL OR q.id = p_standard)
  ),
  eligible AS (
    SELECT std.id AS standard_id, std.valid_from, std.valid_to, s.id AS student_id, g.id AS age_group_id
      FROM std
      JOIN federation_age_group g ON g.season_id = std.season_id AND g.archived_at IS NULL
      JOIN student s ON s.archived_at IS NULL
                    AND (p_student IS NULL OR s.id = p_student)
                    AND federation_age_group_admits(g.gender, g.born_from, g.born_to, s.birth_date, s.gender)
  )
  SELECT e.standard_id, e.student_id, e.age_group_id, qt.stroke, qt.distance_m, qt.course,
         qt.time_ms, b.time_ms, b.swum_on, b.meet_name
    FROM eligible e
    JOIN qualifying_time qt ON qt.standard_id = e.standard_id
                           AND qt.age_group_id = e.age_group_id
                           AND qt.archived_at IS NULL
    LEFT JOIN LATERAL (
      SELECT r.time_ms, r.swum_on, sm.name AS meet_name
        FROM student_record r
        JOIN swim_meet sm ON sm.id = r.meet_id AND sm.organization_id = r.organization_id
       WHERE r.student_id = e.student_id
         AND r.archived_at IS NULL
         AND sm.archived_at IS NULL
         AND sm.official
         AND r.stroke = qt.stroke
         AND r.distance_m = qt.distance_m
         AND r.course = qt.course
         AND r.swum_on BETWEEN e.valid_from AND e.valid_to
       ORDER BY r.time_ms, r.swum_on
       LIMIT 1
    ) b ON true
$$;

COMMENT ON FUNCTION qualifying_gaps(uuid, uuid) IS
  'POOLSE-85: the one definition of a valid time and the gap. Same course, official live '
  'meet, inside the window (else the season). Read by Progressão and the Mínimos board.';

DROP FUNCTION IF EXISTS qualifying_attempts(uuid, uuid);
