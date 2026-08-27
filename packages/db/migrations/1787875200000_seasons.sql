-- Up Migration
--
-- Seasons — POOLSE-07.
--
-- "Reset season" needs a season to reset. Until now a season was only a date
-- range handed to `generate_sessions` — no row, so nothing for classes,
-- enrolments or attendance to belong to and nothing to archive or make active.
--
-- **A turma belongs to a season; everything else follows it.** `class_session`
-- and `enrollment` hang off `class_group`, so a turma moving to a season takes
-- its sessions, its enrolments and their attendance with it. Denormalising a
-- `season_id` onto three tables would be three chances for them to disagree
-- about which season a class was in.
--
-- That is also what makes the reset cheap and safe: archiving a season and
-- creating a new one deletes nothing. The old turmas stay attached to the old
-- season, keep every session and every register, and simply stop appearing in
-- the new one. The new season is empty because no turma points at it yet.
--
-- Students, levels, pools and staff are tenant data and are untouched by a
-- reset. They belong to the club, not to a year of it.

CREATE TABLE season (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),

  name            text NOT NULL,
  starts_on       date NOT NULL,
  ends_on         date NOT NULL,

  /*
   * Archived is not the same as soft-deleted, which is why this is a status and
   * not just `archived_at`.
   *
   * An archived season stays fully readable — classes, enrolments, attendance,
   * history — and remains selectable in reporting. `archived_at` says when it
   * stopped being current, not that it is gone.
   */
  archived_at     timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),

  CHECK (btrim(name) <> ''),
  CHECK (ends_on >= starts_on)
);

/*
 * Exactly one current season per organization.
 *
 * A club looking at two "current" seasons cannot say which turmas are running,
 * and every screen that filters by the active one would have to pick. Enforced
 * by an index rather than by the reset code, because the reset is not the only
 * thing that will ever write here.
 */
CREATE UNIQUE INDEX season_one_active
  ON season (organization_id) WHERE archived_at IS NULL;

CREATE INDEX season_range_idx ON season (organization_id, starts_on DESC);

CREATE TRIGGER season_updated_at BEFORE UPDATE ON season
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE season ENABLE ROW LEVEL SECURITY;
CREATE POLICY season_tenant ON season
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON season TO poolse_app;

-- ---------------------------------------------------------------------------
-- Every organization gets its current season, and every turma joins it
--
-- Named from the range it covers — "2026/2027" — because that is what a club
-- calls it. September to August, matching `seasonOf` in the web app: a swimming
-- school's year starts when school does and stops for the August holidays.
--
-- August belongs to the season ahead, for the same reason `seasonOf` pivots
-- there: August is the month the pool is shut, so there is never anything left
-- to run in it.
-- ---------------------------------------------------------------------------

INSERT INTO season (organization_id, name, starts_on, ends_on)
SELECT o.id,
       to_char(start_year, 'FM9999') || '/' || to_char(start_year + 1, 'FM9999'),
       make_date(start_year, 9, 1),
       make_date(start_year + 1, 8, 31)
  FROM organization o
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN extract(month FROM current_date) >= 8
               THEN extract(year FROM current_date)::int
             ELSE extract(year FROM current_date)::int - 1
           END AS start_year
  ) AS s
 WHERE o.archived_at IS NULL;

ALTER TABLE class_group ADD COLUMN season_id uuid;

UPDATE class_group cg
   SET season_id = s.id
  FROM season s
 WHERE s.organization_id = cg.organization_id
   AND s.archived_at IS NULL;

/*
 * NOT NULL only after the backfill.
 *
 * A turma with no season would be invisible on every screen that filters by one
 * — present in the database and absent from the product, which is the worst of
 * both. Any organization archived before this migration has no season and no
 * turmas either, so nothing is stranded.
 */
ALTER TABLE class_group ALTER COLUMN season_id SET NOT NULL;

ALTER TABLE class_group
  ADD CONSTRAINT class_group_organization_id_season_id_fkey
  FOREIGN KEY (organization_id, season_id) REFERENCES season (organization_id, id);

CREATE INDEX class_group_season_idx
  ON class_group (organization_id, season_id) WHERE archived_at IS NULL;

COMMENT ON COLUMN class_group.season_id IS
  'The season this turma runs in. Sessions and enrolments follow it, so archiving '
  'a season retires its turmas without deleting anything.';

-- ---------------------------------------------------------------------------
-- generate_sessions — only for the season that is running
--
-- Replaced whole rather than patched, for the same reason as last time: it is one
-- function and a partial edit is how the three passes stop agreeing. Only the
-- `slots` CTE differs from the version in 1787853600000_scheduling-and-levels.sql.
-- ---------------------------------------------------------------------------

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
      organization_id, class_group_id, pool_id, lane, starts_at, duration_minutes,
      instructor_membership_id
    )
    SELECT p_organization_id,
           o.class_group_id,
           o.pool_id,
           o.lane,
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

-- Down Migration

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
           cg.instructor_membership_id,
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
      organization_id, class_group_id, pool_id, lane, starts_at, duration_minutes,
      instructor_membership_id
    )
    SELECT p_organization_id,
           o.class_group_id,
           o.pool_id,
           o.lane,
           (o.on_date + o.start_time) AT TIME ZONE o.timezone,
           o.duration_minutes,
           o.instructor_membership_id
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
$$;

DROP INDEX IF EXISTS class_group_season_idx;
ALTER TABLE class_group DROP CONSTRAINT IF EXISTS class_group_organization_id_season_id_fkey;
ALTER TABLE class_group DROP COLUMN IF EXISTS season_id;

DROP TABLE IF EXISTS season;
