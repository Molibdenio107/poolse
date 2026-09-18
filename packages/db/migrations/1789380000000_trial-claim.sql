-- Up Migration
--
-- One person, one trial — POOLSE-62, slice C.
--
-- The trial is uncapped and takes no card, which is the right product decision
-- and also means nothing stops one person running a club on a fresh organization
-- every fifteen days. **The fix is at the door, not inside the trial**: every
-- limit added to the trial is paid for by every honest club evaluating the
-- product, and a ledger at the door is paid for by nobody.
--
-- **`trial_claim` is platform-scoped**, for the reason `stripe_event`,
-- `trial_event` and `manual_payment` are: a row is *about* a tenant rather than
-- belonging to one, and the entire point is a cross-tenant lookup that a tenant
-- connection cannot do and must not be able to do.
--
-- **The unique index is the enforcement, not an application check.** The API asks
-- nothing first: it lets the insert happen inside the provisioning transaction
-- and turns the refusal into a sentence. So two signups racing on one address end
-- with exactly one tenant, and a refused signup leaves no organization, no
-- membership and no claim — because the claim is written by
-- `provision_organization` itself, inside the one transaction that makes a tenant.
--
-- **A block is never told which lever it was.** "Já usou o seu período
-- experimental" tells an abuser exactly what to change; the message points at
-- signing in and at contacting us, because the person reading it may be a real
-- customer.
--
-- **A claim outlives the organization that made it, including its archiving.**
-- Releasing it on archive would be the abuse path with extra steps — let the
-- trial lapse, wait for the sweep, start again. A club that genuinely leaves and
-- comes back writes in, and *conceder novo período* is one click. That makes the
-- override load-bearing rather than a convenience, which is why it is in this
-- slice and not a later one.

-- ---------------------------------------------------------------------------
-- What counts as the same address
-- ---------------------------------------------------------------------------
--
-- One definition, in SQL, because the ledger is written in SQL and a second
-- implementation in TypeScript would agree until the day it did not.
--
-- **`+tags` go for every domain.** Gmail, Outlook, Fastmail and most others treat
-- `rui+poolse@` as `rui@`; a provider that does not is a provider on which
-- nobody has ever deliberately registered an address with a plus in it.
--
-- **Dots go for Gmail only**, because there they are genuinely ignored and
-- everywhere else `j.silva@` and `jsilva@` are two different people. Googlemail
-- is folded into gmail: the same mailbox, spelled two ways.
--
-- IMMUTABLE so it can sit in an index expression later if it ever needs to, and
-- because it genuinely is: the same address normalises the same way for ever.

CREATE FUNCTION normalize_signup_email(p_email text) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
           WHEN parts.domain = '' THEN NULL
           ELSE CASE
                  WHEN parts.domain IN ('gmail.com', 'googlemail.com')
                    THEN replace(split_part(parts.local, '+', 1), '.', '')
                  ELSE split_part(parts.local, '+', 1)
                END
                || '@'
                || CASE WHEN parts.domain = 'googlemail.com' THEN 'gmail.com'
                        ELSE parts.domain END
         END
    FROM (
      SELECT split_part(lower(btrim(coalesce(p_email, ''))), '@', 1) AS local,
             split_part(lower(btrim(coalesce(p_email, ''))), '@', 2) AS domain
    ) parts
$$;

COMMENT ON FUNCTION normalize_signup_email(text) IS
  'The one definition of "the same address": lowercased, +tags stripped '
  'everywhere, dots stripped for gmail only, googlemail folded into gmail. '
  'Null for anything without a domain. POOLSE-62.';

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------

CREATE TABLE trial_claim (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),

  /** What this address normalises to. The hard block is keyed on it. */
  normalized_email text NOT NULL,
  /** Kept whole beside it: a soft flag, and the only way to read the domain back. */
  email_domain     text NOT NULL,

  /*
   * The NIPC, normalised, and **null until POOLSE-62's second half writes it**.
   *
   * It is not asked for at signup and should not be: signup stays three fields
   * and thirty seconds, and a tax number is the most intrusive question you can
   * put to somebody who has not decided yet — and the one they cannot answer from
   * memory. It is asked for in the club's own settings, where invoicing will need
   * it anyway, and the check runs the moment it is saved. The column and its index
   * are here so that is a write rather than a second migration.
   */
  tax_number       text,

  /*
   * A signal, not a record.
   *
   * **Hashed, and never the address itself** — an IP is personal data under RGPD
   * and this one would be kept for ever. Salted, too: the IPv4 space is small
   * enough that an unsalted digest is the address with extra steps. No salt
   * configured means no hash and no flag, which is the honest failure — see
   * `signup-claim.ts`.
   */
  signup_ip_hash   text,

  /*
   * Released by an operator — *conceder novo período*.
   *
   * A row rather than a DELETE, because history is never destroyed here and
   * because "this person was given a second trial, by whom, when" is exactly the
   * sort of thing somebody asks six months later. Both unique indexes are partial
   * on it, so releasing a claim genuinely frees the address.
   */
  released_at      timestamptz,
  released_by_clerk_user_id text,

  created_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),

  CONSTRAINT trial_claim_email_present  CHECK (btrim(normalized_email) <> ''),
  CONSTRAINT trial_claim_domain_present CHECK (btrim(email_domain) <> ''),
  /* A release has an author, and an author means a release. */
  CONSTRAINT trial_claim_release_pair CHECK (
    (released_at IS NULL) = (released_by_clerk_user_id IS NULL)
  )
);

