-- Up Migration
--
-- A student's ID number may be on file without its type (Rui, 01-11-2026): the
-- record's *Geral* tab asks for the number only, as information, and it is
-- stored as typed. The type — and, for a Cartão de Cidadão, the check of the
-- whole card number — belongs to *Documentos*, which the FPN's declaration
-- prints from. A type still needs a number: "Cartão de Cidadão" with no
-- number says nothing.

ALTER TABLE student DROP CONSTRAINT student_id_document_both;
ALTER TABLE student ADD CONSTRAINT student_id_document_type_needs_number CHECK (
  id_document_type IS NULL OR id_document_number_encrypted IS NOT NULL);

-- Down Migration
--
-- A number with no type is given back its old partner: `other`, never a guess
-- at a Cartão de Cidadão.

UPDATE student SET id_document_type = 'other'
 WHERE id_document_type IS NULL AND id_document_number_encrypted IS NOT NULL;
ALTER TABLE student DROP CONSTRAINT student_id_document_type_needs_number;
ALTER TABLE student ADD CONSTRAINT student_id_document_both CHECK (
  (id_document_type IS NULL) = (id_document_number_encrypted IS NULL));
