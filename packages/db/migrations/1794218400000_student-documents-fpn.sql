-- Up Migration
--
-- POOLSE-132 — *Documentos* on the student's record, and the FPN's Anexo 2
-- (Declaração de Consentimento Informado), printed filled from the record and
-- filed signed, one per season (Rui, 30-10-2026).
--
-- 1. The student's identification document: type, number (encrypted by the API,
--    never plaintext — the POOLSE-100 shape and CHECK), issue date and expiry.
--    Identity: cleared on anonymisation with the rest (the licence trigger).
-- 2. The FPN disciplines the student is affiliated in — a checkbox list kept on
--    the record (Rui: "should also be a checkbox list on poolse").
-- 3. The club's regional association and its FPN abbreviation (ANNP, GCST), set
--    once and printed on every declaration.
-- 4. `student_document`: the signed copies, one current per student, kind and
--    season, older ones kept (`replaced_at`), the partner-contract shape.

-- 1 + 2 ---------------------------------------------------------------------
CREATE TYPE fpn_discipline AS ENUM (
  'pura', 'open_water', 'water_polo', 'artistic', 'adapted', 'masters', 'diving'
);

ALTER TABLE student
  ADD COLUMN id_document_type             text,
  ADD COLUMN id_document_number_encrypted text,
  ADD COLUMN id_document_issued_on        date,
  ADD COLUMN id_document_valid_until      date,
  ADD COLUMN fpn_disciplines              fpn_discipline[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT student_id_document_type CHECK (
    id_document_type IS NULL OR id_document_type IN ('cc', 'bi', 'passport', 'other')),
  ADD CONSTRAINT student_id_document_both CHECK (
    (id_document_type IS NULL) = (id_document_number_encrypted IS NULL)),
  ADD CONSTRAINT student_id_document_ciphertext CHECK (
    id_document_number_encrypted IS NULL
    OR id_document_number_encrypted ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  ADD CONSTRAINT student_id_document_dates CHECK (
    id_document_issued_on IS NULL OR id_document_valid_until IS NULL
    OR id_document_valid_until >= id_document_issued_on);

COMMENT ON COLUMN student.id_document_number_encrypted IS
  'POOLSE-132: the student''s ID document number, encrypted by the API (never plaintext, by CHECK). '
  'Owner and admin read it; every read is audited (student.id_document_read).';
COMMENT ON COLUMN student.fpn_disciplines IS
  'POOLSE-132: the FPN disciplines the swimmer is affiliated in, ticked on the record and printed on the Anexo 2.';

CREATE OR REPLACE FUNCTION student_anonymised_clears_licence() RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.federation_licence := NULL;
  -- POOLSE-131: the student's address and identity.
  NEW.address_line := NULL;
  NEW.locality := NULL;
  NEW.postal_code := NULL;
  NEW.parent_one_name := NULL;
  NEW.parent_two_name := NULL;
  NEW.marital_status := NULL;
  NEW.profession := NULL;
  NEW.education := NULL;
  NEW.birthplace := NULL;
  NEW.nationality := NULL;
  NEW.sns_number := NULL;
  -- POOLSE-132: the identification document.
  NEW.id_document_type := NULL;
  NEW.id_document_number_encrypted := NULL;
  NEW.id_document_issued_on := NULL;
  NEW.id_document_valid_until := NULL;
  RETURN NEW;
END;
$function$;

-- 3 -------------------------------------------------------------------------
ALTER TABLE organization
  ADD COLUMN fpn_association text,
  ADD COLUMN fpn_club_code   text,
  ADD CONSTRAINT organization_fpn_association_shape CHECK (
    fpn_association IS NULL OR (btrim(fpn_association) <> '' AND length(fpn_association) <= 20)),
  ADD CONSTRAINT organization_fpn_club_code_shape CHECK (
    fpn_club_code IS NULL OR (btrim(fpn_club_code) <> '' AND length(fpn_club_code) <= 20));

COMMENT ON COLUMN organization.fpn_association IS 'POOLSE-132: the club''s regional association, e.g. ANNP.';
COMMENT ON COLUMN organization.fpn_club_code IS 'POOLSE-132: the club''s abbreviation at the FPN, e.g. GCST.';

-- `organization` is column-granted to the app (POOLSE-87): each column the club
-- writes needs its own grant.
GRANT UPDATE (fpn_association, fpn_club_code) ON organization TO poolse_app;

-- 4 -------------------------------------------------------------------------
ALTER TYPE file_purpose ADD VALUE IF NOT EXISTS 'student_document';

CREATE TYPE student_document_kind AS ENUM ('fpn_declaration', 'fpn_declaration_minor', 'socio_form');

CREATE TABLE student_document (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  student_id      uuid NOT NULL,
  kind            student_document_kind NOT NULL,
  -- The season it is for; null for a document that is not seasonal (the boletim).
  season_id       uuid,
  file_id         uuid NOT NULL,
  filed_by        uuid NOT NULL,
  filed_at        timestamptz NOT NULL DEFAULT now(),
  -- Set when another copy replaced this one, or it was withdrawn.
  replaced_at     timestamptz,
  replaced_by     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, season_id) REFERENCES season (organization_id, id),
  FOREIGN KEY (organization_id, file_id) REFERENCES stored_file (organization_id, id),
  FOREIGN KEY (organization_id, filed_by) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, replaced_by) REFERENCES membership (organization_id, id),
  CONSTRAINT student_document_replaced_whole CHECK ((replaced_at IS NULL) = (replaced_by IS NULL)),
  CONSTRAINT student_document_season_kind CHECK (
    (kind = 'socio_form') = (season_id IS NULL))
);

