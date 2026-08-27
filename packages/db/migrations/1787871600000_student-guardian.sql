-- Up Migration
--
-- The encarregado de educação, on the student's own record — POOLSE-04.
--
-- Fields rather than a linked account, which is the ticket's own decision and
-- the right one for this iteration: a club enrolling a seven-year-old needs
-- somewhere to write their mother's phone number *now*, not an invitation flow
-- and an acceptance before the record can be saved.
--
-- **Nothing here is enforced by age.** The block appears when a student is under
-- eighteen and the interface requires a name, a relationship and one contact
-- before saving a minor — but the database does not, and that is deliberate.
-- Age moves on its own: a student who was fifteen when the row was written turns
-- eighteen without anybody touching it, and a CHECK constraint reading
-- `current_date` is not even possible, let alone desirable. A constraint that
-- became false while nobody was looking would block every later edit to a record
-- that was perfectly valid when it was made.
--
-- What the schema does enforce is that the fields are sane in themselves: no
-- blank strings pretending to be values.
--
-- **Guardian data is never deleted when a student turns eighteen** — criterion 5.
-- There is no trigger and no job that clears it. The block collapses in the
-- interface and the data stays, because "who was your guardian" remains true
-- about the years it covered.

ALTER TABLE student
  ADD COLUMN guardian_name         text,
  ADD COLUMN guardian_relationship text,
  ADD COLUMN guardian_phone        text,
  ADD COLUMN guardian_email        citext,
  ADD COLUMN guardian_tax_number   text,
  ADD COLUMN guardian_address      text;

COMMENT ON COLUMN student.guardian_name IS
  'The encarregado de educação, as fields on the student — POOLSE-04. Not a linked account.';
COMMENT ON COLUMN student.guardian_relationship IS
  'Free text: "Mãe", "Avô", "Tutor legal". A closed list would be wrong for somebody.';
COMMENT ON COLUMN student.guardian_tax_number IS
  'NIF, optional. Text rather than a number — it can carry a leading zero and is never arithmetic.';

/*
 * Blank is not a value, and an untouched form field sends one.
 *
 * Written as one constraint over all six rather than six constraints, because
 * they are one rule and a later column added to the group should join it rather
 * than be forgotten.
 */
ALTER TABLE student
  ADD CONSTRAINT student_guardian_fields_not_blank
  CHECK (
    (guardian_name IS NULL OR btrim(guardian_name) <> '')
    AND (guardian_relationship IS NULL OR btrim(guardian_relationship) <> '')
    AND (guardian_phone IS NULL OR btrim(guardian_phone) <> '')
    AND (guardian_tax_number IS NULL OR btrim(guardian_tax_number) <> '')
    AND (guardian_address IS NULL OR btrim(guardian_address) <> '')
  );

-- `citext` already ignores case, so this only rejects the shapes that are not
-- addresses at all. Deliberately loose: strict RFC validation refuses addresses
-- that work, and the only test that matters is whether mail arrives.
ALTER TABLE student
  ADD CONSTRAINT student_guardian_email_shape
  CHECK (guardian_email IS NULL OR guardian_email::text ~ '^[^[:space:]@]+@[^[:space:]@.]+\.[^[:space:]@]+$');

-- Finding every child of one guardian — the same phone number across siblings is
-- the common case, and it is how a club answers "who else is in this family".
CREATE INDEX student_guardian_email_idx
  ON student (organization_id, guardian_email) WHERE guardian_email IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS student_guardian_email_idx;

ALTER TABLE student DROP CONSTRAINT IF EXISTS student_guardian_email_shape;
ALTER TABLE student DROP CONSTRAINT IF EXISTS student_guardian_fields_not_blank;

ALTER TABLE student
  DROP COLUMN IF EXISTS guardian_address,
  DROP COLUMN IF EXISTS guardian_tax_number,
  DROP COLUMN IF EXISTS guardian_email,
  DROP COLUMN IF EXISTS guardian_phone,
  DROP COLUMN IF EXISTS guardian_relationship,
  DROP COLUMN IF EXISTS guardian_name;
