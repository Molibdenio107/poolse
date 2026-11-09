-- Up Migration
--
-- At 18 the family is told, and the young adult confirms what a parent signed
-- — POOLSE-208 (Rui, 09-11-2026).
--
-- **`majority_notice`**: one email per recipient per majority, written by the
-- nightly job on the day a student with a live parental link comes of age, then
-- sent after the commit, rendered from its row and retried hourly (the email
-- convention). The unique index makes a rerun write nothing twice, so it sends
-- nothing twice. An acompanhante's link never writes one.
--
-- **`consent_awaits_self()`**: a live consent signed by somebody who is (or
-- was) a guardian of the student, on a student now on the adult path. It stays
-- in force until the young adult confirms or withdraws it (open point 2's
-- default, Rui to confirm): stopping it on the birthday would take down photos
-- nobody objected to, and a withdrawal is possible at any moment.

CREATE TYPE majority_notice_kind AS ENUM ('parent', 'student');

CREATE TABLE majority_notice (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organization (id),
  student_id         uuid NOT NULL,
  majority_on        date NOT NULL,
  kind               majority_notice_kind NOT NULL,
  -- The parent's membership, or the student's own when they have one.
  membership_id      uuid,
  email              citext NOT NULL,
  locale             text NOT NULL DEFAULT 'pt-PT',
  -- Whether that parent was the payer, so the email says they keep paying.
  payer              boolean NOT NULL DEFAULT false,

  delivered_at       timestamptz,
  delivery_attempts  integer NOT NULL DEFAULT 0,
  last_attempt_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, membership_id) REFERENCES membership (organization_id, id),
  CONSTRAINT majority_notice_locale_known CHECK (locale IN ('pt-PT', 'en'))
);

COMMENT ON TABLE majority_notice IS
  'POOLSE-208: the email telling a parent and the student what changed at majority. One per recipient '
  'per majority (unique), sent from its row and retried hourly.';

CREATE UNIQUE INDEX majority_notice_once_uq
  ON majority_notice (organization_id, student_id, majority_on, kind, email);

CREATE TRIGGER majority_notice_updated_at BEFORE UPDATE ON majority_notice
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE majority_notice ENABLE ROW LEVEL SECURITY;
CREATE POLICY majority_notice_tenant ON majority_notice
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE ON majority_notice TO poolse_app;

/*
 * The notices due for a club today: every student whose majority fell in the
 * last three days (a missed night is caught, the unique index stops a repeat),
 * of age by a confirmed date, with a live parental link. One row per parent
 * with an email, and one for the student when they have one.
 */
CREATE FUNCTION majority_notices_write(p_organization_id uuid)
RETURNS integer
LANGUAGE sql AS $fn$
  WITH due AS (
    SELECT s.id AS student_id, s.membership_id, s.contact_email,
           (s.birth_date + make_interval(years => o.age_of_majority))::date AS majority_on,
           o.locale AS club_locale
      FROM student s
      JOIN organization o ON o.id = s.organization_id
     WHERE s.organization_id = p_organization_id
       AND s.archived_at IS NULL
       AND student_of_age(s.organization_id, s.id)
       AND (s.birth_date + make_interval(years => o.age_of_majority))::date
           BETWEEN club_today() - 3 AND club_today()
       AND EXISTS (SELECT 1 FROM guardian_link g
                    WHERE g.organization_id = s.organization_id AND g.student_id = s.id
                      AND g.archived_at IS NULL AND g.kind = 'parental')
  ),
  rows AS (
    SELECT d.student_id, d.majority_on, 'parent'::majority_notice_kind AS kind,
           g.guardian_membership_id AS membership_id,
           nullif(btrim(person_email(g.guardian_membership_id)::text), '') AS email,
           coalesce((SELECT u.locale FROM membership m JOIN app_user u ON u.id = m.app_user_id
                      WHERE m.id = g.guardian_membership_id), d.club_locale) AS locale,
           invoice_payer_membership_id(p_organization_id, d.student_id) = g.guardian_membership_id AS payer
      FROM due d
      JOIN guardian_link g
        ON g.organization_id = p_organization_id AND g.student_id = d.student_id
       AND g.archived_at IS NULL AND g.kind = 'parental'
    UNION ALL
    SELECT d.student_id, d.majority_on, 'student', d.membership_id,
           nullif(btrim(coalesce(person_email(d.membership_id), d.contact_email)::text), ''),
           coalesce((SELECT u.locale FROM membership m JOIN app_user u ON u.id = m.app_user_id
                      WHERE m.id = d.membership_id), d.club_locale),
           false
      FROM due d
  ),
  written AS (
    INSERT INTO majority_notice (organization_id, student_id, majority_on, kind, membership_id, email, locale, payer)
    SELECT p_organization_id, r.student_id, r.majority_on, r.kind, r.membership_id, r.email,
           CASE WHEN r.locale = 'en' THEN 'en' ELSE 'pt-PT' END, r.payer
      FROM rows r
     WHERE r.email IS NOT NULL
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int FROM written
$fn$;

/*
 * A live consent a parent signed for a student who is now on the adult path:
 * shown to the young adult as *a confirmar por si*, and to the office beside it.
 */
CREATE FUNCTION consent_awaits_self(p_organization_id uuid, p_consent_id uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce((
    SELECT c.withdrawn_at IS NULL
       AND c.granted
       AND c.granted_by_membership_id IS DISTINCT FROM s.membership_id
       AND EXISTS (SELECT 1 FROM guardian_link g
                    WHERE g.organization_id = c.organization_id AND g.student_id = c.student_id
                      AND g.guardian_membership_id = c.granted_by_membership_id)
       AND student_is_adult_path(c.organization_id, c.student_id)
      FROM consent c
      JOIN student s ON s.id = c.student_id AND s.organization_id = c.organization_id
     WHERE c.id = p_consent_id AND c.organization_id = p_organization_id), false)
$fn$;

-- Down Migration

DROP FUNCTION consent_awaits_self(uuid, uuid);
DROP FUNCTION majority_notices_write(uuid);
DROP TABLE majority_notice;
DROP TYPE majority_notice_kind;
