-- Up Migration
--
-- *Fez 18 anos* — POOLSE-207 (Rui, 09-11-2026).
--
-- POOLSE-206 ends a parent's link on the birthday by itself. This is where the
-- office is told: every student who came of age in the last 60 days and still
-- has a live parental link is a row to look at, until somebody acts. Acting is a
-- `majority_review` row: *Confirmar* (nothing changes, the parent stays payer
-- only), *É acompanhante* (the link becomes accompanying, written by the API in
-- the same transaction) or *Convidar para a app* (the existing student
-- invitation).
--
-- **The review names the majority it answers** (`majority_on`, the birthday at
-- the club's age of majority). A corrected birth date is a different majority,
-- and asks again; the same one never asks twice. One live row per student per
-- majority, archived rather than deleted, so a revert through Atividade can
-- archive it and the row comes back.
--
-- **Pending is derived, never stored**: `majority_pending()`, read by the list
-- and the attention circle, so the two cannot disagree.

CREATE TYPE majority_review_action AS ENUM ('confirmed', 'accompanying', 'invited');

CREATE TABLE majority_review (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization (id),
  student_id       uuid NOT NULL,
  majority_on      date NOT NULL,
  action           majority_review_action NOT NULL,
  reviewed_by      uuid NOT NULL,
  reviewed_at      timestamptz NOT NULL DEFAULT now(),

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, reviewed_by) REFERENCES membership (organization_id, id)
);

COMMENT ON TABLE majority_review IS
  'POOLSE-207: the office acted on a student who came of age with a parental link. '
  'One live row per student per majority (majority_on); pending is majority_pending().';

CREATE UNIQUE INDEX majority_review_one_uq
  ON majority_review (organization_id, student_id, majority_on)
  WHERE archived_at IS NULL;

CREATE TRIGGER majority_review_updated_at BEFORE UPDATE ON majority_review
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE majority_review ENABLE ROW LEVEL SECURITY;
CREATE POLICY majority_review_tenant ON majority_review
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE ON majority_review TO poolse_app;

/*
 * Who still needs looking at: of age by a confirmed date, the majority within
 * the last 60 days, a live parental link, and no live review of this majority.
 * security invoker (the default), so RLS scopes it to the session's club.
 */
CREATE FUNCTION majority_pending(p_organization_id uuid)
RETURNS TABLE (student_id uuid, majority_on date)
LANGUAGE sql STABLE AS $fn$
  SELECT s.id, (s.birth_date + make_interval(years => o.age_of_majority))::date
    FROM student s
    JOIN organization o ON o.id = s.organization_id
   WHERE s.organization_id = p_organization_id
     AND s.archived_at IS NULL
     AND student_of_age(s.organization_id, s.id)
     AND (s.birth_date + make_interval(years => o.age_of_majority))::date > club_today() - 60
     AND EXISTS (SELECT 1 FROM guardian_link g
                  WHERE g.organization_id = s.organization_id AND g.student_id = s.id
                    AND g.archived_at IS NULL AND g.kind = 'parental')
     AND NOT EXISTS (SELECT 1 FROM majority_review r
                      WHERE r.organization_id = s.organization_id AND r.student_id = s.id
                        AND r.majority_on = (s.birth_date + make_interval(years => o.age_of_majority))::date
                        AND r.archived_at IS NULL)
$fn$;

-- Down Migration

DROP FUNCTION majority_pending(uuid);
DROP TABLE majority_review;
DROP TYPE majority_review_action;
