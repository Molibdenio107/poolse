-- Up Migration
--
-- POOLSE-133 — the exame médico(-desportivo) (Rui, 30-10-2026): each student's
-- exam as a row — date, result, valid until, an optional note and an optional
-- certificate — imported and exported for the club as a spreadsheet, and the
-- certificate filed per student.
--
-- A student's standing is their latest live row (by examined_on). Rows are
-- archived, never edited: a correction is a new row. Validity is judged against
-- `club_today()` at read time, never stored.
--
-- Health data:
-- * the certificate is the atestado's kind of file — purpose `medical_certificate`,
--   sealed at rest, office-only, every read audited — so no new purpose;
-- * when `apply_retention()` erases a student's health data (1 year after they
--   leave, `health_erased_at`), a trigger destroys the certificates' keys
--   (crypto-shredding) and clears the notes. A trigger rather than another
--   branch in that function, the pattern CLAUDE.md names for retention.

CREATE TYPE medical_exam_result AS ENUM ('fit', 'fit_with_conditions', 'unfit');

CREATE TABLE medical_exam (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization (id),
  student_id          uuid NOT NULL,
  examined_on         date NOT NULL,
  result              medical_exam_result NOT NULL,
  valid_until         date,
  -- True when no date was given and a year from the exam was assumed: an
  -- estimate is labelled as one, never presented as the certificate's.
  valid_until_assumed boolean NOT NULL DEFAULT false,
  note                text,
  file_id             uuid,
  recorded_by         uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  archived_at         timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, file_id) REFERENCES stored_file (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by) REFERENCES membership (organization_id, id),
  CONSTRAINT medical_exam_valid_after CHECK (valid_until IS NULL OR valid_until >= examined_on),
  CONSTRAINT medical_exam_note_not_blank CHECK (note IS NULL OR (btrim(note) <> '' AND length(note) <= 500)),
  CONSTRAINT medical_exam_assumed_has_date CHECK (NOT valid_until_assumed OR valid_until IS NOT NULL)
);

COMMENT ON TABLE medical_exam IS
  'POOLSE-133: a student''s exame médico. Latest live row is their standing; archived, never edited. '
  'Health data: the certificate is a sealed medical_certificate file, shredded with the student''s health data.';

CREATE INDEX medical_exam_student_idx
  ON medical_exam (organization_id, student_id, examined_on DESC)
  WHERE archived_at IS NULL;

CREATE TRIGGER medical_exam_updated_at BEFORE UPDATE ON medical_exam
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE medical_exam ENABLE ROW LEVEL SECURITY;
CREATE POLICY medical_exam_tenant ON medical_exam
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON medical_exam FROM poolse_app;
GRANT SELECT, INSERT ON medical_exam TO poolse_app;
GRANT UPDATE (archived_at, file_id) ON medical_exam TO poolse_app;

-- The certificate may follow the exam (typed first, scanned later), once: a
-- filed certificate is never swapped in place — a correction is a new row.
CREATE OR REPLACE FUNCTION medical_exam_file_once() RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.file_id IS NOT NULL AND NEW.file_id IS DISTINCT FROM OLD.file_id THEN
    RAISE EXCEPTION 'medical_exam_file_set|%', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER medical_exam_file_once BEFORE UPDATE OF file_id ON medical_exam
  FOR EACH ROW EXECUTE FUNCTION medical_exam_file_once();

-- Retention: when a student's health data is erased, so are the exams' notes and
-- the certificates' keys. Runs as the owner (SECURITY DEFINER) because the
-- certificate rows' keys are not the app's to write, and acts only on that
-- student's rows.
CREATE OR REPLACE FUNCTION medical_exam_health_erased() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE medical_exam SET note = NULL
   WHERE organization_id = NEW.organization_id AND student_id = NEW.id AND note IS NOT NULL;

  UPDATE stored_file f
     SET wrapped_key = NULL,
         key_shredded_at = now(),
         archived_at = coalesce(f.archived_at, now())
    FROM medical_exam e
   WHERE e.organization_id = NEW.organization_id
     AND e.student_id = NEW.id
     AND f.organization_id = e.organization_id
     AND f.id = e.file_id
     AND f.key_shredded_at IS NULL;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER medical_exam_health_erased
  AFTER UPDATE OF health_erased_at ON student
  FOR EACH ROW
  WHEN (OLD.health_erased_at IS NULL AND NEW.health_erased_at IS NOT NULL)
  EXECUTE FUNCTION medical_exam_health_erased();

-- Down Migration

DROP TRIGGER medical_exam_health_erased ON student;
DROP FUNCTION medical_exam_health_erased();
DROP TABLE medical_exam;
DROP FUNCTION medical_exam_file_once();
DROP TYPE medical_exam_result;
