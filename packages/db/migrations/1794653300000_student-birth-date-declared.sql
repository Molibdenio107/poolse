-- Up Migration

/*
 * A date of birth a person typed reaches the club's record, and the office
 * confirms it — POOLSE-186. Rui, 05-11-2026: his student login, born in 1990,
 * was told a guardian answers for it. The date sat on `app_user`, `student`'s was
 * blank, the screen read through and every rule did not.
 *
 * **A blank club date takes the login's, once.** On linking a student, on a login
 * joining a person the club already holds, and on saving a profile. A date the
 * club holds is never overwritten, and a student with a live guardian is left
 * alone: a minor keeps the club's record (POOLSE-177).
 *
 * **Such a date is declared until the office confirms it.** It works at once for
 * answering in the app and for sending a paper, because those rules ask for an
 * age. `student_is_adult_path()` refuses it: a date somebody typed for themselves
 * must not decide who signs their own consent (1794652900000's rule, kept).
 *
 * Confirming writes `birth_date_verified_at` / `_by`. The office changing the date
 * clears both states by trigger, so a confirmation never outlives its date.
 */

ALTER TABLE student
  ADD COLUMN birth_date_declared_at timestamptz,
  ADD COLUMN birth_date_verified_at timestamptz,
  ADD COLUMN birth_date_verified_by uuid,
  ADD CONSTRAINT student_birth_date_verified_by_fk
    FOREIGN KEY (organization_id, birth_date_verified_by) REFERENCES membership (organization_id, id),
  ADD CONSTRAINT student_birth_date_one_state
    CHECK (birth_date_declared_at IS NULL OR birth_date_verified_at IS NULL);

COMMENT ON COLUMN student.birth_date_declared_at IS
  'Set when birth_date came from the person''s own login and the office has not confirmed it. Never counts for the adult path.';
COMMENT ON COLUMN student.birth_date_verified_at IS
  'The office confirmed birth_date, normally against the ID document. Cleared when the date changes.';

-- Linking a student to a login that already has a date.
CREATE FUNCTION student_birth_date_fill() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_birth date;
BEGIN
  IF NEW.birth_date IS NULL AND NEW.membership_id IS NOT NULL AND NEW.anonymised_at IS NULL THEN
    SELECT u.birth_date INTO v_birth
      FROM membership m
      JOIN app_user u ON u.id = m.app_user_id AND u.deleted_at IS NULL
     WHERE m.id = NEW.membership_id AND m.organization_id = NEW.organization_id;
    IF v_birth IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM guardian_link g
       WHERE g.student_id = NEW.id AND g.organization_id = NEW.organization_id AND g.archived_at IS NULL
    ) THEN
      NEW.birth_date := v_birth;
      NEW.birth_date_declared_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER student_birth_date_fill
  BEFORE INSERT OR UPDATE OF membership_id ON student
  FOR EACH ROW EXECUTE FUNCTION student_birth_date_fill();

-- A confirmation belongs to one date. Runs after the fill (trigger names sort).
CREATE FUNCTION student_birth_date_state() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.birth_date IS DISTINCT FROM OLD.birth_date
     AND NEW.birth_date_declared_at IS NOT DISTINCT FROM OLD.birth_date_declared_at
     AND NEW.birth_date_verified_at IS NOT DISTINCT FROM OLD.birth_date_verified_at THEN
    NEW.birth_date_declared_at := NULL;
    NEW.birth_date_verified_at := NULL;
    NEW.birth_date_verified_by := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER student_birth_date_state
  BEFORE UPDATE OF birth_date ON student
  FOR EACH ROW EXECUTE FUNCTION student_birth_date_state();

-- A login joining a person the club holds (an accepted invitation).
CREATE FUNCTION membership_birth_date_fill() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE student s
     SET birth_date = u.birth_date, birth_date_declared_at = now()
    FROM app_user u
   WHERE u.id = NEW.app_user_id AND u.birth_date IS NOT NULL AND u.deleted_at IS NULL
     AND s.membership_id = NEW.id AND s.organization_id = NEW.organization_id
     AND s.birth_date IS NULL AND s.anonymised_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM guardian_link g
        WHERE g.student_id = s.id AND g.organization_id = s.organization_id AND g.archived_at IS NULL);
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER membership_birth_date_fill
  AFTER UPDATE OF app_user_id ON membership
  FOR EACH ROW WHEN (NEW.app_user_id IS NOT NULL) EXECUTE FUNCTION membership_birth_date_fill();

