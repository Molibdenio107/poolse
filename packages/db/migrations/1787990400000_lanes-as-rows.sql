-- Up Migration
--
-- A lane becomes a thing that exists — POOLSE-43.
--
-- A real club's schedule is written per lane, not per pool. In the reference
-- sheet every time slot is split into `Pista 1..6` and four or five groups run
-- at once in the same tank, each on its own lane with its own level and
-- instructor. Poolse stored a lane as a bare `smallint` on the turma: no name,
-- no capacity, nothing stopping somebody typing lane 7 in a six-lane pool, and
-- no way for one booking to span several lanes.
--
-- **A pool without lanes still gets exactly one lane row**, named after the
-- pool. The alternative — a nullable `lane_id` meaning "the whole pool" — puts a
-- null branch in every join, every conflict check and every grid cell, and the
-- branch is the bug. One row costs nothing and makes a learner tank simply a
-- pool with one lane.
--
-- **`pool.lane_count` goes.** It would otherwise be a second answer to "how many
-- lanes has this pool", and two answers drift: the count says six while five
-- rows exist, and nothing can say which is right. The rows are the truth and the
-- count is `count(lane)`.
--
-- **Nothing an operator can see changes yet.** This migration exists so the grid
-- work that follows lands on a model that is already correct and already
-- migrated, rather than doing both at once.

ALTER TABLE pool ADD COLUMN lanes_enabled boolean NOT NULL DEFAULT false;

-- A pool that already carries a lane count was always a pool with lanes; nobody
-- has to be asked again for something the data already says.
UPDATE pool SET lanes_enabled = true WHERE lane_count IS NOT NULL AND lane_count > 0;

CREATE TABLE lane (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization (id),
  pool_id          uuid NOT NULL,

  -- Renameable. A club that calls one of them "Pista do fundo" has not moved it
  -- — `position` is what the grid orders by, not the name.
  name             text NOT NULL,
  position         smallint NOT NULL,

  -- Both nullable, and deliberately: an operator who has not decided how many
  -- fit in a lane must not be blocked, and inventing a default would enforce a
  -- number nobody chose. The same rule `class_group.capacity` already follows.
  length_m         numeric(5,2),
  default_capacity integer,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  -- The composite reference, as everywhere: a lane cannot be put in another
  -- organization's pool.
  FOREIGN KEY (organization_id, pool_id) REFERENCES pool (organization_id, id),

  CHECK (btrim(name) <> ''),
  CHECK (position > 0),
  CHECK (length_m IS NULL OR length_m > 0),
  CHECK (default_capacity IS NULL OR default_capacity > 0)
);

COMMENT ON TABLE lane IS
  'One lane of a pool. A pool without lanes still has exactly one, so the model has no "no lane" case.';

-- Partial, as every unique index on a soft-deletable table here is. Otherwise
-- archiving Pista 6 and adding it back next season violates the constraint
-- against a dead row.
CREATE UNIQUE INDEX lane_position_uq
  ON lane (organization_id, pool_id, position) WHERE archived_at IS NULL;

CREATE UNIQUE INDEX lane_name_uq
  ON lane (organization_id, pool_id, lower(strip_accents(name))) WHERE archived_at IS NULL;

CREATE INDEX lane_pool_idx
  ON lane (organization_id, pool_id) WHERE archived_at IS NULL;

CREATE TRIGGER lane_updated_at BEFORE UPDATE ON lane
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- The lanes every existing pool implies
-- ---------------------------------------------------------------------------
--
-- Three sources, in order, and the third is the one that matters:
--
--   1. a pool with `lane_count` gets `Pista 1 … Pista N`;
--   2. a pool without gets one lane named after itself;
--   3. a turma whose `lane` exceeds its pool's `lane_count` gets the lane it is
--      already using.
--
-- The third is real — nothing enforced the relationship until now — and losing
-- where a class swims in order to tidy up a migration is not a trade this repo
-- makes.

