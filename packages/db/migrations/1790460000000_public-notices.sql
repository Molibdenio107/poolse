-- Up Migration
--
-- The complaints book and the operating regulation on every public page —
-- POOLSE-73, roadmap 7b.4. Source record: docs/research/public-notices-2026-10.md.
--
-- 1. **Where a complaint goes is the club's regime, not a setting per page.**
--    A private operator (a club, an association, an IPSS, a hotel) must show
--    access to the Livro de Reclamações Eletrónico "em local visível e de forma
--    destacada" — DL 156/2005 art. 5.º-B n.º 2. A pool run directly by a câmara
--    or freguesia is public administration and outside that regime (art. 2.º
--    n.º 3); it shows its own platform under DL 135/99 art. 35.º-A and 38.º.
--    The public platform's address is unverified, so a public service gives its
--    own and the CHECK requires it; a private operator's link is the official
--    one and lives in the API.
--
-- 2. **`facility_regulation`** — Portaria 454/2023 art. 46.º: the owner or
--    concessionaire draws up a regulamento de funcionamento, sends it to the
--    câmara, registers it on the IPDJ's iAP and makes it available to users on
--    request. Versioned by publication and never edited: the version in force is
--    the latest live one whose day has come (`facility_regulation_current`), a
--    correction is a new version, and a version can be published ahead of the
--    season. Archiving withdraws one published by mistake.
--
-- 3. The two public functions gain both, and nothing else.

CREATE TYPE complaints_regime AS ENUM ('private', 'public_service');

ALTER TABLE organization
  ADD COLUMN complaints_regime complaints_regime NOT NULL DEFAULT 'private',
  ADD COLUMN complaints_url text;

ALTER TABLE organization
  ADD CONSTRAINT organization_complaints_url_shape CHECK (
    complaints_url IS NULL
    OR (complaints_url ~ '^https://[^\s]+$' AND length(complaints_url) <= 300)
  ),
  ADD CONSTRAINT organization_public_service_names_its_platform CHECK (
    complaints_regime = 'private' OR complaints_url IS NOT NULL
  );

COMMENT ON COLUMN organization.complaints_regime IS
  'POOLSE-73: private (DL 156/2005, livroreclamacoes.pt) or public_service (DL 135/99, '
  'the platform in complaints_url).';

CREATE TABLE facility_regulation (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id            uuid NOT NULL REFERENCES organization (id),
  facility_id                uuid NOT NULL,
  effective_from             date NOT NULL,
  body                       text NOT NULL,
  published_by_membership_id uuid,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  archived_at                timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, published_by_membership_id)
    REFERENCES membership (organization_id, id),

  CONSTRAINT facility_regulation_body_present
    CHECK (btrim(body) <> '' AND length(body) <= 50000)
);

COMMENT ON TABLE facility_regulation IS
  'POOLSE-73: one published version of a facility''s regulamento de funcionamento '
  '(Portaria 454/2023 art. 46.º). Never edited; a correction is a new version.';

-- One live version per facility per day: two taking effect on one day would
-- leave "which is in force" with no answer.
CREATE UNIQUE INDEX facility_regulation_one_per_day
  ON facility_regulation (organization_id, facility_id, effective_from)
  WHERE archived_at IS NULL;

ALTER TABLE facility_regulation ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_regulation_tenant ON facility_regulation
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Insert-only, bar withdrawing a version. **Revoke first**: the default
-- privileges hand poolse_app a table-wide UPDATE, and a column GRANT on top of
-- it restricts nothing — public-notices.sql test 4 caught exactly that.
REVOKE UPDATE, DELETE ON facility_regulation FROM poolse_app;
GRANT SELECT, INSERT ON facility_regulation TO poolse_app;
GRANT UPDATE (archived_at) ON facility_regulation TO poolse_app;

-- The same mistake in POOLSE-72's lab_result_alert (1790416800000), already on
-- main: its column grant sat on top of a table-wide UPDATE, so a tenant could
-- rewrite which parameters an alert named. Corrected here, forward.
REVOKE UPDATE ON lab_result_alert FROM poolse_app;
GRANT UPDATE (recipients, delivered_at) ON lab_result_alert TO poolse_app;

