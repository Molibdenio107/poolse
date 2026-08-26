-- Up Migration
--
-- Phase 0.2 + 0.3: core tenancy tables, and the two mechanisms that make tenant
-- isolation a property of the database rather than a promise made by the repository
-- layer (see docs/data-model.md, decision 2):
--
--   1. Composite foreign keys — (organization_id, parent_id) references
--      parent(organization_id, id), so a row can never point at another tenant's row.
--   2. Row-level security keyed on the `app.organization_id` GUC, so a query that
--      forgets its WHERE clause returns nothing instead of everything.
--
-- Migrations run as the table owner, which bypasses RLS. The application connects as
-- poolse_app, which does not.

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Application role
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'poolse_app') THEN
    CREATE ROLE poolse_app LOGIN;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Shared plumbing
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Returns the organization the current request is scoped to, or NULL when unset.
-- NULL makes every RLS policy evaluate false, which is the behaviour we want: an
-- unscoped connection sees nothing at all.
CREATE OR REPLACE FUNCTION current_organization_id() RETURNS uuid AS $$
  SELECT nullif(current_setting('app.organization_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE TYPE organization_kind AS ENUM ('business', 'personal');
CREATE TYPE membership_status AS ENUM ('invited', 'active', 'suspended');
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'instructor', 'maintenance', 'student', 'guardian');
CREATE TYPE pool_kind AS ENUM ('indoor', 'outdoor');

-- ---------------------------------------------------------------------------
-- organization
-- ---------------------------------------------------------------------------

CREATE TABLE organization (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                  organization_kind NOT NULL DEFAULT 'business',
  name                  text NOT NULL,
  locale                text NOT NULL DEFAULT 'pt-PT',
  country               char(2) NOT NULL DEFAULT 'PT',
  vat_number            text,
  invoice_series_prefix text NOT NULL DEFAULT 'A',
  stripe_customer_id    text,
  subscription_status   text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz
);

CREATE TRIGGER organization_updated_at BEFORE UPDATE ON organization
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- app_user — global identity, keyed to Clerk
--
-- Not tenant-scoped: one person may belong to several organizations. The name and
-- email columns are a cache maintained by the Clerk webhook, never written by the
-- app, so staff lists and instructor pickers do not become an API fan-out per row.
-- ---------------------------------------------------------------------------

CREATE TABLE app_user (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id     text NOT NULL UNIQUE,
  cached_email      citext,
  cached_first_name text,
  cached_last_name  text,
  cached_avatar_url text,
  synced_at         timestamptz,
  locale            text NOT NULL DEFAULT 'pt-PT',
  theme_preference  text NOT NULL DEFAULT 'system',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER app_user_updated_at BEFORE UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- membership — a person's presence in an organization
--
-- app_user_id is nullable because an invited person has a membership before they
-- have an account; the Clerk webhook binds the two on acceptance.
-- ---------------------------------------------------------------------------

CREATE TABLE membership (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  app_user_id     uuid REFERENCES app_user (id),
  status          membership_status NOT NULL DEFAULT 'invited',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id)
);

-- Partial, so archiving an instructor and re-adding them next season does not
-- collide with the dead row.
CREATE UNIQUE INDEX membership_org_user_uq
  ON membership (organization_id, app_user_id)
  WHERE archived_at IS NULL;

CREATE INDEX membership_app_user_idx ON membership (app_user_id);

CREATE TRIGGER membership_updated_at BEFORE UPDATE ON membership
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- membership_role — several roles per person per organization
--
-- A scalar role column would force the owner who also teaches to choose between
-- the admin view and the instructor view. Authorisation reads this table.
-- ---------------------------------------------------------------------------

CREATE TABLE membership_role (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  membership_id   uuid NOT NULL,
  role            member_role NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  FOREIGN KEY (organization_id, membership_id) REFERENCES membership (organization_id, id)
);

CREATE UNIQUE INDEX membership_role_uq
  ON membership_role (membership_id, role)
  WHERE archived_at IS NULL;

CREATE TRIGGER membership_role_updated_at BEFORE UPDATE ON membership_role
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- invitation
-- ---------------------------------------------------------------------------

CREATE TABLE invitation (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organization (id),
  email                   citext NOT NULL,
  roles                   member_role[] NOT NULL,
  token                   text NOT NULL UNIQUE,
  expires_at              timestamptz NOT NULL,
  accepted_at             timestamptz,
  accepted_membership_id  uuid,
  invited_by_membership_id uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, accepted_membership_id) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, invited_by_membership_id) REFERENCES membership (organization_id, id),
  CHECK (array_length(roles, 1) >= 1)
);

-- One live invite per email per organization.
CREATE UNIQUE INDEX invitation_pending_uq
  ON invitation (organization_id, email)
  WHERE accepted_at IS NULL;

CREATE TRIGGER invitation_updated_at BEFORE UPDATE ON invitation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- facility / pool
-- ---------------------------------------------------------------------------

CREATE TABLE facility (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  name            text NOT NULL,
  address         text,
  timezone        text NOT NULL DEFAULT 'Europe/Lisbon',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id)
);

CREATE TRIGGER facility_updated_at BEFORE UPDATE ON facility
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE pool (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id     uuid NOT NULL,
  name            text NOT NULL,
  kind            pool_kind NOT NULL DEFAULT 'indoor',
  volume_litres   integer,
  lane_count      smallint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  -- The composite reference is the point: org A's pool cannot live in org B's facility.
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
);

CREATE TRIGGER pool_updated_at BEFORE UPDATE ON pool
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE organization    ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership      ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation      ENABLE ROW LEVEL SECURITY;
ALTER TABLE facility        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user        ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_tenant ON organization
  USING (id = current_organization_id())
  WITH CHECK (id = current_organization_id());

CREATE POLICY membership_tenant ON membership
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY membership_role_tenant ON membership_role
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY invitation_tenant ON invitation
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY facility_tenant ON facility
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY pool_tenant ON pool
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- app_user carries no organization_id, so it is scoped through membership: you can
-- see a person only if they are a member of the organization you are scoped to.
CREATE POLICY app_user_via_membership ON app_user
  USING (
    EXISTS (
      SELECT 1 FROM membership m
      WHERE m.app_user_id = app_user.id
        AND m.organization_id = current_organization_id()
    )
  );

GRANT USAGE ON SCHEMA public TO poolse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO poolse_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO poolse_app;

-- Down Migration

DROP POLICY IF EXISTS app_user_via_membership ON app_user;
DROP POLICY IF EXISTS pool_tenant ON pool;
DROP POLICY IF EXISTS facility_tenant ON facility;
DROP POLICY IF EXISTS invitation_tenant ON invitation;
DROP POLICY IF EXISTS membership_role_tenant ON membership_role;
DROP POLICY IF EXISTS membership_tenant ON membership;
DROP POLICY IF EXISTS organization_tenant ON organization;

DROP TABLE IF EXISTS pool;
DROP TABLE IF EXISTS facility;
DROP TABLE IF EXISTS invitation;
DROP TABLE IF EXISTS membership_role;
DROP TABLE IF EXISTS membership;
DROP TABLE IF EXISTS app_user;
DROP TABLE IF EXISTS organization;

DROP TYPE IF EXISTS pool_kind;
DROP TYPE IF EXISTS member_role;
DROP TYPE IF EXISTS membership_status;
DROP TYPE IF EXISTS organization_kind;

DROP FUNCTION IF EXISTS current_organization_id();
DROP FUNCTION IF EXISTS set_updated_at();
