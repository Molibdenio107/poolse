-- Up Migration
--
-- POOLSE-84 — a closure belongs to one site, or to some of its tanks. Rui,
-- 16 October 2026.
--
-- **The bug.** `closure.facility_id` existed from the first migration and was
-- never written nor read, so "Toda a instalação" saved a closure with no site
-- and no tank, which every reader took to mean the whole organization: a club
-- with two sites that shut one for works cancelled classes at both. Worse, the
-- tank test was `c.pool_id = cs.pool_id`, and `class_session.pool_id` is copied
-- from the *turma* — a parceria, a free-swim block or an event has none, so a
-- tank closure never cancelled any of them.
--
-- **What a closure reaches is now one definition.** `closure_reaches` takes the
-- closure's site, tank, days and half, and a session's site, tanks and local
-- start. `session_reach` is the one answer to "where is this session": its site
-- (the tank's, else the booking's, else the turma's), and every tank it touches
-- — the turma's own and the pool of every lane it holds that week. Everything
-- that cancels, restores, counts or refuses reads those two:
-- `generate_sessions`, `apply_closures`, `release_closures`, `closure_impact`,
-- the free-swim check-in, the tank's "Encerrado até", and — through
-- `closure_shuts_day` — the readers that ask about a whole day (lifeguard gaps,
-- the occupancy denominator, the safety periods).
--
-- **Half days.** `part_of_day` is morning or afternoon, null for the whole day,
-- and only on a single-day closure. The cut is `closure_half_day_cut()`, 13:00
-- on the site's own clock, judged on the session's *start*: the one place the
-- hour is written. The overlap exclusion compares `closure_span`, a range of
-- local time, so a morning and an afternoon on the same day do not overlap and a
-- whole day overlaps both.
--
-- **Holidays stay the organization's.** A manual closure must name a site (by
-- CHECK); `national_holiday` and `municipal_holiday` keep both columns null and
-- reach every site, as they always have — and Férias still reads only those two.
--
-- **Existing data.** A tank closure gets its site from the tank. A manual
-- closure with neither becomes one closure per site of its organization, the
-- first keeping its row (and so the messages that name it), and the sessions it
-- cancelled are repointed to the copy for their own site.
--
-- **Several tanks in one form are several rows**, so one can reopen before the
-- other. They share `batch_id`, which is what lets one warning reach everybody
-- the form took a lesson from, rather than one message per tank to the same
-- families.

CREATE TYPE closure_part_of_day AS ENUM ('morning', 'afternoon');

ALTER TABLE closure
  ADD COLUMN part_of_day closure_part_of_day,
  ADD COLUMN batch_id uuid NOT NULL DEFAULT gen_random_uuid();

COMMENT ON COLUMN closure.part_of_day IS
  'POOLSE-84: null is the whole day; morning or afternoon only on a single-day closure. '
  'The cut is closure_half_day_cut() on the site''s clock, judged on a session''s start.';
COMMENT ON COLUMN closure.batch_id IS
  'POOLSE-84: closures made by one form share it (one row per tank), so one warning '
  'reaches everybody the form took a lesson from. A closure on its own is its own batch.';
COMMENT ON COLUMN closure.facility_id IS
  'POOLSE-84: the site a manual closure shuts (all of it, or only pool_id). Null only '
  'for a holiday, which shuts every site of the organization.';

CREATE INDEX closure_batch_idx ON closure (organization_id, batch_id);

-- The old exclusion keys on the pool alone; it has to go before the split below,
-- whose copies are the same days at another site.
ALTER TABLE closure DROP CONSTRAINT closure_no_overlap;

-- ---------------------------------------------------------------------------
-- The definitions
-- ---------------------------------------------------------------------------

CREATE FUNCTION closure_half_day_cut() RETURNS time
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT TIME '13:00' $$;

COMMENT ON FUNCTION closure_half_day_cut() IS
  'POOLSE-84: where a morning ends and an afternoon begins, on the site''s clock. The one place.';

-- Does a closure fall on this local moment? The day is the four-argument
-- `closure_covers`, unchanged; the half is the cut.
CREATE FUNCTION closure_covers(
  p_starts_on date,
  p_ends_on   date,
  p_repeats   boolean,
  p_part      closure_part_of_day,
  p_local     timestamp
) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT closure_covers(p_starts_on, p_ends_on, p_repeats, p_local::date)
     AND (p_part IS NULL
          OR (p_part = 'morning') = (p_local::time < closure_half_day_cut()))
$$;

-- The local time a closure covers, as a range — what the overlap exclusion
-- compares. Morning and afternoon of one day meet at the cut and do not overlap.
CREATE FUNCTION closure_span(
  p_starts_on date,
  p_ends_on   date,
  p_part      closure_part_of_day
) RETURNS tsrange
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE p_part
           WHEN 'morning'   THEN tsrange(p_starts_on::timestamp,
                                         p_starts_on + closure_half_day_cut(), '[)')
           WHEN 'afternoon' THEN tsrange(p_starts_on + closure_half_day_cut(),
                                         (p_ends_on + 1)::timestamp, '[)')
           ELSE tsrange(p_starts_on::timestamp, (p_ends_on + 1)::timestamp, '[)')
         END
$$;

-- Does a closure with this reach take a session with that one? The single
-- definition: site, tank, day and half. A null site is a holiday (every site);
-- a null tank is the whole site; a session's tanks are every tank it touches.
CREATE FUNCTION closure_reaches(
  p_facility_id   uuid,
  p_pool_id       uuid,
  p_starts_on     date,
  p_ends_on       date,
  p_repeats       boolean,
  p_part          closure_part_of_day,
  s_facility_id   uuid,
  s_pool_ids      uuid[],
  s_local_start   timestamp
) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT (p_facility_id IS NULL OR p_facility_id = s_facility_id)
     AND (p_pool_id IS NULL OR p_pool_id = ANY (s_pool_ids))
     AND closure_covers(p_starts_on, p_ends_on, p_repeats, p_part, s_local_start)
$$;

-- The same for a stored closure, which must also be live and blocking.
CREATE FUNCTION closure_applies(
  c               closure,
  s_facility_id   uuid,
  s_pool_ids      uuid[],
  s_local_start   timestamp
) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT c.archived_at IS NULL
     AND c.blocks_generation
     AND closure_reaches(c.facility_id, c.pool_id, c.starts_on, c.ends_on,
                         c.repeats_annually, c.part_of_day,
                         s_facility_id, s_pool_ids, s_local_start)
$$;

-- Does a closure shut this whole day, for these tanks? Both halves taken. Read by
-- the day-level questions (lifeguard gaps, opening hours, safety periods); an
-- empty tank list asks about the site itself, which only a site closure shuts.
CREATE FUNCTION closure_shuts_day(
  c               closure,
  s_facility_id   uuid,
  s_pool_ids      uuid[],
  s_day           date
) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT closure_applies(c, s_facility_id, s_pool_ids, s_day::timestamp)
     AND closure_applies(c, s_facility_id, s_pool_ids, s_day + closure_half_day_cut())