-- The version in force: the latest live one whose day has come, in the
-- facility's own timezone. STABLE, reads tables; called by the definer
-- functions below, so it is not SECURITY DEFINER itself and RLS applies to any
-- other caller.
CREATE FUNCTION facility_regulation_current(p_facility_id uuid) RETURNS uuid
LANGUAGE sql STABLE
AS $fn$
  SELECT r.id
    FROM facility_regulation r
    JOIN facility f ON f.id = r.facility_id AND f.organization_id = r.organization_id
   WHERE r.facility_id = p_facility_id
     AND r.archived_at IS NULL
     AND r.effective_from <= (now() AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'))::date
   ORDER BY r.effective_from DESC
   LIMIT 1;
$fn$;

GRANT EXECUTE ON FUNCTION facility_regulation_current(uuid) TO poolse_app;

-- ---------------------------------------------------------------------------
-- The public pages, restated
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public_water_page(p_token text) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org  uuid;
  v_pool uuid;
  v_out  jsonb;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{32,}$' THEN
    RETURN NULL;
  END IF;

  SELECT l.organization_id, l.pool_id INTO v_org, v_pool
    FROM pool_public_link l
    JOIN pool p ON p.id = l.pool_id AND p.organization_id = l.organization_id
    JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
    JOIN organization o ON o.id = l.organization_id
   WHERE l.token = p_token
     AND l.revoked_at IS NULL
     AND p.archived_at IS NULL
     AND f.archived_at IS NULL
     AND o.suspended_at IS NULL
     AND o.archived_at IS NULL;

  IF v_pool IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
           'facilityName', f.name,
           'poolName', p.name,
           'timezone', f.timezone,
           -- POOLSE-73: where a complaint goes, and the rules in force.
           'complaintsRegime', o.complaints_regime::text,
           'complaintsUrl', o.complaints_url,
           'regulation', (
             SELECT jsonb_build_object('effectiveFrom', r.effective_from, 'body', r.body)
               FROM facility_regulation r
              WHERE r.id = facility_regulation_current(f.id)),
           -- POOLSE-72: what the national bands for this tank depend on.
           'poolKind', p.kind::text,
           'poolUse', p.use::text,
           'readings', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'metric', r.metric, 'value', r.value, 'unit', r.unit,
                      'takenAt', r.taken_at) ORDER BY r.metric)
               FROM (
                 SELECT DISTINCT ON (v.metric) v.metric::text AS metric, v.value, v.unit, a.taken_at
                   FROM pool_analysis a
                   JOIN pool_analysis_value v
                     ON v.analysis_id = a.id AND v.organization_id = a.organization_id
                  WHERE a.organization_id = v_org
                    AND a.pool_id = v_pool
                    AND a.archived_at IS NULL
                  ORDER BY v.metric, a.taken_at DESC
               ) r), '[]'::jsonb),
           'bands', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'metric', m.metric::text, 'from', m.min_value, 'to', m.max_value))
               FROM pool_metric_range m
              WHERE m.organization_id = v_org
                AND m.pool_id = v_pool
                AND m.archived_at IS NULL), '[]'::jsonb),
           -- POOLSE-72: the latest live lab result, values only — the grade is
           -- derived by the API with gradeLabResult(), never stored. No
           -- laboratory name, reference, sample point or author leaves here.
           'lab', (
             SELECT jsonb_build_object(
                      'sampledAt', lr.sampled_at,
                      'values', coalesce((
                        SELECT jsonb_agg(jsonb_build_object(
                                 'parameter', lv.parameter::text,
                                 'value', lv.value,
                                 'unit', lv.unit) ORDER BY lv.parameter::text)
                          FROM lab_result_value lv
                         WHERE lv.lab_result_id = lr.id
                           AND lv.organization_id = lr.organization_id), '[]'::jsonb))
               FROM lab_result lr
              WHERE lr.organization_id = v_org
                AND lr.pool_id = v_pool
                AND lr.archived_at IS NULL
              ORDER BY lr.sampled_at DESC
              LIMIT 1)
         )
    INTO v_out
    FROM pool p
    JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
    JOIN organization o ON o.id = p.organization_id
   WHERE p.id = v_pool AND p.organization_id = v_org;

  RETURN v_out;
END;
$fn$;

CREATE OR REPLACE FUNCTION public_lead_form(p_slug text) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org      uuid;
  v_name     text;
  v_majority smallint;
  v_regime   text;
  v_url      text;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RETURN NULL;
  END IF;

  SELECT o.id, o.name, o.age_of_majority, o.complaints_regime::text, o.complaints_url
    INTO v_org, v_name, v_majority, v_regime, v_url
    FROM organization o
   WHERE o.slug = p_slug
     AND o.archived_at IS NULL
     AND o.suspended_at IS NULL
     AND o.read_only_at IS NULL
     AND o.public_registration_open
     AND o.kind = 'business';

  IF v_org IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'clubName', v_name,
    'ageOfMajority', v_majority,
    -- POOLSE-73.
    'complaintsRegime', v_regime,
    'complaintsUrl', v_url,
    'regulations', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'facilityName', f.name,
               'effectiveFrom', r.effective_from,
               'body', r.body) ORDER BY f.name)
        FROM facility f
        JOIN facility_regulation r ON r.id = facility_regulation_current(f.id)
       WHERE f.organization_id = v_org AND f.archived_at IS NULL), '[]'::jsonb),
    'facilities', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name) ORDER BY f.name)
        FROM facility f
       WHERE f.organization_id = v_org AND f.archived_at IS NULL), '[]'::jsonb),
    'levels', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name)
                       ORDER BY l.sort_order, l.name)
        FROM student_level l
       WHERE l.organization_id = v_org AND l.archived_at IS NULL), '[]'::jsonb)
  );
