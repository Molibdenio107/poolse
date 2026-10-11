-- Up Migration
--
-- One clash no longer empties the calendar — 11 October 2026.
--
-- Lessons are generated automatically whenever a weekly pattern is written
-- (apps/api/src/classes/lesson-sync.ts). Two turmas sharing an instructor at one
-- hour used to refuse generation for the whole club, so a single clash left every
-- turma without its season. `generate_sessions` gains an optional list of turmas
-- to leave out; the API passes the two in each clash and names them, and every
-- other turma is generated. The body is the previous definition
-- (1788004800000_move-one-occurrence.sql) with that one filter added; a caller
-- with three arguments gets exactly the old behaviour.

DROP FUNCTION generate_sessions(uuid, date, date);

CREATE FUNCTION generate_sessions(
  p_organization_id uuid,
  p_from            date,
  p_to              date,
  p_skip_groups     uuid[] DEFAULT '{}'
) RETURNS TABLE (
  o_created   integer,
  o_cancelled integer,
  o_restored  integer
)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_created   integer := 0;
  v_cancelled integer := 0;
  v_restored  integer := 0;
BEGIN
  IF p_to < p_from THEN
    RAISE EXCEPTION 'generate_sessions: the window ends before it starts';
  END IF;

  -- 1. Create what is missing.
  WITH slots AS (
    SELECT sch.id AS schedule_id,
           sch.class_group_id,
           cg.pool_id,
           coalesce(sch.instructor_membership_id, cg.instructor_membership_id)
             AS instructor_membership_id,
           sch.weekday,
           sch.start_time,
           sch.duration_minutes,
           coalesce(f.timezone, 'Europe/Lisbon') AS timezone,
           greatest(p_from, coalesce(cg.starts_on, p_from), se.starts_on) AS window_from,
           least(p_to,   coalesce(cg.ends_on,   p_to),   se.ends_on)      AS window_to
      FROM class_schedule sch
      JOIN facility fac
        ON fac.id = sch.facility_id AND fac.organization_id = sch.organization_id
      LEFT JOIN class_group cg
        ON cg.id = sch.class_group_id
       AND cg.organization_id = sch.organization_id
       AND cg.archived_at IS NULL
      JOIN season se
        ON se.organization_id = sch.organization_id
       AND se.id = coalesce(cg.season_id, (
             SELECT s2.id FROM season s2
              WHERE s2.organization_id = sch.organization_id AND s2.status = 'published'
           ))
       AND se.status = 'published'
      LEFT JOIN pool p ON p.id = cg.pool_id AND p.organization_id = cg.organization_id
      LEFT JOIN facility f ON f.id = coalesce(p.facility_id, sch.facility_id)
                          AND f.organization_id = sch.organization_id
     WHERE sch.organization_id = p_organization_id
       AND sch.archived_at IS NULL
       AND (sch.subject_type <> 'turma' OR cg.id IS NOT NULL)
       -- The turmas a clash leaves out — 11 October 2026. Two turmas sharing an
       -- instructor at one hour would make the instructor exclusion refuse the
       -- whole statement, so they are skipped and named, and every other turma
       -- still gets its season.
       AND (sch.class_group_id IS NULL OR NOT (sch.class_group_id = ANY (p_skip_groups)))
  ),
  occurrences AS (
    SELECT s.*, d::date AS on_date
      FROM slots s
      CROSS JOIN LATERAL generate_series(s.window_from, s.window_to, interval '1 day') AS d
     WHERE extract(ISODOW FROM d) = s.weekday
       AND NOT EXISTS (
         SELECT 1 FROM closure c
          WHERE c.organization_id = p_organization_id
            AND c.archived_at IS NULL
            AND c.blocks_generation
            AND (c.pool_id IS NULL OR c.pool_id = s.pool_id)
            AND closure_covers(c.starts_on, c.ends_on, c.repeats_annually, d::date)
       )
  ),
  inserted AS (
    INSERT INTO class_session (
      organization_id, schedule_id, class_group_id, pool_id, occurs_on,
      starts_at, duration_minutes, instructor_membership_id
    )
    SELECT p_organization_id,
           o.schedule_id,
           o.class_group_id,
           o.pool_id,
           o.on_date,
           (o.on_date + o.start_time) AT TIME ZONE o.timezone,
           o.duration_minutes,
           o.instructor_membership_id
      FROM occurrences o
    -- The day, not the instant: a session moved to another time still occupies
    -- its week, and regenerating must not put a second one back where it was.
    ON CONFLICT (schedule_id, occurs_on) WHERE schedule_id IS NOT NULL DO NOTHING
    RETURNING id, schedule_id, starts_at, ends_at
  ),
  laned AS (
    INSERT INTO class_session_lane
      (organization_id, session_id, lane_id, starts_at, ends_at, cancelled)
    SELECT p_organization_id, i.id, bl.lane_id, i.starts_at, i.ends_at, false
      FROM inserted i
      JOIN booking_lane bl
        ON bl.schedule_id = i.schedule_id AND bl.organization_id = p_organization_id
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_created FROM inserted;

  -- 2. Cancel what a closure now covers — on the pool's own calendar day.
  WITH cancelled AS (
    UPDATE class_session cs
       SET status = 'cancelled',
           closure_id = c.id,
           cancellation_reason = c.reason
      FROM closure c
     WHERE cs.organization_id = p_organization_id
       AND c.organization_id = p_organization_id
       AND c.archived_at IS NULL
       AND c.blocks_generation
       AND (c.pool_id IS NULL OR c.pool_id = cs.pool_id)
       AND cs.status = 'scheduled'
       AND closure_covers(
             c.starts_on, c.ends_on, c.repeats_annually,
             session_local_date(p_organization_id, cs.pool_id, cs.starts_at)
           )
    RETURNING 1
  )
  SELECT count(*) INTO v_cancelled FROM cancelled;

  -- 3. Put back what a removed closure no longer covers.
  WITH restored AS (
    UPDATE class_session cs
       SET status = 'scheduled',
           closure_id = NULL,
           cancellation_reason = NULL
     WHERE cs.organization_id = p_organization_id
       AND cs.status = 'cancelled'
       AND cs.closure_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM closure c
          WHERE c.id = cs.closure_id
            AND c.archived_at IS NULL
            AND c.blocks_generation
            AND closure_covers(
                  c.starts_on, c.ends_on, c.repeats_annually,
                  session_local_date(p_organization_id, cs.pool_id, cs.starts_at)
                )
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_restored FROM restored;

  RETURN QUERY SELECT v_created, v_cancelled, v_restored;
END;
$fn$;

-- Down Migration

DROP FUNCTION IF EXISTS generate_sessions(uuid, date, date, uuid[]);

CREATE OR REPLACE FUNCTION generate_sessions(
  p_organization_id uuid,
  p_from            date,
  p_to              date
) RETURNS TABLE (
  o_created   integer,
  o_cancelled integer,
  o_restored  integer
)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_created   integer := 0;
  v_cancelled integer := 0;
  v_restored  integer := 0;
BEGIN
  IF p_to < p_from THEN
    RAISE EXCEPTION 'generate_sessions: the window ends before it starts';
  END IF;

  -- 1. Create what is missing.
  WITH slots AS (
    SELECT sch.id AS schedule_id,
           sch.class_group_id,
           cg.pool_id,
           coalesce(sch.instructor_membership_id, cg.instructor_membership_id)
             AS instructor_membership_id,
           sch.weekday,
           sch.start_time,
           sch.duration_minutes,
           coalesce(f.timezone, 'Europe/Lisbon') AS timezone,
           greatest(p_from, coalesce(cg.starts_on, p_from), se.starts_on) AS window_from,
           least(p_to,   coalesce(cg.ends_on,   p_to),   se.ends_on)      AS window_to
      FROM class_schedule sch
      JOIN facility fac
        ON fac.id = sch.facility_id AND fac.organization_id = sch.organization_id
      LEFT JOIN class_group cg
        ON cg.id = sch.class_group_id
       AND cg.organization_id = sch.organization_id
       AND cg.archived_at IS NULL
      JOIN season se
        ON se.organization_id = sch.organization_id
       AND se.id = coalesce(cg.season_id, (
             SELECT s2.id FROM season s2
              WHERE s2.organization_id = sch.organization_id AND s2.status = 'published'
           ))
       AND se.status = 'published'
      LEFT JOIN pool p ON p.id = cg.pool_id AND p.organization_id = cg.organization_id
      LEFT JOIN facility f ON f.id = coalesce(p.facility_id, sch.facility_id)
                          AND f.organization_id = sch.organization_id
     WHERE sch.organization_id = p_organization_id
       AND sch.archived_at IS NULL
       AND (sch.subject_type <> 'turma' OR cg.id IS NOT NULL)
  ),
  occurrences AS (
    SELECT s.*, d::date AS on_date
      FROM slots s
      CROSS JOIN LATERAL generate_series(s.window_from, s.window_to, interval '1 day') AS d
     WHERE extract(ISODOW FROM d) = s.weekday
       AND NOT EXISTS (
         SELECT 1 FROM closure c
          WHERE c.organization_id = p_organization_id
            AND c.archived_at IS NULL
            AND c.blocks_generation
            AND (c.pool_id IS NULL OR c.pool_id = s.pool_id)
            AND closure_covers(c.starts_on, c.ends_on, c.repeats_annually, d::date)
       )
  ),
  inserted AS (
    INSERT INTO class_session (
      organization_id, schedule_id, class_group_id, pool_id, occurs_on,
      starts_at, duration_minutes, instructor_membership_id
    )
    SELECT p_organization_id,
           o.schedule_id,
           o.class_group_id,
           o.pool_id,
           o.on_date,
           (o.on_date + o.start_time) AT TIME ZONE o.timezone,
           o.duration_minutes,
           o.instructor_membership_id
      FROM occurrences o
    -- The day, not the instant: a session moved to another time still occupies
    -- its week, and regenerating must not put a second one back where it was.
    ON CONFLICT (schedule_id, occurs_on) WHERE schedule_id IS NOT NULL DO NOTHING
    RETURNING id, schedule_id, starts_at, ends_at
  ),
  laned AS (
    INSERT INTO class_session_lane
      (organization_id, session_id, lane_id, starts_at, ends_at, cancelled)
    SELECT p_organization_id, i.id, bl.lane_id, i.starts_at, i.ends_at, false
      FROM inserted i
      JOIN booking_lane bl
        ON bl.schedule_id = i.schedule_id AND bl.organization_id = p_organization_id
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_created FROM inserted;

  -- 2. Cancel what a closure now covers — on the pool's own calendar day.
  WITH cancelled AS (
    UPDATE class_session cs
       SET status = 'cancelled',
           closure_id = c.id,
           cancellation_reason = c.reason
      FROM closure c
     WHERE cs.organization_id = p_organization_id
       AND c.organization_id = p_organization_id
       AND c.archived_at IS NULL
       AND c.blocks_generation
       AND (c.pool_id IS NULL OR c.pool_id = cs.pool_id)
       AND cs.status = 'scheduled'
       AND closure_covers(
             c.starts_on, c.ends_on, c.repeats_annually,
             session_local_date(p_organization_id, cs.pool_id, cs.starts_at)
           )
    RETURNING 1
  )
  SELECT count(*) INTO v_cancelled FROM cancelled;

  -- 3. Put back what a removed closure no longer covers.
  WITH restored AS (
    UPDATE class_session cs
       SET status = 'scheduled',
           closure_id = NULL,
           cancellation_reason = NULL
     WHERE cs.organization_id = p_organization_id
       AND cs.status = 'cancelled'
       AND cs.closure_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM closure c
          WHERE c.id = cs.closure_id
            AND c.archived_at IS NULL
            AND c.blocks_generation
            AND closure_covers(
                  c.starts_on, c.ends_on, c.repeats_annually,
                  session_local_date(p_organization_id, cs.pool_id, cs.starts_at)
                )
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_restored FROM restored;

  RETURN QUERY SELECT v_created, v_cancelled, v_restored;
END;
$fn$;
