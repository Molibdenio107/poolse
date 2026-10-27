-- Up Migration

-- POOLSE-100: a staff member's date of birth and identity document.
--
-- **The date of birth already exists, twice, and stays where it is.** A person
-- with a login keeps it on `app_user` — theirs, edited in *O meu perfil*, across
-- every club, like their name (`name_is_theirs`); a person without one keeps it
-- on the club's `membership` row. The staff record reads whichever applies and
-- writes only the second; an owner or admin cannot overwrite a login's own date.
--
-- **The ID document is the club's own record**, per membership: a type and a
-- number, both or neither. The number is ciphertext (`sensitive/cipher.ts`), and
-- the CHECK refuses anything else, so a mistake writes nothing readable. Only
-- the owner, an admin and the person read it, decided by the API; every read by
-- somebody other than the person is in the audit log. It goes
-- `id_document_retention_months` (12 by default, a club setting) after the
-- membership was archived, by `apply_retention()`.

ALTER TABLE membership
  ADD COLUMN id_document_type text,
  ADD COLUMN id_document_number_encrypted text,
  ADD CONSTRAINT membership_id_document_type CHECK (
    id_document_type IS NULL OR id_document_type IN ('cc', 'passport', 'residence_permit', 'other')),
  ADD CONSTRAINT membership_id_document_both CHECK (
    (id_document_type IS NULL) = (id_document_number_encrypted IS NULL)),
  ADD CONSTRAINT membership_id_document_ciphertext CHECK (
    id_document_number_encrypted IS NULL
    OR id_document_number_encrypted ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$');

COMMENT ON COLUMN membership.id_document_number_encrypted IS
  'POOLSE-100: the staff member''s ID document number, encrypted by the API (never plaintext, '
  'by CHECK). Read by owner, admin and the person; reads by others are audited.';

ALTER TABLE organization
  ADD COLUMN id_document_retention_months smallint NOT NULL DEFAULT 12,
  ADD CONSTRAINT organization_id_document_retention CHECK (id_document_retention_months BETWEEN 1 AND 120);

COMMENT ON COLUMN organization.id_document_retention_months IS
  'POOLSE-100: months after a membership is archived that its ID document is erased. 12 by default.';

-- A column the club writes needs its own grant (POOLSE-87): organization is
-- granted column by column.
GRANT UPDATE (id_document_retention_months) ON organization TO poolse_app;

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

    -- POOLSE-116: a lesson's feedback keeps its mood and loses its words and
    -- who wrote them. The trigger lets an anonymising write through.
    UPDATE lesson_feedback
       SET comment = NULL, author_membership_id = NULL, anonymised_at = now()
     WHERE organization_id = v_org AND student_id = ANY (v_identity) AND anonymised_at IS NULL;

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

  -- ------------------------- a staff member's ID document, after they leave
  -- POOLSE-100 (Rui, 22-10-2026): the Cartão de Cidadão (or passport) number a
  -- club records for a member of staff goes once their membership has been
  -- archived for the club's `id_document_retention_months` (12 by default).
  WITH cleared AS (
    UPDATE membership m
       SET id_document_type = NULL, id_document_number_encrypted = NULL
      FROM organization o
     WHERE o.id = v_org
       AND m.organization_id = v_org
       AND m.id_document_number_encrypted IS NOT NULL
       AND m.archived_at IS NOT NULL
       AND m.archived_at <= now() - make_interval(months => o.id_document_retention_months)
    RETURNING m.id
  )
  INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
  SELECT v_org, 'retention.id_document_erased', 'membership', id, '{}'::jsonb FROM cleared;

  RETURN QUERY SELECT cardinality(v_health), cardinality(v_identity), v_leads;
END;
$fn$;

-- Down Migration

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

    -- POOLSE-116: a lesson's feedback keeps its mood and loses its words and
    -- who wrote them. The trigger lets an anonymising write through.
    UPDATE lesson_feedback
       SET comment = NULL, author_membership_id = NULL, anonymised_at = now()
     WHERE organization_id = v_org AND student_id = ANY (v_identity) AND anonymised_at IS NULL;

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

REVOKE UPDATE (id_document_retention_months) ON organization FROM poolse_app;
ALTER TABLE organization DROP CONSTRAINT IF EXISTS organization_id_document_retention,
  DROP COLUMN IF EXISTS id_document_retention_months;
ALTER TABLE membership
  DROP CONSTRAINT IF EXISTS membership_id_document_ciphertext,
  DROP CONSTRAINT IF EXISTS membership_id_document_both,
  DROP CONSTRAINT IF EXISTS membership_id_document_type,
  DROP COLUMN IF EXISTS id_document_number_encrypted,
  DROP COLUMN IF EXISTS id_document_type;
