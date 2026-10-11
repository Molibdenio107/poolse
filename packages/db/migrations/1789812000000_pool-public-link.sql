-- Up Migration
--
-- A public water-quality page per tank — POOLSE-71, roadmap 7b.1.
--
-- A Portuguese pool has to show its users the water's current readings. Poolse
-- holds every reading and knows whether each is inside its band; this lets a
-- bather scan a QR at the entrance and see them, with no login.
--
-- **It is the first read of tenant data with no tenant context**, so the whole
-- boundary is one function with a fixed body and a fixed result shape,
-- `public_water_page()` below — the `provision_organization` pattern. Never a
-- looser RLS policy, and never "look the tenant up, then `withOrg`": that is a
-- second, unreviewed cross-tenant read path.
--
-- **The token is stored retrievable** (decisions, 11-10-2026), reversing the 7b
-- brief's "stored hashed". It is printed at the entrance by design and grants only
-- public readings; a hash would make every lost printout a regenerate that kills
-- the QR already on the wall. Revocation is the protection, and it is immediate.
--
-- **A row per link ever issued.** Regenerating is a revoke and an insert, so "who
-- turned the public page on, and when did the old QR stop working" has an answer.

CREATE TABLE pool_public_link (
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organization (id),
  pool_id                  uuid NOT NULL,

  -- 256 bits from the API's CSPRNG, base64url. The CHECK is a floor against a
  -- caller that ever writes something guessable, not the generator.
  token                    text NOT NULL,

  created_by_membership_id uuid,
  -- Null means live. Set when the page is switched off or the link replaced.
  revoked_at               timestamptz,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, pool_id) REFERENCES pool (organization_id, id),
  FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES membership (organization_id, id),

  CONSTRAINT pool_public_link_token_shape CHECK (token ~ '^[A-Za-z0-9_-]{32,}$')
);

COMMENT ON TABLE pool_public_link IS
  'POOLSE-71: the public water page link of one tank. One live row per tank; a '
  'replaced or switched-off link keeps its row with revoked_at set.';
COMMENT ON COLUMN pool_public_link.token IS
  'Retrievable by design (decisions 11-10-2026): printed at the entrance, grants '
  'public readings only. Revocation, not secrecy at rest, is the protection.';

-- One live link per tank. Partial, as every uniqueness on a soft-ended row is.
CREATE UNIQUE INDEX pool_public_link_live_uq
  ON pool_public_link (organization_id, pool_id) WHERE revoked_at IS NULL;

-- Across every tenant, and over revoked rows too: a token is never issued twice,
-- so an old printout can never come back to life pointing at somebody else.
CREATE UNIQUE INDEX pool_public_link_token_uq ON pool_public_link (token);

CREATE TRIGGER pool_public_link_updated_at BEFORE UPDATE ON pool_public_link
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE pool_public_link ENABLE ROW LEVEL SECURITY;
CREATE POLICY pool_public_link_tenant ON pool_public_link
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- A link is revoked, never deleted, and never re-pointed.
REVOKE UPDATE, DELETE ON pool_public_link FROM poolse_app;
GRANT SELECT, INSERT ON pool_public_link TO poolse_app;
GRANT UPDATE (revoked_at) ON pool_public_link TO poolse_app;

-- ---------------------------------------------------------------------------
-- The public read — the whole boundary
--
-- SECURITY DEFINER so it can read one tenant's rows with no tenant context; a
-- fixed body so that is all it can do. Given a live token on a tank that is not
-- archived, at a site that is not archived, of a club that is neither suspended
-- nor archived, it returns exactly these keys:
--
--   facilityName, poolName, timezone, readings[{metric, value, unit, takenAt}],
--   bands[{metric, from, to}]
--
-- and NULL for anything else — unknown, revoked and closed look the same. The
-- readings are the latest live value of each metric; the bands are the pool's
-- live overrides, resolved against the published set by `resolveBands` in the
-- API, as every other caller does. No id, no note, no author leaves here.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public_water_page(p_token text) RETURNS jsonb
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

COMMENT ON FUNCTION public_water_page(text) IS
  'POOLSE-71: the public water page of one live token, and nothing else. The only '
  'read of tenant data with no tenant context; its result keys are asserted by a test.';

REVOKE ALL ON FUNCTION public_water_page(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_water_page(text) TO poolse_app;

-- Down Migration

DROP FUNCTION IF EXISTS public_water_page(text);
DROP POLICY IF EXISTS pool_public_link_tenant ON pool_public_link;
DROP TABLE IF EXISTS pool_public_link;
