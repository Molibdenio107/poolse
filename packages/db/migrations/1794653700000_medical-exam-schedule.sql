-- Up Migration

-- POOLSE-192 — the step before an exam (Rui, 06-11-2026): it is due, and the
-- student has been told.
--
-- **`medical_exam_schedule`** is one row per scheduled exam, *marcado para* or
-- *fazer até*, with at most one open per student: a change is a cancel and a new
-- one, so a reminder already sent never silently means another date. It closes
-- when an exam is recorded, by `recorded_exam_id`, in `insertExamIn`, which both
-- ways of recording share. `due_time` is a `time`, not a `timestamptz`: it is the
-- clock on the clinic's wall, a typed moment and not an instant.
--
-- **It is health data.** Owner and admin only, in the API. `message.health` marks
-- a reminder, so an instructor's reader leaves it out and `apply_retention()` can
-- find its words: they go with the student's health data, a year after leaving,
-- and not with the identity at five.

CREATE TYPE medical_exam_schedule_kind AS ENUM ('appointment', 'deadline');

COMMENT ON TYPE medical_exam_schedule_kind IS
  'appointment: the club booked it, on this date. deadline: the student books it, by this date.';

ALTER TABLE message ADD COLUMN health boolean NOT NULL DEFAULT false;
GRANT INSERT (health) ON message TO poolse_app;

COMMENT ON COLUMN message.health IS
  'POOLSE-192: a reminder of a medical exam. Health data: office only, and its words expire with the student''s.';

CREATE TABLE medical_exam_schedule (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization (id),
  student_id       uuid NOT NULL,
  kind             medical_exam_schedule_kind NOT NULL,
  due_on           date NOT NULL,
  due_time         time,
  place            text,
  note             text,
  recorded_exam_id uuid,
  aviso_message_id uuid,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, recorded_exam_id) REFERENCES medical_exam (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES membership (organization_id, id),
  CONSTRAINT medical_exam_schedule_aviso_fk
    FOREIGN KEY (organization_id, aviso_message_id) REFERENCES message (organization_id, id),
  CONSTRAINT medical_exam_schedule_place_shape CHECK (place IS NULL OR (btrim(place) <> '' AND length(place) <= 200)),
  CONSTRAINT medical_exam_schedule_note_shape CHECK (note IS NULL OR (btrim(note) <> '' AND length(note) <= 500)),
  -- A deadline has a day and nothing else to attend at.
  CONSTRAINT medical_exam_schedule_deadline_no_time CHECK (kind = 'appointment' OR due_time IS NULL)
);

COMMENT ON TABLE medical_exam_schedule IS
  'POOLSE-192: a medical exam due, before it happens. Health data, office only; erased by apply_retention().';

CREATE UNIQUE INDEX medical_exam_schedule_one_open
  ON medical_exam_schedule (organization_id, student_id)
  WHERE archived_at IS NULL AND recorded_exam_id IS NULL;

CREATE TRIGGER medical_exam_schedule_updated_at BEFORE UPDATE ON medical_exam_schedule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE medical_exam_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY medical_exam_schedule_tenant ON medical_exam_schedule
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON medical_exam_schedule FROM poolse_app;
GRANT SELECT, INSERT ON medical_exam_schedule TO poolse_app;
GRANT UPDATE (archived_at, recorded_exam_id, aviso_message_id, updated_at) ON medical_exam_schedule TO poolse_app;

CREATE OR REPLACE FUNCTION public.apply_retention()
 RETURNS TABLE(health_erased integer, anonymised integer, leads_anonymised integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    -- POOLSE-192: a scheduled exam, and the words of its reminders. The rows of
    -- the reminders stay, as a message to one person does when the identity goes.
    DELETE FROM medical_exam_schedule
     WHERE organization_id = v_org AND student_id = ANY (v_health);
    UPDATE message SET subject = 'Mensagem anonimizada', body = 'Mensagem anonimizada'
     WHERE organization_id = v_org AND audience = 'student' AND health
       AND student_id = ANY (v_health);
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

    -- POOLSE-191: words written to one person. The row stays, and what it said goes.
    UPDATE message SET subject = 'Mensagem anonimizada', body = 'Mensagem anonimizada'
     WHERE organization_id = v_org AND audience = 'student' AND student_id = ANY (v_identity);

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
$function$;

-- Down Migration

CREATE OR REPLACE FUNCTION public.apply_retention()
 RETURNS TABLE(health_erased integer, anonymised integer, leads_anonymised integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

    -- POOLSE-191: words written to one person. The row stays, and what it said goes.
    UPDATE message SET subject = 'Mensagem anonimizada', body = 'Mensagem anonimizada'
     WHERE organization_id = v_org AND audience = 'student' AND student_id = ANY (v_identity);

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
$function$;

DROP TABLE medical_exam_schedule;
DROP TYPE medical_exam_schedule_kind;
ALTER TABLE message DROP COLUMN health;
