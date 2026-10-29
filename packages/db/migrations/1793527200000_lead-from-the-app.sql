-- Up Migration
--
-- POOLSE-121, the enrolment half (Rui, 29-10-2026) — a family asks to join a
-- class from the app, and the request lands in Pedidos de inscrição naming the
-- class they want.
--
-- **The same queue, not a second one.** A request from the app is a `lead`, as
-- the public form's is, so the office works one list, the attention circle
-- (POOLSE-120) counts it with no edit, and converting it goes through
-- `placeLead`'s one insert path.
--
-- Two new facts:
--   * `requested_class_group_id` — the turma they asked for; the office still
--     chooses (a club checks levels), and Inscrever starts on this one.
--   * `requested_by_membership_id` — the logged-in family member who asked. Null
--     for a public-form request, which is how the queue tells the two apart.
--
-- **For a child the club already has, `student_id` is set from the start**, so
-- converting attaches the turma to that student and never makes a second one.
-- Such a request may carry no birth date (the student may have none), hence the
-- column is nullable where a student is named. A new child asked for from the
-- app is a request like the public form's, birth date required.
--
-- **One open request per child and turma**: asking twice is the same request.

ALTER TABLE lead
  ADD COLUMN requested_class_group_id   uuid,
  ADD COLUMN requested_by_membership_id uuid,
  ADD CONSTRAINT lead_requested_class_fk FOREIGN KEY (organization_id, requested_class_group_id)
    REFERENCES class_group (organization_id, id),
  ADD CONSTRAINT lead_requested_by_fk FOREIGN KEY (organization_id, requested_by_membership_id)
    REFERENCES membership (organization_id, id),
  ALTER COLUMN swimmer_birth_date DROP NOT NULL,
  ADD CONSTRAINT lead_birth_date_known CHECK (swimmer_birth_date IS NOT NULL OR student_id IS NOT NULL);

COMMENT ON COLUMN lead.requested_class_group_id IS
  'POOLSE-121: the turma the family asked for from the app. The office still chooses; Inscrever starts on it.';
COMMENT ON COLUMN lead.requested_by_membership_id IS
  'POOLSE-121: the logged-in family member who asked, from the app. Null: the public form.';

CREATE UNIQUE INDEX lead_one_open_app_request
  ON lead (organization_id, student_id, requested_class_group_id)
  WHERE status IN ('new', 'trial_booked') AND archived_at IS NULL
    AND student_id IS NOT NULL AND requested_class_group_id IS NOT NULL;

CREATE INDEX lead_requested_by_idx ON lead (organization_id, requested_by_membership_id)
  WHERE requested_by_membership_id IS NOT NULL;

-- Down Migration

DROP INDEX lead_requested_by_idx;
DROP INDEX lead_one_open_app_request;
ALTER TABLE lead
  DROP CONSTRAINT lead_birth_date_known,
  DROP CONSTRAINT lead_requested_by_fk,
  DROP CONSTRAINT lead_requested_class_fk,
  DROP COLUMN requested_by_membership_id,
  DROP COLUMN requested_class_group_id;
-- Refused if an app request without a birth date exists: archive or fill it first.
ALTER TABLE lead ALTER COLUMN swimmer_birth_date SET NOT NULL;
