-- Up Migration
--
-- A fee line that is charged once, and therefore names no periodicity.
--
-- `student_fee.fee_period_id` has been NOT NULL since the price list was built,
-- and rightly: a mensalidade and a quota are charged *every* something, and the
-- period is how the line knows what one occurrence is worth and when the next
-- falls due. An inscrição is not charged every anything — it is paid once, for a
-- season — and a seguro is bought once for the season it covers.
--
-- Forcing one to name a period would make the arithmetic wrong rather than
-- merely redundant: the total is `amount × months`, so a €12,00 seguro filed
-- against an "Anual" period reads as €144,00 on the student's page. The honest
-- shape is a line with no period at all, where `amount_cents` is the whole
-- amount and there is exactly one occurrence, on `starts_on`.
--
-- **Only the two season kinds may leave it out.** A mensalidade or a quota with
-- no periodicity is a line nothing knows when to ask for, and every row that
-- exists today has one, so the CHECK costs nothing and closes the shape.

ALTER TABLE student_fee ALTER COLUMN fee_period_id DROP NOT NULL;

ALTER TABLE student_fee
  ADD CONSTRAINT student_fee_period_matches_kind CHECK (
    fee_period_id IS NOT NULL OR kind IN ('inscricao', 'seguro')
  );

COMMENT ON COLUMN student_fee.fee_period_id IS
  'The periodicity this line is charged on. Null on an inscricao or a seguro '
  'that is charged once: amount_cents is then the whole amount and the line has '
  'exactly one occurrence, on starts_on.';

-- Down Migration
--
-- The lines that used the shape cannot be expressed without it, so they go —
-- the same reasoning as the kinds themselves. Nothing that predates this
-- migration is touched, because every row it left behind names a period.

ALTER TABLE student_fee DROP CONSTRAINT IF EXISTS student_fee_period_matches_kind;

DELETE FROM student_fee_payment sfp
 USING student_fee sf
 WHERE sf.id = sfp.student_fee_id AND sf.fee_period_id IS NULL;
DELETE FROM student_fee WHERE fee_period_id IS NULL;

ALTER TABLE student_fee ALTER COLUMN fee_period_id SET NOT NULL;
