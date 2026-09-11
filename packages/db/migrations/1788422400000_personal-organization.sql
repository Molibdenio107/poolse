-- A person with a pool in the garden is their own organization — slice 4.5.
--
-- `organization.kind` has said `'business' | 'personal'` since the core-tenancy
-- migration, on the decision that every account is a tenant and a personal user
-- is a mostly-empty one (docs/data-model.md, decision 1). Nothing ever wrote the
-- second value. This migration is the whole of what "personal" costs the schema:
--
-- 1. `provision_organization` takes the kind, and a personal tenant opens with a
--    facility *and a pool* and no season. The pool is the point — an individual
--    signs up to record readings, and readings hang off a pool, so landing them
--    in a site with no tank is landing them in a form. The season is a turmas
--    concept: `class_group.season_id` is NOT NULL, which is why a club gets one at
--    signup, and a personal tenant has no turmas to put in it. It is not created,
--    rather than created and hidden, so that "does this tenant have a season" is a
--    question with one honest answer.
--
-- 2. `resolve_memberships` returns the kind, so `/me` can say it and the
--    navigation can be shaped by it in one round trip — the same reason it grew
--    the billing state.
--
-- Nothing is *enforced* about a personal tenant's size. `max_facilities` already
-- caps the sites at one by default, and a second pool or a second member is
-- somebody's own affair — a jacuzzi beside the pool, a partner who also tops up
-- the chlorine. The shape is a default, not a rule, and the trigger that would
-- refuse those is the trigger somebody removes the first week.
--
-- Both functions are dropped and recreated rather than replaced: the return type
-- changes, and CREATE OR REPLACE cannot do that. The old four-argument
-- `provision_organization` goes too — with a DEFAULT on the fifth parameter, two
-- overloads would make every existing four-argument call ambiguous.

-- Up Migration

COMMENT ON COLUMN organization.kind IS
  'business is a club, school, hotel or municipality; personal is one person tracking '
  'their own pool. A personal tenant is provisioned with a pool and no season, and the '
  'web app hides the club-only sections. A default of shape, not a rule of size: nothing '
  'refuses a second pool or a second member.';

-- ---------------------------------------------------------------------------
-- provision_organization: the kind decides what a new tenant opens with
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS provision_organization(text, text, text, text);

