-- Up Migration
--
-- A tariff for a meter with no bill — roadmap slice 5.3, second half.
--
-- **Why this exists.** Cost for a *billed* meter is a fact: `energy_invoice`
-- carries what EDP charged, and the meter page divides it out. Every other
-- meter — the heat pump, the AQS, the bomba, every sub-meter behind the club's
-- one ponto de entrega — has kWh and nothing else, because nobody sends a sub-
-- meter a fatura. This is the rate a club types so those kWh become euros.
--
-- **The figure it produces is an estimate, and the schema says so before any
-- screen does.** `provenance` may be `contracted`, `estimated` or `assumed` and
-- may never be `actual`: a euro that actually happened is a document, and this
-- table is not one (docs/financials.md §2). Everything derived from a row here
-- is therefore `estimated` at best, which is exactly the example that section
-- uses. It must never be summed into an unlabelled total beside a billed euro,
-- and keeping the two apart is the one rule this slice can break silently.
--
-- **`unit_price` is `numeric(12,6)`, not cents.** €0.1548/kWh in integer cents
-- is €0.15 — a 3% error in the module whose entire purpose is cost accuracy.
-- The stored *amounts* elsewhere in this schema stay integer minor units; a
-- unit price is the documented exception (CLAUDE.md, docs/financials.md §4).
--
-- **It is gross, and there is no `vat_rate` here.** The rule that an amount is
-- gross with the rate that is already inside it exists so a *document* can be
-- issued from the figure; nothing is issued from this one, and the number a
-- club can actually lay hands on is the all-in €/kWh printed on its own last
-- bill — which is what the meter page already shows for a billed meter, so the
-- form can point at it. A rate column with no reader would be the third thing
-- in §10's list of provenance columns nothing consults. Add it the day
-- something invoices from this, and not before.
--
-- **Effective-dated, one live rate at a time**, the same shape as
-- `staff_compensation` and for the same reason: "what did the pump cost us in
-- March" is only answerable if March knows its own rate. `effective_to` is the
-- LAST DAY at that rate, inclusive, so the exclusion constraint ranges over
-- `effective_to + 1` — a bare `daterange(from, to)` is half-open at the top and
-- would admit a second rate starting on the closing day.
--
-- **No standing charge, deliberately.** A potência contratada and a taxa
-- DGEG are billed once for the whole ponto de entrega; charging one again on
-- each sub-meter behind it would count the same euro three times. The standing
-- part of the cost lives on the site's bill, where it happened.

