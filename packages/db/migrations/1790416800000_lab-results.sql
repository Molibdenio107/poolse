-- Up Migration
--
-- The national water reference, and grading a lab result — POOLSE-72, 7b.3.
--
-- The bands themselves are code (`@poolse/rules`, NP 4542:2017, cited by
-- quadro); this migration holds what they need from the database:
--
-- 1. **`pool.use`** — what the tank is for. NP 4542 Anexo D sets the water
--    temperature by it. Null means nobody said, and temperature is then not
--    judged rather than guessed (decisions, 13-10-2026).
--
-- 2. **`lab_result` + `lab_result_value`** — a laboratory report is its own
--    record, not a kit reading: a laboratory, a reference, a sample point, the
--    seven microbiological parameters of NP 4542 Quadro 3 and whatever
--    chemistry the lab measured. **The grade is never stored** — it is
--    `gradeLabResult()`, derived from these values wherever it is shown, so the
--    page, the alert and the public page cannot disagree. Corrected by archiving
--    and recording again, like an analysis.
--
-- 3. **`lab_result_alert`** — a não conforme result tells the same people the
--    water alert tells (owner, admin, maintenance), on the same 48-hour window
--    of the sample date, recorded inside the transaction and sent after it, with
--    `delivered_at` null said in words. A sibling of `pool_analysis_alert`
--    rather than a generalisation of it: that table's `metrics` is a
--    `pool_metric[]`, and a lab failure is as often an organism.
--
-- 4. **`public_water_page()`** gains the tank's kind and use (the bands depend
--    on them) and the latest live lab result's values and date — nothing else
--    from the report.

CREATE TYPE pool_use AS ENUM ('sport', 'diving', 'learning', 'children', 'hydrotherapy');

ALTER TABLE pool ADD COLUMN use pool_use;

COMMENT ON COLUMN pool.use IS
  'POOLSE-72: what the tank is for; picks the NP 4542 Anexo D temperature band. '
  'Null means temperature is not judged.';

-- The seven organisms of NP 4542 Quadro 3, then the chemistry pool_metric names.
CREATE TYPE lab_parameter AS ENUM (
  'colonies_37c',
  'total_coliforms',
  'e_coli',
  'enterococci',
  'pseudomonas_aeruginosa',
  'staphylococcus_coagulase_positive',
  'staphylococcus_total',
  'ph',
  'temperature',
  'free_chlorine',
  'combined_chlorine',
  'total_alkalinity',
  'calcium_hardness',
  'cyanuric_acid',
  'turbidity',
  'salt'
);

CREATE TYPE lab_sample_depth AS ENUM ('surface', 'subsurface');

CREATE TABLE lab_result (
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organization (id),
  pool_id                  uuid NOT NULL,

  -- When the sample was taken, UTC — not when the report arrived.
  sampled_at               timestamptz NOT NULL,
  laboratory               text,
  report_reference         text,
  -- NP 4542 §4.3.3: at the inner edge, furthest from the inlet; at the surface
  -- and 10–30 cm below it. The club's own label for the point, and which depth.
  sample_point             text,
  sample_depth             lab_sample_depth,
  notes                    text,

  recorded_by_membership_id uuid,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  archived_at              timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, pool_id) REFERENCES pool (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by_membership_id)
    REFERENCES membership (organization_id, id),

  CHECK (sampled_at > TIMESTAMPTZ '2000-01-01'),
  CONSTRAINT lab_result_text_bounded CHECK (
    coalesce(length(laboratory), 0) <= 200
    AND coalesce(length(report_reference), 0) <= 100
    AND coalesce(length(sample_point), 0) <= 100
    AND coalesce(length(notes), 0) <= 2000
  )
);

COMMENT ON TABLE lab_result IS
  'POOLSE-72: one laboratory report on one tank. Graded by gradeLabResult() in '
  '@poolse/rules from its values — the grade is never stored.';

