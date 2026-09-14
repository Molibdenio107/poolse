-- Up Migration
--
-- `manual_discount_*` becomes `line_discount_*` — Rui's call, 14 September 2026.
--
-- The columns were named in POOLSE-42, when a discount on a fee line could only
-- have been typed by a person. Round 19 gave a fee category a value and made it
-- the author of most of them, so the word stopped being true: a line reading
-- `manual_discount_percent = 20` may well be twenty per cent nobody typed.
--
-- **A name is worth a migration when it makes somebody believe something false.**
-- This one does: the obvious reading is "a person decided this", and code written
-- on that reading would be wrong for every concession in the product. The wart
-- was noted in `docs/data-model.md` and proposed rather than done; this is the
-- yes.
--
-- **Nothing moves and nothing is recomputed.** `RENAME COLUMN` rewrites no rows —
-- every agreed figure stays exactly the figure it was agreed at, which matters
-- more here than anywhere else in the schema.
--
-- `fee_category_id` beside them is what says which of the two authors it was: set
-- means the category, null with a figure present means a person and
-- `discount_reason` says why.

ALTER TABLE student_fee RENAME COLUMN manual_discount_percent TO line_discount_percent;
ALTER TABLE student_fee RENAME COLUMN manual_discount_cents   TO line_discount_cents;

COMMENT ON COLUMN student_fee.line_discount_percent IS
  'What comes off this line, as a percentage. Authored by the line''s fee '
  'category where fee_category_id is set, and by a person otherwise — in which '
  'case discount_reason says why. Never both, by CHECK.';
COMMENT ON COLUMN student_fee.line_discount_cents IS
  'What comes off this line, as a fixed amount. Never both this and the '
  'percentage. Floors at zero on a line smaller than it.';

/*
 * The constraints carried the old word in their names.
 *
 * Renamed rather than left: a refusal that says `student_fee_one_manual_discount`
 * sends whoever reads it looking for a manual discount, and the whole point of
 * this migration is that they would not find one.
 */
ALTER TABLE student_fee
  RENAME CONSTRAINT student_fee_manual_discount_sane TO student_fee_line_discount_sane;
ALTER TABLE student_fee
  RENAME CONSTRAINT student_fee_manual_discount_cents_sane
    TO student_fee_line_discount_cents_sane;
ALTER TABLE student_fee
  RENAME CONSTRAINT student_fee_one_manual_discount TO student_fee_one_line_discount;

/*
 * `fee_payable_cents`'s parameters said it too.
 *
 * Replaced in full rather than left with stale names: the body is four lines and
 * a caller reading `p_manual_discount_percent` in an error or an EXPLAIN would be
 * told the same untruth the columns used to tell. The arithmetic is identical,
 * character for character — this migration changes no total anywhere.
 *
 * **DROP and CREATE, not CREATE OR REPLACE**: Postgres refuses to rename an input
 * parameter in place ("cannot change name of input parameter"). Safe here because
 * nothing depends on this function structurally — no generated column, no index,
 * no view — it is only ever called from a query.
 */
DROP FUNCTION fee_payable_cents(integer, smallint, numeric, numeric, integer);

CREATE FUNCTION fee_payable_cents(
  p_amount_cents          integer,
  p_months                smallint,
  p_discount_percent      numeric,
  p_line_discount_percent numeric,
  p_line_discount_cents   integer
) RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_line_discount_percent IS NOT NULL THEN
      round(fee_total_cents(p_amount_cents, p_months, p_discount_percent)::numeric
            * (1 - p_line_discount_percent / 100))::integer
    WHEN p_line_discount_cents IS NOT NULL THEN
      greatest(fee_total_cents(p_amount_cents, p_months, p_discount_percent)
               - p_line_discount_cents, 0)
    ELSE fee_total_cents(p_amount_cents, p_months, p_discount_percent)
  END;
$$;

COMMENT ON FUNCTION fee_payable_cents(integer, smallint, numeric, numeric, integer) IS
  'The period total with the line''s own discount applied — whoever authored it, '
  'a fee category or a person. Wraps fee_total_cents rather than restating it.';

-- Down Migration
--
-- The word goes back. Nothing here recomputes anything either.

DROP FUNCTION fee_payable_cents(integer, smallint, numeric, numeric, integer);

CREATE FUNCTION fee_payable_cents(
  p_amount_cents            integer,
  p_months                  smallint,
  p_discount_percent        numeric,
  p_manual_discount_percent numeric,
  p_manual_discount_cents   integer
) RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_manual_discount_percent IS NOT NULL THEN
      round(fee_total_cents(p_amount_cents, p_months, p_discount_percent)::numeric
            * (1 - p_manual_discount_percent / 100))::integer
    WHEN p_manual_discount_cents IS NOT NULL THEN
      greatest(fee_total_cents(p_amount_cents, p_months, p_discount_percent)
               - p_manual_discount_cents, 0)
    ELSE fee_total_cents(p_amount_cents, p_months, p_discount_percent)
  END;
$$;

ALTER TABLE student_fee
  RENAME CONSTRAINT student_fee_one_line_discount TO student_fee_one_manual_discount;
ALTER TABLE student_fee
  RENAME CONSTRAINT student_fee_line_discount_cents_sane
    TO student_fee_manual_discount_cents_sane;
ALTER TABLE student_fee
  RENAME CONSTRAINT student_fee_line_discount_sane TO student_fee_manual_discount_sane;

ALTER TABLE student_fee RENAME COLUMN line_discount_cents   TO manual_discount_cents;
ALTER TABLE student_fee RENAME COLUMN line_discount_percent TO manual_discount_percent;
