-- Up Migration

-- A membership number cannot be repeated (Rui, 07-11-2026). The index already
-- refused an exact repeat among live students; "S-1" and "s-1", or a stray space,
-- still read as two numbers on a boletim while being one to anybody looking.
-- Same name, so the bin's refusal (`archive/restorable.ts`) keeps reading it.
-- Partial as before: an archived student's number stays free for the next member.

DROP INDEX student_socio_number_uq;

CREATE UNIQUE INDEX student_socio_number_uq
  ON student (organization_id, lower(btrim(socio_number)))
  WHERE archived_at IS NULL AND socio_number IS NOT NULL;

-- Down Migration

DROP INDEX student_socio_number_uq;

CREATE UNIQUE INDEX student_socio_number_uq
  ON student (organization_id, socio_number)
  WHERE archived_at IS NULL AND socio_number IS NOT NULL;
