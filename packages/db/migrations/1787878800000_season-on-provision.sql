-- A new organization opens with a season — POOLSE-07, follow-up.
--
-- `1787875200000_seasons.sql` backfilled a season for every organization that
-- already existed and made `class_group.season_id` NOT NULL. It did not touch
-- `provision_organization`, which means an organization created after it had no
-- season at all — and a turma cannot be created without one. Signing up and then
-- immediately failing to add a class is exactly the kind of hole that only shows
-- up on the first new customer.
--
-- Fixed here rather than by editing that migration, which has already run.
--
-- The name and the range come from the same rule as the backfill and as
-- `seasonOf` in the web app: September to August, pivoting in August because
-- that is the month the pool is shut and there is nothing left to run.

-- Up Migration

CREATE OR REPLACE FUNCTION provision_organization(
  p_clerk_user_id text,
  p_name          text,
  p_locale        text,
  p_facility_name text
) RETURNS TABLE (
  o_organization_id uuid,
  o_membership_id   uuid,
  o_facility_id     uuid,
  o_slug            text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user          uuid;
  v_org           uuid;
  v_membership    uuid;
  v_facility      uuid;
  v_season        uuid;
  v_start_year    int;
  v_name          text := btrim(p_name);
  v_facility_name text := btrim(coalesce(nullif(btrim(p_facility_name), ''), p_name));
  v_base          text;
  v_slug          text;
  v_suffix        int := 1;
  v_trial_ends    timestamptz := now() + interval '14 days';
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'provision_organization requires a name';
  END IF;

  SELECT id INTO v_user
    FROM app_user
   WHERE clerk_user_id = p_clerk_user_id
     AND deleted_at IS NULL;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'provision_organization: no live app_user for %', p_clerk_user_id;
  END IF;

  -- A name of nothing but punctuation slugifies to an empty string, which would
  -- otherwise become a unique index entry of ''.
  v_base := coalesce(nullif(slugify(v_name), ''), 'org');
  v_slug := v_base;

  WHILE EXISTS (SELECT 1 FROM organization WHERE slug = v_slug AND archived_at IS NULL) LOOP
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-' || v_suffix;
  END LOOP;

  INSERT INTO organization (name, locale, slug, subscription_status, trial_ends_at)
  VALUES (
    v_name,
    coalesce(nullif(btrim(p_locale), ''), 'pt-PT'),
    v_slug,
    'trialing',
    v_trial_ends
  )
  RETURNING id INTO v_org;

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_user, 'active')
  RETURNING id INTO v_membership;

  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_membership, 'owner');

  -- The first facility, so the new tenant is not an empty room. Everything in
  -- module 1 hangs off a facility, so an organization without one cannot hold a
  -- class group, a schedule or an attendance record — the operator would have to
  -- discover that themselves before anything worked.
  INSERT INTO facility (organization_id, name)
  VALUES (v_org, v_facility_name)
  RETURNING id INTO v_facility;

  -- The first season, for the same reason and a stronger one: `class_group`
  -- requires it, so without this the very first turma fails on a NOT NULL.
  v_start_year := CASE
                    WHEN extract(month FROM current_date) >= 8
                      THEN extract(year FROM current_date)::int
                    ELSE extract(year FROM current_date)::int - 1
                  END;

  INSERT INTO season (organization_id, name, starts_on, ends_on)
  VALUES (
    v_org,
    to_char(v_start_year, 'FM9999') || '/' || to_char(v_start_year + 1, 'FM9999'),
    make_date(v_start_year, 9, 1),
    make_date(v_start_year + 1, 8, 31)
  )
  RETURNING id INTO v_season;

  INSERT INTO audit_log (
    organization_id, actor_membership_id, actor_app_user_id,
    action, entity_type, entity_id, data
  ) VALUES (
    v_org, v_membership, v_user,
    'organization.created', 'organization', v_org,
    jsonb_build_object('name', v_name, 'slug', v_slug, 'trial_ends_at', v_trial_ends)
  ), (
    v_org, v_membership, v_user,
    'facility.created', 'facility', v_facility,
    jsonb_build_object('name', v_facility_name, 'source', 'signup')
  ), (
    v_org, v_membership, v_user,
    'season.created', 'season', v_season,
    jsonb_build_object('source', 'signup')
  );

  RETURN QUERY SELECT v_org, v_membership, v_facility, v_slug;
END;
$fn$;

REVOKE ALL ON FUNCTION provision_organization(text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION provision_organization(text, text, text, text) TO poolse_app;

-- Down Migration
--
-- Back to the version that creates no season. Copied whole rather than diffed,
-- because a function is replaced entire and a partial revert is not a thing.

CREATE OR REPLACE FUNCTION provision_organization(
  p_clerk_user_id text,
  p_name          text,
  p_locale        text,
  p_facility_name text
) RETURNS TABLE (
  o_organization_id uuid,
  o_membership_id   uuid,
  o_facility_id     uuid,
  o_slug            text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user          uuid;
  v_org           uuid;
  v_membership    uuid;
  v_facility      uuid;
  v_name          text := btrim(p_name);
  v_facility_name text := btrim(coalesce(nullif(btrim(p_facility_name), ''), p_name));
  v_base          text;
  v_slug          text;
  v_suffix        int := 1;
  v_trial_ends    timestamptz := now() + interval '14 days';
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'provision_organization requires a name';
  END IF;

  SELECT id INTO v_user
    FROM app_user
   WHERE clerk_user_id = p_clerk_user_id
     AND deleted_at IS NULL;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'provision_organization: no live app_user for %', p_clerk_user_id;
  END IF;

  v_base := coalesce(nullif(slugify(v_name), ''), 'org');
  v_slug := v_base;

  WHILE EXISTS (SELECT 1 FROM organization WHERE slug = v_slug AND archived_at IS NULL) LOOP
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-' || v_suffix;
  END LOOP;

  INSERT INTO organization (name, locale, slug, subscription_status, trial_ends_at)
  VALUES (
    v_name,
    coalesce(nullif(btrim(p_locale), ''), 'pt-PT'),
    v_slug,
    'trialing',
    v_trial_ends
  )
  RETURNING id INTO v_org;

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_user, 'active')
  RETURNING id INTO v_membership;

  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_membership, 'owner');

  INSERT INTO facility (organization_id, name)
  VALUES (v_org, v_facility_name)
  RETURNING id INTO v_facility;

  INSERT INTO audit_log (
    organization_id, actor_membership_id, actor_app_user_id,
    action, entity_type, entity_id, data
  ) VALUES (
    v_org, v_membership, v_user,
    'organization.created', 'organization', v_org,
    jsonb_build_object('name', v_name, 'slug', v_slug, 'trial_ends_at', v_trial_ends)
  ), (
    v_org, v_membership, v_user,
    'facility.created', 'facility', v_facility,
    jsonb_build_object('name', v_facility_name, 'source', 'signup')
  );

  RETURN QUERY SELECT v_org, v_membership, v_facility, v_slug;
END;
$fn$;

REVOKE ALL ON FUNCTION provision_organization(text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION provision_organization(text, text, text, text) TO poolse_app;
