-- Up Migration
--
-- Sweep 19-10-2026b — retention reaches `invoice_reminder`.
--
-- An invoice reminder (POOLSE-86 3.0b) snapshots the payer's name and address,
-- and its audit entry the payer's name. `apply_retention()` anonymises
-- `message_recipient` and missed this. A reminder is not a fatura, so the
-- ten-year tax retention that keeps an invoice's snapshot does not cover it.
--
-- The same shape as the opt-out list (1791626400000): a trigger on the
-- anonymisation rather than another copy of `apply_retention()`.
-- - A **student** anonymised: the reminders that student paid for themselves (the
--   adult path, `payer_student_id`).
-- - A **person** anonymised by retention — recognised by what retention writes
--   (archived, "Pessoa anonimizada", no address) — never by a staff member clearing
--   an address by hand, which must not erase a live family's records.
-- `SECURITY DEFINER`: `poolse_app` holds no UPDATE on those columns, by design.

CREATE FUNCTION invoice_reminder_anonymise(p_org uuid, p_student uuid, p_membership uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Only ever the club of the request it runs in (see email_preference_forget).
  IF p_org IS DISTINCT FROM current_organization_id() THEN
    RETURN;
  END IF;
  UPDATE audit_log a SET data = a.data - 'payerName'
    FROM invoice_reminder r
   WHERE r.organization_id = p_org
     AND (r.payer_student_id = p_student OR r.payer_membership_id = p_membership)
     AND a.organization_id = p_org
     AND a.entity_type = 'invoice_reminder'
     AND a.entity_id = r.id
     AND a.data ? 'payerName';
  UPDATE invoice_reminder
     SET payer_name = CASE WHEN p_student IS NOT NULL THEN 'Aluno anonimizado' ELSE 'Pessoa anonimizada' END,
         email = 'anonimizado@anonimizado.invalid'
   WHERE organization_id = p_org
     AND (payer_student_id = p_student OR payer_membership_id = p_membership);
END;
$fn$;

REVOKE ALL ON FUNCTION invoice_reminder_anonymise(uuid, uuid, uuid) FROM PUBLIC;
-- The triggers run as whoever made the change — retention, or poolse_app when a
-- staff member clears an address — so the app may run it; it acts on one club only.
GRANT EXECUTE ON FUNCTION invoice_reminder_anonymise(uuid, uuid, uuid) TO poolse_app;

CREATE FUNCTION invoice_reminder_anonymise_student() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM invoice_reminder_anonymise(NEW.organization_id, NEW.id, NULL);
  RETURN NULL;
END;
$$;

CREATE FUNCTION invoice_reminder_anonymise_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM invoice_reminder_anonymise(NEW.organization_id, NULL, NEW.id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER student_anonymised_anonymises_reminders
  AFTER UPDATE OF anonymised_at ON student
  FOR EACH ROW
  WHEN (OLD.anonymised_at IS NULL AND NEW.anonymised_at IS NOT NULL)
  EXECUTE FUNCTION invoice_reminder_anonymise_student();

CREATE TRIGGER membership_anonymised_anonymises_reminders
  AFTER UPDATE OF first_name, last_name, email ON membership
  FOR EACH ROW
  WHEN (NEW.first_name = 'Pessoa' AND NEW.last_name = 'anonimizada' AND NEW.email IS NULL
        AND NEW.archived_at IS NOT NULL
        AND (OLD.first_name IS DISTINCT FROM 'Pessoa' OR OLD.last_name IS DISTINCT FROM 'anonimizada'))
  EXECUTE FUNCTION invoice_reminder_anonymise_membership();

-- Down Migration

DROP TRIGGER IF EXISTS membership_anonymised_anonymises_reminders ON membership;
DROP TRIGGER IF EXISTS student_anonymised_anonymises_reminders ON student;
DROP FUNCTION IF EXISTS invoice_reminder_anonymise_membership();
DROP FUNCTION IF EXISTS invoice_reminder_anonymise_student();
DROP FUNCTION IF EXISTS invoice_reminder_anonymise(uuid, uuid, uuid);
