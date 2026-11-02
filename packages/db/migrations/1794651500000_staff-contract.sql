-- Up Migration

-- POOLSE-149 slice C — a staff member's contract (Rui, 02-11-2026): the signed
-- document, PDF or Word, with its earlier versions kept, and three facts said
-- beside it — the kind, the start and, for a fixed term, the end. **For reading
-- only**: nothing in salaries or vacations reads these, by Rui's call ("keep it
-- just informative").
--
-- **The facts** are one row per person (`staff_contract`), edited in place and
-- audited by the API. **The files** are `staff_contract_version`, the
-- `partner_contract_version` shape (POOLSE-105): insert-only bar closing a
-- version, one open version per person, and the file stays readable in the
-- history after it is replaced or removed.
--
-- **Who** is the API's, beside the pay rule: owner and admin, and the person;
-- an Admin never reads or writes the Owner's (`visibleToViewer`). Not sealed:
-- a contract is not health data, and the office downloads it to work with.
--
-- A Word document is accepted for this purpose as for a partnership's contract.

ALTER TYPE file_purpose ADD VALUE IF NOT EXISTS 'staff_contract';

ALTER TABLE stored_file DROP CONSTRAINT stored_file_type;
ALTER TABLE stored_file ADD CONSTRAINT stored_file_type CHECK (
  content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  OR (
    purpose::text IN ('agreement_document', 'staff_contract')
    AND content_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
  OR (purpose::text = 'meet_results' AND content_type IN ('application/xml', 'application/zip'))
);

CREATE TYPE staff_contract_kind AS ENUM (
  'open_ended',      -- sem termo
  'fixed_term',      -- termo certo
  'uncertain_term',  -- termo incerto
  'services',        -- prestação de serviços
  'internship'       -- estágio
);

CREATE TABLE staff_contract (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  membership_id   uuid NOT NULL,
  kind            staff_contract_kind,
  starts_on       date,
  ends_on         date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, membership_id),
  FOREIGN KEY (organization_id, membership_id) REFERENCES membership (organization_id, id),
  -- A fixed term ends; an open-ended contract does not.
  CONSTRAINT staff_contract_fixed_term_ends CHECK (kind IS DISTINCT FROM 'fixed_term' OR ends_on IS NOT NULL),
  CONSTRAINT staff_contract_open_ended_never_ends CHECK (kind IS DISTINCT FROM 'open_ended' OR ends_on IS NULL),
  CONSTRAINT staff_contract_ends_after_start CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

COMMENT ON TABLE staff_contract IS
  'POOLSE-149: what a staff member''s contract says — kind, start, end. Informative only: '
  'nothing in salaries or vacations reads it. One row per person, edited in place, audited by the API.';

CREATE TRIGGER staff_contract_updated_at BEFORE UPDATE ON staff_contract
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE staff_contract ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_contract_tenant ON staff_contract
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON staff_contract FROM poolse_app;
GRANT SELECT, INSERT ON staff_contract TO poolse_app;
GRANT UPDATE (kind, starts_on, ends_on) ON staff_contract TO poolse_app;

CREATE TABLE staff_contract_version (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  membership_id   uuid NOT NULL,
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
  FOREIGN KEY (organization_id, membership_id) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, file_id) REFERENCES stored_file (organization_id, id),
  FOREIGN KEY (organization_id, attached_by) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, replaced_by) REFERENCES membership (organization_id, id),
  CONSTRAINT staff_contract_version_replaced_whole
    CHECK ((replaced_at IS NULL) = (replaced_by IS NULL)),
  CONSTRAINT staff_contract_version_replaced_after
    CHECK (replaced_at IS NULL OR replaced_at >= attached_at)
);

COMMENT ON TABLE staff_contract_version IS
  'POOLSE-149: every contract file attached to a staff member — who, when, and who replaced '
  'or removed it. Insert-only bar closing a version.';

-- One open version per person: the current contract.
CREATE UNIQUE INDEX staff_contract_version_current
  ON staff_contract_version (organization_id, membership_id)
  WHERE replaced_at IS NULL;
CREATE INDEX staff_contract_version_person_idx
  ON staff_contract_version (organization_id, membership_id, attached_at DESC);
CREATE INDEX staff_contract_version_file_idx
  ON staff_contract_version (organization_id, file_id);

CREATE TRIGGER staff_contract_version_updated_at BEFORE UPDATE ON staff_contract_version
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE staff_contract_version ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_contract_version_tenant ON staff_contract_version
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON staff_contract_version FROM poolse_app;
GRANT SELECT, INSERT ON staff_contract_version TO poolse_app;
GRANT UPDATE (replaced_at, replaced_by) ON staff_contract_version TO poolse_app;

-- Down Migration

DROP TABLE IF EXISTS staff_contract_version;
DROP TABLE IF EXISTS staff_contract;
DROP TYPE IF EXISTS staff_contract_kind;

-- A Word contract left behind makes this CHECK refuse the down rather than
-- leave a file the narrower rule calls impossible.
ALTER TABLE stored_file DROP CONSTRAINT stored_file_type;
ALTER TABLE stored_file ADD CONSTRAINT stored_file_type CHECK (
  content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  OR (
    purpose = 'agreement_document'
    AND content_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
  OR (purpose::text = 'meet_results' AND content_type IN ('application/xml', 'application/zip'))
);

-- The enum value stays: Postgres cannot drop one, and nothing names it now.