$$;

-- Where a session is: its site, every tank it touches, and its start on that
-- site's clock. The tank's site wins, then the booking's, then the turma's, then
-- its lanes'.
CREATE FUNCTION session_reach(p_organization_id uuid, p_session_id uuid)
RETURNS TABLE (facility_id uuid, pool_ids uuid[], local_start timestamp)
LANGUAGE sql STABLE
AS $$
  SELECT f.id,
         array(
           SELECT DISTINCT x.pool_id
             FROM (
               SELECT cs.pool_id
               UNION ALL
               SELECT l.pool_id
                 FROM class_session_lane csl
                 JOIN lane l ON l.id = csl.lane_id AND l.organization_id = csl.organization_id
                WHERE csl.session_id = cs.id AND csl.organization_id = cs.organization_id
             ) x
            WHERE x.pool_id IS NOT NULL
         ),
         cs.starts_at AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon')
    FROM class_session cs
    LEFT JOIN pool p
      ON p.id = cs.pool_id AND p.organization_id = cs.organization_id
    LEFT JOIN class_schedule sch
      ON sch.id = cs.schedule_id AND sch.organization_id = cs.organization_id
    LEFT JOIN class_group cg
      ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
    LEFT JOIN facility f
      ON f.id = coalesce(
           p.facility_id, sch.facility_id, cg.facility_id,
           -- A session with lanes and nothing else is at its lanes' site.
           (SELECT lp.facility_id
              FROM class_session_lane csl
              JOIN lane l ON l.id = csl.lane_id AND l.organization_id = csl.organization_id
              JOIN pool lp ON lp.id = l.pool_id AND lp.organization_id = l.organization_id
             WHERE csl.session_id = cs.id AND csl.organization_id = cs.organization_id
             LIMIT 1))
     AND f.organization_id = cs.organization_id
   WHERE cs.id = p_session_id AND cs.organization_id = p_organization_id
$$;

COMMENT ON FUNCTION session_reach(uuid, uuid) IS
  'POOLSE-84: a session''s site, every tank it touches (the turma''s and its lanes'') and '
  'its local start. What closure_applies is asked about.';

-- The last day of the occurrence of a closure that contains `p_day` — its
-- `ends_on`, or for an annual one the end date projected onto that year (the
-- next year when it wraps). What "Encerrado até" says.
CREATE FUNCTION closure_until(
  p_starts_on date,
  p_ends_on   date,
  p_repeats   boolean,
  p_day       date
) RETURNS date
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_year int := extract(YEAR FROM p_day)::int;
  v_end  date;
BEGIN
  IF NOT p_repeats THEN
    RETURN p_ends_on;
  END IF;
  FOR i IN 0..1 LOOP
    v_end := make_date(v_year + i, extract(MONTH FROM p_ends_on)::int,
                       least(extract(DAY FROM p_ends_on)::int,
                             extract(DAY FROM (date_trunc('month',
                               make_date(v_year + i, extract(MONTH FROM p_ends_on)::int, 1))
                               + interval '1 month - 1 day'))::int));
    IF v_end >= p_day THEN
      RETURN v_end;
    END IF;
  END LOOP;
  RETURN v_end;
END;
$$;

-- What shuts this tank at this instant, if anything — the free-swim check-in's
-- question. The latest-ending closure is the one worth naming.
CREATE FUNCTION pool_closure_at(p_organization_id uuid, p_pool_id uuid, p_at timestamptz)
RETURNS TABLE (closure_id uuid, reason text, part_of_day closure_part_of_day, until date)
LANGUAGE sql STABLE
AS $$
  SELECT c.id, c.reason, c.part_of_day,
         closure_until(c.starts_on, c.ends_on, c.repeats_annually,
                       (p_at AT TIME ZONE f.timezone)::date) AS until
    FROM pool p
    JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
    JOIN closure c
      ON c.organization_id = p.organization_id
     AND closure_applies(c, p.facility_id, ARRAY[p.id], p_at AT TIME ZONE f.timezone)
   WHERE p.id = p_pool_id AND p.organization_id = p_organization_id
   ORDER BY until DESC, c.created_at
   LIMIT 1
$$;

-- What shuts each tank of a site on a day, any part of it — the tank card's
-- "Encerrado até dd-MM-yyyy" or "Encerrado de manhã". One row per tank that has
-- something; a morning reads at 00:00, an afternoon at the cut.
CREATE FUNCTION pool_closures_on(p_organization_id uuid, p_day date)
RETURNS TABLE (pool_id uuid, closure_id uuid, reason text,
               part_of_day closure_part_of_day, until date)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT ON (p.id)
         p.id, c.id, c.reason, c.part_of_day,
         closure_until(c.starts_on, c.ends_on, c.repeats_annually, p_day) AS until
    FROM pool p
    JOIN closure c
      ON c.organization_id = p.organization_id
     AND (closure_applies(c, p.facility_id, ARRAY[p.id], p_day::timestamp)
          OR closure_applies(c, p.facility_id, ARRAY[p.id], p_day + closure_half_day_cut()))
   WHERE p.organization_id = p_organization_id
     AND p.archived_at IS NULL
   ORDER BY p.id, c.part_of_day IS NOT NULL, until DESC, c.created_at
$$;

-- ---------------------------------------------------------------------------
-- Existing data
-- ---------------------------------------------------------------------------

-- A tank closure's site is the tank's.
UPDATE closure c
   SET facility_id = p.facility_id
  FROM pool p
 WHERE p.id = c.pool_id AND p.organization_id = c.organization_id
   AND c.facility_id IS NULL;

-- An organization-wide manual closure becomes one per site. The first site keeps
-- the row, so a message that named it still names a closure that exists.
DO $$
DECLARE
  r       record;
  f       record;
  v_first uuid;
  v_new   uuid;
BEGIN
  FOR r IN
    SELECT * FROM closure
     WHERE source = 'manual' AND facility_id IS NULL AND pool_id IS NULL
  LOOP
    v_first := NULL;
    FOR f IN
      SELECT id FROM facility
       WHERE organization_id = r.organization_id
       ORDER BY archived_at IS NOT NULL, created_at, id
    LOOP
      IF v_first IS NULL THEN
        v_first := f.id;
        UPDATE closure SET facility_id = f.id WHERE id = r.id;
      ELSE
        INSERT INTO closure (organization_id, facility_id, starts_on, ends_on, reason,
                             blocks_generation, repeats_annually, source, batch_id,
                             created_at, archived_at)
        VALUES (r.organization_id, f.id, r.starts_on, r.ends_on, r.reason,
                r.blocks_generation, r.repeats_annually, 'manual', r.batch_id,
                r.created_at, r.archived_at)
        RETURNING id INTO v_new;

        UPDATE class_session cs
           SET closure_id = v_new
         WHERE cs.closure_id = r.id
           AND (SELECT sr.facility_id FROM session_reach(cs.organization_id, cs.id) sr) = f.id;
      END IF;
    END LOOP;

    IF v_first IS NULL THEN
      RAISE EXCEPTION 'closure % belongs to an organization with no site', r.id;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- The constraints
