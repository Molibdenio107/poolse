-- Up Migration
--
-- Moving one Tuesday without moving every Tuesday.
--
-- A drag on the calendar edited the weekly pattern, so it changed the class for
-- the rest of the season. That is right about half the time. The other half is
-- "the pool is booked this Tuesday, put this week's class on Wednesday" — and
-- there was no way to say it.
--
-- Two columns make the difference:
--
-- **`occurs_on`** — the calendar day the *pattern* implied, fixed when the
-- session was generated and never changed by a move. It is what the generator
-- dedupes on, so a class moved from Tuesday to Wednesday is not quietly
-- recreated on Tuesday the next time somebody regenerates the season. Dedupe on
-- `starts_at` could not do that: the moment a session moves, its `starts_at` no
-- longer matches what the pattern would produce, and the pattern produces it
-- again.
--
-- **`moved_at`** — set when an operator moves that one occurrence. A pattern
-- move skips those, because somebody has already said what should happen that
-- week and a later "every week" must not silently undo it.

ALTER TABLE class_session
  ADD COLUMN occurs_on date,
  ADD COLUMN moved_at  timestamptz;

COMMENT ON COLUMN class_session.occurs_on IS
  'The calendar day the pattern implied. Fixed at generation; a move never changes it.';
COMMENT ON COLUMN class_session.moved_at IS
  'Set when this one occurrence was moved by hand. Pattern moves leave these alone.';

/*
 * Backfilled from where each session actually is, which is where its pattern put
 * it: nothing has been moved yet, because until now there was no way to.
 */
UPDATE class_session cs
   SET occurs_on = session_local_date(cs.organization_id, cs.pool_id, cs.starts_at);

ALTER TABLE class_session ALTER COLUMN occurs_on SET NOT NULL;

/*
 * One occurrence per booking per day, replacing the key on `starts_at`.
 *
 * Partial on `schedule_id`, as before: the sessions POOLSE-46 could not match to
 * a booking carry a null and must not collide with one another.
 */
DROP INDEX class_session_booking_uq;

CREATE UNIQUE INDEX class_session_booking_uq
  ON class_session (schedule_id, occurs_on)
  WHERE schedule_id IS NOT NULL;

CREATE INDEX class_session_occurs_idx
  ON class_session (organization_id, occurs_on);

-- ---------------------------------------------------------------------------
-- A session always knows which day it belongs to
-- ---------------------------------------------------------------------------
--
-- `occurs_on` is NOT NULL, and the generator writes it — but the generator is
-- not the only thing that inserts a session. A reposicao, a fixture, a one-off
-- class added by hand: every one of those would have to learn a new column, and
-- the one that was missed would fail at runtime rather than here.
--
-- So a null means "the day this session actually starts on", which is what the
-- pattern would have said anyway. Explicit callers still win: the generator
-- passes the day the *pattern* implied, which is the point of the column.
CREATE FUNCTION class_session_default_occurs_on() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.occurs_on IS NULL THEN
    NEW.occurs_on := session_local_date(NEW.organization_id, NEW.pool_id, NEW.starts_at);
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER class_session_default_occurs_on BEFORE INSERT ON class_session
  FOR EACH ROW EXECUTE FUNCTION class_session_default_occurs_on();

-- ---------------------------------------------------------------------------
-- The generator stamps the day it generated for
-- ---------------------------------------------------------------------------
--
-- Only two things change: `occurs_on` is written, and the conflict target is the
-- new key. Everything else is POOLSE-46's function unchanged.

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

-- Down Migration
--
-- The generator goes back to keying on the instant, and the two columns go. A
-- session that had been moved for one week keeps where it was moved to — there
-- is nothing in the old shape that says it was moved, so the next regeneration
-- will put a second one back on its original day. Recorded rather than
-- prevented: the old shape genuinely could not express this.

DROP INDEX IF EXISTS class_session_occurs_idx;
DROP INDEX class_session_booking_uq;

CREATE UNIQUE INDEX class_session_booking_uq
  ON class_session (schedule_id, starts_at)
  WHERE schedule_id IS NOT NULL;

DROP TRIGGER class_session_default_occurs_on ON class_session;
DROP FUNCTION class_session_default_occurs_on();

ALTER TABLE class_session
  DROP COLUMN moved_at,
  DROP COLUMN occurs_on;

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
      organization_id, schedule_id, class_group_id, pool_id, starts_at, duration_minutes,
      instructor_membership_id
    )
    SELECT p_organization_id,
           o.schedule_id,
           o.class_group_id,
           o.pool_id,
           (o.on_date + o.start_time) AT TIME ZONE o.timezone,
           o.duration_minutes,
           o.instructor_membership_id
      FROM occurrences o
    ON CONFLICT (schedule_id, starts_at) WHERE schedule_id IS NOT NULL DO NOTHING
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
