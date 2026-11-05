-- Up Migration

-- POOLSE-179 slice 2, part 2 — a family sends a document, and nothing the
-- office holds changes until the office accepts it (Rui, 05-11-2026: "don't
-- break anything").
--
-- **Its own table, not a pending row in `student_document` or `medical_exam`.**
-- Both have readers that take "the latest live row" as the student's standing:
-- the register's exame warning, *Aulas*, the coach's view. A family's exam with
-- no result in `medical_exam` would become that standing and turn a valid exam
-- into "none". Here it changes nothing until the office accepts it. Then the
-- API files it through the office's own paths (`fileCopy`, `insertExamIn`), with
-- the result the office reads off the certificate.
--
-- **One pending per child, kind and season.** A second sending while the first
-- waits is refused (a family re-sends after the office decides).
--
-- **The file's purpose follows the kind**, checked here as `student_document`'s
-- trigger checks it: an ID photo is a sealed `student_id_document`, an exam's
-- certificate a sealed `medical_certificate`, the signed forms a plain
-- `student_document`.
--
-- **A sealing let go is shredded.** Rejected, or its child anonymised by
-- retention (or their health data erased, for an exam), a sealed file's key is
-- destroyed by `family_submission_shred`. That helper has the
-- `student_id_document_shred` shape: one club, a file a submission names, only
-- destroys. An accepted file now belongs to the record it was filed on, whose
-- own triggers shred it.

CREATE TYPE family_submission_kind AS ENUM
  ('fpn_declaration', 'fpn_declaration_minor', 'socio_form', 'id_document', 'medical_exam');
CREATE TYPE family_submission_decision AS ENUM ('accepted', 'rejected');

CREATE TABLE family_submission (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  student_id      uuid NOT NULL,
  kind            family_submission_kind NOT NULL,
  -- The FPN declarations are per season; the rest have none.
  season_id       uuid,
  file_id         uuid NOT NULL,
  -- An exam only: the date the family read off the certificate. The result is
  -- the office's, typed when it accepts.
  examined_on     date,
  submitted_by    uuid NOT NULL,
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  decision        family_submission_decision,
  decided_by      uuid,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, season_id) REFERENCES season (organization_id, id),
  FOREIGN KEY (organization_id, file_id) REFERENCES stored_file (organization_id, id),
  FOREIGN KEY (organization_id, submitted_by) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, decided_by) REFERENCES membership (organization_id, id),
  CONSTRAINT family_submission_season_kind CHECK (
    (kind IN ('fpn_declaration', 'fpn_declaration_minor')) = (season_id IS NOT NULL)),
  CONSTRAINT family_submission_exam_date CHECK ((kind = 'medical_exam') = (examined_on IS NOT NULL)),
  -- Retention may close one with nobody's name on it; a person always names themselves.
  CONSTRAINT family_submission_decided_whole CHECK (
    (decision IS NULL) = (decided_at IS NULL) AND (decided_by IS NULL OR decision IS NOT NULL))
);

COMMENT ON TABLE family_submission IS
  'POOLSE-179: a document a family sent (signed form, ID photo, exame médico). Changes no record '
  'until the office accepts it; then it is filed through the office''s own paths.';

