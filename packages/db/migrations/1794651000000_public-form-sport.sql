-- Up Migration

-- The public pre-registration form offers a sport — POOLSE-143, rule 6.
--
-- Only for a club with a second sport switched on: `public_lead_form()` then adds
-- `sports` (the club's enabled sports) and each level's `sportId`, so the page can
-- ask for the sport first and list only that sport's levels. A pool-only club's
-- answer is byte-for-byte what it was. `submit_lead` is unchanged: the level a
-- family picks already carries its sport, which is how a lead's sport is derived
-- (`LEAD_SPORT` in leads.repository.ts) — the lead row gains nothing.

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
  v_sports   text[];
  v_multi    boolean;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RETURN NULL;
  END IF;

  SELECT o.id, o.name, o.age_of_majority, o.complaints_regime::text, o.complaints_url,
         o.enabled_sports::text[]
    INTO v_org, v_name, v_majority, v_regime, v_url, v_sports
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
  v_multi := cardinality(v_sports) > 1;

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
                         -- The level's sport, only for a club with a second one.
                         || CASE WHEN v_multi THEN jsonb_build_object('sportId', l.sport_id)
                                 ELSE '{}'::jsonb END
                       ORDER BY l.sort_order, l.name)
        FROM student_level l
       WHERE l.organization_id = v_org AND l.archived_at IS NULL), '[]'::jsonb)
  )
  -- POOLSE-143 rule 6: the sports, in the club's own order, only when there are two
  -- or more, so a pool-only club's form is exactly what it was.
  || CASE WHEN v_multi THEN jsonb_build_object('sports', to_jsonb(v_sports)) ELSE '{}'::jsonb END;
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