CREATE FUNCTION provision_organization(
  p_clerk_user_id text,
  p_name          text,
  p_locale        text,
  p_facility_name text,
  p_kind          organization_kind DEFAULT 'business'
) RETURNS TABLE (
  o_organization_id uuid,
  o_membership_id   uuid,
  o_facility_id     uuid,
  o_slug            text,
  o_pool_id         uuid
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
  v_pool          uuid;
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

  INSERT INTO organization (kind, name, locale, slug, subscription_status, trial_ends_at)
  VALUES (
    coalesce(p_kind, 'business'),
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

  INSERT INTO audit_log (
    organization_id, actor_membership_id, actor_app_user_id,
    action, entity_type, entity_id, data
  ) VALUES (
    v_org, v_membership, v_user,
    'organization.created', 'organization', v_org,
    jsonb_build_object('name', v_name, 'slug', v_slug, 'kind', coalesce(p_kind, 'business'),
                       'trial_ends_at', v_trial_ends)
  ), (
    v_org, v_membership, v_user,
    'facility.created', 'facility', v_facility,
    jsonb_build_object('name', v_facility_name, 'source', 'signup')
  );

  IF coalesce(p_kind, 'business') = 'personal' THEN
    -- The pool, named like the site: an individual has one, and asking them to
    -- name it at signup is a question with one answer. `outdoor` because a garden
    -- pool usually is, and it is one select on the pool's page if not.
    INSERT INTO pool (organization_id, facility_id, name, kind)
    VALUES (v_org, v_facility, v_facility_name, 'outdoor')
    RETURNING id INTO v_pool;

    INSERT INTO audit_log (
      organization_id, actor_membership_id, actor_app_user_id,
      action, entity_type, entity_id, data
    ) VALUES (
      v_org, v_membership, v_user,
      'pool.created', 'pool', v_pool,
      jsonb_build_object('name', v_facility_name, 'source', 'signup')
    );
  ELSE
    -- The first season, for the same reason as the facility and a stronger one:
    -- `class_group` requires it, so without this the very first turma fails on a
    -- NOT NULL. September to August, pivoting in August because that is the
    -- month the pool is shut and there is nothing left to run.
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
      'season.created', 'season', v_season,
      jsonb_build_object('source', 'signup')
    );
  END IF;

  RETURN QUERY SELECT v_org, v_membership, v_facility, v_slug, v_pool;
END;
$fn$;

REVOKE ALL ON FUNCTION provision_organization(text, text, text, text, organization_kind) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_organization(text, text, text, text, organization_kind) TO poolse_app;

-- ---------------------------------------------------------------------------
-- resolve_memberships: the kind travels with the membership
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS resolve_memberships(text);

CREATE FUNCTION resolve_memberships(p_clerk_user_id text)
RETURNS TABLE (
  o_app_user_id         uuid,
  o_organization_id     uuid,
  o_organization_name   text,
  o_organization_slug   text,
  o_organization_kind   text,
  o_membership_id       uuid,
  o_roles               text[],
  o_subscription_status text,
  o_trial_ends_at       timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id,
         m.organization_id,
         o.name,
         o.slug,
         o.kind::text,
         m.id,
         coalesce(
           array_agg(mr.role::text ORDER BY mr.role::text)
             FILTER (WHERE mr.archived_at IS NULL),
           '{}'::text[]
         ),
         o.subscription_status::text,
         o.trial_ends_at
    FROM app_user u
    JOIN membership m    ON m.app_user_id = u.id
                        AND m.archived_at IS NULL
                        AND m.status = 'active'
    JOIN organization o  ON o.id = m.organization_id
                        AND o.archived_at IS NULL
    LEFT JOIN membership_role mr ON mr.organization_id = m.organization_id
                                AND mr.membership_id = m.id
   WHERE u.clerk_user_id = p_clerk_user_id
     AND u.deleted_at IS NULL
GROUP BY u.id, m.organization_id, o.name, o.slug, o.kind, m.id, m.created_at,
         o.subscription_status, o.trial_ends_at
ORDER BY m.created_at;
$$;

REVOKE ALL ON FUNCTION resolve_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;

-- Down Migration
--
-- Back to the four-argument function that always opens a season and never a
-- pool, and the membership resolver without the kind. Copied whole rather than
-- diffed, because a function is replaced entire and a partial revert is not a
-- thing. Personal tenants already provisioned keep their kind — the column and
-- its enum predate this migration.

COMMENT ON COLUMN organization.kind IS NULL;

DROP FUNCTION IF EXISTS provision_organization(text, text, text, text, organization_kind);

CREATE FUNCTION provision_organization(
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

REVOKE ALL ON FUNCTION provision_organization(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_organization(text, text, text, text) TO poolse_app;

DROP FUNCTION IF EXISTS resolve_memberships(text);

CREATE FUNCTION resolve_memberships(p_clerk_user_id text)
RETURNS TABLE (
  o_app_user_id        uuid,
  o_organization_id    uuid,
  o_organization_name  text,
  o_organization_slug  text,
  o_membership_id      uuid,
  o_roles              text[],
  o_subscription_status text,
  o_trial_ends_at      timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id,
         m.organization_id,
         o.name,
         o.slug,
         m.id,
         coalesce(
           array_agg(mr.role::text ORDER BY mr.role::text)
             FILTER (WHERE mr.archived_at IS NULL),
           '{}'::text[]
         ),
         o.subscription_status::text,
         o.trial_ends_at
    FROM app_user u
    JOIN membership m    ON m.app_user_id = u.id
                        AND m.archived_at IS NULL
                        AND m.status = 'active'
    JOIN organization o  ON o.id = m.organization_id
                        AND o.archived_at IS NULL
    LEFT JOIN membership_role mr ON mr.organization_id = m.organization_id
                                AND mr.membership_id = m.id
   WHERE u.clerk_user_id = p_clerk_user_id
     AND u.deleted_at IS NULL
GROUP BY u.id, m.organization_id, o.name, o.slug, m.id, m.created_at,
         o.subscription_status, o.trial_ends_at
ORDER BY m.created_at;
$$;

REVOKE ALL ON FUNCTION resolve_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;
