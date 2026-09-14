-- Up Migration
--
-- A fee category authors a discount — round 19.
--
-- POOLSE-23 built the category as a *label* and said so twice: "a reference,
-- never a percentage", with the pricing engine explicitly out of scope. A year
-- of using it settled the question the other way. Nothing read the category, so
-- a club giving seniors 20 % off typed −20 and the word "sénior" into
-- `student_fee.manual_discount_percent` and `discount_reason` once per family,
-- while the "Sénior" sitting on their turma changed nothing at all. A concession
-- with forty authors is a concession nobody can report on or change in one
-- place — which is the failure the original comment was written to prevent.
--
-- So the category becomes what it was standing in for: **the author of the
-- discount.** `docs/decisions.md`, 2026-09-14.
--
-- Three rules, all of which are already how the rest of this schema works.
--
-- **The value is snapshotted onto the line, never read back through the
-- reference.** A line recomputed from the category would rewrite a family's
-- agreed price the moment somebody corrected the percentage — the same failure
-- `amount_cents` is a snapshot to prevent (POOLSE-24 AC5). So the *figure* goes
-- into the columns that already hold a line's own discount, and the category id
-- records who authored it.
--
-- **Never stack.** One discount per line. The category fills it or a person
-- typed it, and the two cannot both be true: `fee_category_id` set means the
-- category authored the figure, null with a discount present means a person did
-- and `discount_reason` says why.
--
-- **All four kinds.** Nothing here restricts a category to a mensalidade. A
-- senior concession on the quota and a waived inscrição for staff are both
-- ordinary, and a rule saying otherwise would have no home in a schema that
-- treats the four as one price list.

-- ---------------------------------------------------------------------------
-- What a category is worth
-- ---------------------------------------------------------------------------

ALTER TABLE fee_category
  ADD COLUMN discount_percent numeric(5,2),
  ADD COLUMN discount_cents   integer;

/*
 * Both nullable, and a category with neither is still perfectly good.
 *
 * That is the "stay a label" case and it must keep working: a club may want
 * "Funcionário" purely to count them, and every category that exists today has
 * no value by construction. Null is *not* zero — a category worth 0 % and a
 * category worth nothing-yet read identically on a screen, and only one of them
 * is a decision somebody took.
 */
ALTER TABLE fee_category
  ADD CONSTRAINT fee_category_discount_percent_sane
    CHECK (discount_percent IS NULL OR discount_percent BETWEEN 0 AND 100),
  ADD CONSTRAINT fee_category_discount_cents_sane
    CHECK (discount_cents IS NULL OR discount_cents >= 0),
  -- One kind or the other, exactly as `student_fee` says it. Both would make the
  -- order they are applied in matter, and nobody would agree on it.
  ADD CONSTRAINT fee_category_one_discount
    CHECK (discount_percent IS NULL OR discount_cents IS NULL);

COMMENT ON COLUMN fee_category.discount_percent IS
  'What this category takes off, as a percentage. Null means the category carries '
  'no value — a label, which is not the same as 0 %.';
COMMENT ON COLUMN fee_category.discount_cents IS
  'What this category takes off, as a fixed amount. Never both this and the '
  'percentage. Floors at zero on a line smaller than it.';

COMMENT ON TABLE fee_category IS
  'Why one person pays a different price from the next — senior, student, staff. '
  'Carries the discount it is worth; a line snapshots that figure rather than '
  'reading it back, so correcting a category never rewrites an agreed price.';

-- ---------------------------------------------------------------------------
-- Who authored the discount on a line
-- ---------------------------------------------------------------------------

ALTER TABLE student_fee ADD COLUMN fee_category_id uuid;

-- Composite, like every reference in this schema: a bare `id` reference would
-- let a line in one club name another club's category, and RLS would not catch
-- it because both rows pass their own policy.
ALTER TABLE student_fee
  ADD CONSTRAINT student_fee_fee_category_fkey
    FOREIGN KEY (organization_id, fee_category_id)
      REFERENCES fee_category (organization_id, id);

