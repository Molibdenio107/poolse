-- Up Migration
--
-- Platform administration — the operator's side of the product, not a tenant's.
--
-- Everything else in this schema answers "what may this member of this club do".
-- This answers a different question: what may *Poolse* do, looking at every club
-- at once. The two are deliberately orthogonal. Being owner of an organization —
-- including a demo one somebody signed up for in thirty seconds — grants nothing
-- here, and nothing here is expressible as a `member_role`.
--
-- Four pieces:
--
--   1. `platform_admin`      who the operators are, keyed on the Clerk user id.
--   2. `platform_audit_log`  what they looked at. Reads included, from day one.
--   3. `poolse_platform`     a second login role that can read across tenants.
--   4. `organization.max_management_users`, and `comped` on the subscription
--      enum — the two columns the overview reports against.
--
-- ---------------------------------------------------------------------------
-- The cross-tenant read role
-- ---------------------------------------------------------------------------
--
-- `poolse_app` cannot serve this screen and must not learn how to: every policy
-- in the schema resolves through `current_organization_id()`, and a connection
-- with no GUC set reads zero rows. That is the guarantee, and weakening it for
-- one screen would weaken it for the whole product.
--
-- So a second role, with its own connection string (`DATABASE_PLATFORM_URL`) and
-- its own pool, used by `PlatformModule` and nothing else.
--
-- **It does not carry BYPASSRLS.** Granting that needs superuser at migrate
-- time, which the owner role on a managed Postgres is not guaranteed to be — and
-- it would give the role every table in the schema for ever, including the
-- sensitive ones a platform overview has no business reading. Instead each table
-- the overview genuinely needs gains a second policy, `FOR SELECT TO
-- poolse_platform USING (true)`. Postgres ORs permissive policies together and
-- `TO` confines this one to that role, so `poolse_app` is untouched and the
-- platform role sees exactly seven tables, read-only.
--
-- Adding a table to the platform's reach is therefore a deliberate line of SQL
-- rather than something that happens by default. That is the point.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'poolse_platform') THEN
    -- No password here: `pnpm db:bootstrap` sets it from DATABASE_PLATFORM_URL,
    -- so there is one source of truth for the credential, as with poolse_app.
    CREATE ROLE poolse_platform LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO poolse_platform;

-- ---------------------------------------------------------------------------
-- platform_admin
--
-- Not tenant-scoped, and it has no `organization_id` on purpose — an operator
-- who belonged to an organization to be an operator would be a tenant role by
-- another name, and the first demo tenant would be a hole.
--
-- Keyed on the Clerk user id rather than on `app_user.id`, because the guard
-- runs before any tenant is resolved and `currentAuth()` is all it has. It also
-- means an operator who has never opened the tenant app — and so has no
-- `app_user` row — is still an operator.
-- ---------------------------------------------------------------------------

CREATE TABLE platform_admin (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL UNIQUE,
  -- Who this is, for a list that will one day have more than one row in it.
  -- Free text, written by hand or by the seeding script; never synced.
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Soft delete, like everything an operator can see. Revoking access must leave
  -- a record that it was once granted.
  archived_at   timestamptz,
  CHECK (clerk_user_id <> '')
);

CREATE TRIGGER platform_admin_updated_at BEFORE UPDATE ON platform_admin
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- platform_audit_log
--
-- Every request that reaches PlatformModule, reads included. Reads are logged
-- because they are cheap to log and because the habit has to exist before the
-- actions do — a trail that starts the day somebody can suspend a tenant starts
-- one day too late.
--
-- `organization_id` is a plain reference and NOT a tenant key: this table is the
-- platform's book, and a row in it is about a tenant rather than belonging to
-- one. Null for a request that named no tenant, which the list endpoint does not.
-- ---------------------------------------------------------------------------

CREATE TABLE platform_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id   text NOT NULL,
  -- Dotted machine key, as in `audit_log`: 'tenants.listed'.
  action          text NOT NULL,
  organization_id uuid REFERENCES organization (id),
  -- The request as it was made — the search term, the page. Never a response
  -- body: the point is what was asked for, and a copy of every tenant's data in
  -- the log is a second copy to protect.
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (action <> '')
);

-- The read this will get: newest first, occasionally filtered to one operator.
CREATE INDEX platform_audit_log_time_idx ON platform_audit_log (created_at DESC);
CREATE INDEX platform_audit_log_actor_idx ON platform_audit_log (clerk_user_id, created_at DESC);

-- No updated_at trigger and no archived_at, for the reason `audit_log` has
-- neither: entries are never edited and never removed.

-- ---------------------------------------------------------------------------
-- Neither table is a tenant's to see
--
-- `ALTER DEFAULT PRIVILEGES` in the core migration grants poolse_app all four
-- verbs on every table created since, so both of these arrived readable by the
-- tenant connection. They go back.
--
-- Belt and braces: RLS is enabled as well, with no policy naming poolse_app. A
-- revoked privilege and a policy that matches nothing are two independent
-- reasons a tenant query returns nothing, and the isolation test asserts it.
-- ---------------------------------------------------------------------------

REVOKE ALL ON platform_admin     FROM poolse_app;
REVOKE ALL ON platform_audit_log FROM poolse_app;

ALTER TABLE platform_admin     ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_admin_operators ON platform_admin
  FOR SELECT TO poolse_platform USING (true);

-- The one table the platform role writes to. `FOR ALL` rather than a SELECT and
-- an INSERT policy, because a policy's WITH CHECK is what governs the insert and
-- splitting it across two policies is how one of them ends up forgotten.
CREATE POLICY platform_audit_log_operators ON platform_audit_log
  FOR ALL TO poolse_platform USING (true) WITH CHECK (true);

