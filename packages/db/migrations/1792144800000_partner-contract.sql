-- POOLSE-105 — the signed contract on a partnership, from the first day.
--
-- **An agreement may exist before its terms.** A club often has the signed
-- paper before it has typed the rates, so the contract can be uploaded as soon
-- as the partner exists: the upload creates the agreement with no terms, and
-- the screen says *termos por preencher* until somebody records them. The three
-- terms that were NOT NULL — the start date, the billing model, the unit price —
-- become nullable **together**: a CHECK keeps a row whole or empty, never half a
-- price. "Pending" is derived from that (`start_date IS NULL`), never stored.
-- Every reader of a price already filters on `start_date <= club_today()`, which
-- a null start never passes, so a pending row contributes nothing to a sum.
--
-- **A Word file is a contract too.** `stored_file` takes the Word type for the
-- `agreement_document` purpose only; every other purpose keeps its four types.
--
-- **Replacing a contract keeps the old one.** `partner_contract_version` is
-- the history: one row per file attached to an agreement, who attached it and
-- when, and — once replaced or removed — who did that and when. Insert-only bar
-- closing a version (a column grant). One open version per agreement, by a
-- partial unique index. `partner_agreement.document_key` stays the pointer to
-- the current file, so nothing that reads it changes.

-- Up Migration

ALTER TABLE partner_agreement
  ALTER COLUMN start_date DROP NOT NULL,
  ALTER COLUMN billing_model DROP NOT NULL,
  ALTER COLUMN unit_price DROP NOT NULL,
  ADD CONSTRAINT partner_agreement_terms_whole CHECK (
    (start_date IS NULL AND billing_model IS NULL AND unit_price IS NULL)
    OR (start_date IS NOT NULL AND billing_model IS NOT NULL AND unit_price IS NOT NULL)
  );

COMMENT ON CONSTRAINT partner_agreement_terms_whole ON partner_agreement IS
  'POOLSE-105: an agreement has all its terms or none. None is "termos por preencher" — '
  'a contract uploaded before the rates were typed.';

ALTER TABLE stored_file DROP CONSTRAINT stored_file_type;
ALTER TABLE stored_file ADD CONSTRAINT stored_file_type CHECK (
  content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  OR (
    purpose = 'agreement_document'
    AND content_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
);

CREATE TABLE partner_contract_version (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  agreement_id    uuid NOT NULL,
  file_id         uuid NOT NULL,
  attached_by     uuid NOT NULL,
  attached_at     timestamptz NOT NULL DEFAULT now(),
  -- Set when another file replaced this one, or the contract was removed.
  replaced_at     timestamptz,
  replaced_by     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, agreement_id) REFERENCES partner_agreement (organization_id, id),
  FOREIGN KEY (organization_id, file_id) REFERENCES stored_file (organization_id, id),
  FOREIGN KEY (organization_id, attached_by) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, replaced_by) REFERENCES membership (organization_id, id),

  CONSTRAINT partner_contract_version_replaced_whole
    CHECK ((replaced_at IS NULL) = (replaced_by IS NULL)),
  CONSTRAINT partner_contract_version_replaced_after
    CHECK (replaced_at IS NULL OR replaced_at >= attached_at)
);

COMMENT ON TABLE partner_contract_version IS
  'POOLSE-105: every signed-contract file attached to a partner agreement — who, when, '
  'and who replaced or removed it. Insert-only bar closing a version.';

-- One open version per agreement: the current contract.
CREATE UNIQUE INDEX partner_contract_version_current
  ON partner_contract_version (organization_id, agreement_id)
  WHERE replaced_at IS NULL;

CREATE INDEX partner_contract_version_agreement_idx
  ON partner_contract_version (organization_id, agreement_id, attached_at DESC);

CREATE TRIGGER partner_contract_version_updated_at BEFORE UPDATE ON partner_contract_version
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE partner_contract_version ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_contract_version_tenant ON partner_contract_version
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- History is written once: a version is opened by an INSERT and closed by
-- setting who replaced it, and that is every change it may ever have.
REVOKE ALL ON partner_contract_version FROM poolse_app;
GRANT SELECT, INSERT ON partner_contract_version TO poolse_app;
GRANT UPDATE (replaced_at, replaced_by) ON partner_contract_version TO poolse_app;

-- The contracts already attached become each agreement's first version, as
-- their file says: uploaded by whom, and when.
INSERT INTO partner_contract_version (organization_id, agreement_id, file_id, attached_by, attached_at)
SELECT pa.organization_id, pa.id, sf.id, sf.uploaded_by, sf.created_at
  FROM partner_agreement pa
  JOIN stored_file sf
    ON sf.organization_id = pa.organization_id AND sf.storage_key = pa.document_key
 WHERE pa.document_key IS NOT NULL;

-- Down Migration

DROP TABLE IF EXISTS partner_contract_version;

ALTER TABLE stored_file DROP CONSTRAINT IF EXISTS stored_file_type;
ALTER TABLE stored_file ADD CONSTRAINT stored_file_type CHECK (
  content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
);

-- A contract with no terms cannot exist without this migration. Rolling back a
-- development database, its pending agreements go with it.
DELETE FROM partner_agreement WHERE start_date IS NULL;
ALTER TABLE partner_agreement
  DROP CONSTRAINT IF EXISTS partner_agreement_terms_whole,
  ALTER COLUMN start_date SET NOT NULL,
  ALTER COLUMN billing_model SET NOT NULL,
  ALTER COLUMN unit_price SET NOT NULL;
