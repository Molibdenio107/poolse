-- POOLSE-109 — the atestado on a medical leave, encrypted, and the envelope
-- every health-data file after it will reuse.
--
-- **Envelope encryption, not a column of ciphertext.** A health file's bytes are
-- sealed in the API with a key of their own (AES-256-GCM, one random data key
-- per file); only that data key, wrapped by a key derived from
-- SENSITIVE_DATA_KEY, is stored here as `wrapped_key`. The bucket therefore
-- holds ciphertext, and the database holds a key that is useless without the
-- server's secret. Two things fall out of it. **Retention is crypto-shredding**:
-- destroying one file's `wrapped_key` makes its bytes unreadable for ever,
-- which SQL can do and a bucket deletion from inside `apply_retention()`
-- cannot. **Rotation is cheap**: re-wrapping the small keys, never re-encrypting
-- the files. `incident_attachment` (POOLSE-70) and POOLSE-100 switch on by
-- joining the list the CHECK below names.
--
-- **The database refuses a health file it could read.** `stored_file_sealed`:
-- a sealed purpose has a wrapped key or a shredded one, never neither; any other
-- purpose has neither. The enum is compared as text because a value added by
-- `ALTER TYPE … ADD VALUE` cannot be used in the transaction that added it.
--
-- **One atestado per leave, replaceable, with its history.**
-- `student_medical_leave.document_file_id` is the current one;
-- `medical_leave_certificate` lists every file a leave has held, who attached
-- it and who replaced or removed it — the same shape as
-- `partner_contract_version` (POOLSE-105). Insert-only bar closing a version.
--
-- **Retention** (BA 4): the files of a leave archived more than 24 months ago are
-- shredded by `apply_retention()`, and every file of a student whose health data
-- is erased, or who is anonymised, is shredded by a trigger on that — whoever
-- does the erasing.

-- Up Migration

ALTER TYPE file_purpose ADD VALUE IF NOT EXISTS 'medical_certificate';

ALTER TABLE stored_file
  ADD COLUMN wrapped_key text,
  ADD COLUMN key_shredded_at timestamptz,
  ADD CONSTRAINT stored_file_sealed CHECK (
    CASE WHEN purpose::text IN ('medical_certificate', 'incident_attachment')
         THEN (wrapped_key IS NOT NULL) <> (key_shredded_at IS NOT NULL)
         ELSE wrapped_key IS NULL AND key_shredded_at IS NULL
    END
  ),
  ADD CONSTRAINT stored_file_wrapped_key_shape CHECK (
    wrapped_key IS NULL OR wrapped_key ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
  );

COMMENT ON COLUMN stored_file.wrapped_key IS
  'POOLSE-109: the file''s own data key, wrapped by a key derived from SENSITIVE_DATA_KEY '
  '(v1.iv.tag.ciphertext). Present for a sealed purpose (health data); the bucket holds '
  'only ciphertext for those. Null with key_shredded_at set: the file was shredded.';
COMMENT ON COLUMN stored_file.key_shredded_at IS
  'POOLSE-109: when retention destroyed this file''s data key. Its bytes are unreadable since.';

-- poolse_app keeps UPDATE (archived_at) only: it may never write or clear a key.

ALTER TABLE student_medical_leave
  ADD COLUMN document_file_id uuid,
  ADD CONSTRAINT student_medical_leave_document_fk
    FOREIGN KEY (organization_id, document_file_id) REFERENCES stored_file (organization_id, id);

COMMENT ON COLUMN student_medical_leave.document_file_id IS
  'POOLSE-109: the atestado in force, served through GET /files/:id after the medical '
  'certificate''s read rule. Earlier files are in medical_leave_certificate.';

CREATE TABLE medical_leave_certificate (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  leave_id        uuid NOT NULL,
  file_id         uuid NOT NULL,
  attached_by     uuid NOT NULL,
  attached_at     timestamptz NOT NULL DEFAULT now(),
  -- Set when another file replaced this one, or the atestado was removed.
  replaced_at     timestamptz,
  replaced_by     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, leave_id) REFERENCES student_medical_leave (organization_id, id),
  FOREIGN KEY (organization_id, file_id) REFERENCES stored_file (organization_id, id),
  FOREIGN KEY (organization_id, attached_by) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, replaced_by) REFERENCES membership (organization_id, id),

  CONSTRAINT medical_leave_certificate_replaced_whole
    CHECK ((replaced_at IS NULL) = (replaced_by IS NULL)),
  CONSTRAINT medical_leave_certificate_replaced_after
    CHECK (replaced_at IS NULL OR replaced_at >= attached_at)
);

