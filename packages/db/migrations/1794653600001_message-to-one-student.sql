-- Up Migration

-- POOLSE-191 — a message to one student (Rui, 06-11-2026).
--
-- **`message.student_id`** names the person, by a composite key, and
-- `message_audience_target` extends to it. **A WhatsApp row is a record, never a
-- send:** Poolse opens WhatsApp with the text ready and a person presses send, so
-- the row says *opened*, carries no address and no delivery, and `deliverMessage`
-- and the retry (both `channel = 'email'`) pass it by.
--
-- **The recipients stay one function.** Both gain a trailing `p_student_id`, which
-- changes their signature, so they are dropped and made again: keeping the old
-- ones beside them would make every call ambiguous. Their bodies are the live ones
-- with only this added. The student branch does not ask for an enrolment.
--
-- **The opt-out does not reach it**: stopping general messages does not stop a
-- message addressed to one person (POOLSE-86's list of what always goes grows by
-- one). **The ceiling:** the 20 messages a day are for mass mail, so a personal
-- one is not counted there, and its addresses still are.
--
-- `apply_retention()` takes the words of a personal message when the student's
-- identity goes, because they may name them. Its body is the live one with that
-- one statement added.

ALTER TABLE message ADD COLUMN student_id uuid;
ALTER TABLE message ADD CONSTRAINT message_student_fk
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id);

COMMENT ON COLUMN message.student_id IS
  'POOLSE-191: the one student a `student` message is about.';

CREATE INDEX message_student_idx ON message (organization_id, student_id, sent_at DESC)
  WHERE student_id IS NOT NULL;

GRANT INSERT (student_id) ON message TO poolse_app;

ALTER TABLE message DROP CONSTRAINT message_audience_target;
ALTER TABLE message ADD CONSTRAINT message_audience_target CHECK (
  ((audience = 'class_group'::message_audience) = (class_group_id IS NOT NULL)) AND ((audience = 'level'::message_audience) = (level_id IS NOT NULL)) AND ((audience = 'facility'::message_audience) = (facility_id IS NOT NULL)) AND ((audience = 'closure'::message_audience) = (closure_id IS NOT NULL)) AND ((audience = 'session'::message_audience) = (class_session_id IS NOT NULL)) AND ((audience = 'sport'::message_audience) = (sport_id IS NOT NULL))
  AND ((audience = 'student'::message_audience) = (student_id IS NOT NULL))
);

ALTER TABLE message DROP CONSTRAINT message_app_audience;
ALTER TABLE message ADD CONSTRAINT message_app_audience CHECK (
  channel = 'email' OR audience IN ('class_group', 'level', 'facility', 'organization', 'sport', 'student')
);
-- WhatsApp opens one conversation with one person.
ALTER TABLE message ADD CONSTRAINT message_whatsapp_student CHECK (
  channel <> 'whatsapp' OR audience = 'student'
);

