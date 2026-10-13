-- Up Migration
--
-- End-of-session sweep, 13 October 2026 (second pass) — what review found.
--
-- 1. **`provision_organization` was executable by anyone.** The trial-claim
--    migration (1789380000000) dropped and recreated it with a sixth argument
--    and never re-issued the REVOKE/GRANT its predecessors carried, so PUBLIC —
--    the platform login included — held EXECUTE on the one function that makes a
--    tenant. Signup is meant to be the only way a club comes into being. Now
--    poolse_app only, as every other definer function here.
--
-- 2. **Signup answered with a slug it had not stored.** Since the lead sweep,
--    a BEFORE INSERT trigger may step a new club past a retired slug
--    (`natacao-x` → `natacao-x-2`), but the function returned and audited the
--    slug it had asked for. It now reads back the one that was written.
--
-- 3. **The app login may no longer DELETE a club.** It never does — clubs are
--    archived — and "history is never destroyed" should not rest on nobody
--    writing that statement.
--
-- 4. **The request-stats prune could not delete.** `poolse_platform` reads
--    `tenant_request_stats` and the hourly 30-day prune ran on it, failing
--    silently every hour wherever TimescaleDB's retention policy is absent (dev,
--    and Railway). It may now delete rows older than 30 days and nothing else —
--    a policy, so the platform login still writes nothing current.

CREATE OR REPLACE FUNCTION provision_organization(
  p_clerk_user_id  text,
  p_name           text,
  p_locale         text,
  p_facility_name  text,
  p_kind           organization_kind DEFAULT 'business',
  p_signup_ip_hash text DEFAULT NULL
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
  v_email         text;
  v_normalized    text;
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'provision_organization requires a name';
  END IF;

  SELECT id, cached_email INTO v_user, v_email
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
  -- The slug as stored: the claim trigger may have stepped past a retired one.
  RETURNING id, slug INTO v_org, v_slug;

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

  /*
   * The claim, last.
   *
   * **A user with no cached address claims nothing rather than claiming ''.** An
   * address is Clerk's and the cache can be a moment behind on a laptop, where
   * the webhook cannot reach; refusing the signup over that would break the one
   * path a developer uses every day, and a claim of empty string would block the
   * *next* such signup for ever. The block is a ledger, not a login check.
   */
  v_normalized := normalize_signup_email(v_email);

  IF v_normalized IS NOT NULL THEN
    INSERT INTO trial_claim (organization_id, normalized_email, email_domain, signup_ip_hash)
    VALUES (
      v_org,
      v_normalized,
      split_part(lower(btrim(v_email)), '@', 2),
      nullif(btrim(coalesce(p_signup_ip_hash, '')), '')
    );
  END IF;

  RETURN QUERY SELECT v_org, v_membership, v_facility, v_slug, v_pool;
END;
$fn$;

REVOKE ALL ON FUNCTION provision_organization(text, text, text, text, organization_kind, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_organization(text, text, text, text, organization_kind, text) TO poolse_app;

REVOKE DELETE ON organization FROM poolse_app;

GRANT DELETE ON tenant_request_stats TO poolse_platform;
CREATE POLICY tenant_request_stats_platform_prune ON tenant_request_stats
  FOR DELETE TO poolse_platform
  USING (bucket < now() - interval '30 days');

-- 5. **"Today" is the club's, not UTC's.** Seven columns defaulted to
--    CURRENT_DATE, which the database (UTC) reads an hour behind Lisbon in
--    summer: an invoice issued, a payment or an enrolment recorded between
--    00:00 and 01:00 was dated the day before. club_today() is Lisbon's date;
--    the API's own queries were moved to it in the same change.
ALTER TABLE enrollment ALTER COLUMN joined_on SET DEFAULT club_today();
ALTER TABLE student_fee_payment ALTER COLUMN paid_on SET DEFAULT club_today();
ALTER TABLE student_fee ALTER COLUMN starts_on SET DEFAULT club_today();
ALTER TABLE invoice_payment ALTER COLUMN paid_on SET DEFAULT club_today();
ALTER TABLE invoice_chase ALTER COLUMN chased_on SET DEFAULT club_today();
ALTER TABLE lost_and_found_item ALTER COLUMN found_on SET DEFAULT club_today();
ALTER TABLE invoice ALTER COLUMN issued_on SET DEFAULT club_today();

-- 6. **A Stripe event older than the last one applied is not applied.** Stripe
--    does not guarantee delivery order, and a late invoice.payment_failed could
--    put a club back to past_due after a newer event said active. The webhook
--    records the event time it last applied and refuses anything older.
ALTER TABLE organization ADD COLUMN stripe_event_at timestamptz;
GRANT UPDATE (stripe_event_at) ON organization TO poolse_platform;
COMMENT ON COLUMN organization.stripe_event_at IS
  'The created time of the last Stripe event applied to this club; an older one is recorded as stale.';

-- Down Migration

DROP POLICY IF EXISTS tenant_request_stats_platform_prune ON tenant_request_stats;
REVOKE DELETE ON tenant_request_stats FROM poolse_platform;
GRANT DELETE ON organization TO poolse_app;

CREATE OR REPLACE FUNCTION provision_organization(
  p_clerk_user_id  text,
  p_name           text,
  p_locale         text,
  p_facility_name  text,
  p_kind           organization_kind DEFAULT 'business',
  p_signup_ip_hash text DEFAULT NULL
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
  v_email         text;
  v_normalized    text;
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'provision_organization requires a name';
  END IF;

  SELECT id, cached_email INTO v_user, v_email
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

  /*
   * The claim, last.
   *
   * **A user with no cached address claims nothing rather than claiming ''.** An
   * address is Clerk's and the cache can be a moment behind on a laptop, where
   * the webhook cannot reach; refusing the signup over that would break the one
   * path a developer uses every day, and a claim of empty string would block the
   * *next* such signup for ever. The block is a ledger, not a login check.
   */
  v_normalized := normalize_signup_email(v_email);

  IF v_normalized IS NOT NULL THEN
    INSERT INTO trial_claim (organization_id, normalized_email, email_domain, signup_ip_hash)
    VALUES (
      v_org,
      v_normalized,
      split_part(lower(btrim(v_email)), '@', 2),
      nullif(btrim(coalesce(p_signup_ip_hash, '')), '')
    );
  END IF;

  RETURN QUERY SELECT v_org, v_membership, v_facility, v_slug, v_pool;
END;
$fn$;

REVOKE UPDATE (stripe_event_at) ON organization FROM poolse_platform;
ALTER TABLE organization DROP COLUMN IF EXISTS stripe_event_at;
ALTER TABLE enrollment ALTER COLUMN joined_on SET DEFAULT CURRENT_DATE;
ALTER TABLE student_fee_payment ALTER COLUMN paid_on SET DEFAULT CURRENT_DATE;
ALTER TABLE student_fee ALTER COLUMN starts_on SET DEFAULT CURRENT_DATE;
ALTER TABLE invoice_payment ALTER COLUMN paid_on SET DEFAULT CURRENT_DATE;
ALTER TABLE invoice_chase ALTER COLUMN chased_on SET DEFAULT CURRENT_DATE;
ALTER TABLE lost_and_found_item ALTER COLUMN found_on SET DEFAULT CURRENT_DATE;
ALTER TABLE invoice ALTER COLUMN issued_on SET DEFAULT CURRENT_DATE;
