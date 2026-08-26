-- Up Migration
--
-- Slices 1.5 and 1.6: the closure calendar, and the sessions generated around it.
--
-- The order is the point, and the roadmap says why: generating sessions first
-- and adding closures afterwards means cancelling August by hand, and then doing
-- it again every time the window rolls forward. Closures exist before the
-- generator ever runs.
--
-- ---------------------------------------------------------------------------
-- Where wall-clock becomes an instant
-- ---------------------------------------------------------------------------
--
-- `class_schedule.start_time` is a wall-clock time — "Tuesdays at 18:00" means
-- six o'clock on the pool's own clock, in July and in January alike. A session is
-- an instant, so the generator converts:
--
--     (date + start_time) AT TIME ZONE facility.timezone
--
-- Verified against this database: 18:00 on 12 January in Lisbon is 18:00 UTC,
-- 18:00 on 13 July is 17:00 UTC, and 18:00 in the Azores is 19:00 UTC. The same
-- clock time, three different instants — which is exactly why the schedule could
-- not have been stored as one.

CREATE TYPE class_session_status AS ENUM ('scheduled', 'cancelled', 'completed');

-- Needed for the lane exclusion below: it lets a GiST index mix equality on
-- uuid/smallint with range overlap, which plain GiST cannot do.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- closure
-- ---------------------------------------------------------------------------

CREATE TABLE closure (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization (id),

  -- Both optional, narrowing as they are filled in: nothing means the whole
  -- organization is shut, a facility means that site, a pool means that tank is
  -- drained while the rest of the building carries on.
  facility_id       uuid,
  pool_id           uuid,

  starts_on         date NOT NULL,
  ends_on           date NOT NULL,
  reason            text NOT NULL,

  -- A closure that does not block generation is a note in the calendar — "pool
  -- busy with a gala, classes still run".
  blocks_generation boolean NOT NULL DEFAULT true,

  -- August every year, entered once. Matched by month and day, ignoring the
  -- year on the row, which is why moveable feasts cannot use it: Carnaval is a
  -- different date every year and is written per year instead.
  repeats_annually  boolean NOT NULL DEFAULT false,

  -- 'manual' or 'national_holiday'. The holidays are created automatically, and
  -- this is what lets the interface label them and the seeder avoid making the
  -- same one twice.
  source            text NOT NULL DEFAULT 'manual',

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz,

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, pool_id) REFERENCES pool (organization_id, id),

  CHECK (ends_on >= starts_on),
  CHECK (btrim(reason) <> ''),
  CHECK (source IN ('manual', 'national_holiday'))
);

CREATE INDEX closure_range_idx
  ON closure (organization_id, starts_on, ends_on) WHERE archived_at IS NULL;

-- One national holiday per day per organization, so re-running the seeder is
-- harmless. Manual closures are not constrained: two overlapping notes about the
-- same week are the operator's business.
CREATE UNIQUE INDEX closure_holiday_uq
  ON closure (organization_id, starts_on)
  WHERE source = 'national_holiday' AND archived_at IS NULL;