COMMENT ON TABLE medical_leave_certificate IS
  'POOLSE-109: every atestado file attached to a medical leave — who, when, and who '
  'replaced or removed it. Insert-only bar closing a version. What retention shreds.';

CREATE UNIQUE INDEX medical_leave_certificate_current
  ON medical_leave_certificate (organization_id, leave_id)
  WHERE replaced_at IS NULL;
CREATE UNIQUE INDEX medical_leave_certificate_file
  ON medical_leave_certificate (organization_id, file_id);

CREATE TRIGGER medical_leave_certificate_updated_at BEFORE UPDATE ON medical_leave_certificate
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE medical_leave_certificate ENABLE ROW LEVEL SECURITY;
CREATE POLICY medical_leave_certificate_tenant ON medical_leave_certificate
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON medical_leave_certificate FROM poolse_app;
GRANT SELECT, INSERT ON medical_leave_certificate TO poolse_app;
GRANT UPDATE (replaced_at, replaced_by) ON medical_leave_certificate TO poolse_app;

-- ----------------------------------------------------------------- retention

CREATE FUNCTION retention_certificate_period() RETURNS interval
LANGUAGE sql IMMUTABLE AS $$ SELECT interval '24 months' $$;

COMMENT ON FUNCTION retention_certificate_period() IS
  'POOLSE-109: how long an atestado outlives the archiving of its medical leave.';

