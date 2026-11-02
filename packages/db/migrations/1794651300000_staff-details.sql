-- Up Migration

-- POOLSE-149 slice A — a staff record holds the person's details (Rui, 02-11-2026):
-- morada, localidade, código postal, NIF, NISS, nacionalidade, naturalidade and an
-- emergency contact as free text. All optional.
--
-- **Morada and NIF already exist on `membership`** (`address`, `tax_number`, the
-- person row a guardian uses too), so a person has one address and one NIF in a
-- club whichever hat they wear. This adds what was missing beside them, in the
-- shapes `student` uses (POOLSE-131): the postcode as 0000-000 and the
-- nationality as an ISO 3166-1 alpha-2 code.
--
-- **The NISS is the Segurança Social number**: eleven digits starting 1 or 2,
-- checksum-validated by `isValidNiss` in `@poolse/rules`; the shape is held here.
--
-- **Retention.** A guardian anonymised with a student loses all of it, beside the
-- columns they already lost. A staff member who left loses the NISS and the
-- emergency contact with the ID document, `id_document_retention_months` after
-- the membership was archived: both are only for while they work here, and the
-- second is somebody else's number. Address, NIF and nationality stay with the
-- person's record, as they did for a guardian.
--
-- `membership` is granted table-wide to `poolse_app` (no column grants on it), so
-- no GRANT is needed.

