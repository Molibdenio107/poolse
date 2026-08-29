-- Up Migration
--
-- Where the atestado is — round 5 follow-up.
--
-- A medical leave is usually backed by a piece of paper: an atestado médico, a
-- hospital discharge note, a form the federação wants. The club needs to be able
-- to answer "on what basis is this student excused for six weeks", and today the
-- answer lives in somebody's memory.
--
-- **A reference, not a file.** Object storage is still deferred, and a medical
-- certificate is the most sensitive document this product would ever hold — it
-- is not the file to bring storage forward for, and a disabled upload button
-- would leave the question unanswerable in the meantime. A short reference is
-- something a club can record today and act on: "atestado 2026/114", "pasta A,
-- separador Alunos", "enviado por email 12/09". When storage lands, the file
-- attaches beside this and the reference stays as what it always was.
--
-- **Optional, and deliberately so.** The round-5 decision is explicit that a
-- justification is not mandatory per leave. A child who turns up with a wrist in
-- plaster is obviously not swimming, and requiring paperwork before the register
-- can be marked correctly would make the honest path the slow one.
--
-- **Not encrypted, because it is not medical detail.** `student_sensitive` holds
-- diagnoses behind a cipher and an audit trail on every read; this is a filing
-- reference, the same kind of fact as an invoice number. Encrypting it would
-- suggest it may safely carry more than it should, which is exactly the trap
-- `attendance.note` and `student.notes` are commented against. The column
-- comment says so, and the form says so.

ALTER TABLE student_medical_leave
  ADD COLUMN justification_reference text;

COMMENT ON COLUMN student_medical_leave.justification_reference IS
  'Where the atestado is filed — a document number or location. Not a diagnosis, and not encrypted: clinical detail belongs in student_sensitive.';

ALTER TABLE student_medical_leave
  -- An untouched field posts a blank, and a blank is not a reference. Null is
  -- how "there is no paperwork" is written.
  ADD CONSTRAINT student_medical_leave_reference_not_blank
  CHECK (justification_reference IS NULL OR btrim(justification_reference) <> '');

-- Down Migration

ALTER TABLE student_medical_leave
  DROP CONSTRAINT IF EXISTS student_medical_leave_reference_not_blank;

ALTER TABLE student_medical_leave
  DROP COLUMN IF EXISTS justification_reference;