CREATE TABLE energy_tariff (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),

  -- The dial this rate prices. Per meter rather than per site: a club on two
  -- contracts, or one whose bomba de calor sits behind a different CPE, has two
  -- answers and no way to say so with one shared rate. A club with one rate
  -- types it on each meter it wants costed, which is the cheaper mistake —
  -- pointing several meters at one shared row is a migration; splitting a
  -- shared row that turned out to mean two things is a guess about history.
  meter_id        uuid NOT NULL,

  /*
   * What one unit costs, gross, in the meter's own `unit` — €/kWh for
   * electricity, €/m³ for a gas meter. Six decimal places because a tariff is
   * quoted in fractions of a cent and rounding it to the cent is a 3% error.
   */
  unit_price      numeric(12,6) NOT NULL,

  /*
   * The optimistic and pessimistic bounds of a rate that is a guess, either one
   * standing alone. Nothing reads them yet — stored from day one because they
   * are the input any later scenario needs and adding them afterwards means
   * touching every money table (docs/financials.md §3).
   */
  unit_price_low  numeric(12,6),
  unit_price_high numeric(12,6),

  -- EUR today, and the column exists because the currency belongs to where the
  -- club is rather than to this row. The CHECK is a guard, not a prediction —
  -- the same one `staff_compensation` carries, removed by one ALTER on the day
  -- a club outside the euro area signs up.
  currency        char(3) NOT NULL DEFAULT 'EUR',

  /*
   * Where the figure came from. Never `actual`: a euro that happened is a
   * fatura, and a fatura is `energy_invoice`. A rate copied off a contract is
   * `contracted`, a rate worked back from last year's bills is `estimated`, and
   * a rate somebody guessed is `assumed` — and whichever it is, the *cost*
   * derived from it is an estimate, because the kWh it multiplies were metered
   * and the euros were not.
   */
  provenance      money_provenance NOT NULL DEFAULT 'contracted',

  effective_from  date NOT NULL,
  -- The LAST DAY at this rate, inclusive — what an operator means by "até 31 de
  -- Outubro" — and null while it is the live one.
  effective_to    date,

  note            text,

  -- Who set it. Not nullable, as on every money table here: a rate with no
  -- author is not a record.
  created_by_membership_id uuid NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, meter_id)
    REFERENCES energy_meter (organization_id, id),
  FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES membership (organization_id, id),

  -- A zero rate is not "free", it is "not set" — and "not set" is the absence
  -- of a row, which is what makes a month with no tariff a dash rather than a
  -- nought. Same reading as every null ceiling in this schema.
  CONSTRAINT energy_tariff_price_positive
    CHECK (unit_price > 0),
  CONSTRAINT energy_tariff_range_ordered CHECK (
    (unit_price_low  IS NULL OR unit_price_low  > 0)
    AND (unit_price_high IS NULL OR unit_price_high > 0)
    AND (unit_price_low  IS NULL OR unit_price_low  <= unit_price)
    AND (unit_price_high IS NULL OR unit_price_high >= unit_price)
  ),
  CONSTRAINT energy_tariff_currency_eur
    CHECK (currency = 'EUR'),
  CONSTRAINT energy_tariff_never_actual
    CHECK (provenance <> 'actual'),
  CONSTRAINT energy_tariff_dates_ordered
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT energy_tariff_note_not_blank
    CHECK (note IS NULL OR btrim(note) <> '')
);

COMMENT ON TABLE energy_tariff IS
  'What one unit off this meter costs, effective-dated. For a meter with no fatura — cost for a billed meter is a fact from energy_invoice. One live rate per meter, by energy_tariff_no_overlap.';

COMMENT ON COLUMN energy_tariff.unit_price IS
  'Gross price of one unit, in the meter''s own unit. numeric(12,6), never cents: EUR 0.1548/kWh rounded to the cent is a 3% error.';

COMMENT ON COLUMN energy_tariff.provenance IS
  'Where the rate came from — docs/financials.md §2. Never actual: a euro that happened is a fatura. The cost derived from it is estimated whichever this is.';

COMMENT ON COLUMN energy_tariff.effective_to IS
  'The last day at this rate, inclusive. Null while it is the live one.';

COMMENT ON COLUMN energy_tariff.archived_at IS
  'Soft delete. Archiving the live rate leaves the meter with no live rate — the previous one stays closed and does not reopen.';

/*
 * One live rate per meter at a time.
 *
 * `btree_gist` supplies the uuid equality; earlier migrations already create it
 * and this one creates it again, because a migration that depends on another
 * migration's extension fails on a fresh database the day the order changes.
 *
 * The `+ 1` is the whole point — see `staff_compensation_no_overlap`, which this
 * is deliberately a copy of. Archived rows are outside it, as every partial
 * constraint on a soft-deletable table here is.
 */
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE energy_tariff
  ADD CONSTRAINT energy_tariff_no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    meter_id WITH =,
    daterange(effective_from, coalesce(effective_to + 1, 'infinity'::date), '[)') WITH &&
  ) WHERE (archived_at IS NULL);

-- The read every screen makes: this meter's rates, newest first — and the read
-- the costing does once per reading, looking for the one live on its date.
CREATE INDEX energy_tariff_meter_idx
  ON energy_tariff (organization_id, meter_id, effective_from DESC)
  WHERE archived_at IS NULL;

CREATE TRIGGER energy_tariff_updated_at
  BEFORE UPDATE ON energy_tariff
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE energy_tariff ENABLE ROW LEVEL SECURITY;

CREATE POLICY energy_tariff_tenant ON energy_tariff
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON energy_tariff TO poolse_app;

-- Down Migration

DROP POLICY IF EXISTS energy_tariff_tenant ON energy_tariff;
DROP TABLE IF EXISTS energy_tariff;
