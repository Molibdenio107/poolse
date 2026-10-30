-- Up Migration
--
-- The ID document photo has no season, as the boletim has none. Its own
-- migration because a new enum value cannot be used in the transaction that
-- added it.

ALTER TABLE student_document DROP CONSTRAINT student_document_season_kind;
ALTER TABLE student_document ADD CONSTRAINT student_document_season_kind CHECK (
  (kind IN ('socio_form', 'id_document')) = (season_id IS NULL));

-- Down Migration

ALTER TABLE student_document DROP CONSTRAINT student_document_season_kind;
ALTER TABLE student_document ADD CONSTRAINT student_document_season_kind CHECK (
  (kind = 'socio_form') = (season_id IS NULL));