-- A person saving their own date. It fills what RLS lets the writer reach; the
-- profile path runs as the definer `set_app_user_profile`, so every club.
CREATE FUNCTION app_user_birth_date_fill() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE student s
     SET birth_date = NEW.birth_date, birth_date_declared_at = now()
    FROM membership m
   WHERE m.app_user_id = NEW.id AND m.archived_at IS NULL
     AND s.membership_id = m.id AND s.organization_id = m.organization_id
     AND s.birth_date IS NULL AND s.anonymised_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM guardian_link g
        WHERE g.student_id = s.id AND g.organization_id = s.organization_id AND g.archived_at IS NULL);
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER app_user_birth_date_fill
  AFTER UPDATE OF birth_date ON app_user
  FOR EACH ROW WHEN (NEW.birth_date IS NOT NULL AND NEW.birth_date IS DISTINCT FROM OLD.birth_date)
  EXECUTE FUNCTION app_user_birth_date_fill();

CREATE OR REPLACE FUNCTION student_is_adult_path(p_organization_id uuid, p_student_id uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT s.birth_date IS NOT NULL
     AND s.birth_date_declared_at IS NULL
     AND s.birth_date <= (club_today() - make_interval(years => o.age_of_majority))
     AND NOT EXISTS (
       SELECT 1 FROM guardian_link g
        WHERE g.student_id = s.id
          AND g.organization_id = s.organization_id
          AND g.archived_at IS NULL
     )
    FROM student s
    JOIN organization o ON o.id = s.organization_id
   WHERE s.id = p_student_id AND s.organization_id = p_organization_id
$fn$;

CREATE OR REPLACE VIEW student_person WITH (security_invoker = true) AS
SELECT s.id,
       s.organization_id,
       coalesce(login.first_name, s.first_name) AS first_name,
       coalesce(login.last_name, s.last_name) AS last_name,
       coalesce(login.birth_date, s.birth_date) AS birth_date,
       s.level_id,
       s.app_user_id,
       s.notes,
       coalesce(login.email, s.contact_email) AS contact_email,
       coalesce(login.phone, s.contact_phone) AS contact_phone,
       s.created_at,
       s.updated_at,
       s.archived_at,
       s.favourite_stroke,
       s.membership_id,
       s.tax_number,
       s.is_socio,
       s.socio_number,
       s.socio_since,
       s.gender,
       s.paid_through_month,
       s.emergency_contact_membership_id,
       s.emergency_contact_name,
       s.emergency_contact_phone,
       s.emergency_contact_relationship,
       s.health_erased_at,
       s.anonymised_at,
       s.federation_licence,
       s.photo_file_id,
       s.address_line,
       s.locality,
       s.postal_code,
       s.parent_one_name,
       s.parent_two_name,
       s.marital_status,
       s.profession,
       s.education,
       s.birthplace,
       s.nationality,
       s.sns_number,
       s.id_document_type,
       s.id_document_number_encrypted,
       s.id_document_issued_on,
       s.id_document_valid_until,
       s.fpn_disciplines,
       login.app_user IS NOT NULL AS identity_from_login,
       s.birth_date_declared_at,
       s.birth_date_verified_at,
       s.birth_date_verified_by
  FROM student s
  LEFT JOIN LATERAL (
    SELECT u.id AS app_user,
           nullif(btrim(u.cached_first_name), '') AS first_name,
           nullif(btrim(u.cached_last_name), '') AS last_name,
           u.birth_date,
           u.cached_email AS email,
           u.contact_phone AS phone
      FROM membership m
      JOIN app_user u ON u.id = m.app_user_id AND u.deleted_at IS NULL
      JOIN organization o ON o.id = s.organization_id
     WHERE s.membership_id IS NOT NULL
       AND s.anonymised_at IS NULL
       AND m.id = s.membership_id
       AND m.organization_id = s.organization_id
       AND m.archived_at IS NULL
       AND (
         student_is_adult_path(s.organization_id, s.id)
         OR ((s.birth_date IS NULL OR s.birth_date_declared_at IS NOT NULL)
             AND u.birth_date <= (club_today() - make_interval(years => o.age_of_majority))
             AND NOT EXISTS (
               SELECT 1 FROM guardian_link g
                WHERE g.student_id = s.id
                  AND g.organization_id = s.organization_id
                  AND g.archived_at IS NULL
             ))
       )
  ) login ON true;

-- The people already in this state.
UPDATE student s
   SET birth_date = u.birth_date, birth_date_declared_at = now()
  FROM membership m
  JOIN app_user u ON u.id = m.app_user_id AND u.deleted_at IS NULL
 WHERE s.membership_id = m.id AND s.organization_id = m.organization_id
   AND s.birth_date IS NULL AND s.anonymised_at IS NULL
   AND u.birth_date IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM guardian_link g
      WHERE g.student_id = s.id AND g.organization_id = s.organization_id AND g.archived_at IS NULL);

