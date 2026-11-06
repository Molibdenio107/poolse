-- Up Migration

/*
 * A student the club holds no birth date for still reads through their login —
 * POOLSE-177, found by Rui on 05-11-2026: his own adult student account changed
 * its phone and birth date on the phone and the record never moved.
 *
 * The view asked `student_is_adult_path()`, which reads `student.birth_date`, so
 * a record with that field empty never read through: the likeliest record of an
 * adult who joined by invitation was the one left out, and the office's edits
 * never reached the account either.
 *
 * **Only the display changes.** With no date on the club's record and no live
 * guardian, a login whose own birth date makes them an adult reads through.
 * `student_is_adult_path()` is deliberately not touched: it decides who may sign
 * their own consent, a date a person typed for themselves must not decide that,
 * and guessing adult is the guess that cannot be recovered from. A date on the
 * club's record still wins, so a minor the office has dated stays a minor
 * whatever their account says.
 *
 * With no date anywhere the age is unknown and the record stays the club's.
 */

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

-- Down Migration

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
     WHERE s.membership_id IS NOT NULL
       AND s.anonymised_at IS NULL
       AND m.id = s.membership_id
       AND m.organization_id = s.organization_id
       AND m.archived_at IS NULL
       AND student_is_adult_path(s.organization_id, s.id)
  ) login ON true;