CREATE INDEX lab_result_pool_idx ON lab_result (organization_id, pool_id, sampled_at DESC)
  WHERE archived_at IS NULL;

CREATE TRIGGER lab_result_updated_at BEFORE UPDATE ON lab_result
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE lab_result ENABLE ROW LEVEL SECURITY;
CREATE POLICY lab_result_tenant ON lab_result
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Archived, never deleted; corrected by recording again.
GRANT SELECT, INSERT, UPDATE ON lab_result TO poolse_app;
REVOKE DELETE ON lab_result FROM poolse_app;

CREATE TABLE lab_result_value (
  organization_id uuid NOT NULL REFERENCES organization (id),
  lab_result_id   uuid NOT NULL,
  parameter       lab_parameter NOT NULL,
  value           numeric(12, 3) NOT NULL,
  unit            text NOT NULL,

  PRIMARY KEY (lab_result_id, parameter),
  FOREIGN KEY (organization_id, lab_result_id) REFERENCES lab_result (organization_id, id),

  -- A count, a pH, a concentration: none is below zero, and a negative is a typo
  -- that would otherwise grade as the cleanest water on record.
  CONSTRAINT lab_result_value_not_negative CHECK (value >= 0),
  CHECK (btrim(unit) <> '')
);

ALTER TABLE lab_result_value ENABLE ROW LEVEL SECURITY;
CREATE POLICY lab_result_value_tenant ON lab_result_value
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Written with its report and never edited.
GRANT SELECT, INSERT ON lab_result_value TO poolse_app;
REVOKE UPDATE, DELETE ON lab_result_value FROM poolse_app;

CREATE TABLE lab_result_alert (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  pool_id         uuid NOT NULL,
  lab_result_id   uuid NOT NULL,
  raised_at       timestamptz NOT NULL DEFAULT now(),
  -- Which parameters failed, snapshotted: a corrected report is a new report.
  parameters      lab_parameter[] NOT NULL,
  recipients      text[] NOT NULL DEFAULT '{}',
  -- Null: recorded, and nothing left the building. Said in words on screen.
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, pool_id) REFERENCES pool (organization_id, id),
  FOREIGN KEY (organization_id, lab_result_id) REFERENCES lab_result (organization_id, id),
  CHECK (cardinality(parameters) > 0)
);

-- One alert per report: a double submit is not two emails.
CREATE UNIQUE INDEX lab_result_alert_once ON lab_result_alert (lab_result_id);

CREATE TRIGGER lab_result_alert_updated_at BEFORE UPDATE ON lab_result_alert
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE lab_result_alert ENABLE ROW LEVEL SECURITY;
CREATE POLICY lab_result_alert_tenant ON lab_result_alert
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT ON lab_result_alert TO poolse_app;
GRANT UPDATE (recipients, delivered_at) ON lab_result_alert TO poolse_app;
REVOKE DELETE ON lab_result_alert FROM poolse_app;

-- ---------------------------------------------------------------------------
-- The public page, restated with the tank and the latest lab result
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

-- Down Migration

-- POOLSE-71's page, verbatim, before the tables it would read go.
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
                AND m.archived_at IS NULL), '[]'::jsonb)
         )
    INTO v_out
    FROM pool p
    JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
   WHERE p.id = v_pool AND p.organization_id = v_org;

  RETURN v_out;
END;
$fn$;

DROP POLICY IF EXISTS lab_result_alert_tenant ON lab_result_alert;
DROP TABLE IF EXISTS lab_result_alert;
DROP POLICY IF EXISTS lab_result_value_tenant ON lab_result_value;
DROP TABLE IF EXISTS lab_result_value;
DROP POLICY IF EXISTS lab_result_tenant ON lab_result;
DROP TABLE IF EXISTS lab_result;
DROP TYPE IF EXISTS lab_sample_depth;
DROP TYPE IF EXISTS lab_parameter;
ALTER TABLE pool DROP COLUMN IF EXISTS use;
DROP TYPE IF EXISTS pool_use;
