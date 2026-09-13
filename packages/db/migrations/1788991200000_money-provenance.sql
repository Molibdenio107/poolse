-- Up Migration
--
-- Where a figure came from — `docs/financials.md`, §2 and §3.
--
-- Poolse will eventually estimate costs and earnings per period and put an agent
-- in front of them. Most of the inputs are optional, by product decision, so the
-- hard problem is never the arithmetic: it is knowing, for any figure on a
-- screen, **where it came from and how much of the picture is missing**. That is
-- a data-model problem, and it is cheap now and a migration per module later.
--
-- **A separate migration from `staff_compensation`'s own**, because that one is
-- applied. The rule in `write-migration` is absolute and worth keeping absolute:
-- a file that has run is history, whatever machines have run it. The ticket asks
-- for one table's worth of columns; what arrives is an ALTER and a shared type.
--
-- **`money_provenance` is created here and used everywhere after.** It is
-- deliberately not named `salary_provenance`: the whole point of the financial
-- rules is that an energy bill, a mensalidade and a wage answer the same question
-- the same way, so the day `fee_plan` gets a provenance column it gets *this*
-- type rather than a second list that drifts.

CREATE TYPE money_provenance AS ENUM ('actual', 'contracted', 'estimated', 'assumed');

COMMENT ON TYPE money_provenance IS
  'Where a monetary figure came from: actual (happened), contracted (a known rate not yet incurred), estimated (derived by a documented model), assumed (a guess). Never sum across these into one unlabelled total — docs/financials.md §2.';

ALTER TABLE staff_compensation
  /*
   * A wage somebody typed in is `contracted`: a known rate, not yet incurred.
   * The default is what makes this migration honest about the rows already
   * there — every one of them was typed by an owner or imported from a club's
   * own spreadsheet, and calling those anything else would be inventing a
   * doubt that does not exist.
   */
  ADD COLUMN provenance money_provenance NOT NULL DEFAULT 'contracted',

  /*
   * The three-point range, stored from day one though nothing reads it yet.
   *
   * `docs/financials.md` §3 is explicit about why: it is the optimistic /
   * likely / pessimistic input any later scenario needs, and adding it once the
   * modules exist means touching every money table in the product. Normally null
   * for contracted pay — a salary is not a guess — and normally present on an
   * `estimated` or `assumed` figure.
   */
  ADD COLUMN amount_low_cents  integer,
  ADD COLUMN amount_high_cents integer,

  /*
   * In order, and only where present.
   *
   * One bound alone is allowed and that is deliberate: "at least €900" is a real
   * thing to know about a cost nobody has pinned down, and requiring both would
   * make somebody invent the other — which is precisely the confident-looking
   * fabrication these columns exist to avoid.
   */
  ADD CONSTRAINT staff_compensation_range_ordered CHECK (
    (amount_low_cents  IS NULL OR amount_low_cents  >= 0)
    AND (amount_high_cents IS NULL OR amount_high_cents >= 0)
    AND (amount_low_cents  IS NULL OR amount_low_cents  <= amount_cents)
    AND (amount_high_cents IS NULL OR amount_high_cents >= amount_cents)
  );

COMMENT ON COLUMN staff_compensation.provenance IS
  'Where this figure came from — docs/financials.md §2. A typed or imported rate is contracted; the roll-up is labelled with the weakest provenance it summed.';

COMMENT ON COLUMN staff_compensation.amount_low_cents IS
  'Optional pessimistic bound for an estimated or assumed figure. Null for a contracted rate, which is not a guess. Never read as zero.';

COMMENT ON COLUMN staff_compensation.amount_high_cents IS
  'Optional optimistic bound. Either bound may stand alone: "at least this much" is worth knowing, and requiring both invites a fabricated other half.';

-- Down Migration

ALTER TABLE staff_compensation
  DROP CONSTRAINT IF EXISTS staff_compensation_range_ordered,
  DROP COLUMN IF EXISTS amount_high_cents,
  DROP COLUMN IF EXISTS amount_low_cents,
  DROP COLUMN IF EXISTS provenance;

DROP TYPE IF EXISTS money_provenance;
