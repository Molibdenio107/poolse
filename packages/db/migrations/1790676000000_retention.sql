-- Up Migration

-- ===========================================================================
-- Retention and anonymisation — roadmap 7b.8 (POOLSE-77), Rui 16-10-2026.
--
-- A student who has left the club keeps their health data for one year and
-- their identity for five. Then a nightly job erases the first and anonymises
-- the second. Invoices keep their own snapshot of the name and NIF regardless:
-- tax law wants ten years, and this file does not touch them.
--
-- **This softens "history is never destroyed"**, for personal data that has
-- served its purpose. Taken out loud: `docs/decisions.md`, 16-10-2026.
--
-- **Leaving.** `student_left_on()` is the one definition. An archived student
-- left on the day they were archived. A live student with an active or waiting
-- enrolment has not left. Anybody else left on their last enrolment's end, or
-- on the day they were created if they never had one.
--
-- **Why a SECURITY DEFINER function.** The data lives in tables the app may
-- not rewrite on purpose: `consent` (no DELETE, a write-once trigger),
-- `incident_detail`/`incident_addendum`, `message_recipient` and `audit_log`
-- (insert-only). The alternative was handing `poolse_app` UPDATE or DELETE on
-- all five, which every other path would then hold too. `apply_retention()`
-- takes no arguments: it acts on `current_organization_id()` only, and only
-- on rows past their date, so calling it early or twice does nothing wrong.
-- The owner bypasses RLS, so every statement names the tenant itself.
-- ===========================================================================

CREATE FUNCTION retention_health_period() RETURNS interval
LANGUAGE sql IMMUTABLE AS $$ SELECT interval '1 year' $$;

CREATE FUNCTION retention_identity_period() RETURNS interval
LANGUAGE sql IMMUTABLE AS $$ SELECT interval '5 years' $$;

COMMENT ON FUNCTION retention_health_period() IS
  'How long a departed student''s health data is kept: medical notes, emergency '
  'contact, consents, register notes and medical-leave detail. Rui, 16-10-2026.';
COMMENT ON FUNCTION retention_identity_period() IS
  'How long a departed student''s identity is kept, and their incidents with it. '
  'Rui, 16-10-2026.';

ALTER TABLE student
  ADD COLUMN health_erased_at timestamptz,
  ADD COLUMN anonymised_at    timestamptz;

COMMENT ON COLUMN student.health_erased_at IS
  'When the retention job erased this student''s health data. Null: not erased.';
COMMENT ON COLUMN student.anonymised_at IS
  'When the retention job replaced this student''s identity with a placeholder.';

ALTER TABLE lead ADD COLUMN anonymised_at timestamptz;

CREATE FUNCTION student_left_on(p_student_id uuid) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT CASE
           WHEN s.archived_at IS NOT NULL
             THEN (s.archived_at AT TIME ZONE 'Europe/Lisbon')::date
           WHEN EXISTS (
             SELECT 1 FROM enrollment e
              WHERE e.student_id = s.id AND e.status IN ('active', 'waiting')
           ) THEN NULL
           ELSE greatest(
             (s.created_at AT TIME ZONE 'Europe/Lisbon')::date,
             (SELECT max(e.ended_on) FROM enrollment e WHERE e.student_id = s.id)
           )
         END
    FROM student s
   WHERE s.id = p_student_id
$$;

COMMENT ON FUNCTION student_left_on(uuid) IS
  'The day a student left the club, or null while they have not — 7b.8. The '
  'one definition the retention job and the student page both read.';

CREATE FUNCTION apply_retention()
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

REVOKE ALL ON FUNCTION apply_retention() FROM public;
GRANT EXECUTE ON FUNCTION apply_retention() TO poolse_app;

COMMENT ON FUNCTION apply_retention() IS
  'The nightly retention pass for the current tenant — 7b.8. Erases health data '
  'a year after a student left and anonymises identity after five. Idempotent.';

-- Down Migration

DROP FUNCTION IF EXISTS apply_retention();
DROP FUNCTION IF EXISTS student_left_on(uuid);
ALTER TABLE lead DROP COLUMN IF EXISTS anonymised_at;
ALTER TABLE student
  DROP COLUMN IF EXISTS anonymised_at,
  DROP COLUMN IF EXISTS health_erased_at;
DROP FUNCTION IF EXISTS retention_identity_period();
DROP FUNCTION IF EXISTS retention_health_period();