CREATE UNIQUE INDEX family_submission_one_pending
  ON family_submission (organization_id, student_id, kind,
                        coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE decision IS NULL;
CREATE INDEX family_submission_student_idx
  ON family_submission (organization_id, student_id, submitted_at DESC);
-- Each file is sent once: a file id cannot be replayed onto another child.
CREATE UNIQUE INDEX family_submission_file_once ON family_submission (organization_id, file_id);

CREATE TRIGGER family_submission_updated_at BEFORE UPDATE ON family_submission
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE family_submission ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_submission_tenant ON family_submission
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON family_submission FROM poolse_app;
GRANT SELECT, INSERT ON family_submission TO poolse_app;
GRANT UPDATE (decision, decided_by, decided_at) ON family_submission TO poolse_app;

-- The file's purpose follows the kind; a decision, once taken, stands.
CREATE FUNCTION family_submission_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_purpose text;
  v_expected text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.decision IS NOT NULL THEN
    RAISE EXCEPTION 'family_submission_decided|%', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT f.purpose::text INTO v_purpose FROM stored_file f
     WHERE f.organization_id = NEW.organization_id AND f.id = NEW.file_id;
    -- Assigned first: inside an IF, the CASE's own THEN would end the condition.
    v_expected := CASE NEW.kind::text
                    WHEN 'id_document' THEN 'student_id_document'
                    WHEN 'medical_exam' THEN 'medical_certificate'
                    ELSE 'student_document' END;
    IF v_purpose IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'family_submission_purpose|%', NEW.kind USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER family_submission_guard
  BEFORE INSERT OR UPDATE ON family_submission
  FOR EACH ROW EXECUTE FUNCTION family_submission_guard();

CREATE FUNCTION family_submission_shred(p_org uuid, p_submission uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_org IS DISTINCT FROM current_organization_id() THEN
    RETURN;
  END IF;
  UPDATE stored_file f
     SET wrapped_key = NULL,
         key_shredded_at = now(),
         archived_at = coalesce(f.archived_at, now())
    FROM family_submission s
   WHERE s.organization_id = p_org
     AND s.id = p_submission
     AND f.organization_id = p_org
     AND f.id = s.file_id
     AND f.purpose::text IN ('student_id_document', 'medical_certificate')
     AND f.key_shredded_at IS NULL
     -- Never a file the office has since filed on a record.
     AND NOT EXISTS (SELECT 1 FROM student_document d WHERE d.organization_id = p_org AND d.file_id = f.id)
     AND NOT EXISTS (SELECT 1 FROM medical_exam e WHERE e.organization_id = p_org AND e.file_id = f.id);
END;
$fn$;

REVOKE ALL ON FUNCTION family_submission_shred(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION family_submission_shred(uuid, uuid) TO poolse_app;

CREATE FUNCTION family_submission_rejected_shreds() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.family_submission_shred(NEW.organization_id, NEW.id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER family_submission_rejected_shreds
  AFTER UPDATE OF decision ON family_submission
  FOR EACH ROW
  WHEN (NEW.decision = 'rejected')
  EXECUTE FUNCTION family_submission_rejected_shreds();

-- Retention: anonymisation takes every sealed file a family sent; erasing health
-- data takes the exams'. Accepted ones are already in the record's own care.
CREATE FUNCTION student_family_submission_shreds() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT s.id FROM family_submission s
     WHERE s.organization_id = NEW.organization_id
       AND s.student_id = NEW.id
       AND (TG_ARGV[0] = 'all' OR s.kind = 'medical_exam')
  LOOP
    PERFORM public.family_submission_shred(NEW.organization_id, v_id);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE TRIGGER student_anonymised_submission_shreds
  AFTER UPDATE OF anonymised_at ON student
  FOR EACH ROW
  WHEN (OLD.anonymised_at IS NULL AND NEW.anonymised_at IS NOT NULL)
  EXECUTE FUNCTION student_family_submission_shreds('all');

CREATE TRIGGER student_health_erased_submission_shreds
  AFTER UPDATE OF health_erased_at ON student
  FOR EACH ROW
  WHEN (OLD.health_erased_at IS NULL AND NEW.health_erased_at IS NOT NULL)
  EXECUTE FUNCTION student_family_submission_shreds('health');

-- Down Migration

DROP TRIGGER IF EXISTS student_health_erased_submission_shreds ON student;
DROP TRIGGER IF EXISTS student_anonymised_submission_shreds ON student;
DROP FUNCTION IF EXISTS student_family_submission_shreds();
DROP TRIGGER IF EXISTS family_submission_rejected_shreds ON family_submission;
DROP FUNCTION IF EXISTS family_submission_rejected_shreds();
DROP FUNCTION IF EXISTS family_submission_shred(uuid, uuid);
DROP TABLE IF EXISTS family_submission;
DROP FUNCTION IF EXISTS family_submission_guard();
DROP TYPE IF EXISTS family_submission_decision;
DROP TYPE IF EXISTS family_submission_kind;
