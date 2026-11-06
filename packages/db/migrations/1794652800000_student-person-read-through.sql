-- Up Migration

/*
 * One person, one answer — POOLSE-177 (Rui, 05-11-2026).
 *
 * The app's Perfil writes `app_user`; the backoffice read `student`, and nothing
 * joined the two, so an adult student changing their phone in the app changed
 * nothing the office could see.
 *
 * **The link is `student.membership_id` → `membership.app_user_id`.**
 * `student.app_user_id`, which the ticket was written around, has no writer: it
 * is null on every row. The migration leaves it alone.
 *
 * **Adult-path students only.** A minor with a login (from 12) keeps the club's
 * record: a child's account must not decide the name on an insurer's form.
 *
 * **No CHECK and no nulling, which is the ticket's plan changed on purpose.**
 * "Adult path" is derived from a birth date and the absence of a guardian link,
 * so a CHECK cannot express it, and a 17-year-old becomes 18 with no write at
 * all. Nulling `student.birth_date` would also make `student_is_adult_path()`
 * answer "no", undoing the rule that put the row here. So the columns stay, as
 * the club's own record and the fallback, and every reader that shows a person
 * goes through this view.
 *
 * **Rules stay on the club's record.** `student_is_adult_path()`, age bands, FPN
 * age groups and retention keep reading `student.birth_date`, so nobody moves
 * their own competition age group, or their own path, from a phone. The view
 * decides adulthood from that same column, which is what keeps it from being
 * circular.
 *
 * **An anonymised student never reads through**, or a login would bring an
 * erased name back.
 *
 * The columns carry the same names as `student`, so a read swaps
 * `FROM student s` for `FROM student_person s` and every `s.first_name`,
 * `displayName('s')` and search below it follows. A half-switch is how a list
 * and a record come to disagree. A new `student` column is added here too;
 * `student-person.sql` test 1 fails until it is.
 *
 * `security_invoker`, so RLS applies as the querying role, as on every view here.
 */

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
     WHERE s.membership_id IS NOT NULL
       AND s.anonymised_at IS NULL
       AND m.id = s.membership_id
       AND m.organization_id = s.organization_id
       AND m.archived_at IS NULL
       AND student_is_adult_path(s.organization_id, s.id)
  ) login ON true;

COMMENT ON VIEW student_person IS
  'A student as the club reads them: an adult-path student with a login reads '
  'name, email, birth date and phone from app_user (POOLSE-177). Rules keep '
  'reading student.birth_date. security_invoker, so RLS applies.';

GRANT SELECT ON student_person TO poolse_app;

/*
 * A person's phone, beside `person_name` and `person_email`: a login's own, else
 * the club's record of somebody with none (BA 3).
 */
CREATE FUNCTION person_phone(p_membership_id uuid) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(u.contact_phone, m.phone)
    FROM membership m
    LEFT JOIN app_user u ON u.id = m.app_user_id
   WHERE m.id = p_membership_id;
$fn$;

GRANT EXECUTE ON FUNCTION person_phone(uuid) TO poolse_app;

/*
 * The backfill (BA 2, decided by Rui, 05-11-2026): the office typed these on
 * purpose, so where the two disagree its birth date and phone go to `app_user`.
 *
 * Name and email are Clerk's. A value written to the cached columns is reverted
 * by the next sync, so Clerk wins them; the club's old value stays where it was,
 * on `student`, which is why it is not copied into the log. The log names what
 * moved and never the value, as `describeChange` does for a person's details.
 *
 * `app_user` is global, so somebody with a membership in another club is left
 * out: their number is not this club's to overwrite.
 */
WITH linked AS (
  SELECT s.organization_id, s.id AS student_id, u.id AS app_user_id,
         s.birth_date, nullif(btrim(s.contact_phone), '') AS phone,
         s.birth_date IS DISTINCT FROM u.birth_date AS birth_moves,
         nullif(btrim(s.contact_phone), '') IS NOT NULL
           AND nullif(btrim(s.contact_phone), '') IS DISTINCT FROM u.contact_phone AS phone_moves
    FROM student s
    JOIN membership m ON m.id = s.membership_id AND m.organization_id = s.organization_id
    JOIN app_user u ON u.id = m.app_user_id AND u.deleted_at IS NULL
   WHERE s.archived_at IS NULL
     AND s.anonymised_at IS NULL
     AND m.archived_at IS NULL
     AND student_is_adult_path(s.organization_id, s.id)
     AND NOT EXISTS (
       SELECT 1 FROM membership other
        WHERE other.app_user_id = u.id
          AND other.organization_id <> s.organization_id
          AND other.archived_at IS NULL
     )
), moved AS (
  UPDATE app_user u
     SET birth_date = CASE WHEN l.birth_moves THEN l.birth_date ELSE u.birth_date END,
         contact_phone = CASE WHEN l.phone_moves THEN l.phone ELSE u.contact_phone END
    FROM linked l
   WHERE u.id = l.app_user_id
     AND (l.birth_moves OR l.phone_moves)
  RETURNING u.id
)
INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
SELECT l.organization_id, 'student.identity_backfilled', 'student', l.student_id,
       jsonb_build_object(
         'source', 'POOLSE-177',
         'before', '{}'::jsonb,
         'after', '{}'::jsonb,
         'withheld', to_jsonb(array_remove(ARRAY[
           CASE WHEN l.birth_moves THEN 'birthDate' END,
           CASE WHEN l.phone_moves THEN 'contactPhone' END
         ], NULL))
       )
  FROM linked l
 WHERE l.birth_moves OR l.phone_moves;

-- Down Migration

/*
 * The backfill is not reversed: it wrote what the office already held, and the
 * values it replaced were deliberately kept out of the log.
 */
DROP FUNCTION person_phone(uuid);
DROP VIEW student_person;
