-- Up Migration
--
-- Gas and water bills, filed like electricity ones (Rui, 12-11-2026).
--
-- A bill already belongs to a meter, and the meter says what it measures, so
-- the club's summary files a gas bill under gas and a water bill under water
-- with no carrier on the bill itself. What a gas or water bill adds:
--
--   volume_m3          the m³ the bill charges (gas off its dial, water off the
--                      utility's meter)
--   conversion_factor  kWh per m³, printed on every gas bill; filing a gas bill
--                      also records it as the meter's factor from the period's
--                      first day, unless one already starts that day
--
-- and four line kinds: `fixed` (termo fixo / tarifa de disponibilidade),
-- `water` (água, by m³), `sanitation` (saneamento) and `waste` (resíduos).

ALTER TYPE energy_line_kind ADD VALUE IF NOT EXISTS 'fixed';
ALTER TYPE energy_line_kind ADD VALUE IF NOT EXISTS 'water';
ALTER TYPE energy_line_kind ADD VALUE IF NOT EXISTS 'sanitation';
ALTER TYPE energy_line_kind ADD VALUE IF NOT EXISTS 'waste';

ALTER TABLE energy_invoice
  ADD COLUMN volume_m3 numeric(14,3),
  ADD COLUMN conversion_factor numeric(10,6);

ALTER TABLE energy_invoice
  ADD CONSTRAINT energy_invoice_volume_positive CHECK (volume_m3 IS NULL OR volume_m3 >= 0),
  ADD CONSTRAINT energy_invoice_factor_range
    CHECK (conversion_factor IS NULL OR (conversion_factor > 0 AND conversion_factor < 100));

COMMENT ON COLUMN energy_invoice.volume_m3 IS 'm³ the bill charges — gas or water. 12-11-2026.';
COMMENT ON COLUMN energy_invoice.conversion_factor IS 'kWh per m³ as a gas bill prints it. 12-11-2026.';

-- Down Migration

ALTER TABLE energy_invoice DROP CONSTRAINT energy_invoice_factor_range;
ALTER TABLE energy_invoice DROP CONSTRAINT energy_invoice_volume_positive;
ALTER TABLE energy_invoice DROP COLUMN conversion_factor, DROP COLUMN volume_m3;
-- The line kinds stay: Postgres cannot drop an enum value.