-- ---------------------------------------------------------------------------

ALTER TABLE closure
  ADD CONSTRAINT closure_manual_has_site
    CHECK (source <> 'manual' OR facility_id IS NOT NULL),
  ADD CONSTRAINT closure_half_day_is_one_day
    CHECK (part_of_day IS NULL OR starts_on = ends_on),
  -- A tank closure's site is the tank's site, by key rather than by trust.
  ADD CONSTRAINT closure_pool_at_its_site
    FOREIGN KEY (organization_id, facility_id, pool_id)
    REFERENCES pool (organization_id, facility_id, id);

-- Two closures of the same reach may not cover the same time. A tank closure
-- inside its site's closure is redundant, not a conflict (different keys); a
-- morning and an afternoon of one day meet at the cut and do not overlap.
ALTER TABLE closure
  ADD CONSTRAINT closure_no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    (coalesce(facility_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    (coalesce(pool_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    closure_span(starts_on, ends_on, part_of_day) WITH &&
  )
  WHERE (archived_at IS NULL AND source = 'manual' AND NOT repeats_annually);

-- ---------------------------------------------------------------------------
-- Applying and lifting
-- ---------------------------------------------------------------------------

-- Cancel the scheduled sessions a closure (or, with no id, any closure) now
-- takes, stamping which one did it. A session two closures take — a tank closure
-- inside its site's — is stamped by the older.
CREATE FUNCTION apply_closures(p_organization_id uuid, p_closure_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_cancelled integer;
BEGIN
  WITH hit AS (
    SELECT DISTINCT ON (cs.id) cs.id, c.id AS closure_id, c.reason
      FROM class_session cs
      CROSS JOIN LATERAL session_reach(cs.organization_id, cs.id) r
      JOIN closure c
        ON c.organization_id = cs.organization_id
       AND closure_applies(c, r.facility_id, r.pool_ids, r.local_start)
     WHERE cs.organization_id = p_organization_id
       AND cs.status = 'scheduled'
       AND (p_closure_id IS NULL OR c.id = p_closure_id)
     ORDER BY cs.id, c.created_at, c.id
  ),
  cancelled AS (
    UPDATE class_session cs
       SET status = 'cancelled',
           closure_id = hit.closure_id,
           cancellation_reason = hit.reason
      FROM hit
     WHERE cs.id = hit.id AND cs.organization_id = p_organization_id
    RETURNING 1
  )
  SELECT count(*) INTO v_cancelled FROM cancelled;

  RETURN v_cancelled;
END;
$fn$;

COMMENT ON FUNCTION apply_closures(uuid, uuid) IS
  'POOLSE-84: cancels the scheduled sessions a closure takes (all live closures with no '
  'id), stamping closure_id so the cancellation is reversible.';

-- Kept for its callers: one closure.
DROP FUNCTION apply_closure(uuid, uuid);
CREATE FUNCTION apply_closure(p_organization_id uuid, p_closure_id uuid)
RETURNS integer
LANGUAGE sql
AS $$ SELECT apply_closures(p_organization_id, p_closure_id) $$;

-- Give back what a closure no longer takes — removed, shortened, moved to
-- another tank or half. A session another closure still takes is re-stamped to
-- that one rather than put back: removing a tank's closure inside its site's
-- closure must not reopen the tank. A cancellation by a person has no
-- closure_id and is never touched. Returns how many came back.
CREATE FUNCTION release_closures(p_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_restored integer;
BEGIN
  WITH stale AS (
    SELECT cs.id, r.facility_id, r.pool_ids, r.local_start
      FROM class_session cs
      JOIN closure c0
        ON c0.id = cs.closure_id AND c0.organization_id = cs.organization_id
      CROSS JOIN LATERAL session_reach(cs.organization_id, cs.id) r
     WHERE cs.organization_id = p_organization_id
       AND cs.status = 'cancelled'
       AND cs.closure_id IS NOT NULL
       AND NOT closure_applies(c0, r.facility_id, r.pool_ids, r.local_start)
  ),
  successor AS (
    SELECT DISTINCT ON (s.id) s.id, c.id AS closure_id, c.reason
      FROM stale s
      JOIN closure c
        ON c.organization_id = p_organization_id
       AND closure_applies(c, s.facility_id, s.pool_ids, s.local_start)
     ORDER BY s.id, c.created_at, c.id
  ),
  restamped AS (
    UPDATE class_session cs
       SET closure_id = n.closure_id,
           cancellation_reason = n.reason
      FROM successor n
     WHERE cs.id = n.id AND cs.organization_id = p_organization_id
    RETURNING 1
  ),
  restored AS (
    UPDATE class_session cs
       SET status = 'scheduled',
           closure_id = NULL,
           cancellation_reason = NULL
      FROM stale s
     WHERE cs.id = s.id AND cs.organization_id = p_organization_id
       AND NOT EXISTS (SELECT 1 FROM successor n WHERE n.id = s.id)
    RETURNING 1
  )
  SELECT count(*) INTO v_restored FROM restored
   CROSS JOIN (SELECT count(*) FROM restamped) AS written;

  RETURN v_restored;
END;
$fn$;

COMMENT ON FUNCTION release_closures(uuid) IS
  'POOLSE-84: restores the sessions whose stamped closure no longer takes them, or '
  're-stamps them to another closure that still does.';

-- What a closure would take, before it is saved: one site, all of it or some of
-- its tanks, a whole day or a half. `marked` is the number that matters.
DROP FUNCTION closure_impact(uuid, date, date, uuid);
CREATE FUNCTION closure_impact(
  p_organization_id uuid,
  p_starts_on       date,
  p_ends_on         date,
  p_facility_id     uuid,
  p_pool_ids        uuid[] DEFAULT '{}',
  p_part            closure_part_of_day DEFAULT NULL,
  p_repeats         boolean DEFAULT false
) RETURNS TABLE (o_sessions integer, o_marked integer)
LANGUAGE sql STABLE
AS $fn$
  WITH covered AS (
    SELECT cs.id
      FROM class_session cs
      CROSS JOIN LATERAL session_reach(cs.organization_id, cs.id) r
     WHERE cs.organization_id = p_organization_id
       AND cs.status = 'scheduled'
       AND EXISTS (
         SELECT 1
           FROM unnest(CASE WHEN cardinality(p_pool_ids) = 0 THEN ARRAY[NULL::uuid]
                            ELSE p_pool_ids END) AS tank(id)
          WHERE closure_reaches(p_facility_id, tank.id, p_starts_on, p_ends_on, p_repeats,
                                p_part, r.facility_id, r.pool_ids, r.local_start)
       )
  )
  SELECT (SELECT count(*) FROM covered)::int,
         (SELECT count(DISTINCT a.class_session_id)
            FROM attendance a
           WHERE a.class_session_id IN (SELECT id FROM covered))::int;
$fn$;

-- ---------------------------------------------------------------------------
-- A lead's warning is scrubbed with the lead
-- ---------------------------------------------------------------------------

-- `message_recipient` may now be written to a partner's contact or a trial
-- lead, as well as a student's family. Exactly one of the three.
ALTER TABLE message_recipient
  ALTER COLUMN student_id DROP NOT NULL,
  ADD COLUMN partner_id uuid,
  ADD COLUMN lead_id uuid,
  ADD CONSTRAINT message_recipient_partner_fkey
    FOREIGN KEY (organization_id, partner_id) REFERENCES partner (organization_id, id),
  ADD CONSTRAINT message_recipient_lead_fkey
    FOREIGN KEY (organization_id, lead_id) REFERENCES lead (organization_id, id),
  ADD CONSTRAINT message_recipient_one_subject
    CHECK (num_nonnulls(student_id, partner_id, lead_id) = 1);

GRANT SELECT (partner_id, lead_id), INSERT (partner_id, lead_id)
  ON message_recipient TO poolse_app;

COMMENT ON COLUMN message_recipient.partner_id IS
  'POOLSE-84: a partner warned about a closure, through its contact''s address. '
  'student_name then holds the partner''s name.';
COMMENT ON COLUMN message_recipient.lead_id IS
  'POOLSE-84: a lead whose aula experimental a closure cancelled. student_name then '
  'holds the swimmer''s name; scrubbed when the lead is anonymised.';

-- `apply_retention` anonymises a lead that never became a student; the copy of
-- its name and address on a closure warning goes with it, whichever path did it.
CREATE FUNCTION lead_anonymised_scrubs_messages() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE message_recipient
     SET student_name = 'Aluno anonimizado',
         name = 'Pessoa anonimizada',
         email = CASE WHEN email IS NULL THEN NULL
                      ELSE 'anonimizado@anonimizado.invalid'::citext END
   WHERE organization_id = NEW.organization_id AND lead_id = NEW.id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER lead_anonymised_scrubs_messages
  AFTER UPDATE OF anonymised_at ON lead
  FOR EACH ROW
  WHEN (OLD.anonymised_at IS NULL AND NEW.anonymised_at IS NOT NULL)
  EXECUTE FUNCTION lead_anonymised_scrubs_messages();

-- ---------------------------------------------------------------------------
-- generate_sessions — the body of 1789898400000, with the closure test swapped
-- for closure_applies and steps 2 and 3 for apply/release_closures.
-- ---------------------------------------------------------------------------

DROP FUNCTION generate_sessions(uuid, date, date, uuid[]);

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
           least(p_to,   coalesce(cg.ends_on,   p_to),   se.ends_on)      AS window_to,
           -- Where the slot is, for the closure test (POOLSE-84): the tank's
           -- site, else the booking's; the turma's tank and every lane's.
           coalesce(p.facility_id, sch.facility_id) AS site_id,
           array_remove(ARRAY[cg.pool_id] || ARRAY(
             SELECT l.pool_id
               FROM booking_lane bl
               JOIN lane l ON l.id = bl.lane_id AND l.organization_id = bl.organization_id
              WHERE bl.schedule_id = sch.id AND bl.organization_id = sch.organization_id
           ), NULL) AS pool_ids
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
            AND closure_applies(c, s.site_id, s.pool_ids, d::date + s.start_time)
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

  -- 2. Cancel what a closure now takes, and 3. give back what it no longer
  --    does — one definition each since POOLSE-84 (`apply_closures`,
  --    `release_closures`), shared with saving and removing a closure.
  v_cancelled := apply_closures(p_organization_id);
  v_restored  := release_closures(p_organization_id);

  RETURN QUERY SELECT v_created, v_cancelled, v_restored;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- message_recipients — the closure audience reaches partners and trial leads
--
-- POOLSE-84. The `closure` audience used to be the families of turmas with a
-- lesson that closure cancelled. It is now everybody the *form* took a lesson
-- from — every closure sharing the batch — and three kinds of people:
--
--   * the families of affected turmas, as before;
--   * each affected parceria's partner, through every live contact with an
--     address, or one row with none so it is counted as not reachable;
--   * leads whose aula experimental was one of those sessions.
--
-- Two columns are added to the result, `partner_id` and `lead_id`; on those rows
-- `student_id` is null and `student_name` names the partner or the swimmer.
-- Every other audience is unchanged and never yields them.
-- ---------------------------------------------------------------------------

DROP FUNCTION message_recipients(uuid, message_audience, uuid, uuid, uuid, uuid);

CREATE FUNCTION message_recipients(
  p_organization_id uuid,
  p_audience        message_audience,
  p_class_group_id  uuid,
  p_level_id        uuid,
  p_facility_id     uuid,
  p_closure_id      uuid DEFAULT NULL
) RETURNS TABLE (
  student_id             uuid,
  student_name           text,
  guardian_membership_id uuid,
  name                   text,
  email                  citext,
  partner_id             uuid,
  lead_id                uuid
)
LANGUAGE sql
STABLE
AS $$
  WITH closed AS (
    -- The sessions the closure's form cancelled: every closure in its batch.
    SELECT cs.id, cs.class_group_id, sch.class_group_id AS schedule_group_id,
           sch.partner_group_id
      FROM closure k0
      JOIN closure k
        ON k.organization_id = k0.organization_id AND k.batch_id = k0.batch_id
      JOIN class_session cs
        ON cs.closure_id = k.id AND cs.organization_id = k.organization_id
      LEFT JOIN class_schedule sch
        ON sch.id = cs.schedule_id AND sch.organization_id = cs.organization_id
     WHERE p_audience = 'closure'
       AND k0.id = p_closure_id
       AND k0.organization_id = p_organization_id
  ),
  audience AS (
    SELECT DISTINCT s.id, s.membership_id, s.contact_email,
           btrim(s.first_name || ' ' || s.last_name) AS student_name
      FROM enrollment e
      JOIN class_group cg
        ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
      JOIN student s
        ON s.id = e.student_id AND s.organization_id = e.organization_id
      LEFT JOIN season se
        ON se.id = cg.season_id AND se.organization_id = cg.organization_id
     WHERE e.organization_id = p_organization_id
       AND e.status = 'active'
       AND cg.archived_at IS NULL
       AND s.archived_at IS NULL
       AND (se.id IS NULL OR se.status <> 'archived')
       AND CASE p_audience
             WHEN 'class_group'  THEN cg.id = p_class_group_id
             WHEN 'level'        THEN cg.level_id = p_level_id
             WHEN 'facility'     THEN cg.facility_id = p_facility_id
             WHEN 'organization' THEN true
             WHEN 'closure'      THEN EXISTS (
               SELECT 1 FROM closed
                WHERE coalesce(closed.class_group_id, closed.schedule_group_id) = cg.id)
           END
  ),
  guardians AS (
    SELECT a.id AS student_id, g.guardian_membership_id
      FROM audience a
      JOIN guardian_link g
        ON g.student_id = a.id AND g.organization_id = p_organization_id
      JOIN membership m
        ON m.id = g.guardian_membership_id AND m.organization_id = g.organization_id
     WHERE g.archived_at IS NULL
       AND m.archived_at IS NULL
  ),
  partners AS (
    SELECT DISTINCT pa.id, pa.name
      FROM closed
      JOIN partner_group pg
        ON pg.id = closed.partner_group_id AND pg.organization_id = p_organization_id
      JOIN partner pa
        ON pa.id = pg.partner_id AND pa.organization_id = pg.organization_id
     WHERE pa.archived_at IS NULL
  )
  SELECT a.id, a.student_name, gu.guardian_membership_id,
         coalesce(person_name(gu.guardian_membership_id), a.student_name),
         nullif(btrim(person_email(gu.guardian_membership_id)::text), '')::citext,
         NULL::uuid, NULL::uuid
    FROM guardians gu
    JOIN audience a ON a.id = gu.student_id
  UNION ALL
  SELECT a.id, a.student_name, NULL::uuid, a.student_name,
         nullif(btrim(coalesce(person_email(a.membership_id), a.contact_email)::text), '')::citext,
         NULL::uuid, NULL::uuid
    FROM audience a
   WHERE NOT EXISTS (SELECT 1 FROM guardians gu WHERE gu.student_id = a.id)
  UNION ALL
  -- A partner is written to at its contacts' addresses; with none it is one row
  -- with no address, counted as not reachable rather than skipped.
  SELECT NULL::uuid, pa.name, NULL::uuid, coalesce(pc.name, pa.name),
         nullif(btrim(pc.email), '')::citext,
         pa.id, NULL::uuid
    FROM partners pa
    LEFT JOIN LATERAL (
      SELECT c.name, c.email
        FROM partner_contact c
       WHERE c.partner_id = pa.id
         AND c.organization_id = p_organization_id
         AND c.archived_at IS NULL
         AND nullif(btrim(coalesce(c.email, '')), '') IS NOT NULL
    ) pc ON true
  UNION ALL
  SELECT NULL::uuid,
         btrim(l.swimmer_first_name || ' ' || l.swimmer_last_name),
         NULL::uuid,
         coalesce(nullif(btrim(l.guardian_name), ''),
                  btrim(l.swimmer_first_name || ' ' || l.swimmer_last_name)),
         nullif(btrim(l.email), '')::citext,
         NULL::uuid, l.id
    FROM lead l
   WHERE l.organization_id = p_organization_id
     AND l.status = 'trial_booked'
     AND l.archived_at IS NULL
     AND l.anonymised_at IS NULL
     AND l.trial_session_id IN (SELECT closed.id FROM closed)
$$;

COMMENT ON FUNCTION message_recipients(uuid, message_audience, uuid, uuid, uuid, uuid) IS
  'POOLSE-67: who a message reaches — live guardians, else the student — one row per '
  'student × address, null email where there is none. Read by preview and send alike. '
  'POOLSE-84: the closure audience is everybody its batch took a lesson from — turma '
  'families, parceria partners (partner_id) and trial leads (lead_id).';


-- The free-swim check-in refuses a closed tank (POOLSE-84). Otherwise the body
-- of 1789941600000.
CREATE OR REPLACE FUNCTION pass_check_in_allowed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_pass      record;
  v_facility  uuid;
  v_timezone  text;
  v_day       date;
  v_used      integer;
  v_occ       record;
  v_closed    record;
BEGIN
  -- An advisory lock rather than FOR UPDATE: a row lock needs an UPDATE grant,
  -- and `pass` deliberately has none.
  PERFORM pg_advisory_xact_lock(hashtextextended('pass:' || NEW.pass_id::text, 0));

  SELECT p.* INTO v_pass
    FROM pass p
   WHERE p.id = NEW.pass_id AND p.organization_id = NEW.organization_id;

  IF v_pass.id IS NULL THEN
    RAISE EXCEPTION 'No such pass' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT pl.facility_id, f.timezone INTO v_facility, v_timezone
    FROM pool pl
    JOIN facility f ON f.id = pl.facility_id AND f.organization_id = pl.organization_id
   WHERE pl.id = NEW.pool_id AND pl.organization_id = NEW.organization_id
     AND pl.archived_at IS NULL;

  IF v_facility IS NULL OR v_facility <> v_pass.facility_id THEN
    RAISE EXCEPTION 'A pass is used at the site that sold it'
      USING ERRCODE = 'check_violation', DETAIL = 'pass_wrong_site';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pass_current pc
     WHERE pc.id = v_pass.id AND pc.organization_id = NEW.organization_id AND pc.voided
  ) THEN
    RAISE EXCEPTION 'This pass was credited'
      USING ERRCODE = 'check_violation', DETAIL = 'pass_void';
  END IF;

  v_day := (NEW.checked_in_at AT TIME ZONE v_timezone)::date;

  IF v_day < v_pass.valid_from THEN
    RAISE EXCEPTION 'This pass starts on %', v_pass.valid_from
      USING ERRCODE = 'check_violation',
            DETAIL = format('pass_not_yet|%s', v_pass.valid_from);
  END IF;

  IF v_pass.valid_until IS NOT NULL AND v_day > v_pass.valid_until THEN
    RAISE EXCEPTION 'This pass ended on %', v_pass.valid_until
      USING ERRCODE = 'check_violation',
            DETAIL = format('pass_expired|%s', v_pass.valid_until);
  END IF;

  IF v_pass.entries IS NOT NULL THEN
    SELECT count(*) INTO v_used
      FROM pass_check_in c
     WHERE c.pass_id = v_pass.id
       AND c.organization_id = NEW.organization_id
       AND c.archived_at IS NULL;

    IF v_used >= v_pass.entries THEN
      RAISE EXCEPTION 'All % entries on this pass are used', v_pass.entries
        USING ERRCODE = 'check_violation',
              DETAIL = format('pass_used_up|%s', v_pass.entries);
    END IF;
  END IF;

  -- One body in the water per pass. A pass belongs to a person, and two entries
  -- at once on one pass is either a mistake or a pass being shared.
  IF EXISTS (
    SELECT 1
      FROM pass_check_in c
      JOIN pool pl ON pl.id = c.pool_id AND pl.organization_id = c.organization_id
      JOIN facility f ON f.id = pl.facility_id AND f.organization_id = pl.organization_id
     WHERE c.pass_id = v_pass.id
       AND c.organization_id = NEW.organization_id
       AND c.archived_at IS NULL
       AND c.checked_in_at <= NEW.checked_in_at
       AND coalesce(c.checked_out_at,
                    c.checked_in_at + make_interval(mins => f.free_swim_stay_minutes))
           > NEW.checked_in_at
  ) THEN
    RAISE EXCEPTION 'This pass is already in the water'
      USING ERRCODE = 'check_violation', DETAIL = 'pass_in_water';
  END IF;

  PERFORM 1 FROM pool pl
    WHERE pl.id = NEW.pool_id AND pl.organization_id = NEW.organization_id
      FOR UPDATE;

  -- A closed tank takes nobody — POOLSE-84. Under the pool lock, like the
  -- capacity test, and through the same definition that cancels its classes.
  SELECT * INTO v_closed FROM pool_closure_at(NEW.organization_id, NEW.pool_id, NEW.checked_in_at);
  IF v_closed.closure_id IS NOT NULL THEN
    RAISE EXCEPTION 'This tank is closed until %', v_closed.until
      USING ERRCODE = 'check_violation',
            DETAIL = format('pool_closed|%s|%s', v_closed.until,
                            coalesce(v_closed.part_of_day::text, ''));
  END IF;

  SELECT * INTO v_occ FROM pool_occupancy(NEW.organization_id, NEW.pool_id, NEW.checked_in_at);

  IF v_occ.capacity IS NOT NULL
     AND v_occ.swimmers + v_occ.in_classes + 1 > v_occ.capacity THEN
    RAISE EXCEPTION 'The tank holds %; % are in the water', v_occ.capacity,
                    v_occ.swimmers + v_occ.in_classes
      USING ERRCODE = 'check_violation',
            DETAIL = format('pool_occupancy|%s|%s|1', v_occ.capacity,
                            v_occ.swimmers + v_occ.in_classes);
  END IF;

  RETURN NEW;
END;
$$;

-- Lifeguard gaps: a day a closure shuts the site or this tank — the whole day —
-- has no window. Otherwise the body of 1790114400000.
CREATE OR REPLACE FUNCTION lifeguard_gaps(
  p_organization_id uuid,
  p_facility_id     uuid,
  p_from            date,
  p_days            integer
) RETURNS TABLE (pool_id uuid, day date, gap_from timestamptz, gap_to timestamptz)
LANGUAGE sql
STABLE
AS $$
  WITH days AS (
    SELECT (p_from + n)::date AS day
      FROM generate_series(0, greatest(p_days, 1) - 1) AS n
  ),
  windows AS (
    SELECT p.id AS pool_id, d.day,
           tstzrange((d.day + h.opens_at) AT TIME ZONE f.timezone,
                     (d.day + h.closes_at) AT TIME ZONE f.timezone) AS open
      FROM pool p
      JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
      CROSS JOIN days d
      JOIN facility_hours h
        ON h.facility_id = f.id AND h.organization_id = f.organization_id
       AND h.weekday = extract(ISODOW FROM d.day)
       AND h.available
       AND h.opens_at IS NOT NULL AND h.closes_at IS NOT NULL
       AND h.closes_at > h.opens_at
     WHERE p.organization_id = p_organization_id
       AND p.facility_id = p_facility_id
       AND p.archived_at IS NULL
       -- A day a closure shuts the site or this tank has no window to cover —
       -- a feriado is not "nobody on duty". The same rule `generate_sessions`
       -- uses to skip lessons, through the same `closure_covers`.
       AND NOT EXISTS (
         SELECT 1 FROM closure c
          WHERE c.organization_id = p_organization_id
            AND closure_shuts_day(c, p.facility_id, ARRAY[p.id], d.day)
       )
  ),
  uncovered AS (
    SELECT w.pool_id, w.day,
           tstzmultirange(w.open) - coalesce(
             (SELECT range_agg(tstzrange(l.starts_at, l.ends_at))
                FROM lifeguard_duty l
               WHERE l.organization_id = p_organization_id
                 AND l.pool_id = w.pool_id
                 AND l.archived_at IS NULL
                 AND tstzrange(l.starts_at, l.ends_at) && w.open),
             '{}'::tstzmultirange) AS gaps
      FROM windows w
  )
  SELECT u.pool_id, u.day, lower(g), upper(g)
    FROM uncovered u
    CROSS JOIN LATERAL unnest(u.gaps) AS g
   ORDER BY u.pool_id, lower(g)
$$;

-- Down Migration

-- Org-wide closures are not re-merged: the copies per site stay, each a valid
-- closure of its site under the old rules.
CREATE OR REPLACE FUNCTION lifeguard_gaps(
  p_organization_id uuid,
  p_facility_id     uuid,
  p_from            date,
  p_days            integer
) RETURNS TABLE (pool_id uuid, day date, gap_from timestamptz, gap_to timestamptz)
LANGUAGE sql
STABLE
AS $$
  WITH days AS (
    SELECT (p_from + n)::date AS day
      FROM generate_series(0, greatest(p_days, 1) - 1) AS n
  ),
  windows AS (
    SELECT p.id AS pool_id, d.day,
           tstzrange((d.day + h.opens_at) AT TIME ZONE f.timezone,
                     (d.day + h.closes_at) AT TIME ZONE f.timezone) AS open
      FROM pool p
      JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
      CROSS JOIN days d
      JOIN facility_hours h
        ON h.facility_id = f.id AND h.organization_id = f.organization_id
       AND h.weekday = extract(ISODOW FROM d.day)
       AND h.available
       AND h.opens_at IS NOT NULL AND h.closes_at IS NOT NULL
       AND h.closes_at > h.opens_at
     WHERE p.organization_id = p_organization_id
       AND p.facility_id = p_facility_id
       AND p.archived_at IS NULL
       -- A day a closure shuts the site or this tank has no window to cover —
       -- a feriado is not "nobody on duty". The same rule `generate_sessions`
       -- uses to skip lessons, through the same `closure_covers`.
       AND NOT EXISTS (
         SELECT 1 FROM closure c
          WHERE c.organization_id = p_organization_id
            AND c.archived_at IS NULL
            AND c.blocks_generation
            AND (c.pool_id IS NULL OR c.pool_id = p.id)
            AND closure_covers(c.starts_on, c.ends_on, c.repeats_annually, d.day)
       )
  ),
  uncovered AS (
    SELECT w.pool_id, w.day,
           tstzmultirange(w.open) - coalesce(
             (SELECT range_agg(tstzrange(l.starts_at, l.ends_at))
                FROM lifeguard_duty l
               WHERE l.organization_id = p_organization_id
                 AND l.pool_id = w.pool_id
                 AND l.archived_at IS NULL
                 AND tstzrange(l.starts_at, l.ends_at) && w.open),
             '{}'::tstzmultirange) AS gaps
      FROM windows w
  )
  SELECT u.pool_id, u.day, lower(g), upper(g)
    FROM uncovered u
    CROSS JOIN LATERAL unnest(u.gaps) AS g
   ORDER BY u.pool_id, lower(g)
$$;

CREATE OR REPLACE FUNCTION pass_check_in_allowed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_pass      record;
  v_facility  uuid;
  v_timezone  text;
  v_day       date;
  v_used      integer;
  v_occ       record;
BEGIN
  -- An advisory lock rather than FOR UPDATE: a row lock needs an UPDATE grant,
  -- and `pass` deliberately has none.
  PERFORM pg_advisory_xact_lock(hashtextextended('pass:' || NEW.pass_id::text, 0));

  SELECT p.* INTO v_pass
    FROM pass p
   WHERE p.id = NEW.pass_id AND p.organization_id = NEW.organization_id;

  IF v_pass.id IS NULL THEN
    RAISE EXCEPTION 'No such pass' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT pl.facility_id, f.timezone INTO v_facility, v_timezone
    FROM pool pl
    JOIN facility f ON f.id = pl.facility_id AND f.organization_id = pl.organization_id
   WHERE pl.id = NEW.pool_id AND pl.organization_id = NEW.organization_id
     AND pl.archived_at IS NULL;

  IF v_facility IS NULL OR v_facility <> v_pass.facility_id THEN
    RAISE EXCEPTION 'A pass is used at the site that sold it'
      USING ERRCODE = 'check_violation', DETAIL = 'pass_wrong_site';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pass_current pc
     WHERE pc.id = v_pass.id AND pc.organization_id = NEW.organization_id AND pc.voided
  ) THEN
    RAISE EXCEPTION 'This pass was credited'
      USING ERRCODE = 'check_violation', DETAIL = 'pass_void';
  END IF;

  v_day := (NEW.checked_in_at AT TIME ZONE v_timezone)::date;

  IF v_day < v_pass.valid_from THEN
    RAISE EXCEPTION 'This pass starts on %', v_pass.valid_from
      USING ERRCODE = 'check_violation',
            DETAIL = format('pass_not_yet|%s', v_pass.valid_from);
  END IF;

  IF v_pass.valid_until IS NOT NULL AND v_day > v_pass.valid_until THEN
    RAISE EXCEPTION 'This pass ended on %', v_pass.valid_until
      USING ERRCODE = 'check_violation',
            DETAIL = format('pass_expired|%s', v_pass.valid_until);
  END IF;

  IF v_pass.entries IS NOT NULL THEN
    SELECT count(*) INTO v_used
      FROM pass_check_in c
     WHERE c.pass_id = v_pass.id
       AND c.organization_id = NEW.organization_id
       AND c.archived_at IS NULL;

    IF v_used >= v_pass.entries THEN
      RAISE EXCEPTION 'All % entries on this pass are used', v_pass.entries
        USING ERRCODE = 'check_violation',
              DETAIL = format('pass_used_up|%s', v_pass.entries);
    END IF;
  END IF;

  -- One body in the water per pass. A pass belongs to a person, and two entries
  -- at once on one pass is either a mistake or a pass being shared.
  IF EXISTS (
    SELECT 1
      FROM pass_check_in c
      JOIN pool pl ON pl.id = c.pool_id AND pl.organization_id = c.organization_id
      JOIN facility f ON f.id = pl.facility_id AND f.organization_id = pl.organization_id
     WHERE c.pass_id = v_pass.id
       AND c.organization_id = NEW.organization_id
       AND c.archived_at IS NULL
       AND c.checked_in_at <= NEW.checked_in_at
       AND coalesce(c.checked_out_at,
                    c.checked_in_at + make_interval(mins => f.free_swim_stay_minutes))
           > NEW.checked_in_at
  ) THEN
    RAISE EXCEPTION 'This pass is already in the water'
      USING ERRCODE = 'check_violation', DETAIL = 'pass_in_water';
  END IF;

  PERFORM 1 FROM pool pl
    WHERE pl.id = NEW.pool_id AND pl.organization_id = NEW.organization_id
      FOR UPDATE;

  SELECT * INTO v_occ FROM pool_occupancy(NEW.organization_id, NEW.pool_id, NEW.checked_in_at);

  IF v_occ.capacity IS NOT NULL
     AND v_occ.swimmers + v_occ.in_classes + 1 > v_occ.capacity THEN
    RAISE EXCEPTION 'The tank holds %; % are in the water', v_occ.capacity,
                    v_occ.swimmers + v_occ.in_classes
      USING ERRCODE = 'check_violation',
            DETAIL = format('pool_occupancy|%s|%s|1', v_occ.capacity,
                            v_occ.swimmers + v_occ.in_classes);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lead_anonymised_scrubs_messages ON lead;
DROP FUNCTION IF EXISTS lead_anonymised_scrubs_messages();

DROP FUNCTION message_recipients(uuid, message_audience, uuid, uuid, uuid, uuid);
CREATE FUNCTION message_recipients(
  p_organization_id uuid,
  p_audience        message_audience,
  p_class_group_id  uuid,
  p_level_id        uuid,
  p_facility_id     uuid,
  p_closure_id      uuid DEFAULT NULL
) RETURNS TABLE (
  student_id             uuid,
  student_name           text,
  guardian_membership_id uuid,
  name                   text,
  email                  citext
)
LANGUAGE sql
STABLE
AS $$
  WITH audience AS (
    SELECT DISTINCT s.id, s.membership_id, s.contact_email,
           btrim(s.first_name || ' ' || s.last_name) AS student_name
      FROM enrollment e
      JOIN class_group cg
        ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
      JOIN student s
        ON s.id = e.student_id AND s.organization_id = e.organization_id
      LEFT JOIN season se
        ON se.id = cg.season_id AND se.organization_id = cg.organization_id
     WHERE e.organization_id = p_organization_id
       AND e.status = 'active'
       AND cg.archived_at IS NULL
       AND s.archived_at IS NULL
       AND (se.id IS NULL OR se.status <> 'archived')
       AND CASE p_audience
             WHEN 'class_group'  THEN cg.id = p_class_group_id
             WHEN 'level'        THEN cg.level_id = p_level_id
             WHEN 'facility'     THEN cg.facility_id = p_facility_id
             WHEN 'organization' THEN true
             -- The turmas this closure took a lesson from: a session it
             -- cancelled names it in `closure_id`. A parceria's session carries
             -- no students, so a school is never written to by this.
             WHEN 'closure'      THEN EXISTS (
               SELECT 1
                 FROM class_session cs
                 LEFT JOIN class_schedule sch
                   ON sch.id = cs.schedule_id AND sch.organization_id = cs.organization_id
                WHERE cs.organization_id = p_organization_id
                  AND cs.closure_id = p_closure_id
                  AND coalesce(cs.class_group_id, sch.class_group_id) = cg.id)
           END
  ),
  guardians AS (
    SELECT a.id AS student_id, g.guardian_membership_id
      FROM audience a
      JOIN guardian_link g
        ON g.student_id = a.id AND g.organization_id = p_organization_id
      JOIN membership m
        ON m.id = g.guardian_membership_id AND m.organization_id = g.organization_id
     WHERE g.archived_at IS NULL
       AND m.archived_at IS NULL
  )
  SELECT a.id, a.student_name, gu.guardian_membership_id,
         coalesce(person_name(gu.guardian_membership_id), a.student_name),
         nullif(btrim(person_email(gu.guardian_membership_id)::text), '')::citext
    FROM guardians gu
    JOIN audience a ON a.id = gu.student_id
  UNION ALL
  SELECT a.id, a.student_name, NULL::uuid, a.student_name,
         nullif(btrim(coalesce(person_email(a.membership_id), a.contact_email)::text), '')::citext
    FROM audience a
   WHERE NOT EXISTS (SELECT 1 FROM guardians gu WHERE gu.student_id = a.id)
$$;

COMMENT ON FUNCTION message_recipients(uuid, message_audience, uuid, uuid, uuid, uuid) IS
  'POOLSE-67: who a message reaches — live guardians, else the student — one row per '
  'student × address, null email where there is none. Read by preview and send alike. '
  'The closure audience reaches turmas with a lesson that closure cancelled.';

ALTER TABLE message_recipient
  DROP CONSTRAINT message_recipient_one_subject,
  DROP CONSTRAINT message_recipient_lead_fkey,
  DROP CONSTRAINT message_recipient_partner_fkey,
  DROP COLUMN lead_id,
  DROP COLUMN partner_id;
-- Fails, correctly, while a partner or lead recipient exists.
ALTER TABLE message_recipient ALTER COLUMN student_id SET NOT NULL;

DROP FUNCTION generate_sessions(uuid, date, date, uuid[]);
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

DROP FUNCTION closure_impact(uuid, date, date, uuid, uuid[], closure_part_of_day, boolean);
CREATE FUNCTION closure_impact(
  p_organization_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_pool_id uuid DEFAULT NULL
) RETURNS TABLE (o_sessions integer, o_marked integer)
LANGUAGE sql STABLE
AS $fn$
  WITH covered AS (
    SELECT cs.id
      FROM class_session cs
     WHERE cs.organization_id = p_organization_id
       AND cs.status = 'scheduled'
       AND (p_pool_id IS NULL OR cs.pool_id = p_pool_id)
       AND session_local_date(p_organization_id, cs.pool_id, cs.starts_at)
             BETWEEN p_starts_on AND p_ends_on
  )
  SELECT (SELECT count(*) FROM covered)::int,
         (SELECT count(DISTINCT a.class_session_id)
            FROM attendance a
           WHERE a.class_session_id IN (SELECT id FROM covered))::int;
$fn$;

DROP FUNCTION apply_closure(uuid, uuid);
DROP FUNCTION release_closures(uuid);
DROP FUNCTION apply_closures(uuid, uuid);
CREATE FUNCTION apply_closure(p_organization_id uuid, p_closure_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_cancelled integer;
BEGIN
  WITH cancelled AS (
    UPDATE class_session cs
       SET status = 'cancelled',
           closure_id = c.id,
           cancellation_reason = c.reason
      FROM closure c
     WHERE c.id = p_closure_id
       AND c.organization_id = p_organization_id
       AND cs.organization_id = p_organization_id
       AND c.archived_at IS NULL
       AND c.blocks_generation
       AND (c.pool_id IS NULL OR c.pool_id = cs.pool_id)
       AND cs.status = 'scheduled'
       AND closure_covers(
             c.starts_on, c.ends_on, c.repeats_annually,
             session_local_date(p_organization_id, cs.pool_id, cs.starts_at)
           )
    RETURNING cs.id
  )
  SELECT count(*) INTO v_cancelled FROM cancelled;

  RETURN v_cancelled;
END;
$fn$;

ALTER TABLE closure DROP CONSTRAINT closure_no_overlap;
ALTER TABLE closure
  DROP CONSTRAINT closure_pool_at_its_site,
  DROP CONSTRAINT closure_half_day_is_one_day,
  DROP CONSTRAINT closure_manual_has_site;

DROP FUNCTION pool_closures_on(uuid, date);
DROP FUNCTION pool_closure_at(uuid, uuid, timestamptz);
DROP FUNCTION closure_until(date, date, boolean, date);
DROP FUNCTION session_reach(uuid, uuid);
DROP FUNCTION closure_shuts_day(closure, uuid, uuid[], date);
DROP FUNCTION closure_applies(closure, uuid, uuid[], timestamp);
DROP FUNCTION closure_reaches(uuid, uuid, date, date, boolean, closure_part_of_day, uuid, uuid[], timestamp);
DROP FUNCTION closure_span(date, date, closure_part_of_day);
DROP FUNCTION closure_covers(date, date, boolean, closure_part_of_day, timestamp);
DROP FUNCTION closure_half_day_cut();

-- The copies per site made from one organization-wide closure go back into it:
-- sessions repointed to the oldest row of the batch, the others removed.
WITH site_wide AS (
  SELECT id, batch_id,
         first_value(id) OVER (PARTITION BY organization_id, batch_id
                               ORDER BY created_at, id) AS keeper
    FROM closure WHERE source = 'manual' AND pool_id IS NULL
), extra AS (SELECT id, keeper FROM site_wide WHERE id <> keeper),
moved AS (
  UPDATE class_session cs SET closure_id = e.keeper
    FROM extra e WHERE cs.closure_id = e.id RETURNING 1
)
DELETE FROM closure c USING extra e
 WHERE c.id = e.id AND (SELECT count(*) FROM moved) >= 0
   AND NOT EXISTS (SELECT 1 FROM message m WHERE m.closure_id = c.id);
-- And a whole-site closure is organization-wide again, as the old rules read it.
UPDATE closure SET facility_id = NULL WHERE source = 'manual' AND pool_id IS NULL;

DROP INDEX closure_batch_idx;
-- A half day becomes a whole day rather than vanishing.
ALTER TABLE closure DROP COLUMN batch_id, DROP COLUMN part_of_day;
DROP TYPE closure_part_of_day;

-- Copies per site overlap each other under the old pool-only key; the old
-- exclusion comes back over the first copy of each only.
ALTER TABLE closure
  ADD CONSTRAINT closure_no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    (coalesce(pool_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  )
  WHERE (archived_at IS NULL AND source = 'manual' AND NOT repeats_annually);

