-- Up Migration

-- POOLSE-179 slice 2, part 1 — a student's ID document photograph is sealed at
-- rest, as a staff member's has been since POOLSE-149. Until now it was filed
-- as a plain `student_document`, so the bucket held a readable copy of a
-- child's Cartão de Cidadão. This closes that whether or not families ever
-- upload one.
--
-- **Its own purpose, `student_id_document`.** The signed FPN declaration and the
-- boletim stay `student_document`: sealing every kind would make this migration
-- re-encrypt files SQL cannot read. `stored_file_sealed` now names the new
-- purpose, compared as text because a value added by `ALTER TYPE … ADD VALUE`
-- cannot be used in the transaction that added it.
--
-- **The database refuses an ID photo it could read.** A `student_document` of
-- kind `id_document` must point at a sealed `student_id_document` file
-- (`student_document_id_sealed`). Rows filed before this migration keep their
-- plain file until `apps/api/scripts/reseal-student-id-documents.ts` re-seals
-- them: the check runs on insert and on a change of `file_id`, never on a row
-- nobody touched.
--
-- **A photograph let go is shredded.** Replaced by a newer copy, or its student
-- anonymised by retention (five years after leaving), its data key is
-- destroyed, so the bucket's bytes can never be opened again. The definer
-- helper is `staff_id_document_shred`'s shape: one club, only destroys.

ALTER TYPE file_purpose ADD VALUE IF NOT EXISTS 'student_id_document';

ALTER TABLE stored_file
  DROP CONSTRAINT stored_file_sealed,
  ADD CONSTRAINT stored_file_sealed CHECK (
    CASE WHEN purpose::text IN ('medical_certificate', 'incident_attachment', 'staff_id_document',
                                'student_id_document')
         THEN (wrapped_key IS NOT NULL) <> (key_shredded_at IS NOT NULL)
         ELSE wrapped_key IS NULL AND key_shredded_at IS NULL
    END
  );

CREATE FUNCTION student_document_id_sealed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind::text = 'id_document' AND NOT EXISTS (
       SELECT 1 FROM stored_file f
        WHERE f.organization_id = NEW.organization_id
          AND f.id = NEW.file_id
          AND f.purpose::text = 'student_id_document'
  ) THEN
    RAISE EXCEPTION 'an ID document photograph must be a sealed student_id_document file'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind::text <> 'id_document' AND EXISTS (
       SELECT 1 FROM stored_file f
        WHERE f.organization_id = NEW.organization_id
          AND f.id = NEW.file_id
          AND f.purpose::text = 'student_id_document'
  ) THEN
    RAISE EXCEPTION 'a student_id_document file is only filed as an ID document'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER student_document_id_sealed
  BEFORE INSERT OR UPDATE OF file_id, kind ON student_document
  FOR EACH ROW EXECUTE FUNCTION student_document_id_sealed();

CREATE FUNCTION student_id_document_shred(p_org uuid, p_file uuid)
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
   WHERE f.organization_id = p_org
     AND f.id = p_file
     AND f.purpose::text = 'student_id_document'
     AND f.key_shredded_at IS NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION student_id_document_shred(uuid, uuid) FROM PUBLIC;
-- The triggers run as whoever made the change — the app, or retention — so the
-- app may run it; it acts on one club only and only destroys.
GRANT EXECUTE ON FUNCTION student_id_document_shred(uuid, uuid) TO poolse_app;

-- A copy closed by a newer one, or moved onto another file by the re-seal.
CREATE FUNCTION student_document_id_shreds() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind::text = 'id_document'
     AND ((OLD.replaced_at IS NULL AND NEW.replaced_at IS NOT NULL)
          OR OLD.file_id IS DISTINCT FROM NEW.file_id) THEN
    PERFORM public.student_id_document_shred(OLD.organization_id, OLD.file_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER student_document_id_shreds
  AFTER UPDATE OF replaced_at, file_id ON student_document
  FOR EACH ROW EXECUTE FUNCTION student_document_id_shreds();

-- Retention's identity erasure (`apply_retention()`, five years) sets
-- `anonymised_at`; every ID photograph the student ever had goes with it.
CREATE FUNCTION student_anonymised_id_shreds() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_file uuid;
BEGIN
  FOR v_file IN
    SELECT d.file_id FROM student_document d
     WHERE d.organization_id = NEW.organization_id
       AND d.student_id = NEW.id
       AND d.kind::text = 'id_document'
  LOOP
    PERFORM public.student_id_document_shred(NEW.organization_id, v_file);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE TRIGGER student_anonymised_id_shreds
  AFTER UPDATE OF anonymised_at ON student
  FOR EACH ROW
  WHEN (OLD.anonymised_at IS NULL AND NEW.anonymised_at IS NOT NULL)
  EXECUTE FUNCTION student_anonymised_id_shreds();

-- Down Migration

DROP TRIGGER IF EXISTS student_anonymised_id_shreds ON student;
DROP FUNCTION IF EXISTS student_anonymised_id_shreds();
DROP TRIGGER IF EXISTS student_document_id_shreds ON student_document;
DROP FUNCTION IF EXISTS student_document_id_shreds();
DROP FUNCTION IF EXISTS student_id_document_shred(uuid, uuid);
DROP TRIGGER IF EXISTS student_document_id_sealed ON student_document;
DROP FUNCTION IF EXISTS student_document_id_sealed();

-- A sealed student_id_document file left behind makes the narrower CHECK refuse
-- this down, so a rollback never turns a sealed file into one the CHECK calls plain.
ALTER TABLE stored_file
  DROP CONSTRAINT stored_file_sealed,
  ADD CONSTRAINT stored_file_sealed CHECK (
    CASE WHEN purpose::text IN ('medical_certificate', 'incident_attachment', 'staff_id_document')
         THEN (wrapped_key IS NOT NULL) <> (key_shredded_at IS NOT NULL)
         ELSE wrapped_key IS NULL AND key_shredded_at IS NULL
    END
  );

-- The enum value stays: Postgres cannot drop one, and nothing names it now.