COMMENT ON TABLE student_document IS
  'POOLSE-132/-134: a signed form filed on a student — an FPN declaration per season, or the '
  'boletim de sócio. Insert-only bar closing a version; the current one has replaced_at null.';

-- One current copy per student, kind and season (the boletim has no season).
CREATE UNIQUE INDEX student_document_current
  ON student_document (organization_id, student_id, kind, coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE replaced_at IS NULL;
CREATE INDEX student_document_student_idx
  ON student_document (organization_id, student_id, filed_at DESC);

CREATE TRIGGER student_document_updated_at BEFORE UPDATE ON student_document
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE student_document ENABLE ROW LEVEL SECURITY;
CREATE POLICY student_document_tenant ON student_document
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON student_document FROM poolse_app;
GRANT SELECT, INSERT ON student_document TO poolse_app;
GRANT UPDATE (replaced_at, replaced_by) ON student_document TO poolse_app;

-- Down Migration

DROP TABLE student_document;
DROP TYPE student_document_kind;
-- `student_document` stays on file_purpose: Postgres cannot drop an enum value,
-- and nothing reads it once the table is gone.

REVOKE UPDATE (fpn_association, fpn_club_code) ON organization FROM poolse_app;
ALTER TABLE organization
  DROP CONSTRAINT organization_fpn_club_code_shape,
  DROP CONSTRAINT organization_fpn_association_shape,
  DROP COLUMN fpn_club_code,
  DROP COLUMN fpn_association;

CREATE OR REPLACE FUNCTION student_anonymised_clears_licence() RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.federation_licence := NULL;
  NEW.address_line := NULL;
  NEW.locality := NULL;
  NEW.postal_code := NULL;
  NEW.parent_one_name := NULL;
  NEW.parent_two_name := NULL;
  NEW.marital_status := NULL;
  NEW.profession := NULL;
  NEW.education := NULL;
  NEW.birthplace := NULL;
  NEW.nationality := NULL;
  NEW.sns_number := NULL;
  RETURN NEW;
END;
$function$;

ALTER TABLE student
  DROP CONSTRAINT student_id_document_dates,
  DROP CONSTRAINT student_id_document_ciphertext,
  DROP CONSTRAINT student_id_document_both,
  DROP CONSTRAINT student_id_document_type,
  DROP COLUMN fpn_disciplines,
  DROP COLUMN id_document_valid_until,
  DROP COLUMN id_document_issued_on,
  DROP COLUMN id_document_number_encrypted,
  DROP COLUMN id_document_type;

DROP TYPE fpn_discipline;
