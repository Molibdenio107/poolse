-- Up Migration
--
-- The photograph of a student's identification document, filed on the record
-- (Rui, 30-10-2026: "the Documents page should also be able to upload the
-- photos already"). A `student_document` of its own kind with no season, the
-- boletim's shape: one current, older ones kept. Its number and dates are read
-- from it (optionally, by the flag-gated reader) into the fields POOLSE-132
-- added, for a person to confirm.

ALTER TYPE student_document_kind ADD VALUE IF NOT EXISTS 'id_document';

-- Down Migration

-- An enum value cannot be dropped; the rows go, the value stays unused.
DELETE FROM student_document WHERE kind::text = 'id_document';