INSERT INTO lane (organization_id, pool_id, name, position)
SELECT p.organization_id, p.id, 'Pista ' || n, n
  FROM pool p
  CROSS JOIN LATERAL generate_series(1, p.lane_count) AS n
 WHERE p.lane_count IS NOT NULL AND p.lane_count > 0;

INSERT INTO lane (organization_id, pool_id, name, position)
SELECT p.organization_id, p.id, p.name, 1
  FROM pool p
 WHERE p.lane_count IS NULL OR p.lane_count <= 0;

-- Whatever the turmas are actually using and the two rules above did not create.
INSERT INTO lane (organization_id, pool_id, name, position)
SELECT DISTINCT cg.organization_id, cg.pool_id, 'Pista ' || cg.lane, cg.lane
  FROM class_group cg
 WHERE cg.lane IS NOT NULL
   AND cg.pool_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM lane l
      WHERE l.organization_id = cg.organization_id
        AND l.pool_id = cg.pool_id
        AND l.position = cg.lane
   );

-- ---------------------------------------------------------------------------
-- The turma and the session point at a row instead of a number
-- ---------------------------------------------------------------------------

ALTER TABLE class_group ADD COLUMN lane_id uuid;
ALTER TABLE class_session ADD COLUMN lane_id uuid;

UPDATE class_group cg
   SET lane_id = l.id
  FROM lane l
 WHERE l.organization_id = cg.organization_id
   AND l.pool_id = cg.pool_id
   AND l.position = cg.lane
   AND cg.lane IS NOT NULL;

UPDATE class_session cs
   SET lane_id = l.id
  FROM lane l
 WHERE l.organization_id = cs.organization_id
   AND l.pool_id = cs.pool_id
   AND l.position = cs.lane
   AND cs.lane IS NOT NULL;

ALTER TABLE class_group
  ADD CONSTRAINT class_group_lane_fkey
  FOREIGN KEY (organization_id, lane_id) REFERENCES lane (organization_id, id);

ALTER TABLE class_session
  ADD CONSTRAINT class_session_lane_fkey
  FOREIGN KEY (organization_id, lane_id) REFERENCES lane (organization_id, id);

-- ---------------------------------------------------------------------------
-- The exclusion constraint, moved onto the reference
-- ---------------------------------------------------------------------------
--
-- The guarantee is unchanged and is the one thing standing between two groups
-- and the same lane: two sessions cannot occupy one lane at one time, and a
-- cancelled session releases it.
--
-- `pool_id` drops out of the key because a lane belongs to exactly one pool, so
-- equality on `lane_id` already implies it. `btree_gist` supplies uuid equality
-- inside the GiST index — verified against this database before the migration
-- was written, because a constraint that silently matches nothing is the failure
-- mode here.

ALTER TABLE class_session DROP CONSTRAINT class_session_lane_free;

ALTER TABLE class_session
  ADD CONSTRAINT class_session_lane_free
  EXCLUDE USING gist (
    lane_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'cancelled' AND lane_id IS NOT NULL);

ALTER TABLE class_group   DROP COLUMN lane;
ALTER TABLE class_session DROP COLUMN lane;

CREATE INDEX class_group_lane_idx
  ON class_group (organization_id, lane_id) WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Every pool has at least one lane, and the schema is what says so
-- ---------------------------------------------------------------------------
--
-- The invariant the whole model rests on — "a pool without lanes is a pool with
-- one lane" — is worth nothing if it holds only where the application remembers
-- it. A pool created by a seed, a test, or an endpoint written next year would
-- otherwise have no lanes at all, and every grid cell for it would be the null
-- case this design exists to remove.
--
-- So the pool's lanes are created with the pool. `lanes_enabled` is read at
-- insert time: a pool that declares lanes gets `Pista 1 … Pista N` from
-- `lane_count`, and everything else gets one lane named after itself. Afterwards
-- the rows are the truth and the lane editor manages them — this trigger never
-- fires again, because renaming Pista 3 must not be undone by an update.

