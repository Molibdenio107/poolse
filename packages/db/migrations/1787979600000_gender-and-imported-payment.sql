-- Up Migration
--
-- Género, and a payment that arrived in a spreadsheet — round 5, second pass.
--
-- **The word is género, so the column is `gender`.** It was `sex` for one
-- session. One vocabulary in the interface and another in the schema is how a
-- maintainer six months from now ends up writing `sex` in a query for a screen
-- that says "género" — the rename is cheap now and never gets cheaper.
--
-- **A club's spreadsheet already says who has paid.** Poolse cannot always turn
-- that into a settled occurrence: a student imported today has no mensalidade
-- yet, and inventing one from a level name would be inventing a price. So the
-- fact is recorded as what it is — "this record was paid up to this month" —
-- and the register reads it for students who have no fee line of their own.
-- Where there *is* a line, the import settles the occurrence properly and this
-- is a second copy of the same answer, which is why the line wins.

ALTER TYPE student_sex RENAME TO student_gender;
ALTER TABLE student RENAME COLUMN sex TO gender;

COMMENT ON COLUMN student.gender IS
  'Optional. Matched against an escalão''s admits_male/admits_female for display '
  'and warnings only — nothing here refuses an enrolment, exactly as the age '
  'range does not.';

ALTER TABLE student ADD COLUMN paid_through_month date;

/*
 * The first day of the last month an import said was paid.
 *
 * A date rather than a boolean because "paid" without a month is the bug this
 * whole ticket removed from `student_fee`: ticked in March it still reads paid
 * in October. Normalised to the first of the month on the way in, so a
 * comparison against `date_trunc('month', current_date)` is the whole rule.
 */
ALTER TABLE student
  ADD CONSTRAINT student_paid_through_is_a_month
  CHECK (paid_through_month IS NULL OR paid_through_month = date_trunc('month', paid_through_month)::date);

COMMENT ON COLUMN student.paid_through_month IS
  'Set by an import that carried a "pago" column. Read only for a student with '
  'no live fee line: a real line and its payments are always the better answer.';

-- Down Migration

ALTER TABLE student DROP CONSTRAINT IF EXISTS student_paid_through_is_a_month;
ALTER TABLE student DROP COLUMN IF EXISTS paid_through_month;

ALTER TABLE student RENAME COLUMN gender TO sex;
ALTER TYPE student_gender RENAME TO student_sex;