END;
$fn$;

-- Down Migration

CREATE OR REPLACE FUNCTION public_lead_form(p_slug text) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org      uuid;
  v_name     text;
  v_majority smallint;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RETURN NULL;
  END IF;

  SELECT o.id, o.name, o.age_of_majority INTO v_org, v_name, v_majority
    FROM organization o
   WHERE o.slug = p_slug
     AND o.archived_at IS NULL
     AND o.suspended_at IS NULL
     AND o.read_only_at IS NULL
     AND o.public_registration_open
     AND o.kind = 'business';

  IF v_org IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'clubName', v_name,
    'ageOfMajority', v_majority,
    'facilities', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name) ORDER BY f.name)
        FROM facility f
       WHERE f.organization_id = v_org AND f.archived_at IS NULL), '[]'::jsonb),
    'levels', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name)
                       ORDER BY l.sort_order, l.name)
        FROM student_level l
       WHERE l.organization_id = v_org AND l.archived_at IS NULL), '[]'::jsonb)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public_water_page(p_token text) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org  uuid;
  v_pool uuid;
  v_out  jsonb;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{32,}$' THEN
    RETURN NULL;
  END IF;

  SELECT l.organization_id, l.pool_id INTO v_org, v_pool
    FROM pool_public_link l
    JOIN pool p ON p.id = l.pool_id AND p.organization_id = l.organization_id
    JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
    JOIN organization o ON o.id = l.organization_id
   WHERE l.token = p_token
     AND l.revoked_at IS NULL
     AND p.archived_at IS NULL
     AND f.archived_at IS NULL
     AND o.suspended_at IS NULL
     AND o.archived_at IS NULL;

  IF v_pool IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
           'facilityName', f.name,
           'poolName', p.name,
           'timezone', f.timezone,
           -- POOLSE-72: what the national bands for this tank depend on.
           'poolKind', p.kind::text,
           'poolUse', p.use::text,
           'readings', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'metric', r.metric, 'value', r.value, 'unit', r.unit,
                      'takenAt', r.taken_at) ORDER BY r.metric)
               FROM (
                 SELECT DISTINCT ON (v.metric) v.metric::text AS metric, v.value, v.unit, a.taken_at
                   FROM pool_analysis a
                   JOIN pool_analysis_value v
                     ON v.analysis_id = a.id AND v.organization_id = a.organization_id
                  WHERE a.organization_id = v_org
                    AND a.pool_id = v_pool
                    AND a.archived_at IS NULL
                  ORDER BY v.metric, a.taken_at DESC
               ) r), '[]'::jsonb),
           'bands', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'metric', m.metric::text, 'from', m.min_value, 'to', m.max_value))
               FROM pool_metric_range m
              WHERE m.organization_id = v_org
                AND m.pool_id = v_pool
                AND m.archived_at IS NULL), '[]'::jsonb),
           -- POOLSE-72: the latest live lab result, values only — the grade is
           -- derived by the API with gradeLabResult(), never stored. No
           -- laboratory name, reference, sample point or author leaves here.
           'lab', (
             SELECT jsonb_build_object(
                      'sampledAt', lr.sampled_at,
                      'values', coalesce((
                        SELECT jsonb_agg(jsonb_build_object(
                                 'parameter', lv.parameter::text,
                                 'value', lv.value,
                                 'unit', lv.unit) ORDER BY lv.parameter::text)
                          FROM lab_result_value lv
                         WHERE lv.lab_result_id = lr.id
                           AND lv.organization_id = lr.organization_id), '[]'::jsonb))
               FROM lab_result lr
              WHERE lr.organization_id = v_org
                AND lr.pool_id = v_pool
                AND lr.archived_at IS NULL
              ORDER BY lr.sampled_at DESC
              LIMIT 1)
         )
    INTO v_out
    FROM pool p
    JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
   WHERE p.id = v_pool AND p.organization_id = v_org;

  RETURN v_out;
END;
$fn$;

GRANT UPDATE ON lab_result_alert TO poolse_app;

DROP FUNCTION IF EXISTS facility_regulation_current(uuid);
DROP POLICY IF EXISTS facility_regulation_tenant ON facility_regulation;
DROP TABLE IF EXISTS facility_regulation;
ALTER TABLE organization
  DROP CONSTRAINT IF EXISTS organization_public_service_names_its_platform,
  DROP CONSTRAINT IF EXISTS organization_complaints_url_shape,
  DROP COLUMN IF EXISTS complaints_url,
  DROP COLUMN IF EXISTS complaints_regime;
DROP TYPE IF EXISTS complaints_regime;
