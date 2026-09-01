-- Up Migration
--
-- A booking is not only a turma — POOLSE-46.
--
-- Three facts about a real schedule that the model could not hold.
--
-- **A booking can occupy several lanes.** Competition squads take two or three;
-- hidroginástica takes the whole tank. `class_group.lane` was one lane, so the
-- only way to say "lanes 2 to 4" was three turmas with the same name.
--
-- **Most of the morning is not turmas.** ES D. Dinis, EPA, Teresianas,
-- Misericórdia, JI Vinha, CAID, Andebol Sub 16 — external entities with no
-- student records behind them, consuming most of the pool's daytime. Poolse had
-- nowhere to put them.
--
-- **A missing instructor is a state, not a blank.** The reference sheet
-- distinguishes `???` (to be defined) from `Sem professor` (uncovered) from
-- `x`/`DE` (the entity brings their own), and the club calls the uncovered ones
-- its main problem. A null instructor cannot tell those apart.
--
-- **`class_schedule` is extended, not replaced.** It is already the weekly
-- pattern, and `class_session`, attendance, reposições, closures and the fees
-- engine all hang off it. A new `booking` table would mean rewriting every one
-- of those before anything new became visible.
--
-- **A booking gains its own `facility_id`.** It used to reach its site through
-- its turma, which stops working the moment a booking has no turma — and the
-- opening-hours trigger, which reads that site, would have silently passed every
-- parceria booking rather than checking it.

ALTER TABLE class_schedule ADD CONSTRAINT class_schedule_organization_id_id_key
  UNIQUE (organization_id, id);

CREATE TYPE booking_subject AS ENUM ('turma', 'parceria', 'evento', 'manutencao');

CREATE TYPE instructor_status AS ENUM ('assigned', 'to_define', 'external', 'uncovered');

/*
 * A colour token, not a hex.
 *
 * CLAUDE.md's rule is that colours come from tokens and no literal hex appears
 * in a component. A club-editable category colour still has to be stored, so it
 * is stored as the name of a token the web app resolves — which keeps light and
 * dark working, and keeps a club from choosing a colour that fails contrast.
 */
CREATE TYPE category_colour AS ENUM
  ('blue', 'teal', 'green', 'amber', 'red', 'violet', 'slate');

-- ---------------------------------------------------------------------------
-- What kind of thing a booking is, for the grid's colours and its legend
-- ---------------------------------------------------------------------------