-- The rows are the count now, so the stored one goes. Dropped before the trigger
-- is written, because a plpgsql body is parsed when it first runs rather than
-- when it is created — a function still naming `lane_count` would compile fine
-- here and fail on the first pool somebody added.
ALTER TABLE pool DROP COLUMN lane_count;

CREATE FUNCTION pool_default_lanes() RETURNS trigger AS $$
BEGIN
  -- One lane, named after the pool. The lane editor is what turns that into six,
  -- because naming and ordering are decisions rather than a number — and a pool
  -- that never gets edited is a laneless tank, which is exactly one lane.
  INSERT INTO lane (organization_id, pool_id, name, position)
  VALUES (NEW.organization_id, NEW.id, NEW.name, 1);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pool_create_default_lanes AFTER INSERT ON pool
  FOR EACH ROW EXECUTE FUNCTION pool_default_lanes();

-- ---------------------------------------------------------------------------
-- The generator copies the lane it is told about
-- ---------------------------------------------------------------------------
--
-- `generate_sessions` stamps each session with its turma's pool and lane at
-- generation time, and deliberately: an exclusion constraint cannot reach into
-- another table, so the session has to carry what the constraint compares. That
-- copied column is now a reference, so the function changes with it.
--
-- Nothing else about it moves. Replaced whole rather than patched because a
-- plpgsql body has no way to be edited in place, and half of one is worse than
-- a duplicate.
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

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------

ALTER TABLE lane ENABLE ROW LEVEL SECURITY;

CREATE POLICY lane_tenant ON lane
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON lane TO poolse_app;

-- Down Migration
--
-- The numbers come back from the positions, and `lane_count` from how many lanes
-- each pool has. A lane renamed since the migration loses its name, which is the
-- one thing this shape cannot carry back — the old column was a `smallint` and
-- had nowhere to put it.

-- The generator, back on the smallint it used to copy.
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

DROP TRIGGER IF EXISTS pool_create_default_lanes ON pool;
DROP FUNCTION IF EXISTS pool_default_lanes();

ALTER TABLE pool ADD COLUMN lane_count smallint;

UPDATE pool p
   SET lane_count = counted.lanes
  FROM (
    SELECT pool_id, count(*)::smallint AS lanes
      FROM lane WHERE archived_at IS NULL GROUP BY pool_id
  ) counted
 WHERE counted.pool_id = p.id AND p.lanes_enabled;

ALTER TABLE pool ADD CONSTRAINT pool_lane_count_check
  CHECK (lane_count IS NULL OR lane_count > 0);

ALTER TABLE class_group   ADD COLUMN lane smallint;
ALTER TABLE class_session ADD COLUMN lane smallint;

UPDATE class_group cg SET lane = l.position
  FROM lane l WHERE l.id = cg.lane_id;

UPDATE class_session cs SET lane = l.position
  FROM lane l WHERE l.id = cs.lane_id;

ALTER TABLE class_group  ADD CONSTRAINT class_group_lane_check CHECK (lane IS NULL OR lane > 0);

ALTER TABLE class_session DROP CONSTRAINT class_session_lane_free;

ALTER TABLE class_session
  ADD CONSTRAINT class_session_lane_free
  EXCLUDE USING gist (
    pool_id WITH =,
    lane WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'cancelled' AND lane IS NOT NULL AND pool_id IS NOT NULL);

DROP INDEX IF EXISTS class_group_lane_idx;

ALTER TABLE class_group   DROP CONSTRAINT class_group_lane_fkey;
ALTER TABLE class_session DROP CONSTRAINT class_session_lane_fkey;
ALTER TABLE class_group   DROP COLUMN lane_id;
ALTER TABLE class_session DROP COLUMN lane_id;

DROP POLICY IF EXISTS lane_tenant ON lane;
DROP TABLE IF EXISTS lane;

ALTER TABLE pool DROP COLUMN lanes_enabled;
