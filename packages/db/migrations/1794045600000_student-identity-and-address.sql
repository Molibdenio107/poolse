-- Up Migration
--
-- POOLSE-131 — a student's record holds their address and identity (Rui,
-- 30-10-2026): morada, localidade, código postal, filiação, estado civil,
-- profissão, habilitações, naturalidade, nacionalidade and nº de utente. All
-- optional; the student's own, never a guardian's. The FPN's Anexo 2 and the
-- boletim de sócio (POOLSE-132, -134) fill from these, so they are typed once.
--
-- Identity, so they go with the student's identity: cleared on anonymisation
-- by the trigger that already clears the FPN licence (`apply_retention()` sets
-- `anonymised_at` 5 years after the student leaves), and named without their
-- values in the change log. The SNS number is health-adjacent as well, and the
-- API shows it to owner and admin only.

CREATE TYPE marital_status AS ENUM ('single', 'married', 'civil_union', 'divorced', 'widowed');

ALTER TABLE student
  ADD COLUMN address_line    text,
  ADD COLUMN locality        text,
  ADD COLUMN postal_code     text,
  ADD COLUMN parent_one_name text,
  ADD COLUMN parent_two_name text,
  ADD COLUMN marital_status  marital_status,
  ADD COLUMN profession      text,
  ADD COLUMN education       text,
  ADD COLUMN birthplace      text,
  ADD COLUMN nationality     text,
  ADD COLUMN sns_number      text;

ALTER TABLE student
  ADD CONSTRAINT student_postal_code_shape CHECK (postal_code IS NULL OR postal_code ~ '^\d{4}-\d{3}$'),
  ADD CONSTRAINT student_nationality_shape CHECK (nationality IS NULL OR nationality ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT student_sns_number_shape  CHECK (sns_number IS NULL OR sns_number ~ '^\d{9}$'),
  ADD CONSTRAINT student_identity_text_not_blank CHECK (
        coalesce(btrim(address_line), 'x') <> '' AND coalesce(btrim(locality), 'x') <> ''
    AND coalesce(btrim(parent_one_name), 'x') <> '' AND coalesce(btrim(parent_two_name), 'x') <> ''
    AND coalesce(btrim(profession), 'x') <> '' AND coalesce(btrim(education), 'x') <> ''
    AND coalesce(btrim(birthplace), 'x') <> '');

COMMENT ON COLUMN student.nationality IS 'ISO 3166-1 alpha-2; the name is the reader''s language (Intl.DisplayNames).';
COMMENT ON COLUMN student.sns_number IS 'Nº de utente do SNS. Owner and admin only, by the API.';
COMMENT ON COLUMN student.parent_one_name IS 'Filiação as printed on a form ("filho/a de"): free text, not a guardian link.';

-- Anonymising clears the identity this ticket adds, beside the FPN licence.
CREATE OR REPLACE FUNCTION student_anonymised_clears_licence() RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.federation_licence := NULL;
  -- POOLSE-131: the student's address and identity.
  NEW.address_line := NULL;
  NEW.locality := NULL;
  NEW.postal_code := NULL;
  NEW.parent_one_name := NULL;
  NEW.parent_two_name := NULL;
  NEW.marital_status := NULL;
  NEW.profession := NULL;
  NEW.education := NULL;
  NEW.birthplace := NULL;
  NEW.nationality := NULL;
  NEW.sns_number := NULL;
  RETURN NEW;
END;
$function$;

-- Down Migration

CREATE OR REPLACE FUNCTION student_anonymised_clears_licence() RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.federation_licence := NULL;
  RETURN NEW;
END;
$function$;

ALTER TABLE student
  DROP CONSTRAINT student_identity_text_not_blank,
  DROP CONSTRAINT student_sns_number_shape,
  DROP CONSTRAINT student_nationality_shape,
  DROP CONSTRAINT student_postal_code_shape,
  DROP COLUMN sns_number,
  DROP COLUMN nationality,
  DROP COLUMN birthplace,
  DROP COLUMN education,
  DROP COLUMN profession,
  DROP COLUMN marital_status,
  DROP COLUMN parent_two_name,
  DROP COLUMN parent_one_name,
  DROP COLUMN postal_code,
  DROP COLUMN locality,
  DROP COLUMN address_line;

DROP TYPE marital_status;