COMMENT ON COLUMN student_fee.fee_category_id IS
  'The category that authored this line''s discount, at the moment it was agreed. '
  'Set means the figure in manual_discount_* came from that category; null with a '
  'discount present means a person typed it and discount_reason says why.';

/*
 * A discount nobody explained is still a discount nobody can defend — but the
 * category *is* the explanation.
 *
 * The original CHECK demanded free text for every discount, which was right
 * while typing was the only way to make one. A line that says "Sénior" needs no
 * sentence beside it; a line that says nothing still does.
 */
ALTER TABLE student_fee DROP CONSTRAINT student_fee_discount_needs_reason;

ALTER TABLE student_fee
  ADD CONSTRAINT student_fee_discount_needs_reason CHECK (
    (manual_discount_percent IS NULL AND manual_discount_cents IS NULL)
    OR fee_category_id IS NOT NULL
    OR (discount_reason IS NOT NULL AND btrim(discount_reason) <> '')
  );

/*
 * Deliberately **not** an index on (organization_id, fee_category_id).
 *
 * `enrollment` has one because the archive check counts live enrolments per
 * category on every read of the list. Nothing counts lines: a category is
 * archivable while old lines still name it, because those lines are history and
 * an archived category is filed away rather than deleted — the name still
 * resolves for anybody reading what a family was charged in March.
 */

-- ---------------------------------------------------------------------------
-- What the document says
-- ---------------------------------------------------------------------------

ALTER TABLE invoice_line ADD COLUMN fee_category_name text;

/*
 * The club's own word, snapshotted — the standing rule for this table.
 *
 * "Sénior" is a name a club invented, so it belongs here beside the level's and
 * the season's; it is not an enum and no catalogue can translate it. Snapshotted
 * because a category renamed next season must not rewrite what a family was
 * charged this one, and because the line's amount is already net of the
 * discount: without the word, a document says 28,00 where the price list says
 * 35,00 and nothing on it explains the difference.
 */
COMMENT ON COLUMN invoice_line.fee_category_name IS
  'The concession this line was charged under, in the club''s own words. Null '
  'where none applied. A snapshot, like every other name on a document.';

-- Down Migration
--
-- The values go and the lines lose the record of who authored their discount;
-- the figures themselves stay, in the columns they were always written to, and
-- the original CHECK comes back to demand a reason for every one of them. A line
-- a category authored therefore needs a reason before this can be reversed —
-- which is exactly what the constraint means, so the reversal fills one in
-- rather than dropping the discount and changing what somebody agreed to pay.

UPDATE student_fee
   SET discount_reason = coalesce(
         nullif(btrim(discount_reason), ''),
         (SELECT c.name FROM fee_category c WHERE c.id = student_fee.fee_category_id))
 WHERE fee_category_id IS NOT NULL
   AND (manual_discount_percent IS NOT NULL OR manual_discount_cents IS NOT NULL);

ALTER TABLE invoice_line DROP COLUMN IF EXISTS fee_category_name;

ALTER TABLE student_fee DROP CONSTRAINT IF EXISTS student_fee_discount_needs_reason;

ALTER TABLE student_fee
  DROP CONSTRAINT IF EXISTS student_fee_fee_category_fkey,
  DROP COLUMN IF EXISTS fee_category_id;

ALTER TABLE student_fee
  ADD CONSTRAINT student_fee_discount_needs_reason CHECK (
    (manual_discount_percent IS NULL AND manual_discount_cents IS NULL)
    OR (discount_reason IS NOT NULL AND btrim(discount_reason) <> '')
  );

ALTER TABLE fee_category
  DROP CONSTRAINT IF EXISTS fee_category_one_discount,
  DROP CONSTRAINT IF EXISTS fee_category_discount_cents_sane,
  DROP CONSTRAINT IF EXISTS fee_category_discount_percent_sane,
  DROP COLUMN IF EXISTS discount_percent,
  DROP COLUMN IF EXISTS discount_cents;

COMMENT ON TABLE fee_category IS
  'Why one person pays a different price from the next — senior, student, staff. '
  'A reference the pricing engine will consult, never a percentage. POOLSE-23 AC4.';
