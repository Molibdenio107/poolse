-- Up Migration
--
-- Sweep 19-10-2026b — a morning closure and an afternoon closure on the same day
-- shut the day.
--
-- `closure_shuts_day(c, …)` asks one closure whether it covers both halves of a
-- day, and every day-level reader asked it closure by closure — so a half-day
-- closure in the morning and another in the afternoon each answered "no", and the
-- day read as open: the occupancy report sold it, the lane count offered its
-- tank, and lifeguard planning put somebody on duty at a shut pool.
--
-- `closure_day_shut()` asks the question of the day instead: some live closure
-- reaches its morning, and some live closure reaches its afternoon, at this site
-- and these tanks. It is the one definition now; `closure_shuts_day` stays for a
-- single closure's own answer. SECURITY INVOKER, so RLS scopes it like any query.

CREATE FUNCTION closure_day_shut(
  p_organization_id uuid,
  s_facility_id     uuid,
  s_pool_ids        uuid[],
  s_day             date
) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM closure c
                  WHERE c.organization_id = p_organization_id
                    AND closure_applies(c, s_facility_id, s_pool_ids, s_day::timestamp))
     AND EXISTS (SELECT 1 FROM closure c
                  WHERE c.organization_id = p_organization_id
                    AND closure_applies(c, s_facility_id, s_pool_ids, s_day + closure_half_day_cut()))
$$;

COMMENT ON FUNCTION closure_day_shut(uuid, uuid, uuid[], date) IS
  'Is this whole day shut at this site and these tanks, by any closures together? The '
  'day-level question (lifeguard gaps, occupancy, safety periods). Sweep 19-10-2026b.';

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
       -- Every closure of the day together (sweep 19-10-2026b): a morning closure
       -- and an afternoon one shut the day between them.
       AND NOT closure_day_shut(p_organization_id, p.facility_id, ARRAY[p.id], d.day)
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

DROP FUNCTION IF EXISTS closure_day_shut(uuid, uuid, uuid[], date);
