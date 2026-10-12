-- Up Migration
--
-- File storage — 12 October 2026, the decision that "stays deferred" taken.
--
-- Rui's answers: Cloudflare R2 (S3-compatible; S3Mock in development), 10 MB a
-- file, and a first slice of the documents, the site and pool photos and the
-- club logo. Student photos follow with the photo-consent rule; incident
-- attachments later, with encryption, because they are health data.
--
-- **One registry, every feature points at it.** `stored_file` is the row for
-- every object in the bucket: whose club, what it is for, its type and size,
-- who uploaded it. A feature references it — by id (`insurance_policy`,
-- `organization`), or by the `storage_key` the photo tables and the partner
-- agreement were already given when the screens were drawn — so "which club
-- owns this object" is always one join and never a guess from a path.
--
-- **The bytes never leave without a check.** Files are served through the app
-- (`GET /files/:id`, streamed by the API after the purpose's read rule), never
-- by a public bucket or a pre-signed link somebody could forward.

CREATE TYPE file_purpose AS ENUM (
  'policy_document',
  'qualification_document',
  'agreement_document',
  'facility_photo',
  'pool_photo',
  'logo',
  'student_photo',
  'incident_attachment'
);

COMMENT ON TYPE file_purpose IS
  'What a stored file is for — and so who may write and read it. Student photos '
  'and incident attachments are named now and switched on in later slices.';

CREATE TABLE stored_file (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization (id),
  purpose          file_purpose NOT NULL,
  storage_key      text NOT NULL,
  content_type     text NOT NULL,
  byte_size        integer NOT NULL,
  original_name    text NOT NULL,
  uploaded_by      uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, storage_key),
  FOREIGN KEY (organization_id, uploaded_by) REFERENCES membership (organization_id, id),

  -- The object lives under the club's own prefix, so a key can never name
  -- another club's object even if somebody builds one by hand.
  CONSTRAINT stored_file_key_in_club CHECK (storage_key LIKE organization_id::text || '/%'),
  CONSTRAINT stored_file_size CHECK (byte_size > 0 AND byte_size <= 10 * 1024 * 1024),
  CONSTRAINT stored_file_type CHECK (
    content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  ),
  CONSTRAINT stored_file_name_not_blank CHECK (btrim(original_name) <> '')
);

COMMENT ON TABLE stored_file IS
  'Every object in the file bucket: the club, the purpose, type, size and uploader. '
  'Insert-only bar archiving; the bytes are served through GET /files/:id after the '
  'purpose''s read rule.';

ALTER TABLE stored_file ENABLE ROW LEVEL SECURITY;
CREATE POLICY stored_file_tenant ON stored_file
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE UPDATE, DELETE ON stored_file FROM poolse_app;
GRANT SELECT, INSERT ON stored_file TO poolse_app;
GRANT UPDATE (archived_at) ON stored_file TO poolse_app;

-- ---------------------------------------------------------------------------
-- The features that point at it
-- ---------------------------------------------------------------------------

-- The apólice's own document.
ALTER TABLE insurance_policy
  ADD COLUMN document_file_id uuid,
  ADD FOREIGN KEY (organization_id, document_file_id) REFERENCES stored_file (organization_id, id);

-- A qualification's certificate.
ALTER TABLE qualification
  ADD COLUMN document_file_id uuid,
  ADD FOREIGN KEY (organization_id, document_file_id) REFERENCES stored_file (organization_id, id);

-- A record is never edited (POOLSE-27), but a certificate scanned after the
-- record was made is the same record, completed. So the column may be set once,
-- from empty, and nothing else about the row may change — the grant and this
-- trigger together.
GRANT UPDATE (document_file_id) ON qualification TO poolse_app;

CREATE FUNCTION qualification_document_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.document_file_id IS NOT NULL
     AND NEW.document_file_id IS DISTINCT FROM OLD.document_file_id THEN
    RAISE EXCEPTION 'A qualification''s certificate is attached once'
      USING ERRCODE = 'check_violation', DETAIL = 'qualification_document_set';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER qualification_document_once BEFORE UPDATE OF document_file_id ON qualification
  FOR EACH ROW EXECUTE FUNCTION qualification_document_once();

-- The club's logo.
ALTER TABLE organization
  ADD COLUMN logo_file_id uuid,
  ADD FOREIGN KEY (id, logo_file_id) REFERENCES stored_file (organization_id, id);

-- The keys the screens were drawn with now name real objects.
ALTER TABLE facility_photo
  ADD FOREIGN KEY (organization_id, storage_key) REFERENCES stored_file (organization_id, storage_key);
ALTER TABLE pool_photo
  ADD FOREIGN KEY (organization_id, storage_key) REFERENCES stored_file (organization_id, storage_key);
ALTER TABLE partner_agreement
  ADD FOREIGN KEY (organization_id, document_key) REFERENCES stored_file (organization_id, storage_key);

-- Down Migration

ALTER TABLE partner_agreement DROP CONSTRAINT IF EXISTS partner_agreement_organization_id_document_key_fkey;
ALTER TABLE pool_photo DROP CONSTRAINT IF EXISTS pool_photo_organization_id_storage_key_fkey;
ALTER TABLE facility_photo DROP CONSTRAINT IF EXISTS facility_photo_organization_id_storage_key_fkey;
ALTER TABLE organization DROP COLUMN IF EXISTS logo_file_id;
DROP TRIGGER IF EXISTS qualification_document_once ON qualification;
DROP FUNCTION IF EXISTS qualification_document_once();
REVOKE UPDATE (document_file_id) ON qualification FROM poolse_app;
ALTER TABLE qualification DROP COLUMN IF EXISTS document_file_id;
ALTER TABLE insurance_policy DROP COLUMN IF EXISTS document_file_id;
DROP TABLE IF EXISTS stored_file;
DROP TYPE IF EXISTS file_purpose;