GRANT SELECT         ON platform_admin     TO poolse_platform;
GRANT SELECT, INSERT ON platform_audit_log TO poolse_platform;

-- ---------------------------------------------------------------------------
-- The seven tables the tenant overview reads
--
-- Each one is here because a column on the overview needs it, and no more:
--
--   organization     the row itself, its plan and its dates
--   membership       seats in use
--   membership_role  which of those seats are management seats
--   invitation       seats promised but not yet taken
--   facility         sites against the licence
--   pool             tanks
--   audit_log        last activity — max(created_at), on the index it already has
--
-- SELECT only, in every case. Nothing on this side of the product writes into a
-- tenant's data, and when something does — extending a trial, suspending — that
-- will be a named function, not a widened grant.
-- ---------------------------------------------------------------------------

CREATE POLICY organization_platform    ON organization    FOR SELECT TO poolse_platform USING (true);
CREATE POLICY membership_platform      ON membership      FOR SELECT TO poolse_platform USING (true);
CREATE POLICY membership_role_platform ON membership_role FOR SELECT TO poolse_platform USING (true);
CREATE POLICY invitation_platform      ON invitation      FOR SELECT TO poolse_platform USING (true);
CREATE POLICY facility_platform        ON facility        FOR SELECT TO poolse_platform USING (true);
CREATE POLICY pool_platform            ON pool            FOR SELECT TO poolse_platform USING (true);
CREATE POLICY audit_log_platform       ON audit_log       FOR SELECT TO poolse_platform USING (true);

GRANT SELECT ON organization    TO poolse_platform;
GRANT SELECT ON membership      TO poolse_platform;
GRANT SELECT ON membership_role TO poolse_platform;
GRANT SELECT ON invitation      TO poolse_platform;
GRANT SELECT ON facility        TO poolse_platform;
GRANT SELECT ON pool            TO poolse_platform;
GRANT SELECT ON audit_log       TO poolse_platform;

-- ---------------------------------------------------------------------------
-- organization.max_management_users
--
-- Decided 2026-09-06 and recorded as "not built"; the overview is what finally
-- needs it. Nullable means unlimited — the same reading as `pool.max_capacity`
-- and `space.expected_cleaning_interval_hours`, and never zero.
--
-- This adds the column and the screen that reports against it. It deliberately
-- does **not** add enforcement at invitation time: that is a refusal an operator
-- would meet, and it belongs with the ticket that can also tell them how to buy
-- another seat.
-- ---------------------------------------------------------------------------

ALTER TABLE organization ADD COLUMN max_management_users integer;

ALTER TABLE organization
  ADD CONSTRAINT organization_max_management_users_positive
  CHECK (max_management_users IS NULL OR max_management_users > 0);

COMMENT ON COLUMN organization.max_management_users IS
  'Soft seat quota for management logins (owner, admin, instructor, maintenance). '
  'NULL is unlimited, never zero. Reported by the platform overview; not yet '
  'enforced when an invitation is created — docs/decisions.md, 2026-09-06.';

-- ---------------------------------------------------------------------------
-- comped
--
-- The free pilot is not trialing, not past due and not cancelled: it is a live
-- tenant that is deliberately not billed. Without a value for that it would sit
-- in the list as `active` and look like revenue, or as `trialing` and look like
-- it was about to lapse.
--
-- The other four values keep the spellings they were given in
-- 1787803200000_organization-signup.sql. `trialing` and `canceled` differ from
-- the ticket's `trial` and `cancelled` by a letter each; renaming them means
-- rewriting three SECURITY DEFINER provisioning functions that insert the
-- literal, for no behaviour.
-- ---------------------------------------------------------------------------

ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'comped';

-- Down Migration

ALTER TABLE organization DROP CONSTRAINT IF EXISTS organization_max_management_users_positive;
ALTER TABLE organization DROP COLUMN IF EXISTS max_management_users;

DROP POLICY IF EXISTS audit_log_platform       ON audit_log;
DROP POLICY IF EXISTS pool_platform            ON pool;
DROP POLICY IF EXISTS facility_platform        ON facility;
DROP POLICY IF EXISTS invitation_platform      ON invitation;
DROP POLICY IF EXISTS membership_role_platform ON membership_role;
DROP POLICY IF EXISTS membership_platform      ON membership;
DROP POLICY IF EXISTS organization_platform    ON organization;

DROP POLICY IF EXISTS platform_audit_log_operators ON platform_audit_log;
DROP POLICY IF EXISTS platform_admin_operators     ON platform_admin;

DROP TABLE IF EXISTS platform_audit_log;
DROP TABLE IF EXISTS platform_admin;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM poolse_platform;
REVOKE USAGE ON SCHEMA public FROM poolse_platform;

-- Postgres cannot remove one value from an enum, so the type is rebuilt. Any
-- tenant sitting on `comped` goes back to `active` rather than being lost: it is
-- a live tenant either way, and the Down is the rollback path, not a migration
-- somebody runs for fun.
UPDATE organization SET subscription_status = 'active' WHERE subscription_status = 'comped';

ALTER TABLE organization ALTER COLUMN subscription_status DROP DEFAULT;
ALTER TYPE subscription_status RENAME TO subscription_status_without_comped;
CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled');
ALTER TABLE organization
  ALTER COLUMN subscription_status TYPE subscription_status
  USING subscription_status::text::subscription_status;
ALTER TABLE organization ALTER COLUMN subscription_status SET DEFAULT 'trialing';
DROP TYPE subscription_status_without_comped;

DROP ROLE IF EXISTS poolse_platform;