COMMENT ON TABLE trial_claim IS
  'One row per trial ever started, keyed on the normalised signup address. '
  'Platform-scoped: it exists for the cross-tenant lookup a tenant connection '
  'cannot do. A claim outlives the organization that made it, archiving '
  'included; an operator releases one by hand. POOLSE-62.';

/*
 * The hard block, and the only thing enforcing it.
 *
 * Partial on `released_at`, like every unique index on a soft-deletable table
 * here: otherwise an operator granting a second trial would be refused by a row
 * nobody can see.
 */
CREATE UNIQUE INDEX trial_claim_email_uq
  ON trial_claim (normalized_email)
  WHERE released_at IS NULL;

CREATE UNIQUE INDEX trial_claim_tax_number_uq
  ON trial_claim (tax_number)
  WHERE tax_number IS NOT NULL AND released_at IS NULL;

/* The two soft flags read these; neither is unique, which is the whole point. */
CREATE INDEX trial_claim_domain_idx ON trial_claim (email_domain);
CREATE INDEX trial_claim_ip_idx ON trial_claim (signup_ip_hash)
  WHERE signup_ip_hash IS NOT NULL;

CREATE INDEX trial_claim_org_idx ON trial_claim (organization_id);

-- No updated_at: the only column that ever moves after the insert is the
-- release, and it carries its own timestamp and its own author.

REVOKE ALL ON trial_claim FROM poolse_app;
ALTER TABLE trial_claim ENABLE ROW LEVEL SECURITY;

/*
 * `FOR ALL`, because a policy's WITH CHECK is what governs an insert and a
 * SELECT-only policy leaves the write refused even with the grant in hand.
 *
 * UPDATE is on this grant and is not on `trial_event`'s, and the difference is
 * the release: an operator frees an address, and that is the one thing about a
 * claim that changes after it is written.
 */
CREATE POLICY trial_claim_operators ON trial_claim
  FOR ALL TO poolse_platform USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON trial_claim TO poolse_platform;

-- ---------------------------------------------------------------------------
-- Signup writes the claim, in the transaction that makes the tenant
-- ---------------------------------------------------------------------------
--
-- The whole function again, because a body cannot be patched in place. It is the
-- live definition from `1789164000000_trial-read-only.sql` with two changes, and
-- the Down puts that version back verbatim:
--
--   1. a new `p_signup_ip_hash` parameter, defaulted so every existing caller
--      still compiles — the API is the only one that passes it;
--   2. the `trial_claim` insert, last, after the tenant exists.
--
-- **Inside this function rather than beside it.** A signup that fails leaves no
-- claim and a claim that fails leaves no tenant, which is one property and not
-- two. `provision_organization` is already the single `SECURITY DEFINER` write
-- path for a brand-new organization; this joins it rather than becoming a second.
--
-- **The insert is last on purpose.** Its unique index is what refuses a repeat,
-- and by then everything else has succeeded — so the exception the API turns into
-- a sentence is unambiguously about the trial and not about a slug clash.
--
-- **A personal tenant claims too.** An individual tracking their own pool gets
-- the same fifteen days, so they get the same one-per-address rule; a carve-out
-- would be a second signup path to abuse.
--
-- **The old signature is dropped first, and that line is load-bearing.**
-- `CREATE OR REPLACE` matches on the argument list, so adding a parameter
-- *overloads* rather than replaces: both versions then exist, and the next
-- caller passing four untyped arguments fails with `function ... is not unique`
-- — at runtime, from SQL, nowhere near this file. Caught by the isolation suite
-- within a minute of writing it, which is the argument for that suite.

DROP FUNCTION IF EXISTS provision_organization(text, text, text, text, organization_kind);

CREATE FUNCTION provision_organization(
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

-- Down Migration
--
-- The claim goes and provisioning forgets it. Every trial ever started is lost
-- with the table, which is the destructive half and is unavoidable: there is
-- nowhere else for the ledger to live. Reversing this on anything but a laptop
-- means the next signup on a used address is allowed.

DROP FUNCTION IF EXISTS provision_organization(text, text, text, text, organization_kind, text);

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

DROP POLICY IF EXISTS trial_claim_operators ON trial_claim;
DROP TABLE IF EXISTS trial_claim;

DROP FUNCTION IF EXISTS normalize_signup_email(text);
