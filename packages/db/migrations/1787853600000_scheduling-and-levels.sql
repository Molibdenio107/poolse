-- Up Migration
--
-- Scheduling correctness and level age ranges — backlog round 4, tickets 1 to 4.
--
-- Ticket 1 asked for two exclusion constraints. Half of it was already here:
-- `class_session_lane_free` has guarded pool-and-lane overlap since slice 1.6,
-- `ends_at` is a real stored column maintained by a BEFORE trigger — which is
-- the workaround the ticket describes, and a stricter one, because a trigger
-- recomputes on UPDATE where an explicitly-written column would drift. And
-- `tstzrange` is half-open, so back-to-back classes already never clashed.
--
-- What was missing is the instructor, and it was missing for a reason worth
-- recording: **the instructor is not on the session.** `class_group` holds the
-- turma's instructor and `class_session` holds only a substitute, so there was
-- nothing for an exclusion constraint to compare — a constraint cannot join.
--
-- So the session gains the instructor it is actually taught by. Denormalised,
-- like `vacation_day.membership_id`, and kept honest the same way: a composite
-- foreign key means it can only ever name a membership of the same organization.
--
-- The constraint compares `coalesce(substitute, instructor)`, which is one
-- expression covering both cases — a substitute who is already teaching
-- somewhere else is refused exactly as the turma's own instructor would be.
-- `coalesce` is immutable over immutable arguments, so it is indexable.

-- ---------------------------------------------------------------------------
-- The instructor on the session
-- ---------------------------------------------------------------------------

ALTER TABLE class_session ADD COLUMN instructor_membership_id uuid;

COMMENT ON COLUMN class_session.instructor_membership_id IS
  'The turma''s instructor, copied at generation. Changing a turma rewrites future '
  'sessions only — a past session keeps whoever actually taught it.';

ALTER TABLE class_session
  ADD CONSTRAINT class_session_organization_id_instructor_membership_id_fkey
  FOREIGN KEY (organization_id, instructor_membership_id)
  REFERENCES membership (organization_id, id);

-- Existing sessions take the instructor their turma has now. This is the one
-- moment where "rewrite the past" is correct: before this column existed there
-- was no per-session answer to rewrite.
UPDATE class_session cs
   SET instructor_membership_id = cg.instructor_membership_id
  FROM class_group cg
 WHERE cg.id = cs.class_group_id
   AND cg.organization_id = cs.organization_id;

/*
 * One person cannot teach two classes at once, in any pool or any lane.
 *
 * If this migration fails to apply, it has found a real double-booking in
 * existing data rather than a bug in itself. That is the constraint working:
 * resolve the clash, then migrate. It cannot be applied "loosely" — a
 * conditional constraint is not a constraint.
 */
ALTER TABLE class_session
  ADD CONSTRAINT class_session_instructor_free
  EXCLUDE USING gist (
    (coalesce(substitute_instructor_membership_id, instructor_membership_id)) WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  )
  WHERE (
    status <> 'cancelled'
    AND coalesce(substitute_instructor_membership_id, instructor_membership_id) IS NOT NULL
  );

-- Belt and braces, and the ticket asks for it by name. The trigger already
-- guarantees it because `duration_minutes` is at least 5 — but the trigger is a
-- function somebody could change, and this is a fact about the row.
ALTER TABLE class_session
  ADD CONSTRAINT class_session_ends_after_starts CHECK (ends_at > starts_at);

-- ---------------------------------------------------------------------------
-- generate_sessions — now writing the instructor
--
-- Replaced whole rather than patched: it is one function and a partial edit is
-- how the three passes stop agreeing about which day a session is on. Only the
-- INSERT column list and its SELECT differ from the version in
-- 1787839200000_session-local-date.sql.
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
-- Age ranges on levels — tickets 2 and 3
-- ---------------------------------------------------------------------------

ALTER TABLE student_level
  ADD COLUMN min_age_years smallint,
  ADD COLUMN max_age_years smallint;

COMMENT ON COLUMN student_level.min_age_years IS
  'Both bounds optional and independent: "Adultos" has a minimum and no maximum.';

-- A range that cannot contain anybody is a typo, not a policy.
ALTER TABLE student_level
  ADD CONSTRAINT student_level_age_range
  CHECK (
    max_age_years IS NULL
    OR min_age_years IS NULL
    OR max_age_years >= min_age_years
  );

-- Nobody is 300. The upper bound is generous on purpose — a masters swimming
-- club with a "90+" level is a real thing and this must not be the reason it
-- cannot be entered.
ALTER TABLE student_level
  ADD CONSTRAINT student_level_age_plausible
  CHECK (
    (min_age_years IS NULL OR (min_age_years >= 0 AND min_age_years <= 120))
    AND (max_age_years IS NULL OR (max_age_years >= 0 AND max_age_years <= 120))
  );

/*
 * Nothing enforces the age of a student against their level, and that is
 * deliberate — ticket 3 is explicit about it.
 *
 * Real clubs have the four-year-old who swims with the six-year-olds because
 * that is where their sibling is, and the adult beginner in a teenagers' class.
 * A rule that cannot be overridden gets worked around by typing a fake birth
 * date, and then the data is worse than if the check had never existed. The
 * warning lives in the interface, where it can be read and overruled.
 *
 * And most students will have no birth date at all: the spreadsheets waiting to
 * be imported have a half-empty column. Blocking on absent data would fail the
 * import for most rows.
 */

-- Down Migration

ALTER TABLE student_level DROP CONSTRAINT IF EXISTS student_level_age_plausible;
ALTER TABLE student_level DROP CONSTRAINT IF EXISTS student_level_age_range;
ALTER TABLE student_level
  DROP COLUMN IF EXISTS max_age_years,
  DROP COLUMN IF EXISTS min_age_years;

-- generate_sessions goes back to the version that does not know about
-- instructors. Restored in full for the same reason it was replaced in full.
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

ALTER TABLE class_session DROP CONSTRAINT IF EXISTS class_session_ends_after_starts;
ALTER TABLE class_session DROP CONSTRAINT IF EXISTS class_session_instructor_free;
ALTER TABLE class_session
  DROP CONSTRAINT IF EXISTS class_session_organization_id_instructor_membership_id_fkey;
ALTER TABLE class_session DROP COLUMN IF EXISTS instructor_membership_id;
