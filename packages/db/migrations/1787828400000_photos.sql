-- Up Migration
--
-- Backlog story 2: where photographs of a pool and of a facility will live.
--
-- Built now and left empty on purpose. Object storage is decided (Cloudflare R2)
-- and not configured, so nothing can write to these tables yet — but creating
-- them costs nothing today and means the storage slice is a handler and a
-- switch rather than a handler, a migration, and a redesign of two screens.
--
-- Two tables rather than one polymorphic `photo` with a `parent_type` column,
-- and that is not duplication for its own sake. A polymorphic parent cannot
-- carry a composite foreign key, and `(organization_id, pool_id)` referencing
-- `pool (organization_id, id)` is the thing that makes it structurally
-- impossible to hang one tenant's photograph off another tenant's pool. Giving
-- that up to save a table would trade the guarantee for tidiness.
--
-- **A caution for whoever wires the storage.** These are described as
-- photographs of pools and buildings, and most will be. Some will have children
-- in them — a photograph of a swimming lesson is a photograph of students. That
-- is why the chosen storage must serve them through signed, expiring URLs and
-- never a public bucket: a guessable link to another club's pictures is the same
-- class of leak that the row-level security work exists to prevent.

CREATE TABLE pool_photo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  pool_id         uuid NOT NULL,

  -- The object key in storage. Resolved to a signed URL at read time, never
  -- stored as one: a URL with an expiry baked in is stale the moment it is
  -- written down.
  storage_key     text NOT NULL,
  caption         text,
  sort_order      integer NOT NULL DEFAULT 0,

  uploaded_by_membership_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  FOREIGN KEY (organization_id, pool_id) REFERENCES pool (organization_id, id),
  FOREIGN KEY (organization_id, uploaded_by_membership_id)
    REFERENCES membership (organization_id, id),
  CHECK (btrim(storage_key) <> '')
);

CREATE TABLE facility_photo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  facility_id     uuid NOT NULL,

  storage_key     text NOT NULL,
  caption         text,
  sort_order      integer NOT NULL DEFAULT 0,

  uploaded_by_membership_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, uploaded_by_membership_id)
    REFERENCES membership (organization_id, id),
  CHECK (btrim(storage_key) <> '')
);

-- The same object attached twice is a double-submitted upload, not two
-- photographs. Partial, so removing one and re-uploading it later works.
CREATE UNIQUE INDEX pool_photo_key_uq
  ON pool_photo (organization_id, pool_id, storage_key)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX facility_photo_key_uq
  ON facility_photo (organization_id, facility_id, storage_key)
  WHERE archived_at IS NULL;

-- The gallery, in the order it is shown.
CREATE INDEX pool_photo_order_idx
  ON pool_photo (organization_id, pool_id, sort_order)
  WHERE archived_at IS NULL;

CREATE INDEX facility_photo_order_idx
  ON facility_photo (organization_id, facility_id, sort_order)
  WHERE archived_at IS NULL;

CREATE TRIGGER pool_photo_updated_at BEFORE UPDATE ON pool_photo
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER facility_photo_updated_at BEFORE UPDATE ON facility_photo
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE pool_photo     ENABLE ROW LEVEL SECURITY;
ALTER TABLE facility_photo ENABLE ROW LEVEL SECURITY;

CREATE POLICY pool_photo_tenant ON pool_photo
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY facility_photo_tenant ON facility_photo
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Down Migration

DROP POLICY IF EXISTS facility_photo_tenant ON facility_photo;
DROP POLICY IF EXISTS pool_photo_tenant ON pool_photo;
DROP TABLE IF EXISTS facility_photo;
DROP TABLE IF EXISTS pool_photo;
