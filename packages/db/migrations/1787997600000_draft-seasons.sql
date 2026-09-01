-- Up Migration
--
-- Planning next season while this one runs — POOLSE-45.
--
-- A club builds the 2026/2027 grid in June, argues about it for three weeks, and
-- switches over in September. For those three weeks both versions have to exist
-- without the draft one showing up on anybody's calendar.
--
-- Poolse had seasons (POOLSE-07) but exactly one could be current, enforced by a
-- unique index. That was right when a season was only a container for turmas. It
-- is wrong the moment the season also owns a slot grid (POOLSE-44) and a set of
-- bookings, because then "planning next year" means editing the thing the club
-- is currently running.
--
-- **`archived_at` stays.** It records *when* a season stopped being current,
-- which the status does not, and both POOLSE-07's reset flow and its migration
-- write it. Status is the state; `archived_at` is the timestamp. Collapsing them
-- would lose the date a season was retired.
--
-- **The generator learns to refuse a draft.** Without that guard, a turma parked
-- in next year's plan would generate two hundred dated sessions onto the
-- calendar the club is using today — which is the one failure this whole ticket
-- exists to prevent.

CREATE TYPE season_status AS ENUM ('draft', 'published', 'archived');

ALTER TABLE season ADD COLUMN status season_status NOT NULL DEFAULT 'published';

-- What the club already has: the current one is published, the retired ones are
-- archived, and nobody is asked to restate something the data already says.
UPDATE season SET status = CASE
  WHEN archived_at IS NULL THEN 'published'::season_status
  ELSE 'archived'::season_status
END;

/*
 * Exactly one *published* season per organization, where there used to be
 * exactly one unarchived one.
 *
 * Drafts are unarchived too, so the old index would have refused the second one
 * — which is the whole feature. Enforced by an index rather than by the publish
 * code, because the publish code is not the only thing that will ever write
 * here.
 */
DROP INDEX season_one_active;

CREATE UNIQUE INDEX season_one_published
  ON season (organization_id) WHERE status = 'published';

/*
 * A retired season is never the one running.
 *
 * `status` is the state and `archived_at` is the timestamp, which leaves one
 * combination that means nothing: archived_at set while the status still says
 * published. Before this ticket, archiving *was* setting `archived_at`, so any
 * writer still doing only that would leave the season looking current to the
 * partial index and retired to a reader — and the next season could not be
 * opened, with an error naming an index rather than the mistake.
 *
 * A CHECK rather than a trigger that quietly corrects it: the write is wrong,
 * and being told so is more useful than being fixed.
 */
ALTER TABLE season ADD CONSTRAINT season_retired_is_not_published
  CHECK (archived_at IS NULL OR status <> 'published');

CREATE INDEX season_status_idx ON season (organization_id, status);

-- ---------------------------------------------------------------------------
-- The generator, taught that a draft is a plan
-- ---------------------------------------------------------------------------
--
-- Replaced whole rather than patched: a plpgsql body has no way to be edited
-- in place, and half of one is worse than a duplicate. The only change is the
-- season predicate.

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
           cg.lane_id,
           cg.instructor_membership_id,
           cs.weekday,
           cs.start_time,
           cs.duration_minutes,
           coalesce(f.timezone, 'Europe/Lisbon') AS timezone,
           -- Bounded by the season as well as by the turma and the window. A
           -- turma from a retired season must not gain new sessions because
           -- somebody generated a wide range.
           greatest(p_from, coalesce(cg.starts_on, p_from), se.starts_on) AS window_from,
           least(p_to,   coalesce(cg.ends_on,   p_to),   se.ends_on)      AS window_to
      FROM class_group cg
      JOIN season se
        ON se.id = cg.season_id
       AND se.organization_id = cg.organization_id
       -- Published only — POOLSE-45. A draft is a plan; generating from one
       -- would put two hundred phantom sessions on the club's calendar.
       AND se.status = 'published'
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
      organization_id, class_group_id, pool_id, lane_id, starts_at, duration_minutes,
      instructor_membership_id
    )
    SELECT p_organization_id,
           o.class_group_id,
           o.pool_id,
           o.lane_id,
           (o.on_date + o.start_time) AT TIME ZONE o.timezone,
           o.duration_minutes,
           o.instructor_membership_id
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

  -- 3. Put back what a removed closure no longer covers. A cancellation made by
  --    a person carries no closure_id and is never touched here.
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
$$;