ALTER TABLE membership
  ADD COLUMN locality           text,
  ADD COLUMN postal_code        text,
  ADD COLUMN niss               text,
  ADD COLUMN nationality        text,
  ADD COLUMN birthplace         text,
  ADD COLUMN emergency_name     text,
  ADD COLUMN emergency_phone    text,
  ADD COLUMN emergency_relation text,
  ADD CONSTRAINT membership_postal_code_shape CHECK (postal_code IS NULL OR postal_code ~ '^\d{4}-\d{3}$'),
  ADD CONSTRAINT membership_nationality_shape CHECK (nationality IS NULL OR nationality ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT membership_niss_shape        CHECK (niss IS NULL OR niss ~ '^[12]\d{10}$'),
  ADD CONSTRAINT membership_details_not_blank CHECK (
        coalesce(btrim(locality), 'x') <> '' AND coalesce(btrim(birthplace), 'x') <> ''
    AND coalesce(btrim(emergency_name), 'x') <> '' AND coalesce(btrim(emergency_phone), 'x') <> ''
    AND coalesce(btrim(emergency_relation), 'x') <> '');

COMMENT ON COLUMN membership.niss IS
  'POOLSE-149: Número de Identificação da Segurança Social. Read by owner, admin and the person; '
  'erased with the ID document after the person leaves.';
COMMENT ON COLUMN membership.nationality IS
  'POOLSE-149: ISO 3166-1 alpha-2; the name is the reader''s language (Intl.DisplayNames).';
COMMENT ON COLUMN membership.emergency_name IS
  'POOLSE-149: who to call for a member of staff — free text, not a person in the club. '
  'Erased with the ID document after the person leaves.';

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

CREATE OR REPLACE FUNCTION merge_memberships(
  p_organization_id uuid,
  p_keep_id         uuid,
  p_absorb_id       uuid
) RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_moved integer := 0;
  v_count integer;
  r       RECORD;
BEGIN
  IF p_keep_id = p_absorb_id THEN
    RAISE EXCEPTION 'A person cannot be merged into themselves';
  END IF;

  -- Both must be live and in this tenant. This is also what makes the function
  -- idempotent: the second run finds the absorbed record archived and stops.
  PERFORM 1 FROM membership
   WHERE id = p_keep_id AND organization_id = p_organization_id AND archived_at IS NULL;
  IF NOT FOUND THEN RETURN 0; END IF;

  PERFORM 1 FROM membership
   WHERE id = p_absorb_id AND organization_id = p_organization_id AND archived_at IS NULL;
  IF NOT FOUND THEN RETURN 0; END IF;

  /*
   * What is not a duplicate — sweep of 15-10-2026.
   *
   * Absorbing the Owner moved the `owner` row onto the survivor and archived the
   * Owner: an Admin could merge themselves with the Owner and be the Owner, the
   * invite matrix and `transfer_ownership` walked round. Ownership changes hands
   * only by transfer. Two records that each have their own login are two
   * people, and a support membership is Poolse's, never the club's.
   */
  IF EXISTS (
    SELECT 1 FROM membership_role
     WHERE membership_id = p_absorb_id AND role = 'owner' AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'merge_absorbs_owner' USING ERRCODE = 'P0001';
  END IF;

  IF (SELECT count(*) FROM membership
       WHERE id IN (p_keep_id, p_absorb_id) AND app_user_id IS NOT NULL) = 2 THEN
    RAISE EXCEPTION 'merge_two_logins' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM membership
     WHERE id IN (p_keep_id, p_absorb_id) AND support_grant_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'merge_support' USING ERRCODE = 'P0001';
  END IF;

  /*
   * Field-level merge, stated once: non-null wins over null, and on a genuine
   * conflict the more recently updated record wins. The discarded value is not
   * lost — `merge_candidates` reported it before this ran, and the absorbed row
   * keeps it.
   */
  UPDATE membership k
     SET first_name = CASE WHEN k.first_name IS NULL THEN a.first_name
                           WHEN a.updated_at > k.updated_at AND a.first_name IS NOT NULL
                             THEN a.first_name ELSE k.first_name END,
         last_name  = CASE WHEN k.last_name IS NULL THEN a.last_name
                           WHEN a.updated_at > k.updated_at AND a.last_name IS NOT NULL
                             THEN a.last_name ELSE k.last_name END,
         phone      = coalesce(k.phone, a.phone),
         address    = coalesce(k.address, a.address),
         tax_number = coalesce(k.tax_number, a.tax_number),
         birth_date = coalesce(k.birth_date, a.birth_date),
         -- POOLSE-149: the staff record's details, non-null wins.
         locality           = coalesce(k.locality, a.locality),
         postal_code        = coalesce(k.postal_code, a.postal_code),
         niss               = coalesce(k.niss, a.niss),
         nationality        = coalesce(k.nationality, a.nationality),
         birthplace         = coalesce(k.birthplace, a.birthplace),
         emergency_name     = coalesce(k.emergency_name, a.emergency_name),
         emergency_phone    = coalesce(k.emergency_phone, a.emergency_phone),
         emergency_relation = coalesce(k.emergency_relation, a.emergency_relation),
         email      = coalesce(k.email, a.email),
         -- A login is identity, and the survivor's own wins. Two people with two
         -- logins is not a duplicate this function should be resolving.
         app_user_id = coalesce(k.app_user_id, a.app_user_id)
    FROM membership a
   WHERE k.id = p_keep_id
     AND a.id = p_absorb_id
     -- The identity constraint refuses club-held names on somebody Clerk names.
     -- Where the survivor gains a login, its own columns must go.
     AND true;

  -- Clerk owns the name and email where there is a login; clear ours rather than
  -- leave two answers to the same question.
  UPDATE membership
     SET first_name = NULL, last_name = NULL, email = NULL
   WHERE id = p_keep_id AND app_user_id IS NOT NULL;

  -- Roles the survivor does not already hold.
  UPDATE membership_role mr
     SET membership_id = p_keep_id
   WHERE mr.membership_id = p_absorb_id
     AND mr.archived_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM membership_role keep
        WHERE keep.membership_id = p_keep_id
          AND keep.role = mr.role
          AND keep.archived_at IS NULL
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved + v_count;

  -- Whatever is left is a role both held. Archive rather than delete.
  UPDATE membership_role SET archived_at = now()
   WHERE membership_id = p_absorb_id AND archived_at IS NULL;

  -- Guardianships the survivor does not already have over the same student.
  UPDATE guardian_link gl
     SET guardian_membership_id = p_keep_id
   WHERE gl.guardian_membership_id = p_absorb_id
     AND gl.archived_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM guardian_link keep
        WHERE keep.guardian_membership_id = p_keep_id
          AND keep.student_id = gl.student_id
          AND keep.archived_at IS NULL
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved + v_count;

  UPDATE guardian_link SET archived_at = now()
   WHERE guardian_membership_id = p_absorb_id AND archived_at IS NULL;

  /*
   * Everything else, discovered rather than listed.
   *
   * Excludes the two handled above, and `membership` itself — the merged_into
   * pointer is set deliberately below and must not be swept up by a loop that
   * repoints every reference.
   */
  FOR r IN
    SELECT DISTINCT cl.relname AS table_name, att.attname AS column_name
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_class ref ON ref.oid = c.confrelid
      JOIN unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k.attnum
     WHERE c.contype = 'f'
       AND ref.relname = 'membership'
       AND att.attname LIKE '%membership_id'
       AND cl.relname NOT IN ('membership', 'membership_role', 'guardian_link')
       /*
        * Only what the caller may change. The insert-only history tables
        * (audit_log, invoice, incident, …) hold no UPDATE for poolse_app, and one
        * UPDATE statement against them failed the whole merge with 42501 — it had
        * never run as the app login. Their rows stay with the absorbed record,
        * which points at the survivor through `merged_into`: history is not
        * rewritten, which is also what an insert-only table is for.
        */
       AND has_column_privilege(current_user, c.conrelid, att.attname, 'UPDATE')
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = $1 WHERE %I = $2 AND organization_id = $3',
      r.table_name, r.column_name, r.column_name
    ) USING p_keep_id, p_absorb_id, p_organization_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_moved := v_moved + v_count;
  END LOOP;

  -- And the student side of the relation, which points at a person by a column
  -- that does not end in `membership_id` on every table.
  UPDATE student SET membership_id = p_keep_id
   WHERE membership_id = p_absorb_id AND organization_id = p_organization_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved + v_count;

  UPDATE membership
     SET archived_at = now(), merged_into = p_keep_id
   WHERE id = p_absorb_id;

  INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
  VALUES (
    p_organization_id, 'person.merged', 'membership', p_keep_id,
    jsonb_build_object('absorbed', p_absorb_id, 'rowsRepointed', v_moved)
  );

  RETURN v_moved;
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

CREATE OR REPLACE FUNCTION merge_memberships(
  p_organization_id uuid,
  p_keep_id         uuid,
  p_absorb_id       uuid
) RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_moved integer := 0;
  v_count integer;
  r       RECORD;
BEGIN
  IF p_keep_id = p_absorb_id THEN
    RAISE EXCEPTION 'A person cannot be merged into themselves';
  END IF;

  -- Both must be live and in this tenant. This is also what makes the function
  -- idempotent: the second run finds the absorbed record archived and stops.
  PERFORM 1 FROM membership
   WHERE id = p_keep_id AND organization_id = p_organization_id AND archived_at IS NULL;
  IF NOT FOUND THEN RETURN 0; END IF;

  PERFORM 1 FROM membership
   WHERE id = p_absorb_id AND organization_id = p_organization_id AND archived_at IS NULL;
  IF NOT FOUND THEN RETURN 0; END IF;

  /*
   * What is not a duplicate — sweep of 15-10-2026.
   *
   * Absorbing the Owner moved the `owner` row onto the survivor and archived the
   * Owner: an Admin could merge themselves with the Owner and be the Owner, the
   * invite matrix and `transfer_ownership` walked round. Ownership changes hands
   * only by transfer. Two records that each have their own login are two
   * people, and a support membership is Poolse's, never the club's.
   */
  IF EXISTS (
    SELECT 1 FROM membership_role
     WHERE membership_id = p_absorb_id AND role = 'owner' AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'merge_absorbs_owner' USING ERRCODE = 'P0001';
  END IF;

  IF (SELECT count(*) FROM membership
       WHERE id IN (p_keep_id, p_absorb_id) AND app_user_id IS NOT NULL) = 2 THEN
    RAISE EXCEPTION 'merge_two_logins' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM membership
     WHERE id IN (p_keep_id, p_absorb_id) AND support_grant_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'merge_support' USING ERRCODE = 'P0001';
  END IF;

  /*
   * Field-level merge, stated once: non-null wins over null, and on a genuine
   * conflict the more recently updated record wins. The discarded value is not
   * lost — `merge_candidates` reported it before this ran, and the absorbed row
   * keeps it.
   */
  UPDATE membership k
     SET first_name = CASE WHEN k.first_name IS NULL THEN a.first_name
                           WHEN a.updated_at > k.updated_at AND a.first_name IS NOT NULL
                             THEN a.first_name ELSE k.first_name END,
         last_name  = CASE WHEN k.last_name IS NULL THEN a.last_name
                           WHEN a.updated_at > k.updated_at AND a.last_name IS NOT NULL
                             THEN a.last_name ELSE k.last_name END,
         phone      = coalesce(k.phone, a.phone),
         address    = coalesce(k.address, a.address),
         tax_number = coalesce(k.tax_number, a.tax_number),
         birth_date = coalesce(k.birth_date, a.birth_date),
         email      = coalesce(k.email, a.email),
         -- A login is identity, and the survivor's own wins. Two people with two
         -- logins is not a duplicate this function should be resolving.
         app_user_id = coalesce(k.app_user_id, a.app_user_id)
    FROM membership a
   WHERE k.id = p_keep_id
     AND a.id = p_absorb_id
     -- The identity constraint refuses club-held names on somebody Clerk names.
     -- Where the survivor gains a login, its own columns must go.
     AND true;

  -- Clerk owns the name and email where there is a login; clear ours rather than
  -- leave two answers to the same question.
  UPDATE membership
     SET first_name = NULL, last_name = NULL, email = NULL
   WHERE id = p_keep_id AND app_user_id IS NOT NULL;

  -- Roles the survivor does not already hold.
  UPDATE membership_role mr
     SET membership_id = p_keep_id
   WHERE mr.membership_id = p_absorb_id
     AND mr.archived_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM membership_role keep
        WHERE keep.membership_id = p_keep_id
          AND keep.role = mr.role
          AND keep.archived_at IS NULL
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved + v_count;

  -- Whatever is left is a role both held. Archive rather than delete.
  UPDATE membership_role SET archived_at = now()
   WHERE membership_id = p_absorb_id AND archived_at IS NULL;

  -- Guardianships the survivor does not already have over the same student.
  UPDATE guardian_link gl
     SET guardian_membership_id = p_keep_id
   WHERE gl.guardian_membership_id = p_absorb_id
     AND gl.archived_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM guardian_link keep
        WHERE keep.guardian_membership_id = p_keep_id
          AND keep.student_id = gl.student_id
          AND keep.archived_at IS NULL
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved + v_count;

  UPDATE guardian_link SET archived_at = now()
   WHERE guardian_membership_id = p_absorb_id AND archived_at IS NULL;

  /*
   * Everything else, discovered rather than listed.
   *
   * Excludes the two handled above, and `membership` itself — the merged_into
   * pointer is set deliberately below and must not be swept up by a loop that
   * repoints every reference.
   */
  FOR r IN
    SELECT DISTINCT cl.relname AS table_name, att.attname AS column_name
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_class ref ON ref.oid = c.confrelid
      JOIN unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k.attnum
     WHERE c.contype = 'f'
       AND ref.relname = 'membership'
       AND att.attname LIKE '%membership_id'
       AND cl.relname NOT IN ('membership', 'membership_role', 'guardian_link')
       /*
        * Only what the caller may change. The insert-only history tables
        * (audit_log, invoice, incident, …) hold no UPDATE for poolse_app, and one
        * UPDATE statement against them failed the whole merge with 42501 — it had
        * never run as the app login. Their rows stay with the absorbed record,
        * which points at the survivor through `merged_into`: history is not
        * rewritten, which is also what an insert-only table is for.
        */
       AND has_column_privilege(current_user, c.conrelid, att.attname, 'UPDATE')
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = $1 WHERE %I = $2 AND organization_id = $3',
      r.table_name, r.column_name, r.column_name
    ) USING p_keep_id, p_absorb_id, p_organization_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_moved := v_moved + v_count;
  END LOOP;

  -- And the student side of the relation, which points at a person by a column
  -- that does not end in `membership_id` on every table.
  UPDATE student SET membership_id = p_keep_id
   WHERE membership_id = p_absorb_id AND organization_id = p_organization_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved + v_count;

  UPDATE membership
     SET archived_at = now(), merged_into = p_keep_id
   WHERE id = p_absorb_id;

  INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
  VALUES (
    p_organization_id, 'person.merged', 'membership', p_keep_id,
    jsonb_build_object('absorbed', p_absorb_id, 'rowsRepointed', v_moved)
  );

  RETURN v_moved;
END;
$fn$;

ALTER TABLE membership
  DROP CONSTRAINT IF EXISTS membership_details_not_blank,
  DROP CONSTRAINT IF EXISTS membership_niss_shape,
  DROP CONSTRAINT IF EXISTS membership_nationality_shape,
  DROP CONSTRAINT IF EXISTS membership_postal_code_shape,
  DROP COLUMN IF EXISTS emergency_relation,
  DROP COLUMN IF EXISTS emergency_phone,
  DROP COLUMN IF EXISTS emergency_name,
  DROP COLUMN IF EXISTS birthplace,
  DROP COLUMN IF EXISTS nationality,
  DROP COLUMN IF EXISTS niss,
  DROP COLUMN IF EXISTS postal_code,
  DROP COLUMN IF EXISTS locality;
