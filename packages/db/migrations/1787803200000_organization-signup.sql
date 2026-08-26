-- Up Migration
--
-- Phase 0.5: self-serve organization signup — the front door.
--
-- Renumbering note: invitations shipped first and were called 0.5 at the time.
-- They are now 0.6, because you cannot invite anyone into an organization that
-- does not exist and the roadmap should read in the order somebody would build
-- it. `docs/roadmap.md` says the same.
--
-- Four things happen here.
--
-- 1. `subscription_status` becomes an enum. It has been a free-text column since
--    0.2, which means 'trialing', 'Trialing' and 'trialling' were all equally
--    valid and the bug would surface in phase 2 as a paywall that lets the wrong
--    people through.
--
-- 2. `trial_ends_at` and `slug`. Signing up starts a 14-day trial immediately and
--    takes no payment — Stripe and paywall enforcement are phase 2. The slug is
--    the URL-safe name, unique among live organizations.
--
-- 3. `create_organization` becomes `provision_organization`. Same single door,
--    wider: it now also stamps the trial, derives the slug, and creates a first
--    facility. Renamed because "create an organization" understates what a
--    tenant needs in order to be usable, and a name that understates gets called
--    from somewhere that then has to patch up the rest.
--
-- 4. `resolve_memberships` starts returning the subscription status and trial end
--    date, so the dashboard can say how long is left without a second round trip
--    on every page load.
--
-- The reason this is still a SECURITY DEFINER function has not changed and is
-- worth restating, because it is the whole point of the slice: the RLS policy on
-- `organization` is `WITH CHECK (id = current_organization_id())`, and for a brand
-- new organization there is no current organization — `current_organization_id()`
-- is NULL, the check fails, and the INSERT is refused. The two ways to "fix" that
-- by loosening something are both catastrophic: weakening the policy re-opens
-- cross-tenant writes, and connecting as the owner disables RLS everywhere at
-- once. A fixed-body function owned by the table owner and executable by exactly
-- one role is the narrow door instead of the open gate.

-- ---------------------------------------------------------------------------
-- subscription_status as an enum
-- ---------------------------------------------------------------------------

CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled');

ALTER TABLE organization
  ALTER COLUMN subscription_status DROP DEFAULT,
  ALTER COLUMN subscription_status TYPE subscription_status
    USING coalesce(subscription_status, 'trialing')::subscription_status,
  ALTER COLUMN subscription_status SET DEFAULT 'trialing',
  ALTER COLUMN subscription_status SET NOT NULL;

ALTER TABLE organization ADD COLUMN trial_ends_at timestamptz;

-- ---------------------------------------------------------------------------
-- slug
-- ---------------------------------------------------------------------------

-- Accents are stripped with translate() rather than the `unaccent` extension: it
-- keeps the function IMMUTABLE with no extension to enable on whichever managed
-- Postgres this ends up on, and Portuguese has a short, known set of them.
CREATE OR REPLACE FUNCTION slugify(p_text text) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(BOTH '-' FROM
    regexp_replace(
      regexp_replace(
        lower(translate(
          coalesce(p_text, ''),
          'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
          'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'
        )),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-{2,}', '-', 'g'
    )
  );
$$;

ALTER TABLE organization ADD COLUMN slug text;

UPDATE organization
   SET slug = coalesce(nullif(slugify(name), ''), 'org') || '-' || left(id::text, 8)
 WHERE slug IS NULL;

ALTER TABLE organization ALTER COLUMN slug SET NOT NULL;

-- Partial, like every unique constraint on a soft-deletable table here: an
-- archived organization must not hold its name hostage forever.
CREATE UNIQUE INDEX organization_slug_uq
  ON organization (slug)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- provision_organization
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS create_organization(text, text, text);

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
AS $$
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
$$;

-- ---------------------------------------------------------------------------
-- resolve_memberships now carries the billing state
--
-- Dropped and recreated rather than replaced: the return type changes, and
-- CREATE OR REPLACE cannot do that.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS resolve_memberships(text);

CREATE OR REPLACE FUNCTION resolve_memberships(p_clerk_user_id text)
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION provision_organization(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_memberships(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION provision_organization(text, text, text, text) TO poolse_app;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;

-- Down Migration

DROP FUNCTION IF EXISTS resolve_memberships(text);

CREATE OR REPLACE FUNCTION resolve_memberships(p_clerk_user_id text)
RETURNS TABLE (
  o_app_user_id       uuid,
  o_organization_id   uuid,
  o_organization_name text,
  o_membership_id     uuid,
  o_roles             text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, m.organization_id, o.name, m.id,
         coalesce(
           array_agg(mr.role::text ORDER BY mr.role::text)
             FILTER (WHERE mr.archived_at IS NULL),
           '{}'::text[]
         )
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
GROUP BY u.id, m.organization_id, o.name, m.id, m.created_at
ORDER BY m.created_at;
$$;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;

DROP FUNCTION IF EXISTS provision_organization(text, text, text, text);

CREATE OR REPLACE FUNCTION create_organization(
  p_clerk_user_id text,
  p_name          text,
  p_locale        text
) RETURNS TABLE (
  o_organization_id uuid,
  o_membership_id   uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid; v_org uuid; v_membership uuid;
BEGIN
  IF coalesce(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'create_organization requires a name';
  END IF;
  SELECT id INTO v_user FROM app_user
   WHERE clerk_user_id = p_clerk_user_id AND deleted_at IS NULL;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'create_organization: no live app_user for %', p_clerk_user_id;
  END IF;

  INSERT INTO organization (name, locale)
  VALUES (btrim(p_name), coalesce(nullif(btrim(p_locale), ''), 'pt-PT'))
  RETURNING id INTO v_org;
  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_user, 'active') RETURNING id INTO v_membership;
  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_membership, 'owner');
  INSERT INTO audit_log (
    organization_id, actor_membership_id, actor_app_user_id,
    action, entity_type, entity_id, data
  ) VALUES (
    v_org, v_membership, v_user, 'organization.created', 'organization', v_org,
    jsonb_build_object('name', btrim(p_name))
  );

  RETURN QUERY SELECT v_org, v_membership;
END;
$$;
GRANT EXECUTE ON FUNCTION create_organization(text, text, text) TO poolse_app;

DROP INDEX IF EXISTS organization_slug_uq;
ALTER TABLE organization DROP COLUMN IF EXISTS slug;
ALTER TABLE organization DROP COLUMN IF EXISTS trial_ends_at;
DROP FUNCTION IF EXISTS slugify(text);

ALTER TABLE organization
  ALTER COLUMN subscription_status DROP DEFAULT,
  ALTER COLUMN subscription_status DROP NOT NULL,
  ALTER COLUMN subscription_status TYPE text USING subscription_status::text;

DROP TYPE IF EXISTS subscription_status;
