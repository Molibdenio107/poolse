-- Up Migration

-- POOLSE-149 slice B — the photograph of a staff member's ID document (Rui,
-- 02-11-2026), front and back, beside the number POOLSE-100 records. This
-- **reverses** POOLSE-100's "the number is enough" (Rui, 22-10-2026).
--
-- **Sealed, as health files are** (POOLSE-109): purpose `staff_id_document` joins
-- `stored_file_sealed`, so the bucket holds ciphertext and the row the file's own
-- wrapped key. Compared as text, because a value added by `ALTER TYPE … ADD
-- VALUE` cannot be used in the transaction that added it.
--
-- **A photograph let go is shredded.** Whenever a membership's front or back
-- moves off a file — replaced, removed, or cleared by retention — the trigger
-- below destroys that file's key, whoever did it. `poolse_app` may never write a
-- key itself, so the work is a definer helper that acts on the request's own
-- club only and only destroys (`medical_certificates_shred`'s shape).
--
-- **Retention**: `apply_retention()` lets both go with the number,
-- `id_document_retention_months` after the membership was archived.

ALTER TYPE file_purpose ADD VALUE IF NOT EXISTS 'staff_id_document';

ALTER TABLE stored_file
  DROP CONSTRAINT stored_file_sealed,
  ADD CONSTRAINT stored_file_sealed CHECK (
    CASE WHEN purpose::text IN ('medical_certificate', 'incident_attachment', 'staff_id_document')
         THEN (wrapped_key IS NOT NULL) <> (key_shredded_at IS NOT NULL)
         ELSE wrapped_key IS NULL AND key_shredded_at IS NULL
    END
  );

ALTER TABLE membership
  ADD COLUMN id_document_front_file_id uuid,
  ADD COLUMN id_document_back_file_id uuid,
  ADD CONSTRAINT membership_id_document_front_fk
    FOREIGN KEY (organization_id, id_document_front_file_id) REFERENCES stored_file (organization_id, id),
  ADD CONSTRAINT membership_id_document_back_fk
    FOREIGN KEY (organization_id, id_document_back_file_id) REFERENCES stored_file (organization_id, id);

COMMENT ON COLUMN membership.id_document_front_file_id IS
  'POOLSE-149: the ID document''s front (stored_file, purpose staff_id_document, sealed). '
  'Read by owner, admin and the person; a read by anybody else is audited.';
COMMENT ON COLUMN membership.id_document_back_file_id IS
  'POOLSE-149: the ID document''s back. As the front.';

CREATE FUNCTION staff_id_document_shred(p_org uuid, p_file uuid)
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
   WHERE f.organization_id = p_org
     AND f.id = p_file
     AND f.purpose::text = 'staff_id_document'
     AND f.key_shredded_at IS NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION staff_id_document_shred(uuid, uuid) FROM PUBLIC;
-- The trigger runs as whoever moved the column — the app, or retention — so the
-- app may run it; it acts on one club only and only destroys.
GRANT EXECUTE ON FUNCTION staff_id_document_shred(uuid, uuid) TO poolse_app;

CREATE FUNCTION membership_id_document_photo_shreds() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id_document_front_file_id IS NOT NULL
     AND OLD.id_document_front_file_id IS DISTINCT FROM NEW.id_document_front_file_id THEN
    PERFORM public.staff_id_document_shred(OLD.organization_id, OLD.id_document_front_file_id);
  END IF;
  IF OLD.id_document_back_file_id IS NOT NULL
     AND OLD.id_document_back_file_id IS DISTINCT FROM NEW.id_document_back_file_id THEN
    PERFORM public.staff_id_document_shred(OLD.organization_id, OLD.id_document_back_file_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER membership_id_document_photo_shreds
  AFTER UPDATE OF id_document_front_file_id, id_document_back_file_id ON membership
  FOR EACH ROW
  EXECUTE FUNCTION membership_id_document_photo_shreds();

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
           photo_file_id = NULL, socio_number = NULL,
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
             -- POOLSE-149: the person's details the staff record added.
             locality = NULL, postal_code = NULL, niss = NULL, nationality = NULL,
             birthplace = NULL, emergency_name = NULL, emergency_phone = NULL,
             emergency_relation = NULL,
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
       SET id_document_type = NULL, id_document_number_encrypted = NULL,
           -- POOLSE-149: the NISS and the emergency contact (a third party's
           -- number) are only for while they work here, and go with it.
           niss = NULL, emergency_name = NULL, emergency_phone = NULL,
           emergency_relation = NULL,
           -- POOLSE-149 B: the document's photographs, shredded by
           -- `membership_id_document_photo_shreds` as the columns let go.
           id_document_front_file_id = NULL, id_document_back_file_id = NULL
      FROM organization o
     WHERE o.id = v_org
       AND m.organization_id = v_org
       AND (m.id_document_number_encrypted IS NOT NULL OR m.niss IS NOT NULL
            OR m.emergency_name IS NOT NULL OR m.emergency_phone IS NOT NULL
            OR m.emergency_relation IS NOT NULL
            OR m.id_document_front_file_id IS NOT NULL OR m.id_document_back_file_id IS NOT NULL)
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
           photo_file_id = NULL, socio_number = NULL,
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
             -- POOLSE-149: the person's details the staff record added.
             locality = NULL, postal_code = NULL, niss = NULL, nationality = NULL,
             birthplace = NULL, emergency_name = NULL, emergency_phone = NULL,
             emergency_relation = NULL,
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
       SET id_document_type = NULL, id_document_number_encrypted = NULL,
           -- POOLSE-149: the NISS and the emergency contact (a third party's
           -- number) are only for while they work here, and go with it.
           niss = NULL, emergency_name = NULL, emergency_phone = NULL,
           emergency_relation = NULL
      FROM organization o
     WHERE o.id = v_org
       AND m.organization_id = v_org
       AND (m.id_document_number_encrypted IS NOT NULL OR m.niss IS NOT NULL
            OR m.emergency_name IS NOT NULL OR m.emergency_phone IS NOT NULL
            OR m.emergency_relation IS NOT NULL)
       AND m.archived_at IS NOT NULL
       AND m.archived_at <= now() - make_interval(months => o.id_document_retention_months)
    RETURNING m.id
  )
  INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
  SELECT v_org, 'retention.id_document_erased', 'membership', id, '{}'::jsonb FROM cleared;

  RETURN QUERY SELECT cardinality(v_health), cardinality(v_identity), v_leads;
END;
$fn$;

DROP TRIGGER IF EXISTS membership_id_document_photo_shreds ON membership;
DROP FUNCTION IF EXISTS membership_id_document_photo_shreds();
DROP FUNCTION IF EXISTS staff_id_document_shred(uuid, uuid);

ALTER TABLE membership
  DROP CONSTRAINT IF EXISTS membership_id_document_back_fk,
  DROP CONSTRAINT IF EXISTS membership_id_document_front_fk,
  DROP COLUMN IF EXISTS id_document_back_file_id,
  DROP COLUMN IF EXISTS id_document_front_file_id;

-- A sealed staff_id_document file left behind makes the narrower CHECK refuse
-- this down, so a rollback never turns a sealed file into one the CHECK calls plain.
ALTER TABLE stored_file
  DROP CONSTRAINT stored_file_sealed,
  ADD CONSTRAINT stored_file_sealed CHECK (
    CASE WHEN purpose::text IN ('medical_certificate', 'incident_attachment')
         THEN (wrapped_key IS NOT NULL) <> (key_shredded_at IS NOT NULL)
         ELSE wrapped_key IS NULL AND key_shredded_at IS NULL
    END
  );

-- The enum value stays: Postgres cannot drop one, and nothing names it now.
