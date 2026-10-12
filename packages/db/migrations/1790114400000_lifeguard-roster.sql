-- Up Migration
--
-- The lifeguard on duty — POOLSE-70, slice 2.
--
-- Who is the lifeguard on each tank, and when. Rui's answers of 12 October
-- 2026 shape all of it:
--
--   * **Anyone on the staff can be rostered** — "a teacher can also be a
--     lifeguard" — so there is no lifeguard role. What makes somebody a valid
--     lifeguard is a qualification under 7b.2, and which type counts is a flag
--     on the type: `qualification_type.counts_as_lifeguard`, seeded on
--     "Nadador-salvador (ISN)", which every club already has.
--   * **Several may be on duty at once and none is mandatory.** No exclusion
--     between two people on one tank; the only one is a person rostered twice
--     on the same tank at overlapping times, which is a typo.
--   * **Two warnings, never gates** (CLAUDE.md): a rostered person with no
--     valid lifeguard qualification that day, and an open window with nobody.
--     Both are derived here, once — `lifeguard_valid_on` and `lifeguard_gaps` —
--     and nothing refuses a duty, an incident or a class over either.

ALTER TABLE qualification_type
  ADD COLUMN counts_as_lifeguard boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN qualification_type.counts_as_lifeguard IS
  'POOLSE-70: a valid record of this type makes somebody a valid lifeguard. Seeded '
  'on Nadador-salvador (ISN); a club may mark another type.';

-- The clubs that exist: their seeded ISN type, by the name it was seeded with.
UPDATE qualification_type SET counts_as_lifeguard = true
 WHERE name = 'Nadador-salvador (ISN)' AND archived_at IS NULL;

-- And every club made from now on.
CREATE OR REPLACE FUNCTION seed_qualification_types(p_organization_id uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO qualification_type
    (organization_id, name, default_validity_months, required_to_teach, counts_as_lifeguard)
  VALUES (p_organization_id, 'TPTD — Título Profissional de Treinador de Desporto', 60, true, false),
         (p_organization_id, 'Nadador-salvador (ISN)', NULL, false, true),
         (p_organization_id, 'SBV — Suporte Básico de Vida', NULL, false, false)
$$;


CREATE TABLE lifeguard_duty (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization (id),
  pool_id          uuid NOT NULL,
  membership_id    uuid NOT NULL,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, pool_id) REFERENCES pool (organization_id, id),
  FOREIGN KEY (organization_id, membership_id) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES membership (organization_id, id),

  CONSTRAINT lifeguard_duty_ordered CHECK (ends_at > starts_at),
  CONSTRAINT lifeguard_duty_one_day CHECK (ends_at - starts_at <= interval '24 hours'),

  -- One person on one tank once at a time; two people on one tank is allowed.
  CONSTRAINT lifeguard_duty_no_double EXCLUDE USING gist (
    pool_id WITH =,
    membership_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (archived_at IS NULL)
);

COMMENT ON TABLE lifeguard_duty IS
  'POOLSE-70: who is the lifeguard on a tank, from when to when. Several at once '
  'are allowed and none is required; removing one archives it.';

CREATE INDEX lifeguard_duty_pool_idx
  ON lifeguard_duty (organization_id, pool_id, starts_at)
  WHERE archived_at IS NULL;

CREATE TRIGGER lifeguard_duty_updated_at BEFORE UPDATE ON lifeguard_duty
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE lifeguard_duty ENABLE ROW LEVEL SECURITY;
CREATE POLICY lifeguard_duty_tenant ON lifeguard_duty
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE ON lifeguard_duty TO poolse_app;
REVOKE DELETE ON lifeguard_duty FROM poolse_app;


/*
 * Whether somebody held a valid lifeguard qualification on a day.
 *
 * Derived from 7b.2's dated records and never copied: a record issued on or
 * before the day and not expired by it, of a type that counts. Read by the
 * roster's warning and by the incident's ("was the lifeguard licensed then").
 */
CREATE FUNCTION lifeguard_valid_on(
  p_organization_id uuid,
  p_membership_id   uuid,
  p_day             date
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM qualification q
      JOIN qualification_type t
        ON t.id = q.qualification_type_id AND t.organization_id = q.organization_id
     WHERE q.organization_id = p_organization_id
       AND q.membership_id = p_membership_id
       AND q.archived_at IS NULL
       AND t.archived_at IS NULL
       AND t.counts_as_lifeguard
       AND (q.issued_on IS NULL OR q.issued_on <= p_day)
       AND (q.expires_on IS NULL OR q.expires_on >= p_day)
  )
$$;

COMMENT ON FUNCTION lifeguard_valid_on(uuid, uuid, date) IS
  'POOLSE-70: a valid record of a counts_as_lifeguard type on that day. The one '
  'definition the roster and the incident read.';

/*
 * The open windows of a site's tanks with nobody on duty, over a run of days.
 * Days a closure covers are not open, so they have no gaps.
 *
 * For each tank and each day the site opens: the opening window as a range in
 * the site's own time zone, minus the union of that tank's live duties — what
 * is left are the gaps, as exact times rather than an hour grid. Multiranges
 * (PostgreSQL 14+) do the subtraction.
 */
CREATE FUNCTION lifeguard_gaps(
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

COMMENT ON FUNCTION lifeguard_gaps(uuid, uuid, date, integer) IS
  'POOLSE-70: open windows with nobody rostered, per tank and day — a warning, '
  'never a gate.';

-- Down Migration

DROP FUNCTION IF EXISTS lifeguard_gaps(uuid, uuid, date, integer);
DROP FUNCTION IF EXISTS lifeguard_valid_on(uuid, uuid, date);
DROP TABLE IF EXISTS lifeguard_duty;

CREATE OR REPLACE FUNCTION seed_qualification_types(p_organization_id uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO qualification_type (organization_id, name, default_validity_months, required_to_teach)
  VALUES (p_organization_id, 'TPTD — Título Profissional de Treinador de Desporto', 60, true),
         (p_organization_id, 'Nadador-salvador (ISN)', NULL, false),
         (p_organization_id, 'SBV — Suporte Básico de Vida', NULL, false)
$$;

ALTER TABLE qualification_type DROP COLUMN IF EXISTS counts_as_lifeguard;