DROP FUNCTION message_recipients(uuid, message_audience, uuid, uuid, uuid, uuid, text);
DROP FUNCTION message_recipients_all(uuid, message_audience, uuid, uuid, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.message_recipients_all(p_organization_id uuid, p_audience message_audience, p_class_group_id uuid, p_level_id uuid, p_facility_id uuid, p_closure_id uuid DEFAULT NULL::uuid, p_sport_id text DEFAULT NULL::text, p_student_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(student_id uuid, student_name text, guardian_membership_id uuid, name text, email citext, partner_id uuid, lead_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
  WITH closed AS (
    -- The sessions the closure's form cancelled: every closure in its batch.
    SELECT cs.id, cs.class_group_id, sch.class_group_id AS schedule_group_id,
           sch.partner_group_id
      FROM closure k0
      JOIN closure k
        ON k.organization_id = k0.organization_id AND k.batch_id = k0.batch_id
      JOIN class_session cs
        ON cs.closure_id = k.id AND cs.organization_id = k.organization_id
      LEFT JOIN class_schedule sch
        ON sch.id = cs.schedule_id AND sch.organization_id = cs.organization_id
     WHERE p_audience = 'closure'
       AND k0.id = p_closure_id
       AND k0.organization_id = p_organization_id
  ),
  audience AS (
    SELECT DISTINCT s.id, s.membership_id, s.contact_email,
           btrim(s.first_name || ' ' || s.last_name) AS student_name
      FROM enrollment e
      JOIN class_group cg
        ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
      JOIN student s
        ON s.id = e.student_id AND s.organization_id = e.organization_id
      LEFT JOIN season se
        ON se.id = cg.season_id AND se.organization_id = cg.organization_id
      -- POOLSE-146: the turma's sport is its recinto's; a turma with none is swimming's.
      LEFT JOIN playing_area pa
        ON pa.id = cg.playing_area_id AND pa.organization_id = cg.organization_id
     WHERE e.organization_id = p_organization_id
       AND e.status = 'active'
       AND cg.archived_at IS NULL
       AND s.archived_at IS NULL
       AND (se.id IS NULL OR se.status <> 'archived')
       AND CASE p_audience
             WHEN 'class_group'  THEN cg.id = p_class_group_id
             WHEN 'level'        THEN cg.level_id = p_level_id
             WHEN 'facility'     THEN cg.facility_id = p_facility_id
             WHEN 'organization' THEN true
             -- POOLSE-146: everybody in one sport — a student in two is one row (DISTINCT).
             WHEN 'sport'        THEN coalesce(pa.sport_id, 'pool') = p_sport_id
             -- POOLSE-90 slice 4: one cancelled lesson's turma (the caller passes it).
             WHEN 'session'      THEN cg.id = p_class_group_id
             WHEN 'closure'      THEN EXISTS (
               SELECT 1 FROM closed
                WHERE coalesce(closed.class_group_id, closed.schedule_group_id) = cg.id)
           END
    UNION
    -- POOLSE-191: one person, enrolled or not: a reminder may precede a turma.
    SELECT s.id, s.membership_id, s.contact_email,
           btrim(s.first_name || ' ' || s.last_name)
      FROM student s
     WHERE p_audience = 'student'
       AND s.id = p_student_id
       AND s.organization_id = p_organization_id
       AND s.archived_at IS NULL
  ),
  guardians AS (
    SELECT a.id AS student_id, g.guardian_membership_id
      FROM audience a
      JOIN guardian_link g
        ON g.student_id = a.id AND g.organization_id = p_organization_id
      JOIN membership m
        ON m.id = g.guardian_membership_id AND m.organization_id = g.organization_id
     WHERE g.archived_at IS NULL
       AND m.archived_at IS NULL
  ),
  partners AS (
    SELECT DISTINCT pa.id, pa.name
      FROM closed
      JOIN partner_group pg
        ON pg.id = closed.partner_group_id AND pg.organization_id = p_organization_id
      JOIN partner pa
        ON pa.id = pg.partner_id AND pa.organization_id = pg.organization_id
     WHERE pa.archived_at IS NULL
  )
  SELECT a.id, a.student_name, gu.guardian_membership_id,
         coalesce(person_name(gu.guardian_membership_id), a.student_name),
         nullif(btrim(person_email(gu.guardian_membership_id)::text), '')::citext,
         NULL::uuid, NULL::uuid
    FROM guardians gu
    JOIN audience a ON a.id = gu.student_id
  UNION ALL
  SELECT a.id, a.student_name, NULL::uuid, a.student_name,
         nullif(btrim(coalesce(person_email(a.membership_id), a.contact_email)::text), '')::citext,
         NULL::uuid, NULL::uuid
    FROM audience a
   WHERE NOT EXISTS (SELECT 1 FROM guardians gu WHERE gu.student_id = a.id)
  UNION ALL
  -- A partner is written to at its contacts' addresses; with none it is one row
  -- with no address, counted as not reachable rather than skipped.
  SELECT NULL::uuid, pa.name, NULL::uuid, coalesce(pc.name, pa.name),
         nullif(btrim(pc.email), '')::citext,
         pa.id, NULL::uuid
    FROM partners pa
    LEFT JOIN LATERAL (
      SELECT c.name, c.email
        FROM partner_contact c
       WHERE c.partner_id = pa.id
         AND c.organization_id = p_organization_id
         AND c.archived_at IS NULL
         AND nullif(btrim(coalesce(c.email, '')), '') IS NOT NULL
    ) pc ON true
  UNION ALL
  SELECT NULL::uuid,
         btrim(l.swimmer_first_name || ' ' || l.swimmer_last_name),
         NULL::uuid,
         coalesce(nullif(btrim(l.guardian_name), ''),
                  btrim(l.swimmer_first_name || ' ' || l.swimmer_last_name)),
         nullif(btrim(l.email), '')::citext,
         NULL::uuid, l.id
    FROM lead l
   WHERE l.organization_id = p_organization_id
     AND l.status = 'trial_booked'
     AND l.archived_at IS NULL
     AND l.anonymised_at IS NULL
     AND l.trial_session_id IN (SELECT closed.id FROM closed)
$function$;

CREATE OR REPLACE FUNCTION public.message_recipients(p_organization_id uuid, p_audience message_audience, p_class_group_id uuid, p_level_id uuid, p_facility_id uuid, p_closure_id uuid DEFAULT NULL::uuid, p_sport_id text DEFAULT NULL::text, p_student_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(student_id uuid, student_name text, guardian_membership_id uuid, name text, email citext, partner_id uuid, lead_id uuid, opted_out boolean)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT r.student_id, r.student_name, r.guardian_membership_id, r.name, r.email,
         r.partner_id, r.lead_id,
         -- A closure or cancellation warning always goes, and so does a message addressed to
         -- one person (POOLSE-191); anything else respects the address's choice.
         (p_audience NOT IN ('closure', 'session', 'student')
          AND r.email IS NOT NULL
          AND EXISTS (SELECT 1 FROM email_preference ep
                       WHERE ep.organization_id = p_organization_id
                         AND ep.email = r.email
                         AND ep.messages_opted_out_at IS NOT NULL)) AS opted_out
    FROM message_recipients_all(p_organization_id, p_audience, p_class_group_id,
                                p_level_id, p_facility_id, p_closure_id, p_sport_id, p_student_id) r
$function$;

CREATE OR REPLACE FUNCTION public.message_quota_respected()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_messages  integer;
  v_addresses integer;
BEGIN
  -- A cancellation notice is the club telling families a lesson is off, never a
  -- person mass-mailing: it is not counted and never refused (Rui, 27-10-2026).
  -- An aviso is not mail at all (POOLSE-166).
  -- WhatsApp leaves from a person's own phone, and Poolse sends nothing (POOLSE-191).
  IF NEW.audience = 'session' OR NEW.channel IN ('app', 'whatsapp') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('message_quota:' || NEW.organization_id::text, 0));

  SELECT count(*) INTO v_messages
    FROM message
   WHERE organization_id = NEW.organization_id
     AND sent_at >= message_day_start(NEW.sent_at)
     AND audience NOT IN ('session', 'student')
     AND channel = 'email';
  -- Since POOLSE-86 the address ceiling is shared with invoice reminders.
  v_addresses := email_addresses_today(NEW.organization_id, NEW.sent_at);

  -- A message to one person is not a mass mailing: the 20 a day are for those, and
  -- its addresses still count (POOLSE-191).
  IF NEW.audience <> 'student' AND v_messages + 1 > message_daily_limit() THEN
    RAISE EXCEPTION 'Daily message limit reached: % of %', v_messages, message_daily_limit()
      USING ERRCODE = 'check_violation',
            DETAIL = format('message_quota|messages|%s|%s|1', message_daily_limit(), v_messages);
  END IF;

  IF v_addresses + NEW.address_count > message_daily_address_limit() THEN
    RAISE EXCEPTION 'Daily address limit reached: % of %, this message asks for %',
      v_addresses, message_daily_address_limit(), NEW.address_count
      USING ERRCODE = 'check_violation',
            DETAIL = format('message_quota|addresses|%s|%s|%s',
                            message_daily_address_limit(), v_addresses, NEW.address_count);
  END IF;

  RETURN NEW;
END;
$function$;

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

-- Down Migration

DELETE FROM message_recipient WHERE message_id IN (SELECT id FROM message WHERE audience = 'student');
DELETE FROM message WHERE audience = 'student';

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

CREATE OR REPLACE FUNCTION public.message_quota_respected()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_messages  integer;
  v_addresses integer;
BEGIN
  -- A cancellation notice is the club telling families a lesson is off, never a
  -- person mass-mailing: it is not counted and never refused (Rui, 27-10-2026).
  -- An aviso is not mail at all (POOLSE-166).
  IF NEW.audience = 'session' OR NEW.channel = 'app' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('message_quota:' || NEW.organization_id::text, 0));

  SELECT count(*) INTO v_messages
    FROM message
   WHERE organization_id = NEW.organization_id
     AND sent_at >= message_day_start(NEW.sent_at)
     AND audience <> 'session'
     AND channel = 'email';
  -- Since POOLSE-86 the address ceiling is shared with invoice reminders.
  v_addresses := email_addresses_today(NEW.organization_id, NEW.sent_at);

  IF v_messages + 1 > message_daily_limit() THEN
    RAISE EXCEPTION 'Daily message limit reached: % of %', v_messages, message_daily_limit()
      USING ERRCODE = 'check_violation',
            DETAIL = format('message_quota|messages|%s|%s|1', message_daily_limit(), v_messages);
  END IF;

  IF v_addresses + NEW.address_count > message_daily_address_limit() THEN
    RAISE EXCEPTION 'Daily address limit reached: % of %, this message asks for %',
      v_addresses, message_daily_address_limit(), NEW.address_count
      USING ERRCODE = 'check_violation',
            DETAIL = format('message_quota|addresses|%s|%s|%s',
                            message_daily_address_limit(), v_addresses, NEW.address_count);
  END IF;

  RETURN NEW;
END;
$function$;

DROP FUNCTION message_recipients(uuid, message_audience, uuid, uuid, uuid, uuid, text, uuid);
DROP FUNCTION message_recipients_all(uuid, message_audience, uuid, uuid, uuid, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.message_recipients_all(p_organization_id uuid, p_audience message_audience, p_class_group_id uuid, p_level_id uuid, p_facility_id uuid, p_closure_id uuid DEFAULT NULL::uuid, p_sport_id text DEFAULT NULL::text)
 RETURNS TABLE(student_id uuid, student_name text, guardian_membership_id uuid, name text, email citext, partner_id uuid, lead_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
  WITH closed AS (
    -- The sessions the closure's form cancelled: every closure in its batch.
    SELECT cs.id, cs.class_group_id, sch.class_group_id AS schedule_group_id,
           sch.partner_group_id
      FROM closure k0
      JOIN closure k
        ON k.organization_id = k0.organization_id AND k.batch_id = k0.batch_id
      JOIN class_session cs
        ON cs.closure_id = k.id AND cs.organization_id = k.organization_id
      LEFT JOIN class_schedule sch
        ON sch.id = cs.schedule_id AND sch.organization_id = cs.organization_id
     WHERE p_audience = 'closure'
       AND k0.id = p_closure_id
       AND k0.organization_id = p_organization_id
  ),
  audience AS (
    SELECT DISTINCT s.id, s.membership_id, s.contact_email,
           btrim(s.first_name || ' ' || s.last_name) AS student_name
      FROM enrollment e
      JOIN class_group cg
        ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
      JOIN student s
        ON s.id = e.student_id AND s.organization_id = e.organization_id
      LEFT JOIN season se
        ON se.id = cg.season_id AND se.organization_id = cg.organization_id
      -- POOLSE-146: the turma's sport is its recinto's; a turma with none is swimming's.
      LEFT JOIN playing_area pa
        ON pa.id = cg.playing_area_id AND pa.organization_id = cg.organization_id
     WHERE e.organization_id = p_organization_id
       AND e.status = 'active'
       AND cg.archived_at IS NULL
       AND s.archived_at IS NULL
       AND (se.id IS NULL OR se.status <> 'archived')
       AND CASE p_audience
             WHEN 'class_group'  THEN cg.id = p_class_group_id
             WHEN 'level'        THEN cg.level_id = p_level_id
             WHEN 'facility'     THEN cg.facility_id = p_facility_id
             WHEN 'organization' THEN true
             -- POOLSE-146: everybody in one sport — a student in two is one row (DISTINCT).
             WHEN 'sport'        THEN coalesce(pa.sport_id, 'pool') = p_sport_id
             -- POOLSE-90 slice 4: one cancelled lesson's turma (the caller passes it).
             WHEN 'session'      THEN cg.id = p_class_group_id
             WHEN 'closure'      THEN EXISTS (
               SELECT 1 FROM closed
                WHERE coalesce(closed.class_group_id, closed.schedule_group_id) = cg.id)
           END
  ),
  guardians AS (
    SELECT a.id AS student_id, g.guardian_membership_id
      FROM audience a
      JOIN guardian_link g
        ON g.student_id = a.id AND g.organization_id = p_organization_id
      JOIN membership m
        ON m.id = g.guardian_membership_id AND m.organization_id = g.organization_id
     WHERE g.archived_at IS NULL
       AND m.archived_at IS NULL
  ),
  partners AS (
    SELECT DISTINCT pa.id, pa.name
      FROM closed
      JOIN partner_group pg
        ON pg.id = closed.partner_group_id AND pg.organization_id = p_organization_id
      JOIN partner pa
        ON pa.id = pg.partner_id AND pa.organization_id = pg.organization_id
     WHERE pa.archived_at IS NULL
  )
  SELECT a.id, a.student_name, gu.guardian_membership_id,
         coalesce(person_name(gu.guardian_membership_id), a.student_name),
         nullif(btrim(person_email(gu.guardian_membership_id)::text), '')::citext,
         NULL::uuid, NULL::uuid
    FROM guardians gu
    JOIN audience a ON a.id = gu.student_id
  UNION ALL
  SELECT a.id, a.student_name, NULL::uuid, a.student_name,
         nullif(btrim(coalesce(person_email(a.membership_id), a.contact_email)::text), '')::citext,
         NULL::uuid, NULL::uuid
    FROM audience a
   WHERE NOT EXISTS (SELECT 1 FROM guardians gu WHERE gu.student_id = a.id)
  UNION ALL
  -- A partner is written to at its contacts' addresses; with none it is one row
  -- with no address, counted as not reachable rather than skipped.
  SELECT NULL::uuid, pa.name, NULL::uuid, coalesce(pc.name, pa.name),
         nullif(btrim(pc.email), '')::citext,
         pa.id, NULL::uuid
    FROM partners pa
    LEFT JOIN LATERAL (
      SELECT c.name, c.email
        FROM partner_contact c
       WHERE c.partner_id = pa.id
         AND c.organization_id = p_organization_id
         AND c.archived_at IS NULL
         AND nullif(btrim(coalesce(c.email, '')), '') IS NOT NULL
    ) pc ON true
  UNION ALL
  SELECT NULL::uuid,
         btrim(l.swimmer_first_name || ' ' || l.swimmer_last_name),
         NULL::uuid,
         coalesce(nullif(btrim(l.guardian_name), ''),
                  btrim(l.swimmer_first_name || ' ' || l.swimmer_last_name)),
         nullif(btrim(l.email), '')::citext,
         NULL::uuid, l.id
    FROM lead l
   WHERE l.organization_id = p_organization_id
     AND l.status = 'trial_booked'
     AND l.archived_at IS NULL
     AND l.anonymised_at IS NULL
     AND l.trial_session_id IN (SELECT closed.id FROM closed)
$function$;

CREATE OR REPLACE FUNCTION public.message_recipients(p_organization_id uuid, p_audience message_audience, p_class_group_id uuid, p_level_id uuid, p_facility_id uuid, p_closure_id uuid DEFAULT NULL::uuid, p_sport_id text DEFAULT NULL::text)
 RETURNS TABLE(student_id uuid, student_name text, guardian_membership_id uuid, name text, email citext, partner_id uuid, lead_id uuid, opted_out boolean)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT r.student_id, r.student_name, r.guardian_membership_id, r.name, r.email,
         r.partner_id, r.lead_id,
         -- A closure or cancellation warning always goes; anything else respects the address's choice.
         (p_audience NOT IN ('closure', 'session')
          AND r.email IS NOT NULL
          AND EXISTS (SELECT 1 FROM email_preference ep
                       WHERE ep.organization_id = p_organization_id
                         AND ep.email = r.email
                         AND ep.messages_opted_out_at IS NOT NULL)) AS opted_out
    FROM message_recipients_all(p_organization_id, p_audience, p_class_group_id,
                                p_level_id, p_facility_id, p_closure_id, p_sport_id) r
$function$;

ALTER TABLE message DROP CONSTRAINT message_whatsapp_student;
ALTER TABLE message DROP CONSTRAINT message_app_audience;
ALTER TABLE message ADD CONSTRAINT message_app_audience CHECK (
  channel = 'email' OR audience IN ('class_group', 'level', 'facility', 'organization', 'sport')
);
ALTER TABLE message DROP CONSTRAINT message_audience_target;
ALTER TABLE message ADD CONSTRAINT message_audience_target CHECK (
  ((audience = 'class_group'::message_audience) = (class_group_id IS NOT NULL)) AND ((audience = 'level'::message_audience) = (level_id IS NOT NULL)) AND ((audience = 'facility'::message_audience) = (facility_id IS NOT NULL)) AND ((audience = 'closure'::message_audience) = (closure_id IS NOT NULL)) AND ((audience = 'session'::message_audience) = (class_session_id IS NOT NULL)) AND ((audience = 'sport'::message_audience) = (sport_id IS NOT NULL))
);
DROP INDEX message_student_idx;
ALTER TABLE message DROP CONSTRAINT message_student_fk;
ALTER TABLE message DROP COLUMN student_id;
