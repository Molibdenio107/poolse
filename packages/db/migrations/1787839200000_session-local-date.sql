-- Up Migration
--
-- Fixes a one-day disagreement inside `generate_sessions`.
--
-- The three passes have to agree on one question: which local day is this
-- session on? Pass 1 answered it in the facility's own timezone, because that is
-- how the sessions are built. Passes 2 and 3 — cancel, and restore — answered it
-- in UTC, which is the same day right up until it is not.
--
-- It is not the same day for a class at 23:30 in the Azores: 23:30 on Tuesday is
-- 00:30 UTC on Wednesday, so a closure on that Tuesday would step over it, and a
-- closure on the Wednesday would cancel a class nobody said to cancel. Nothing
-- would look wrong — the class simply would not be there, or would be, and the
-- calendar would be quietly one day out for the one facility in the country
-- keeping a different clock.
--
-- Rare, but silent, and the whole point of these two slices is that "there is no
-- class on the 15th" can be trusted. A rare wrong answer given confidently is
-- worse than a common one.

-- Named rather than inlined three times, so the next person to touch the
-- generator cannot fix two call sites and miss the third — which is how the two
-- passes came apart in the first place.
--
-- STABLE, not IMMUTABLE: it reads `facility.timezone`, and a facility that moves
-- from Lisbon to Ponta Delgada changes the answer. That rules it out of an index
-- and matters nowhere else.
CREATE OR REPLACE FUNCTION session_local_date(
  p_organization_id uuid,
  p_pool_id         uuid,
  p_starts_at       timestamptz
) RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT (p_starts_at AT TIME ZONE coalesce((
    SELECT f.timezone
      FROM pool p
      JOIN facility f
        ON f.id = p.facility_id AND f.organization_id = p.organization_id
     WHERE p.id = p_pool_id AND p.organization_id = p_organization_id
  ), 'Europe/Lisbon'))::date
$$;

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
AS $$
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
    SELECT cg.id  AS class_group_id,
           cg.pool_id,
           cg.lane,
           cs.weekday,
           cs.start_time,
           cs.duration_minutes,
           coalesce(f.timezone, 'Europe/Lisbon') AS timezone,
           greatest(p_from, coalesce(cg.starts_on, p_from)) AS window_from,
           least(p_to,   coalesce(cg.ends_on,   p_to))      AS window_to
      FROM class_group cg
      JOIN class_schedule cs
        ON cs.class_group_id = cg.id
       AND cs.organization_id = cg.organization_id
       AND cs.archived_at IS NULL
      LEFT JOIN pool p     ON p.id = cg.pool_id     AND p.organization_id = cg.organization_id
      LEFT JOIN facility f ON f.id = p.facility_id  AND f.organization_id = cg.organization_id
     WHERE cg.organization_id = p_organization_id
       AND cg.archived_at IS NULL
  ),
  occurrences AS (
    SELECT s.*, d::date AS on_date
      FROM slots s
      CROSS JOIN LATERAL generate_series(s.window_from, s.window_to, interval '1 day') AS d
     WHERE extract(ISODOW FROM d) = s.weekday
       -- Skip the days a blocking closure covers. Generating them and then
       -- cancelling them in step 2 would work, but it would fill August with
       -- cancelled rows nobody asked for.
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
      organization_id, class_group_id, pool_id, lane, starts_at, duration_minutes
    )
    SELECT p_organization_id,
           o.class_group_id,
           o.pool_id,
           o.lane,
           (o.on_date + o.start_time) AT TIME ZONE o.timezone,
           o.duration_minutes
      FROM occurrences o
    ON CONFLICT (class_group_id, starts_at) DO NOTHING
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
       AND cs.status = 'scheduled'
       AND c.organization_id = p_organization_id
       AND c.archived_at IS NULL
       AND c.blocks_generation
       AND (c.pool_id IS NULL OR c.pool_id = cs.pool_id)
       AND closure_covers(c.starts_on, c.ends_on, c.repeats_annually,
                          session_local_date(cs.organization_id, cs.pool_id, cs.starts_at))
    RETURNING 1
  )
  SELECT count(*) INTO v_cancelled FROM cancelled;

  -- 3. Restore what a removed closure was holding down. Only rows this function
  -- cancelled — a class called off by a person keeps its cancellation.
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
            AND closure_covers(c.starts_on, c.ends_on, c.repeats_annually,
                               session_local_date(cs.organization_id, cs.pool_id, cs.starts_at))
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_restored FROM restored;

  RETURN QUERY SELECT v_created, v_cancelled, v_restored;
END;
$$;

-- Down Migration
--
-- Puts back the previous body verbatim, UTC comparison and all. Dropping the
-- helper on its own would leave `generate_sessions` referring to a function that
-- is not there — a rollback that breaks the thing it was rolling back.

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
AS $$
DECLARE
  v_created   integer := 0;
  v_cancelled integer := 0;
  v_restored  integer := 0;
BEGIN
  IF p_to < p_from THEN
    RAISE EXCEPTION 'generate_sessions: the window ends before it starts';
  END IF;

  WITH slots AS (
    SELECT cg.id  AS class_group_id,
           cg.pool_id,
           cg.lane,
           cs.weekday,
           cs.start_time,
           cs.duration_minutes,
           coalesce(f.timezone, 'Europe/Lisbon') AS timezone,
           greatest(p_from, coalesce(cg.starts_on, p_from)) AS window_from,
           least(p_to,   coalesce(cg.ends_on,   p_to))      AS window_to
      FROM class_group cg
      JOIN class_schedule cs
        ON cs.class_group_id = cg.id
       AND cs.organization_id = cg.organization_id
       AND cs.archived_at IS NULL
      LEFT JOIN pool p     ON p.id = cg.pool_id     AND p.organization_id = cg.organization_id
      LEFT JOIN facility f ON f.id = p.facility_id  AND f.organization_id = cg.organization_id
     WHERE cg.organization_id = p_organization_id
       AND cg.archived_at IS NULL
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
      organization_id, class_group_id, pool_id, lane, starts_at, duration_minutes
    )
    SELECT p_organization_id,
           o.class_group_id,
           o.pool_id,
           o.lane,
           (o.on_date + o.start_time) AT TIME ZONE o.timezone,
           o.duration_minutes
      FROM occurrences o
    ON CONFLICT (class_group_id, starts_at) DO NOTHING
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
       AND cs.status = 'scheduled'
       AND c.organization_id = p_organization_id
       AND c.archived_at IS NULL
       AND c.blocks_generation
       AND (c.pool_id IS NULL OR c.pool_id = cs.pool_id)
       AND closure_covers(c.starts_on, c.ends_on, c.repeats_annually,
                          (cs.starts_at AT TIME ZONE 'UTC')::date)
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
            AND closure_covers(c.starts_on, c.ends_on, c.repeats_annually,
                               (cs.starts_at AT TIME ZONE 'UTC')::date)
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_restored FROM restored;

  RETURN QUERY SELECT v_created, v_cancelled, v_restored;
END;
$$;

DROP FUNCTION IF EXISTS session_local_date(uuid, uuid, timestamptz);