-- ---------------------------------------------------------------------------
-- Publishing, as one statement
-- ---------------------------------------------------------------------------
--
-- The incumbent has to be archived *before* the draft is published, or the
-- partial unique index refuses the second update — and a moment with two
-- published seasons, or none, is a moment where every screen that filters by the
-- current season is wrong.
--
-- A function rather than two statements in the repository, because the ordering
-- is the correctness and it should not be re-derived by the next caller. Plain
-- `SECURITY INVOKER`: the caller is already tenant-scoped and RLS applies, which
-- is exactly what should happen.

CREATE FUNCTION publish_season(p_organization_id uuid, p_season_id uuid)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_status season_status;
BEGIN
  SELECT status INTO v_status
    FROM season
   WHERE id = p_season_id AND organization_id = p_organization_id
   FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN false;
  END IF;

  -- Publishing what is already published is not an error and not a change.
  IF v_status = 'published' THEN
    RETURN true;
  END IF;

  IF v_status = 'archived' THEN
    RAISE EXCEPTION 'publish_season: an archived season cannot be published';
  END IF;

  -- Order matters: retire first, so the partial index is free when the draft
  -- takes the slot.
  UPDATE season
     SET status = 'archived', archived_at = coalesce(archived_at, now())
   WHERE organization_id = p_organization_id AND status = 'published';

  UPDATE season
     SET status = 'published', archived_at = NULL
   WHERE id = p_season_id AND organization_id = p_organization_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION publish_season(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION publish_season(uuid, uuid) TO poolse_app;


-- Down Migration
--
-- Drafts have nowhere to go in the old shape: it could hold one current season
-- and any number of archived ones, and a draft is neither. They are archived on
-- the way back, which keeps every row and loses only the distinction.

DROP FUNCTION IF EXISTS publish_season(uuid, uuid);

UPDATE season SET archived_at = coalesce(archived_at, now())
 WHERE status = 'draft';

ALTER TABLE season DROP CONSTRAINT IF EXISTS season_retired_is_not_published;
DROP INDEX IF EXISTS season_status_idx;
DROP INDEX IF EXISTS season_one_published;

CREATE UNIQUE INDEX season_one_active
  ON season (organization_id) WHERE archived_at IS NULL;

ALTER TABLE season DROP COLUMN status;
DROP TYPE IF EXISTS season_status;

-- The generator, back on "any unarchived season".

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
           cg.lane_id,
           cg.instructor_membership_id,
           cs.weekday,
           cs.start_time,
           cs.duration_minutes,
           coalesce(f.timezone, 'Europe/Lisbon') AS timezone,
           -- Bounded by the season as well as by the turma and the window. A
           -- turma from a retired season must not gain new sessions because
           -- somebody generated a wide range.
           greatest(p_from, coalesce(cg.starts_on, p_from), se.starts_on) AS window_from,
           least(p_to,   coalesce(cg.ends_on,   p_to),   se.ends_on)      AS window_to
      FROM class_group cg
      JOIN season se
        ON se.id = cg.season_id
       AND se.organization_id = cg.organization_id
       AND se.archived_at IS NULL
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
      organization_id, class_group_id, pool_id, lane_id, starts_at, duration_minutes,
      instructor_membership_id
    )
    SELECT p_organization_id,
           o.class_group_id,
           o.pool_id,
           o.lane_id,
           (o.on_date + o.start_time) AT TIME ZONE o.timezone,
           o.duration_minutes,
           o.instructor_membership_id
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

  -- 3. Put back what a removed closure no longer covers. A cancellation made by
  --    a person carries no closure_id and is never touched here.
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
$$;