CREATE TRIGGER closure_updated_at BEFORE UPDATE ON closure
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE closure ENABLE ROW LEVEL SECURITY;
CREATE POLICY closure_tenant ON closure
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- ---------------------------------------------------------------------------
-- closure_covers — does this closure fall on this date?
--
-- Split out because it is the one piece of logic the generator, the cancel pass
-- and the un-cancel pass all have to agree on. Three copies of a date
-- comparison is three chances for August to be shut in one of them and open in
-- another.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION closure_covers(
  p_starts_on date,
  p_ends_on   date,
  p_repeats   boolean,
  p_date      date
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_year int := extract(YEAR FROM p_date)::int;
  v_from date;
  v_to   date;
BEGIN
  IF NOT p_repeats THEN
    RETURN p_date BETWEEN p_starts_on AND p_ends_on;
  END IF;

  -- Recurring: the same month and day, whichever year we are looking at.
  -- 29 February in a non-leap year has to land somewhere, and 28 February is
  -- the only sensible answer.
  v_from := make_date(v_year, extract(MONTH FROM p_starts_on)::int,
                      least(extract(DAY FROM p_starts_on)::int,
                            extract(DAY FROM (date_trunc('month',
                              make_date(v_year, extract(MONTH FROM p_starts_on)::int, 1))
                              + interval '1 month - 1 day'))::int));
  v_to   := make_date(v_year, extract(MONTH FROM p_ends_on)::int,
                      least(extract(DAY FROM p_ends_on)::int,
                            extract(DAY FROM (date_trunc('month',
                              make_date(v_year, extract(MONTH FROM p_ends_on)::int, 1))
                              + interval '1 month - 1 day'))::int));

  IF v_to >= v_from THEN
    RETURN p_date BETWEEN v_from AND v_to;
  END IF;

  -- The range wraps the year end — 20 December to 5 January.
  RETURN p_date >= v_from OR p_date <= v_to;
END;
$$;

-- ---------------------------------------------------------------------------
-- class_session — a materialised occurrence
--
-- Generated ahead rather than computed on read, because attendance,
-- cancellations and substitutions all need a row to attach to. "The 14th was
-- cancelled" is inexpressible against a recurring pattern.
-- ---------------------------------------------------------------------------

CREATE TABLE class_session (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organization (id),
  class_group_id          uuid NOT NULL,

  -- Copied from the turma at generation time, and deliberately so: an exclusion
  -- constraint cannot reach into another table. Regeneration is what keeps them
  -- in step — move a turma to another pool and its clean future sessions are
  -- rebuilt with the new one.
  pool_id                 uuid,
  lane                    smallint,

  starts_at               timestamptz NOT NULL,
  duration_minutes        integer NOT NULL,
  -- Derived from the two columns above and never set by hand — see the trigger
  -- below. It is a real column rather than a generated one because
  -- `timestamptz + interval` is only STABLE, not IMMUTABLE (adding an interval
  -- depends on the session timezone), and a generated column may not use it.
  -- The exclusion constraint needs something concrete to index either way.
  ends_at                 timestamptz NOT NULL,

  status                  class_session_status NOT NULL DEFAULT 'scheduled',
  substitute_instructor_membership_id uuid,
  cancellation_reason     text,
  -- Set when a closure cancelled it, which is what makes closures reversible:
  -- delete the closure and these come back, while anything cancelled by hand
  -- stays cancelled.
  closure_id              uuid REFERENCES closure (id),

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, class_group_id) REFERENCES class_group (organization_id, id),
  FOREIGN KEY (organization_id, substitute_instructor_membership_id)
    REFERENCES membership (organization_id, id),

  UNIQUE (class_group_id, starts_at),
  CHECK (duration_minutes BETWEEN 5 AND 480)
);

-- Keeps ends_at honest. Set on every insert and recomputed on every update, so
-- shortening a session by ten minutes cannot leave a stale end time behind —
-- which, with the exclusion constraint below reading that column, would mean a
-- lane clash that the database cheerfully allows.
CREATE OR REPLACE FUNCTION class_session_ends_at() RETURNS trigger AS $$
BEGIN
  NEW.ends_at := NEW.starts_at + make_interval(mins => NEW.duration_minutes);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER class_session_set_ends_at
  BEFORE INSERT OR UPDATE OF starts_at, duration_minutes ON class_session
  FOR EACH ROW EXECUTE FUNCTION class_session_ends_at();

-- Two turmas cannot occupy the same lane at the same time. A cancelled session
-- releases its lane, which is exactly why this lives here and not on the weekly
-- pattern — a pattern has no way to say "except the 15th".
ALTER TABLE class_session
  ADD CONSTRAINT class_session_lane_free
  EXCLUDE USING gist (
    pool_id WITH =,
    lane WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'cancelled' AND lane IS NOT NULL AND pool_id IS NOT NULL);

CREATE INDEX class_session_when_idx
  ON class_session (organization_id, starts_at);
CREATE INDEX class_session_group_idx
  ON class_session (organization_id, class_group_id, starts_at);

CREATE TRIGGER class_session_updated_at BEFORE UPDATE ON class_session
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE class_session ENABLE ROW LEVEL SECURITY;
CREATE POLICY class_session_tenant ON class_session
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- ---------------------------------------------------------------------------
-- generate_sessions
--
-- Idempotent by design: run it as often as you like. It does three things, and
-- the second and third are what make closures feel alive rather than a filter
-- applied once at creation.
--
--   1. Create sessions that are missing, for every turma slot inside the window
--      and inside the turma's own season.
--   2. Cancel scheduled sessions that a blocking closure now covers, recording
--      which closure did it.
--   3. Restore sessions whose closure has since been removed or moved.
--
-- Anything cancelled by a person is never touched by any of the three: those
-- have no `closure_id`, and step 3 only revives what step 2 put down.
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

  -- 2. Cancel what a closure now covers.
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
                               (cs.starts_at AT TIME ZONE 'UTC')::date)
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_restored FROM restored;

  RETURN QUERY SELECT v_created, v_cancelled, v_restored;
END;
$$;

-- Down Migration

DROP FUNCTION IF EXISTS generate_sessions(uuid, date, date);
DROP FUNCTION IF EXISTS class_session_ends_at() CASCADE;

DROP POLICY IF EXISTS class_session_tenant ON class_session;
DROP TABLE IF EXISTS class_session;

DROP FUNCTION IF EXISTS closure_covers(date, date, boolean, date);

DROP POLICY IF EXISTS closure_tenant ON closure;
DROP TABLE IF EXISTS closure;

DROP TYPE IF EXISTS class_session_status;
