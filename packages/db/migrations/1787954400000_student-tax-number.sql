-- ---------------------------------------------------------------------------
-- A student's own NIF
--
-- Until now only a guardian carried one, because the guardian is who an invoice
-- is addressed to when the swimmer is seven. That is not the only shape a club
-- has: a hidroginástica sénior class, a masters squad and an adult learn-to-swim
-- group are all made of people who pay for themselves, and their number belonged
-- nowhere. It was going into the notes field, which is the worst of both — it is
-- not searchable, not unique, and it is a free-text box the interface explicitly
-- tells operators not to put real data in.
--
-- **No age rule, deliberately.** The obvious reading is "adults only", and it is
-- wrong for Portugal: children have NIFs, and a parent deducting the lessons on
-- their IRS does it against the child's number, so a club's invoice for a
-- seven-year-old often carries one. A CHECK against the club's maioridade would
-- refuse a number that is genuinely on the paperwork — and it would age badly in
-- the way `student_guardian` already warned about, since a row valid when it was
-- written must not become invalid because time passed.
--
-- Unique per organization among the living, like every other identifier here.
-- A NIF is a national identity number: two active students sharing one is a
-- typo, most likely the guardian's number typed into the child's row, and a
-- constraint catches it at the moment it is made rather than during a merge
-- eighteen months later. Partial, per the standing rule — archiving a student
-- and re-enrolling them next season must not collide with a dead row.
--
-- Not validated as a real NIF. Same reasoning as `membership.tax_number`: an
-- operator copying a number off a form should not be stopped by a checksum, and
-- a wrong-but-plausible number is a correction, not a crash.
-- ---------------------------------------------------------------------------

-- Up Migration

ALTER TABLE student
  ADD COLUMN tax_number text;

COMMENT ON COLUMN student.tax_number IS
  'NIF, for a student who is invoiced in their own name — an adult class, or a '
  'child whose lessons a parent deducts against their number. No age rule: '
  'minors have NIFs in Portugal. Never validated as a real number.';

ALTER TABLE student
  ADD CONSTRAINT student_tax_number_not_blank
  CHECK (tax_number IS NULL OR btrim(tax_number) <> '');

CREATE UNIQUE INDEX student_tax_number_uq
  ON student (organization_id, tax_number)
  WHERE archived_at IS NULL AND tax_number IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS student_tax_number_uq;

ALTER TABLE student
  DROP CONSTRAINT IF EXISTS student_tax_number_not_blank;

ALTER TABLE student
  DROP COLUMN IF EXISTS tax_number;