-- Down Migration

UPDATE student SET birth_date = NULL WHERE birth_date_declared_at IS NOT NULL;

CREATE OR REPLACE FUNCTION student_is_adult_path(p_organization_id uuid, p_student_id uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT s.birth_date IS NOT NULL
     AND s.birth_date <= (club_today() - make_interval(years => o.age_of_majority))
     AND NOT EXISTS (
       SELECT 1 FROM guardian_link g
        WHERE g.student_id = s.id
          AND g.organization_id = s.organization_id
          AND g.archived_at IS NULL
     )
    FROM student s
    JOIN organization o ON o.id = s.organization_id
   WHERE s.id = p_student_id AND s.organization_id = p_organization_id
$fn$;

DROP TRIGGER app_user_birth_date_fill ON app_user;
DROP FUNCTION app_user_birth_date_fill();
DROP TRIGGER membership_birth_date_fill ON membership;
DROP FUNCTION membership_birth_date_fill();
DROP TRIGGER student_birth_date_state ON student;
DROP FUNCTION student_birth_date_state();
DROP TRIGGER student_birth_date_fill ON student;
DROP FUNCTION student_birth_date_fill();

DROP VIEW student_person;
CREATE VIEW student_person WITH (security_invoker = true) AS
SELECT s.id,
       s.organization_id,
       coalesce(login.first_name, s.first_name) AS first_name,
       coalesce(login.last_name, s.last_name) AS last_name,
       coalesce(login.birth_date, s.birth_date) AS birth_date,
       s.level_id,
       s.app_user_id,
       s.notes,
       coalesce(login.email, s.contact_email) AS contact_email,
       coalesce(login.phone, s.contact_phone) AS contact_phone,
       s.created_at,
       s.updated_at,
       s.archived_at,
       s.favourite_stroke,
       s.membership_id,
       s.tax_number,
       s.is_socio,
       s.socio_number,
       s.socio_since,
       s.gender,
       s.paid_through_month,
       s.emergency_contact_membership_id,
       s.emergency_contact_name,
       s.emergency_contact_phone,
       s.emergency_contact_relationship,
       s.health_erased_at,
       s.anonymised_at,
       s.federation_licence,
       s.photo_file_id,
       s.address_line,
       s.locality,
       s.postal_code,
       s.parent_one_name,
       s.parent_two_name,
       s.marital_status,
       s.profession,
       s.education,
       s.birthplace,
       s.nationality,
       s.sns_number,
       s.id_document_type,
       s.id_document_number_encrypted,
       s.id_document_issued_on,
       s.id_document_valid_until,
       s.fpn_disciplines,
       login.app_user IS NOT NULL AS identity_from_login
  FROM student s
  LEFT JOIN LATERAL (
    SELECT u.id AS app_user,
           nullif(btrim(u.cached_first_name), '') AS first_name,
           nullif(btrim(u.cached_last_name), '') AS last_name,
           u.birth_date,
           u.cached_email AS email,
           u.contact_phone AS phone
      FROM membership m
      JOIN app_user u ON u.id = m.app_user_id AND u.deleted_at IS NULL
      JOIN organization o ON o.id = s.organization_id
     WHERE s.membership_id IS NOT NULL
       AND s.anonymised_at IS NULL
       AND m.id = s.membership_id
       AND m.organization_id = s.organization_id
       AND m.archived_at IS NULL
       AND (
         student_is_adult_path(s.organization_id, s.id)
         OR (s.birth_date IS NULL
             AND u.birth_date <= (club_today() - make_interval(years => o.age_of_majority))
             AND NOT EXISTS (
               SELECT 1 FROM guardian_link g
                WHERE g.student_id = s.id
                  AND g.organization_id = s.organization_id
                  AND g.archived_at IS NULL
             ))
       )
  ) login ON true;

GRANT SELECT ON student_person TO poolse_app;

ALTER TABLE student
  DROP CONSTRAINT student_birth_date_one_state,
  DROP CONSTRAINT student_birth_date_verified_by_fk,
  DROP COLUMN birth_date_verified_by,
  DROP COLUMN birth_date_verified_at,
  DROP COLUMN birth_date_declared_at;
