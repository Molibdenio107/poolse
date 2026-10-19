-- Up Migration
--
-- Sweep 19-10-2026b — retention reaches `email_preference`.
--
-- POOLSE-86's opt-out row holds an address, paired with the club, and was never
-- deleted — so five years after a family left, `apply_retention()` anonymised the
-- student, the guardian and the lead, and the address lived on here. That is the
-- rule CLAUDE.md states for every new table of identity, missed.
--
-- **A trigger on the anonymisation, not another copy of `apply_retention()`**,
-- the same choice the FPN licence made (1791021600000): when a student or a lead
-- is anonymised, or a person's address is cleared, the opt-out row for that
-- address goes — **unless somebody still live in the club holds the same
-- address** (the father of a sibling who still swims), whose choice it then is.
-- `SECURITY DEFINER` because `poolse_app` holds no DELETE on the table, and a
-- staff member clearing a guardian's address by hand must not fail on it.

CREATE FUNCTION email_preference_forget(p_org uuid, p_email citext) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Only ever the club of the request it runs in: the app may call this, and a
  -- definer function taking a club as a parameter must not reach another club.
  IF p_org IS DISTINCT FROM current_organization_id() THEN
    RETURN;
  END IF;
  IF p_email IS NULL OR btrim(p_email::text) = '' THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM student s
              WHERE s.organization_id = p_org AND s.anonymised_at IS NULL
                AND s.contact_email = p_email)
     OR EXISTS (SELECT 1 FROM membership m
                  LEFT JOIN app_user u ON u.id = m.app_user_id
                 WHERE m.organization_id = p_org AND m.archived_at IS NULL
                   AND coalesce(u.cached_email, m.email) = p_email)
     OR EXISTS (SELECT 1 FROM lead l
                 WHERE l.organization_id = p_org AND l.anonymised_at IS NULL
                   AND l.email = p_email) THEN
    RETURN;
  END IF;
  DELETE FROM email_preference WHERE organization_id = p_org AND email = p_email;
END;
$fn$;

REVOKE ALL ON FUNCTION email_preference_forget(uuid, citext) FROM PUBLIC;
-- The triggers run as whoever made the change — retention, or poolse_app when a
-- staff member clears an address — so the app may run it; it acts on one club only.
GRANT EXECUTE ON FUNCTION email_preference_forget(uuid, citext) TO poolse_app;

CREATE FUNCTION email_preference_forget_student() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM email_preference_forget(OLD.organization_id, OLD.contact_email);
  RETURN NULL;
END;
$$;

CREATE FUNCTION email_preference_forget_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM email_preference_forget(OLD.organization_id, OLD.email);
  RETURN NULL;
END;
$$;

CREATE FUNCTION email_preference_forget_lead() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM email_preference_forget(OLD.organization_id, OLD.email::citext);
  RETURN NULL;
END;
$$;

-- AFTER, so the row being anonymised no longer counts as a live holder.
CREATE TRIGGER student_anonymised_forgets_preference
  AFTER UPDATE OF anonymised_at ON student
  FOR EACH ROW
  WHEN (OLD.anonymised_at IS NULL AND NEW.anonymised_at IS NOT NULL)
  EXECUTE FUNCTION email_preference_forget_student();

CREATE TRIGGER membership_address_cleared_forgets_preference
  AFTER UPDATE OF email ON membership
  FOR EACH ROW
  WHEN (OLD.email IS NOT NULL AND NEW.email IS NULL)
  EXECUTE FUNCTION email_preference_forget_membership();

CREATE TRIGGER lead_anonymised_forgets_preference
  AFTER UPDATE OF anonymised_at ON lead
  FOR EACH ROW
  WHEN (OLD.anonymised_at IS NULL AND NEW.anonymised_at IS NOT NULL)
  EXECUTE FUNCTION email_preference_forget_lead();

-- Down Migration

DROP TRIGGER IF EXISTS lead_anonymised_forgets_preference ON lead;
DROP TRIGGER IF EXISTS membership_address_cleared_forgets_preference ON membership;
DROP TRIGGER IF EXISTS student_anonymised_forgets_preference ON student;
DROP FUNCTION IF EXISTS email_preference_forget_lead();
DROP FUNCTION IF EXISTS email_preference_forget_membership();
DROP FUNCTION IF EXISTS email_preference_forget_student();
DROP FUNCTION IF EXISTS email_preference_forget(uuid, citext);