CREATE TABLE booking_category (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  facility_id     uuid NOT NULL,

  name            text NOT NULL,
  colour          category_colour NOT NULL DEFAULT 'slate',

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
    ON DELETE CASCADE,

  CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX booking_category_name_uq
  ON booking_category (organization_id, facility_id, lower(strip_accents(name)))
  WHERE archived_at IS NULL;

CREATE TRIGGER booking_category_updated_at BEFORE UPDATE ON booking_category
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE booking_category ENABLE ROW LEVEL SECURITY;
CREATE POLICY booking_category_tenant ON booking_category
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON booking_category TO poolse_app;

-- ---------------------------------------------------------------------------
-- The booking itself
-- ---------------------------------------------------------------------------

ALTER TABLE class_schedule
  ADD COLUMN facility_id      uuid,
  ADD COLUMN subject_type     booking_subject NOT NULL DEFAULT 'turma',
  /*
   * The partner group this booking is for.
   *
   * No foreign key yet, and that is a gap with a date on it: `partner_group`
   * arrives with POOLSE-47, which adds the composite key. Nothing can write a
   * non-null value here before then — the CHECK below requires
   * `subject_type = 'parceria'`, and no writer sets that until the partner
   * tables exist. See the ticket.
   */
  ADD COLUMN partner_group_id uuid,
  -- Which row of the grid, when the booking's own time matches one — POOLSE-44.
  ADD COLUMN slot_id          uuid,
  -- An override. Absent means the turma's own instructor.
  ADD COLUMN instructor_membership_id uuid,
  ADD COLUMN instructor_status instructor_status NOT NULL DEFAULT 'assigned',
  ADD COLUMN headcount_override integer,
  ADD COLUMN category_id      uuid,
  -- Only for a booking with neither a turma nor a partner to take a name from.
  ADD COLUMN title            text,
  ADD COLUMN notes            text;

-- Every booking so far is a turma, so its site is the turma's.
UPDATE class_schedule cs
   SET facility_id = cg.facility_id
  FROM class_group cg
 WHERE cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id;

ALTER TABLE class_schedule ALTER COLUMN facility_id SET NOT NULL;

ALTER TABLE class_schedule
  ALTER COLUMN class_group_id DROP NOT NULL,
  ADD CONSTRAINT class_schedule_facility_fkey
    FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  ADD CONSTRAINT class_schedule_slot_fkey
    FOREIGN KEY (organization_id, slot_id) REFERENCES facility_time_slot (organization_id, id),
  ADD CONSTRAINT class_schedule_instructor_fkey
    FOREIGN KEY (organization_id, instructor_membership_id)
      REFERENCES membership (organization_id, id),
  ADD CONSTRAINT class_schedule_category_fkey
    FOREIGN KEY (organization_id, category_id) REFERENCES booking_category (organization_id, id),
  ADD CONSTRAINT class_schedule_headcount_check
    CHECK (headcount_override IS NULL OR headcount_override >= 0),
  /*
   * The subject invariant, as a CHECK rather than a convention.
   *
   * Without it a parceria row carrying a stale `class_group_id` would be counted
   * twice by occupancy and once by the register, and nothing would object.
   */
  ADD CONSTRAINT class_schedule_subject_check CHECK (
    (subject_type = 'turma'    AND class_group_id IS NOT NULL AND partner_group_id IS NULL) OR
    (subject_type = 'parceria' AND partner_group_id IS NOT NULL AND class_group_id IS NULL) OR
    (subject_type IN ('evento', 'manutencao')
       AND class_group_id IS NULL AND partner_group_id IS NULL)
  );

/*
 * One booking per subject per moment, whatever the subject is.
 *
 * The old index was `(class_group_id, weekday, start_time)`, which stops
 * constraining anything the moment `class_group_id` is null — nulls are distinct
 * in a unique index, so every parceria and every evento would have been free to
 * duplicate itself. `coalesce` gives the index a subject to key on whichever
 * kind of booking it is.
 */
DROP INDEX class_schedule_slot_uq;

CREATE UNIQUE INDEX class_schedule_slot_uq
  ON class_schedule (
    organization_id,
    coalesce(class_group_id, partner_group_id),
    weekday,
    start_time
  )
  WHERE archived_at IS NULL
    AND (class_group_id IS NOT NULL OR partner_group_id IS NOT NULL);

CREATE INDEX class_schedule_facility_idx
  ON class_schedule (organization_id, facility_id, weekday, start_time)
  WHERE archived_at IS NULL;

/*
 * A booking with a turma already knows its site.
 *
 * `facility_id` is NOT NULL because every booking sits somewhere and the
 * opening-hours trigger reads it — but making every writer restate a fact the
 * turma already holds is how a NOT NULL turns into forty edited call sites and
 * one that gets it wrong. Filled in here when it is omitted; a booking with no
 * turma has no site to derive and must say which one.
 */
CREATE FUNCTION class_schedule_default_facility() RETURNS trigger AS $fn$
BEGIN
  IF NEW.facility_id IS NULL AND NEW.class_group_id IS NOT NULL THEN
    SELECT cg.facility_id INTO NEW.facility_id
      FROM class_group cg
     WHERE cg.id = NEW.class_group_id
       AND cg.organization_id = NEW.organization_id;
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

/*
 * The name is load-bearing.
 *
 * Postgres fires BEFORE triggers in alphabetical order, so this has to sort
 * ahead of `class_schedule_hours` — which reads the column this fills in.
 * Called `class_schedule_site` it sorted *after*, the hours check saw a null
 * facility, found no hours for it, and waved through a class on a day the site
 * is shut. `facility-hours.sql` test 2a caught it.
 *
 * d < h. Do not rename this without checking that again.
 */
CREATE TRIGGER class_schedule_default_site
  BEFORE INSERT OR UPDATE OF class_group_id, facility_id ON class_schedule
  FOR EACH ROW EXECUTE FUNCTION class_schedule_default_facility();

-- ---------------------------------------------------------------------------
-- Which lanes a booking occupies
-- ---------------------------------------------------------------------------
--
-- One or more. Hidroginástica across six lanes is six rows rather than a "whole
-- pool" shorthand, because a pool without lanes has exactly one lane row
-- (POOLSE-43) and six rows are what the conflict rules can actually reason
-- about.

CREATE TABLE booking_lane (
  organization_id uuid NOT NULL REFERENCES organization (id),
  schedule_id     uuid NOT NULL,
  lane_id         uuid NOT NULL,

  PRIMARY KEY (schedule_id, lane_id),

  FOREIGN KEY (organization_id, schedule_id)
    REFERENCES class_schedule (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, lane_id) REFERENCES lane (organization_id, id)
);

CREATE INDEX booking_lane_lane_idx ON booking_lane (organization_id, lane_id);

-- What the turmas already say. A turma with no lane chosen contributes nothing,
-- which is ordinary and stays ordinary.
INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
SELECT cs.organization_id, cs.id, cg.lane_id
  FROM class_schedule cs
  JOIN class_group cg
    ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
 WHERE cg.lane_id IS NOT NULL;

ALTER TABLE booking_lane ENABLE ROW LEVEL SECURITY;
CREATE POLICY booking_lane_tenant ON booking_lane
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON booking_lane TO poolse_app;

-- ---------------------------------------------------------------------------
-- A session knows which booking made it
-- ---------------------------------------------------------------------------

ALTER TABLE class_session ADD COLUMN schedule_id uuid;

/*
 * Backfilled by matching the session's local weekday and time against its
 * turma's pattern — which is how it was generated in the first place.
 *
 * A session whose slot has since moved matches nothing and keeps a null, which
 * is honest: the pattern that made it no longer exists in that shape. Those
 * sessions are still perfectly readable; only regeneration cares, and it will
 * not produce them again anyway.
 */
UPDATE class_session cs
   SET schedule_id = sch.id
  FROM class_schedule sch
 WHERE sch.class_group_id = cs.class_group_id
   AND sch.organization_id = cs.organization_id
   AND sch.archived_at IS NULL
   AND sch.weekday = extract(
         ISODOW FROM session_local_date(cs.organization_id, cs.pool_id, cs.starts_at)
       )::int
   AND sch.start_time = (cs.starts_at AT TIME ZONE coalesce(
         (SELECT f.timezone FROM pool p
            JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
           WHERE p.id = cs.pool_id),
         'Europe/Lisbon'))::time;

ALTER TABLE class_session
  ALTER COLUMN class_group_id DROP NOT NULL,
  ADD CONSTRAINT class_session_schedule_fkey
    FOREIGN KEY (organization_id, schedule_id) REFERENCES class_schedule (organization_id, id);

/*
 * One session per booking per moment.
 *
 * The existing `(class_group_id, starts_at)` key stops constraining anything
 * once `class_group_id` is null, so a parceria booking could have generated the
 * same occurrence twice. Partial, because the sessions this migration could not
 * match keep a null `schedule_id` and must not all collide with one another.
 */
CREATE UNIQUE INDEX class_session_booking_uq
  ON class_session (schedule_id, starts_at)
  WHERE schedule_id IS NOT NULL;

CREATE INDEX class_session_schedule_idx
  ON class_session (organization_id, schedule_id, starts_at);

-- ---------------------------------------------------------------------------
-- The lanes a session occupies, and the guarantee that moved with them
-- ---------------------------------------------------------------------------
--
-- **This is the highest-risk piece of the ticket**, and it is worth saying why.
-- `class_session_lane_free` is the one thing standing between two groups and the
-- same lane at the same time. It was an exclusion constraint on `class_session`,
-- which worked while a session had exactly one lane. A session across three
-- lanes needs three rows, so the constraint moves to the table that holds them —
-- and an exclusion constraint cannot reach into another table, so those rows
-- have to carry their own copy of the session's times.
--
-- A copy is a thing that can go stale, which is what the trigger below is for:
-- shorten a session by ten minutes and every one of its lane rows has to follow,
-- or the constraint is comparing against a time nobody is swimming at.

CREATE TABLE class_session_lane (
  organization_id uuid NOT NULL REFERENCES organization (id),
  session_id      uuid NOT NULL,
  lane_id         uuid NOT NULL,

  -- Copied from the session. Kept honest by `class_session_lane_sync`, and never
  -- written by hand — see the header.
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  -- Copied too: a cancelled session releases its lane, and the constraint has to
  -- be able to see that without a join.
  cancelled       boolean NOT NULL DEFAULT false,

  PRIMARY KEY (session_id, lane_id),

  FOREIGN KEY (organization_id, session_id)
    REFERENCES class_session (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, lane_id) REFERENCES lane (organization_id, id),

  EXCLUDE USING gist (
    lane_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (NOT cancelled)
);

CREATE INDEX class_session_lane_lane_idx
  ON class_session_lane (organization_id, lane_id, starts_at);

-- Everything the single-lane column already said.
INSERT INTO class_session_lane (organization_id, session_id, lane_id, starts_at, ends_at, cancelled)
SELECT organization_id, id, lane_id, starts_at, ends_at, status = 'cancelled'
  FROM class_session
 WHERE lane_id IS NOT NULL;

/*
 * The copy, kept honest.
 *
 * Fires on the three columns the constraint reads. Without it, shortening a
 * session by ten minutes leaves its lane rows claiming the old window — and the
 * lane looks busy when it is free, or free when it is busy, which is the failure
 * this whole structure exists to prevent.
 */
CREATE FUNCTION class_session_lane_sync() RETURNS trigger AS $fn$
BEGIN
  UPDATE class_session_lane
     SET starts_at = NEW.starts_at,
         ends_at   = NEW.ends_at,
         cancelled = (NEW.status = 'cancelled')
   WHERE session_id = NEW.id;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

/*
 * Every update, not a named list of columns.
 *
 * `AFTER UPDATE OF ends_at` names the columns the *statement* sets, not the
 * ones that actually changed — and `ends_at` is written by a BEFORE trigger
 * from `duration_minutes`. Shortening a class therefore never listed `ends_at`,
 * the sync never fired, and the lane rows kept claiming the old window. Caught
 * by test 4 in `bookings.sql`, which exists for exactly this.
 *
 * The WHEN clause keeps it cheap: the body only runs when something it copies
 * has moved.
 */
CREATE TRIGGER class_session_lane_follow
  AFTER UPDATE ON class_session
  FOR EACH ROW
  WHEN (OLD.starts_at IS DISTINCT FROM NEW.starts_at
     OR OLD.ends_at   IS DISTINCT FROM NEW.ends_at
     OR OLD.status    IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION class_session_lane_sync();

-- The old guarantee, now held one table down.
ALTER TABLE class_session DROP CONSTRAINT class_session_lane_free;
ALTER TABLE class_session DROP CONSTRAINT class_session_lane_fkey;
ALTER TABLE class_session DROP COLUMN lane_id;

ALTER TABLE class_session_lane ENABLE ROW LEVEL SECURITY;
CREATE POLICY class_session_lane_tenant ON class_session_lane
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON class_session_lane TO poolse_app;

-- ---------------------------------------------------------------------------
-- Opening hours, checked against the booking's own site
-- ---------------------------------------------------------------------------
--
-- This read the site through `class_group`, which returns nothing the moment a
-- booking has no turma — and `NOT FOUND` means "this site has no hours written
-- down", so every parceria and every evento would have sailed past the check
-- rather than being tested by it. The booking now carries its own
-- `facility_id`, so the lookup is direct and applies to all four kinds.

CREATE OR REPLACE FUNCTION class_schedule_within_facility_hours() RETURNS trigger AS $fn$
DECLARE
  v_available boolean;
  v_opens_at  time;
  v_closes_at time;
  v_site      text;
  v_starts    integer;  -- minutes from midnight
  v_ends      integer;
  v_closes    integer;
BEGIN
  SELECT h.available, h.opens_at, h.closes_at, f.name
    INTO v_available, v_opens_at, v_closes_at, v_site
    FROM facility f
    JOIN facility_hours h
      ON h.facility_id = f.id
     AND h.organization_id = f.organization_id
     AND h.weekday = NEW.weekday
   WHERE f.id = NEW.facility_id
     AND f.organization_id = NEW.organization_id;

  -- A site that has never had its hours written down says nothing about when it
  -- opens, and a rule with no data behind it must not refuse anybody.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NOT v_available THEN
    RAISE EXCEPTION
      'facility_closed_on_weekday: % does not open on ISO weekday %', v_site, NEW.weekday
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.start_time < v_opens_at OR NEW.start_time >= v_closes_at THEN
    RAISE EXCEPTION
      'outside_facility_hours: % opens % to % on ISO weekday %, class starts %',
      v_site, v_opens_at, v_closes_at, NEW.weekday, NEW.start_time
      USING ERRCODE = 'check_violation';
  END IF;

  /*
   * Minutes from midnight on both sides — round 4's rule, unchanged.
   *
   * `time '23:30' + interval '60 minutes'` is `00:30`, and `00:30 <= 22:00` is
   * true, so the naive comparison passes exactly the class it has to refuse.
   */
  v_starts := extract(HOUR FROM NEW.start_time) * 60 + extract(MINUTE FROM NEW.start_time);
  v_ends   := v_starts + NEW.duration_minutes;
  v_closes := extract(HOUR FROM v_closes_at) * 60 + extract(MINUTE FROM v_closes_at);
  IF v_closes_at = TIME '24:00' THEN v_closes := 1440; END IF;

  /*
   * The message prefix is load-bearing: `scheduleRefusal` reads it to tell
   * "starts too early" from "runs past closing", which are two different things
   * to say to an operator. Rewriting this trigger with a tidier message broke
   * that mapping, and only the integration test noticed.
   */
  IF v_ends > v_closes THEN
    RAISE EXCEPTION
      'class_ends_after_closing: % closes at % on ISO weekday %, class runs % to %',
      v_site, v_closes_at, NEW.weekday, NEW.start_time,
      (NEW.start_time + (NEW.duration_minutes || ' minutes')::interval)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER class_schedule_hours ON class_schedule;

CREATE TRIGGER class_schedule_hours
  BEFORE INSERT OR UPDATE OF weekday, start_time, duration_minutes, facility_id
  ON class_schedule
  FOR EACH ROW WHEN (NEW.archived_at IS NULL)
  EXECUTE FUNCTION class_schedule_within_facility_hours();

-- ---------------------------------------------------------------------------
-- The generator iterates bookings, not turmas
-- ---------------------------------------------------------------------------
--
-- It walked `class_group` and joined the pattern to it, which cannot reach a
-- booking that has no turma. It now walks `class_schedule` — every booking, of
-- every kind — and looks the turma up only for the things a turma supplies: the
-- pool, the instructor, and the dates a class runs between.
--
-- A booking with no turma is bounded by its season alone, which is the right
-- answer: a school's block runs for the year the club sold it.
--
-- It also writes the lane rows, from `booking_lane`. A session with no lanes is
-- ordinary — plenty of turmas have not been given one.

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
           -- The pool comes from the turma today. A booking with no turma has no
           -- pool of its own yet; POOLSE-49 gives the grid one to drop onto.
           cg.pool_id,
           coalesce(sch.instructor_membership_id, cg.instructor_membership_id)
             AS instructor_membership_id,
           sch.weekday,
           sch.start_time,
           sch.duration_minutes,
           coalesce(f.timezone, 'Europe/Lisbon') AS timezone,
           /*
            * Bounded by the season, and by the turma where there is one. A
            * booking from a retired season must not gain new sessions because
            * somebody generated a wide range.
            */
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
       -- A turma names its season; a booking without one belongs to whichever
       -- season is running.
       AND se.id = coalesce(cg.season_id, (
             SELECT s2.id FROM season s2
              WHERE s2.organization_id = sch.organization_id AND s2.status = 'published'
           ))
       -- Published only — POOLSE-45. A draft is a plan; generating from one
       -- would put two hundred phantom sessions on the club's calendar.
       AND se.status = 'published'
      LEFT JOIN pool p ON p.id = cg.pool_id AND p.organization_id = cg.organization_id
      LEFT JOIN facility f ON f.id = coalesce(p.facility_id, sch.facility_id)
                          AND f.organization_id = sch.organization_id
     WHERE sch.organization_id = p_organization_id
       AND sch.archived_at IS NULL
       -- A turma booking whose turma has been archived produces nothing.
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
  -- The lanes each new session occupies, copied from the booking. The copy is
  -- what the exclusion constraint compares; `class_session_lane_sync` keeps it
  -- honest afterwards.
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
$fn$;


-- Down Migration
--
-- The single-lane world comes back, and a multi-lane booking cannot: the old
-- column holds one lane, so a booking across three keeps its lowest and the rest
-- are lost. Bookings with no turma are removed entirely, since `class_schedule`
-- had nowhere to put them.

DROP TRIGGER IF EXISTS class_schedule_default_site ON class_schedule;
DROP FUNCTION IF EXISTS class_schedule_default_facility();

DROP TRIGGER IF EXISTS class_session_lane_follow ON class_session;
DROP FUNCTION IF EXISTS class_session_lane_sync();

ALTER TABLE class_session ADD COLUMN lane_id uuid;

UPDATE class_session cs
   SET lane_id = pick.lane_id
  FROM (
    SELECT csl.session_id, csl.lane_id,
           row_number() OVER (PARTITION BY csl.session_id ORDER BY l.position) AS rank
      FROM class_session_lane csl
      JOIN lane l ON l.id = csl.lane_id
  ) pick
 WHERE pick.session_id = cs.id AND pick.rank = 1;

ALTER TABLE class_session
  ADD CONSTRAINT class_session_lane_fkey
    FOREIGN KEY (organization_id, lane_id) REFERENCES lane (organization_id, id),
  ADD CONSTRAINT class_session_lane_free
    EXCLUDE USING gist (
      lane_id WITH =,
      tstzrange(starts_at, ends_at) WITH &&
    ) WHERE (status <> 'cancelled' AND lane_id IS NOT NULL);

DROP POLICY IF EXISTS class_session_lane_tenant ON class_session_lane;
DROP TABLE IF EXISTS class_session_lane;

DELETE FROM class_session WHERE class_group_id IS NULL;
DELETE FROM class_schedule WHERE class_group_id IS NULL;

DROP INDEX IF EXISTS class_session_schedule_idx;
DROP INDEX IF EXISTS class_session_booking_uq;
ALTER TABLE class_session DROP CONSTRAINT IF EXISTS class_session_schedule_fkey;
ALTER TABLE class_session DROP COLUMN schedule_id;
ALTER TABLE class_session ALTER COLUMN class_group_id SET NOT NULL;

DROP POLICY IF EXISTS booking_lane_tenant ON booking_lane;
DROP TABLE IF EXISTS booking_lane;

-- Before the columns go: the trigger names facility_id, so Postgres refuses
-- to drop the column while it still does.
-- The hours trigger, back to reaching its site through the turma.

CREATE OR REPLACE FUNCTION class_schedule_within_facility_hours() RETURNS trigger AS $fn$

DECLARE
  v_available boolean;
  v_opens_at  time;
  v_closes_at time;
  v_site      text;
  v_starts    integer;  -- minutes from midnight
  v_ends      integer;
  v_closes    integer;
BEGIN
  SELECT h.available, h.opens_at, h.closes_at, f.name
    INTO v_available, v_opens_at, v_closes_at, v_site
    FROM class_group g
    JOIN facility f
      ON f.id = g.facility_id
     AND f.organization_id = g.organization_id
    JOIN facility_hours h
      ON h.facility_id = f.id
     AND h.organization_id = f.organization_id
     AND h.weekday = NEW.weekday
   WHERE g.id = NEW.class_group_id
     AND g.organization_id = NEW.organization_id;

  -- A site that has never had its hours written down says nothing about when it
  -- opens, and a rule with no data behind it must not refuse anybody.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NOT v_available THEN
    RAISE EXCEPTION
      'facility_closed_on_weekday: % does not open on ISO weekday %', v_site, NEW.weekday
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.start_time < v_opens_at OR NEW.start_time >= v_closes_at THEN
    RAISE EXCEPTION
      'outside_facility_hours: % opens % to % on ISO weekday %, class starts %',
      v_site, v_opens_at, v_closes_at, NEW.weekday, NEW.start_time
      USING ERRCODE = 'check_violation';
  END IF;

  /*
   * Minutes from midnight on both sides — round 4's rule, unchanged.
   *
   * `time '23:30' + interval '60 minutes'` is `00:30`, and `00:30 <= 22:00` is
   * true, so the naive comparison passes exactly the class it has to refuse.
   */
  v_starts := extract(HOUR FROM NEW.start_time) * 60 + extract(MINUTE FROM NEW.start_time);
  v_ends   := v_starts + NEW.duration_minutes;
  v_closes := extract(HOUR FROM v_closes_at) * 60 + extract(MINUTE FROM v_closes_at);
  IF v_closes_at = TIME '24:00' THEN v_closes := 1440; END IF;

  IF v_ends > v_closes THEN
    RAISE EXCEPTION
      'class_ends_after_closing: % closes at % on ISO weekday %, class runs % to %',
      v_site, v_closes_at, NEW.weekday, NEW.start_time,
      (NEW.start_time + (NEW.duration_minutes || ' minutes')::interval)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;

$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS class_schedule_hours ON class_schedule;

CREATE TRIGGER class_schedule_hours
  BEFORE INSERT OR UPDATE OF weekday, start_time, duration_minutes, class_group_id
  ON class_schedule
  FOR EACH ROW WHEN (NEW.archived_at IS NULL)
  EXECUTE FUNCTION class_schedule_within_facility_hours();
DROP INDEX IF EXISTS class_schedule_facility_idx;
DROP INDEX IF EXISTS class_schedule_slot_uq;

CREATE UNIQUE INDEX class_schedule_slot_uq
  ON class_schedule (class_group_id, weekday, start_time)
  WHERE archived_at IS NULL;

ALTER TABLE class_schedule
  DROP CONSTRAINT IF EXISTS class_schedule_subject_check,
  DROP CONSTRAINT IF EXISTS class_schedule_headcount_check,
  DROP CONSTRAINT IF EXISTS class_schedule_category_fkey,
  DROP CONSTRAINT IF EXISTS class_schedule_instructor_fkey,
  DROP CONSTRAINT IF EXISTS class_schedule_slot_fkey,
  DROP CONSTRAINT IF EXISTS class_schedule_facility_fkey,
  ALTER COLUMN class_group_id SET NOT NULL,
  DROP COLUMN notes,
  DROP COLUMN title,
  DROP COLUMN category_id,
  DROP COLUMN headcount_override,
  DROP COLUMN instructor_status,
  DROP COLUMN instructor_membership_id,
  DROP COLUMN slot_id,
  DROP COLUMN partner_group_id,
  DROP COLUMN subject_type,
  DROP COLUMN facility_id;

ALTER TABLE class_schedule DROP CONSTRAINT IF EXISTS class_schedule_organization_id_id_key;

DROP POLICY IF EXISTS booking_category_tenant ON booking_category;
DROP TABLE IF EXISTS booking_category;

DROP TYPE IF EXISTS category_colour;
DROP TYPE IF EXISTS instructor_status;
DROP TYPE IF EXISTS booking_subject;

-- The generator, back to walking turmas.

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