-- Shreds every atestado a student's leaves ever held. Only the club of the
-- request it runs in, as email_preference_forget does.
CREATE FUNCTION medical_certificates_shred(p_org uuid, p_student uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_org IS DISTINCT FROM current_organization_id() THEN
    RETURN;
  END IF;
  UPDATE stored_file f
     SET wrapped_key = NULL,
         key_shredded_at = now(),
         archived_at = coalesce(f.archived_at, now())
    FROM medical_leave_certificate c
    JOIN student_medical_leave l
      ON l.organization_id = c.organization_id AND l.id = c.leave_id
   WHERE f.organization_id = p_org
     AND c.organization_id = p_org
     AND f.id = c.file_id
     AND l.student_id = p_student
     AND f.key_shredded_at IS NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION medical_certificates_shred(uuid, uuid) FROM PUBLIC;
-- The trigger runs as whoever erased the data — retention, or the app — so the
-- app may run it; it acts on one club only and only destroys.
GRANT EXECUTE ON FUNCTION medical_certificates_shred(uuid, uuid) TO poolse_app;

CREATE FUNCTION student_erased_shreds_certificates() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM medical_certificates_shred(NEW.organization_id, NEW.id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER student_erased_shreds_certificates
  AFTER UPDATE OF health_erased_at, anonymised_at ON student
  FOR EACH ROW
  WHEN ((OLD.health_erased_at IS NULL AND NEW.health_erased_at IS NOT NULL)
        OR (OLD.anonymised_at IS NULL AND NEW.anonymised_at IS NOT NULL))
  EXECUTE FUNCTION student_erased_shreds_certificates();

CREATE OR REPLACE FUNCTION apply_retention()
RETURNS TABLE (health_erased integer, anonymised integer, leads_anonymised integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org       uuid := current_organization_id();
  v_today     date := club_today();
  v_health    uuid[];
  v_identity  uuid[];
  v_people    uuid[];
  v_leads     integer;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'apply_retention() runs inside a tenant context';
  END IF;

  -- ----------------------------------------------------------- health, 1 year
  SELECT coalesce(array_agg(s.id), '{}') INTO v_health
    FROM student s
   WHERE s.organization_id = v_org
     AND s.health_erased_at IS NULL
     AND student_left_on(s.id) <= v_today - retention_health_period();

  IF cardinality(v_health) > 0 THEN
    DELETE FROM student_sensitive
     WHERE organization_id = v_org AND student_id = ANY (v_health);
    DELETE FROM consent
     WHERE organization_id = v_org AND student_id = ANY (v_health);
    UPDATE attendance SET note = NULL
     WHERE organization_id = v_org AND student_id = ANY (v_health) AND note IS NOT NULL;
    UPDATE student_medical_leave SET reason = NULL, justification_reference = NULL
     WHERE organization_id = v_org AND student_id = ANY (v_health)
       AND (reason IS NOT NULL OR justification_reference IS NOT NULL);
    UPDATE student
       SET emergency_contact_membership_id = NULL,
           emergency_contact_name = NULL,
           emergency_contact_phone = NULL,
           emergency_contact_relationship = NULL,
           health_erased_at = now()
     WHERE organization_id = v_org AND id = ANY (v_health);

    INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
    SELECT v_org, 'retention.health_erased', 'student', id,
           jsonb_build_object('period', retention_health_period()::text)
      FROM unnest(v_health) AS id;
  END IF;

  -- -------------------------------------------------------- identity, 5 years
  SELECT coalesce(array_agg(s.id), '{}') INTO v_identity
    FROM student s
   WHERE s.organization_id = v_org
     AND s.anonymised_at IS NULL
     AND student_left_on(s.id) <= v_today - retention_identity_period();

  IF cardinality(v_identity) > 0 THEN
    /*
     * The people behind them who exist only for them: a guardian, or the
     * student's own person record, with no login (Clerk owns a login's name),
     * no role but guardian or student, and no link to a student kept.
     */
    SELECT coalesce(array_agg(DISTINCT m.id), '{}') INTO v_people
      FROM membership m
     WHERE m.organization_id = v_org
       AND m.app_user_id IS NULL
       AND (
         m.id IN (SELECT gl.guardian_membership_id FROM guardian_link gl
                   WHERE gl.organization_id = v_org AND gl.student_id = ANY (v_identity))
         OR m.id IN (SELECT s.membership_id FROM student s
                      WHERE s.organization_id = v_org AND s.id = ANY (v_identity))
       )
       AND NOT EXISTS (
         SELECT 1 FROM membership_role r
          WHERE r.membership_id = m.id AND r.archived_at IS NULL
            AND r.role NOT IN ('guardian', 'student')
       )
       AND NOT EXISTS (
         SELECT 1 FROM guardian_link gl
           JOIN student s ON s.id = gl.student_id
          WHERE gl.guardian_membership_id = m.id
            AND s.anonymised_at IS NULL AND NOT (s.id = ANY (v_identity))
       )
       AND NOT EXISTS (
         SELECT 1 FROM student s
          WHERE s.membership_id = m.id
            AND s.anonymised_at IS NULL AND NOT (s.id = ANY (v_identity))
       )
       -- Nor anybody who is still a kept student's emergency contact: that
       -- child's phone number reads through this person.
       AND NOT EXISTS (
         SELECT 1 FROM student s
          WHERE s.emergency_contact_membership_id = m.id
            AND s.anonymised_at IS NULL AND NOT (s.id = ANY (v_identity))
       );

    UPDATE student
       SET first_name = 'Aluno', last_name = 'anonimizado',
           birth_date = NULL, contact_email = NULL, contact_phone = NULL,
           tax_number = NULL, notes = NULL, gender = NULL,
           photo_storage_key = NULL, socio_number = NULL,
           anonymised_at = now()
     WHERE organization_id = v_org AND id = ANY (v_identity);

    UPDATE student_record SET note = NULL
     WHERE organization_id = v_org AND student_id = ANY (v_identity) AND note IS NOT NULL;

    -- Incidents are kept for the same five years, then their words go. The
    -- facts (when, where, emergency, lifeguard) stay, naming nobody.
    DELETE FROM incident_addendum
     WHERE organization_id = v_org
       AND incident_id IN (SELECT id FROM incident
                            WHERE organization_id = v_org AND student_id = ANY (v_identity));
    DELETE FROM incident_detail
     WHERE organization_id = v_org
       AND incident_id IN (SELECT id FROM incident
                            WHERE organization_id = v_org AND student_id = ANY (v_identity));

    UPDATE message_recipient
       SET student_name = 'Aluno anonimizado',
           name = CASE WHEN guardian_membership_id IS NULL THEN 'Aluno anonimizado' ELSE name END,
           email = CASE WHEN guardian_membership_id IS NULL THEN NULL ELSE email END
     WHERE organization_id = v_org AND student_id = ANY (v_identity);

    UPDATE lead
       SET swimmer_first_name = 'Aluno', swimmer_last_name = 'anonimizado',
           swimmer_birth_date = make_date(extract(year FROM swimmer_birth_date)::int, 1, 1),
           swimmer_tax_number = NULL, guardian_name = NULL, guardian_relationship = NULL,
           guardian_tax_number = NULL, email = 'anonimizado@anonimizado.invalid',
           phone = NULL, note = NULL, anonymised_at = now()
     WHERE organization_id = v_org AND student_id = ANY (v_identity) AND anonymised_at IS NULL;

    IF cardinality(v_people) > 0 THEN
      -- The role first: a live guardian must have a NIF or an e-mail
      -- (`guardian_needs_a_key`), and these are about to have neither.
      UPDATE membership_role SET archived_at = now()
       WHERE organization_id = v_org AND membership_id = ANY (v_people) AND archived_at IS NULL;
      UPDATE membership
         SET first_name = 'Pessoa', last_name = 'anonimizada',
             email = NULL, phone = NULL, tax_number = NULL, address = NULL,
             birth_date = NULL, notes = NULL,
             archived_at = coalesce(archived_at, now())
       WHERE organization_id = v_org AND id = ANY (v_people);
      UPDATE message_recipient SET name = 'Pessoa anonimizada', email = NULL
       WHERE organization_id = v_org AND guardian_membership_id = ANY (v_people);
    END IF;

    -- Names copied into the trail. The entries stay; the names in them go.
    UPDATE audit_log SET data = data - 'name' - 'fromName'
     WHERE organization_id = v_org
       AND entity_id = ANY (v_identity || v_people)
       AND (data ? 'name' OR data ? 'fromName');

    INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
    SELECT v_org, 'retention.anonymised', 'student', id,
           jsonb_build_object('period', retention_identity_period()::text,
                              'people', cardinality(v_people))
      FROM unnest(v_identity) AS id;
  END IF;

  -- ------------------------------------- leads that never became a student
  -- Archived after twelve months unconverted (`lead_retention()`), then kept
  -- the same five years as anybody else's identity.
  UPDATE lead
     SET swimmer_first_name = 'Aluno', swimmer_last_name = 'anonimizado',
         swimmer_birth_date = make_date(extract(year FROM swimmer_birth_date)::int, 1, 1),
         swimmer_tax_number = NULL, guardian_name = NULL, guardian_relationship = NULL,
         guardian_tax_number = NULL, email = 'anonimizado@anonimizado.invalid',
         phone = NULL, note = NULL, anonymised_at = now()
   WHERE organization_id = v_org
     AND student_id IS NULL
     AND anonymised_at IS NULL
     AND archived_at <= now() - retention_identity_period();
  GET DIAGNOSTICS v_leads = ROW_COUNT;

  -- ------------------------------------ atestados, 24 months after their leave
  -- POOLSE-109. A leave archived more than `retention_certificate_period()` ago
  -- loses its atestados: the file's data key is destroyed, which leaves the
  -- bucket's bytes as ciphertext nobody can open (crypto-shredding).
  WITH shredded AS (
    UPDATE stored_file f
       SET wrapped_key = NULL,
           key_shredded_at = now(),
           archived_at = coalesce(f.archived_at, now())
      FROM medical_leave_certificate c
      JOIN student_medical_leave l
        ON l.organization_id = c.organization_id AND l.id = c.leave_id
     WHERE f.organization_id = v_org
       AND c.organization_id = v_org
       AND f.id = c.file_id
       AND f.key_shredded_at IS NULL
       AND l.archived_at <= now() - retention_certificate_period()
    RETURNING c.leave_id
  )
  INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
  SELECT v_org, 'retention.certificate_shredded', 'student_medical_leave', leave_id,
         jsonb_build_object('period', retention_certificate_period()::text, 'files', count(*))
    FROM shredded
   GROUP BY leave_id;

  RETURN QUERY SELECT cardinality(v_health), cardinality(v_identity), v_leads;
END;
$fn$;

-- Down Migration

DROP TRIGGER IF EXISTS student_erased_shreds_certificates ON student;
DROP FUNCTION IF EXISTS student_erased_shreds_certificates();
DROP FUNCTION IF EXISTS medical_certificates_shred(uuid, uuid);

CREATE OR REPLACE FUNCTION apply_retention()
RETURNS TABLE (health_erased integer, anonymised integer, leads_anonymised integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org       uuid := current_organization_id();
  v_today     date := club_today();
  v_health    uuid[];
  v_identity  uuid[];
  v_people    uuid[];
  v_leads     integer;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'apply_retention() runs inside a tenant context';
  END IF;

  -- ----------------------------------------------------------- health, 1 year
  SELECT coalesce(array_agg(s.id), '{}') INTO v_health
    FROM student s
   WHERE s.organization_id = v_org
     AND s.health_erased_at IS NULL
     AND student_left_on(s.id) <= v_today - retention_health_period();

  IF cardinality(v_health) > 0 THEN
    DELETE FROM student_sensitive
     WHERE organization_id = v_org AND student_id = ANY (v_health);
    DELETE FROM consent
     WHERE organization_id = v_org AND student_id = ANY (v_health);
    UPDATE attendance SET note = NULL
     WHERE organization_id = v_org AND student_id = ANY (v_health) AND note IS NOT NULL;
    UPDATE student_medical_leave SET reason = NULL, justification_reference = NULL
     WHERE organization_id = v_org AND student_id = ANY (v_health)
       AND (reason IS NOT NULL OR justification_reference IS NOT NULL);
    UPDATE student
       SET emergency_contact_membership_id = NULL,
           emergency_contact_name = NULL,
           emergency_contact_phone = NULL,
           emergency_contact_relationship = NULL,
           health_erased_at = now()
     WHERE organization_id = v_org AND id = ANY (v_health);

    INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
    SELECT v_org, 'retention.health_erased', 'student', id,
           jsonb_build_object('period', retention_health_period()::text)
      FROM unnest(v_health) AS id;
  END IF;

  -- -------------------------------------------------------- identity, 5 years
  SELECT coalesce(array_agg(s.id), '{}') INTO v_identity
    FROM student s
   WHERE s.organization_id = v_org
     AND s.anonymised_at IS NULL
     AND student_left_on(s.id) <= v_today - retention_identity_period();

  IF cardinality(v_identity) > 0 THEN
    /*
     * The people behind them who exist only for them: a guardian, or the
     * student's own person record, with no login (Clerk owns a login's name),
     * no role but guardian or student, and no link to a student kept.
     */
    SELECT coalesce(array_agg(DISTINCT m.id), '{}') INTO v_people
      FROM membership m
     WHERE m.organization_id = v_org
       AND m.app_user_id IS NULL
       AND (
         m.id IN (SELECT gl.guardian_membership_id FROM guardian_link gl
                   WHERE gl.organization_id = v_org AND gl.student_id = ANY (v_identity))
         OR m.id IN (SELECT s.membership_id FROM student s
                      WHERE s.organization_id = v_org AND s.id = ANY (v_identity))
       )
       AND NOT EXISTS (
         SELECT 1 FROM membership_role r
          WHERE r.membership_id = m.id AND r.archived_at IS NULL
            AND r.role NOT IN ('guardian', 'student')
       )
       AND NOT EXISTS (
         SELECT 1 FROM guardian_link gl
           JOIN student s ON s.id = gl.student_id
          WHERE gl.guardian_membership_id = m.id
            AND s.anonymised_at IS NULL AND NOT (s.id = ANY (v_identity))
       )
       AND NOT EXISTS (
         SELECT 1 FROM student s
          WHERE s.membership_id = m.id
            AND s.anonymised_at IS NULL AND NOT (s.id = ANY (v_identity))
       )
       -- Nor anybody who is still a kept student's emergency contact: that
       -- child's phone number reads through this person.
       AND NOT EXISTS (
         SELECT 1 FROM student s
          WHERE s.emergency_contact_membership_id = m.id
            AND s.anonymised_at IS NULL AND NOT (s.id = ANY (v_identity))
       );

    UPDATE student
       SET first_name = 'Aluno', last_name = 'anonimizado',
           birth_date = NULL, contact_email = NULL, contact_phone = NULL,
           tax_number = NULL, notes = NULL, gender = NULL,
           photo_storage_key = NULL, socio_number = NULL,
           anonymised_at = now()
     WHERE organization_id = v_org AND id = ANY (v_identity);

    UPDATE student_record SET note = NULL
     WHERE organization_id = v_org AND student_id = ANY (v_identity) AND note IS NOT NULL;

    -- Incidents are kept for the same five years, then their words go. The
    -- facts (when, where, emergency, lifeguard) stay, naming nobody.
    DELETE FROM incident_addendum
     WHERE organization_id = v_org
       AND incident_id IN (SELECT id FROM incident
                            WHERE organization_id = v_org AND student_id = ANY (v_identity));
    DELETE FROM incident_detail
     WHERE organization_id = v_org
       AND incident_id IN (SELECT id FROM incident
                            WHERE organization_id = v_org AND student_id = ANY (v_identity));

    UPDATE message_recipient
       SET student_name = 'Aluno anonimizado',
           name = CASE WHEN guardian_membership_id IS NULL THEN 'Aluno anonimizado' ELSE name END,
           email = CASE WHEN guardian_membership_id IS NULL THEN NULL ELSE email END
     WHERE organization_id = v_org AND student_id = ANY (v_identity);

    UPDATE lead
       SET swimmer_first_name = 'Aluno', swimmer_last_name = 'anonimizado',
           swimmer_birth_date = make_date(extract(year FROM swimmer_birth_date)::int, 1, 1),
           swimmer_tax_number = NULL, guardian_name = NULL, guardian_relationship = NULL,
           guardian_tax_number = NULL, email = 'anonimizado@anonimizado.invalid',
           phone = NULL, note = NULL, anonymised_at = now()
     WHERE organization_id = v_org AND student_id = ANY (v_identity) AND anonymised_at IS NULL;

    IF cardinality(v_people) > 0 THEN
      -- The role first: a live guardian must have a NIF or an e-mail
      -- (`guardian_needs_a_key`), and these are about to have neither.
      UPDATE membership_role SET archived_at = now()
       WHERE organization_id = v_org AND membership_id = ANY (v_people) AND archived_at IS NULL;
      UPDATE membership
         SET first_name = 'Pessoa', last_name = 'anonimizada',
             email = NULL, phone = NULL, tax_number = NULL, address = NULL,
             birth_date = NULL, notes = NULL,
             archived_at = coalesce(archived_at, now())
       WHERE organization_id = v_org AND id = ANY (v_people);
      UPDATE message_recipient SET name = 'Pessoa anonimizada', email = NULL
       WHERE organization_id = v_org AND guardian_membership_id = ANY (v_people);
    END IF;

    -- Names copied into the trail. The entries stay; the names in them go.
    UPDATE audit_log SET data = data - 'name' - 'fromName'
     WHERE organization_id = v_org
       AND entity_id = ANY (v_identity || v_people)
       AND (data ? 'name' OR data ? 'fromName');

    INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
    SELECT v_org, 'retention.anonymised', 'student', id,
           jsonb_build_object('period', retention_identity_period()::text,
                              'people', cardinality(v_people))
      FROM unnest(v_identity) AS id;
  END IF;

  -- ------------------------------------- leads that never became a student
  -- Archived after twelve months unconverted (`lead_retention()`), then kept
  -- the same five years as anybody else's identity.
  UPDATE lead
     SET swimmer_first_name = 'Aluno', swimmer_last_name = 'anonimizado',
         swimmer_birth_date = make_date(extract(year FROM swimmer_birth_date)::int, 1, 1),
         swimmer_tax_number = NULL, guardian_name = NULL, guardian_relationship = NULL,
         guardian_tax_number = NULL, email = 'anonimizado@anonimizado.invalid',
         phone = NULL, note = NULL, anonymised_at = now()
   WHERE organization_id = v_org
     AND student_id IS NULL
     AND anonymised_at IS NULL
     AND archived_at <= now() - retention_identity_period();
  GET DIAGNOSTICS v_leads = ROW_COUNT;

  RETURN QUERY SELECT cardinality(v_health), cardinality(v_identity), v_leads;
END;
$fn$;

DROP FUNCTION IF EXISTS retention_certificate_period();

DROP TABLE IF EXISTS medical_leave_certificate;
ALTER TABLE student_medical_leave
  DROP CONSTRAINT IF EXISTS student_medical_leave_document_fk,
  DROP COLUMN IF EXISTS document_file_id;

-- A sealed file cannot exist without its columns. Rolling back a development
-- database, its atestados go with them (the enum value stays: Postgres cannot
-- drop one, and an unused value is harmless).
DELETE FROM stored_file WHERE purpose::text = 'medical_certificate';
ALTER TABLE stored_file
  DROP CONSTRAINT IF EXISTS stored_file_wrapped_key_shape,
  DROP CONSTRAINT IF EXISTS stored_file_sealed,
  DROP COLUMN IF EXISTS key_shredded_at,
  DROP COLUMN IF EXISTS wrapped_key;
