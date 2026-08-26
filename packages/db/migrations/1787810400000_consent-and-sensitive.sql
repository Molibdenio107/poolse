-- Up Migration
--
-- Phase 1.3: consent, and the sensitive fields it governs.
--
-- This is the slice a customer's data protection officer will ask about, and the
-- one that cannot be retrofitted: an audit trail added later has no history for
-- the period that matters. Three structural decisions, each of which exists to
-- make a promise the application cannot quietly break.
--
-- 1. **Sensitive data lives in its own table.** `student_sensitive` is not a
--    column on `student`. That separation is what lets the read path be
--    restricted and logged independently — the ordinary student register is
--    readable by every member of the organization, and it must stay that way
--    without dragging a child's medical history along with it.
--
-- 2. **Consent is an event, not a checkbox.** Who granted it, when, and what the
--    evidence was. A boolean column answers "may we photograph this child" and
--    cannot answer "who told us so, and when" — which is the only question that
--    matters when somebody objects a year later.
--
-- 3. **A consent record cannot be edited.** Only withdrawal may change it, and
--    that is enforced by a trigger rather than by convention. A consent trail the
--    application can rewrite is not evidence of anything.
--
-- The medical notes themselves are encrypted by the application before they get
-- here — AES-256-GCM, key held in the environment, never sent to the database.
-- Postgres therefore stores ciphertext it cannot read, which means a dump, a
-- backup on a laptop, or a support engineer with a psql prompt does not have
-- children's health records. See apps/api/src/sensitive/cipher.ts.

-- ---------------------------------------------------------------------------
-- student_sensitive
-- ---------------------------------------------------------------------------

CREATE TABLE student_sensitive (
  -- One row per student, so the primary key is the student. There is no version
  -- history here on purpose: the audit log records that a change happened and
  -- who made it, and keeping every superseded revision of a child's medical
  -- notes would mean keeping special-category data long after it stopped being
  -- true.
  student_id                uuid PRIMARY KEY,
  organization_id           uuid NOT NULL REFERENCES organization (id),

  -- Ciphertext. Never a readable string, at any point, in any environment.
  medical_notes_encrypted   text,

  recorded_by_membership_id uuid,
  recorded_at               timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by_membership_id)
    REFERENCES membership (organization_id, id)
);

CREATE TRIGGER student_sensitive_updated_at BEFORE UPDATE ON student_sensitive
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- consent
-- ---------------------------------------------------------------------------

-- A genuinely closed set: these are the three things Poolse asks permission for,
-- and adding a fourth is a product decision that deserves a migration.
CREATE TYPE consent_kind AS ENUM ('photo', 'medical_data', 'parent_sharing');

CREATE TABLE consent (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            uuid NOT NULL REFERENCES organization (id),
  student_id                 uuid NOT NULL,
  kind                       consent_kind NOT NULL,

  -- False is a real answer, and a different one from "never asked". A guardian
  -- who refuses photographs has been recorded as refusing; the absence of a row
  -- means nobody has asked yet.
  granted                    boolean NOT NULL,

  granted_by_membership_id   uuid,
  granted_at                 timestamptz NOT NULL DEFAULT now(),
  -- How it was obtained: "signed form 12/09", "email from the mother". Free text
  -- because the evidence is whatever the operator actually has.
  evidence_note              text,

  withdrawn_at               timestamptz,
  withdrawn_by_membership_id uuid,

  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, granted_by_membership_id)
    REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, withdrawn_by_membership_id)
    REFERENCES membership (organization_id, id),

  CHECK (withdrawn_at IS NULL OR withdrawn_at >= granted_at)
);

-- One live decision per kind per student. Superseded records stay: withdraw the
-- old one, record a new one, and the history reads in order.
CREATE UNIQUE INDEX consent_live_uq
  ON consent (organization_id, student_id, kind)
  WHERE withdrawn_at IS NULL;

CREATE INDEX consent_student_idx
  ON consent (organization_id, student_id, granted_at DESC);

-- ---------------------------------------------------------------------------
-- Consent records are write-once, apart from withdrawal
--
-- Enforced here rather than trusted to the repository layer, for the same reason
-- audit_log gave back its UPDATE grant: a record of what a guardian agreed to is
-- only worth having if it cannot be quietly changed to say something else. The
-- correction path is to withdraw and record a new decision, which leaves both
-- facts visible.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION consent_is_write_once() RETURNS trigger AS $$
BEGIN
  IF NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.granted IS DISTINCT FROM OLD.granted
     OR NEW.granted_by_membership_id IS DISTINCT FROM OLD.granted_by_membership_id
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
     OR NEW.evidence_note IS DISTINCT FROM OLD.evidence_note
  THEN
    RAISE EXCEPTION
      'A consent record cannot be edited. Withdraw it and record a new decision.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Withdrawal happens once, too. Un-withdrawing would erase the fact that it
  -- ever happened.
  IF OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at THEN
    RAISE EXCEPTION 'A withdrawn consent record cannot be changed.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consent_write_once BEFORE UPDATE ON consent
  FOR EACH ROW EXECUTE FUNCTION consent_is_write_once();

CREATE TRIGGER consent_updated_at BEFORE UPDATE ON consent
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- The same tenant policy as everything else. Note what this does NOT do: it does
-- not restrict which *members* of the organization may read these rows. That is
-- an application decision (a role check on the route) rather than a database
-- one, because the GUC carries an organization and not a role. The database
-- guarantees tenant isolation; the API guarantees that an instructor sees a
-- child's medical notes and a receptionist does not.
-- ---------------------------------------------------------------------------

ALTER TABLE student_sensitive ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent           ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_sensitive_tenant ON student_sensitive
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY consent_tenant ON consent
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Consent records are never deleted, only withdrawn. Taking the grant away makes
-- that structural instead of aspirational.
REVOKE DELETE ON consent FROM poolse_app;

-- Down Migration

DROP TRIGGER IF EXISTS consent_updated_at ON consent;
DROP TRIGGER IF EXISTS consent_write_once ON consent;
DROP FUNCTION IF EXISTS consent_is_write_once();

DROP POLICY IF EXISTS consent_tenant ON consent;
DROP POLICY IF EXISTS student_sensitive_tenant ON student_sensitive;

DROP TABLE IF EXISTS consent;
DROP TABLE IF EXISTS student_sensitive;
DROP TYPE IF EXISTS consent_kind;
