-- Up Migration
--
-- Day 15 is read-only, not a locked door — POOLSE-61, slice B1.
--
-- `trial_ends_at` has been on `organization` since slice 0.5 and **nothing has
-- ever read it**. The date passes and the club carries on. This adds the state a
-- trial ends *into*, and the door that state closes; the clock that moves a
-- tenant through it is B2 and is deliberately not here.
--
-- **Nothing is copied and nothing is migrated, ever.** A trial tenant is an
-- ordinary `organization` row with a different status: there is no trial
-- database, no copy step and no import, so converting is a status change and
-- restoring one is a status change back. This paragraph is in the migration
-- rather than only in a ticket because the first person to assume otherwise will
-- be reading SQL, and "where does the trial data live" has exactly one answer —
-- here, in the same rows, the whole time.
--
-- **Read-only is a third access state, not a rename of suspension.** The platform
-- slice separated billing state (`subscription_status`) from access state
-- (`suspended_at`) on purpose. This adds a *degree* to access state and does not
-- merge the two back: `suspended_at` beats `read_only_at` beats open, enforced in
-- `TenantMiddleware` and asserted in `tenant-isolation.sql`.
--
-- **Purge is not here** — POOLSE-61 AC13. `pending_delete_at` is a date this
-- migration can set and nothing in this commit acts on; the destructive path is
-- its own ticket with its own argument.

-- ---------------------------------------------------------------------------
-- The state a trial ends into
-- ---------------------------------------------------------------------------
--
-- `ADD VALUE IF NOT EXISTS`, the pattern `comped` used. Postgres will add an enum
-- value inside a transaction but will not let the same transaction *use* it —
-- nothing here does, and the job that will is in the next slice.

ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'expired';

-- ---------------------------------------------------------------------------
-- How long a trial is, in one place
-- ---------------------------------------------------------------------------
--
-- Fifteen days from signup — POOLSE-61 AC1, up from fourteen.
--
-- A function rather than a literal, because the literal was copied into four
-- provisioning functions across four migrations and changing it meant finding all
-- four. The next change finds one. `STABLE` rather than `IMMUTABLE`: it returns a
-- constant today, and a club-specific trial later would make that a lie the
-- planner had already folded away.
--
-- **Nobody already on a trial is touched** — AC14. This changes what a *new*
-- signup gets; a migration that rewrote a live `trial_ends_at` would move billing
-- state under one club, on its own, for no benefit.

CREATE FUNCTION trial_period() RETURNS interval
LANGUAGE sql
STABLE
AS $$ SELECT interval '15 days' $$;

COMMENT ON FUNCTION trial_period() IS
  'How long a new organization trials for — POOLSE-61 AC1. The single '
  'definition; provisioning calls it rather than holding its own literal.';

-- ---------------------------------------------------------------------------
-- Where a tenant sits on the ladder
-- ---------------------------------------------------------------------------

ALTER TABLE organization
  ADD COLUMN read_only_at      timestamptz,
  ADD COLUMN pending_delete_at timestamptz;

COMMENT ON COLUMN organization.read_only_at IS
  'When this tenant stopped being able to write. Reads, exports and the billing '
  'path stay open — a club whose trial ran out can still see everything it built, '
  'get it out, and pay. Null is open. POOLSE-61.';
COMMENT ON COLUMN organization.pending_delete_at IS
  'When this tenant is due to lose access entirely, set thirty days after a trial '
  'expires. A date, not an action: nothing in this commit acts on it, and the '
  'destructive path is its own ticket. Clearing it is an operator action.';

/*
 * Both on the platform grant, and both for a reason an operator will need.
 *
 * Read-only must be liftable — a club that paid by bank transfer, a trial
 * extended by hand — and a tenant must be pullable back from pending-delete. A
 * state only a cron can set is a state nobody can undo at four o'clock on a
 * Friday. Named columns, like the six already there: a bare
 * `GRANT UPDATE ON organization` would hand over the name and the slug too.
 */
GRANT UPDATE (read_only_at, pending_delete_at) ON organization TO poolse_platform;

-- ---------------------------------------------------------------------------
-- `resolve_memberships` carries the new state to the middleware
-- ---------------------------------------------------------------------------
--
-- Read-only is decided in `TenantMiddleware`, beside suspension, for the reason
-- that one is: a tenant that simply stopped resolving is indistinguishable from
-- somebody who belongs to no organization at all. So the state travels with the
-- membership and the refusal happens one layer up, where it can carry a code and
-- the two dates a banner is built from.
--
-- Recreated in full rather than patched: a function's return type cannot be
-- widened in place, and the Down puts the current definition back verbatim.

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
  o_trial_ends_at       timestamptz,
  o_suspended_at        timestamptz,
  o_suspension_reason   text,
  o_read_only_at        timestamptz,
  o_pending_delete_at   timestamptz
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
         o.trial_ends_at,
         o.suspended_at,
         o.suspension_reason,
         o.read_only_at,
         o.pending_delete_at
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
         o.subscription_status, o.trial_ends_at, o.suspended_at, o.suspension_reason,
         o.read_only_at, o.pending_delete_at
ORDER BY m.created_at;
$$;

REVOKE ALL ON FUNCTION resolve_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;

-- ---------------------------------------------------------------------------
-- Provisioning asks how long a trial is rather than knowing
-- ---------------------------------------------------------------------------
--
-- The whole function, because a body cannot be patched in place. It is the live
-- definition from `1788422400000_personal-organization.sql` with exactly one line
-- changed — the trial now comes from `trial_period()` — and the Down puts the
-- fourteen-day literal back.

CREATE OR REPLACE FUNCTION provision_organization(
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
  v_trial_ends    timestamptz := now() + trial_period();
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

-- Down Migration
--
-- The columns and the state go; the enum is rebuilt, because Postgres cannot drop
-- a value from one. Any tenant sitting on `expired` goes to `canceled` rather
-- than being lost: it is the nearest true thing to say about a club whose trial
-- ran out, and losing the row would be worse than approximating its status.
--
-- Nothing here touches a `trial_ends_at`. A club provisioned at fifteen days
-- keeps its fifteen days — reversing the code must not move a date somebody was
-- told.

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
  o_trial_ends_at       timestamptz,
  o_suspended_at        timestamptz,
  o_suspension_reason   text
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
         o.trial_ends_at,
         o.suspended_at,
         o.suspension_reason
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
         o.subscription_status, o.trial_ends_at, o.suspended_at, o.suspension_reason
ORDER BY m.created_at;
$$;

REVOKE ALL ON FUNCTION resolve_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;

REVOKE UPDATE (read_only_at, pending_delete_at) ON organization FROM poolse_platform;

ALTER TABLE organization
  DROP COLUMN IF EXISTS read_only_at,
  DROP COLUMN IF EXISTS pending_delete_at;

UPDATE organization SET subscription_status = 'canceled' WHERE subscription_status = 'expired';

ALTER TYPE subscription_status RENAME TO subscription_status_without_expired;

CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'comped');

ALTER TABLE organization
  ALTER COLUMN subscription_status DROP DEFAULT,
  ALTER COLUMN subscription_status TYPE subscription_status
    USING subscription_status::text::subscription_status,
  ALTER COLUMN subscription_status SET DEFAULT 'trialing';

DROP TYPE subscription_status_without_expired;

CREATE OR REPLACE FUNCTION provision_organization(
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

DROP FUNCTION IF EXISTS trial_period();
