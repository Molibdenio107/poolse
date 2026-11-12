-- Up Migration
--
-- Gas and water as quantities of their own (Rui, 12-11-2026; research in
-- docs/research/energy-metering-2026-11.md › 2).
--
-- 1. A gas meter counts m³ and the bill charges kWh: kWh = m³ × the conversion
--    factor printed on every gas bill (PCS × the temperature and pressure
--    corrections, ~11 kWh/m³), which moves a little each month. So a gas meter
--    keeps its factors, effective-dated — the one live on a reading's day turns
--    its m³ into kWh. One live factor per meter per day: the partial unique key.
-- 2. A water meter may be a sub-meter on the make-up line (água de compensação
--    — not "reposição", which the make-up-lesson module already owns) or on the
--    backwash line: two kinds of what a meter feeds.
-- 3. A water reading may say how many filter backwashes (lavagens) happened in
--    the interval, the commonest reason a pool's water use jumps.

CREATE TABLE energy_gas_factor (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  meter_id        uuid NOT NULL,
  -- kWh per m³, as the bill prints it (e.g. 11,272). numeric, never a float.
  kwh_per_unit    numeric(10,6) NOT NULL,
  effective_from  date NOT NULL,
  note            text,
  created_by_membership_id uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, meter_id) REFERENCES energy_meter (organization_id, id),
  FOREIGN KEY (organization_id, created_by_membership_id) REFERENCES membership (organization_id, id),

  CONSTRAINT energy_gas_factor_positive CHECK (kwh_per_unit > 0 AND kwh_per_unit < 100),
  CONSTRAINT energy_gas_factor_note_not_blank CHECK (note IS NULL OR btrim(note) <> '')
);

CREATE UNIQUE INDEX energy_gas_factor_one_per_day_uq
  ON energy_gas_factor (organization_id, meter_id, effective_from)
  WHERE archived_at IS NULL;

CREATE TRIGGER energy_gas_factor_updated_at BEFORE UPDATE ON energy_gas_factor
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE energy_gas_factor ENABLE ROW LEVEL SECURITY;
CREATE POLICY energy_gas_factor_tenant ON energy_gas_factor
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE ON energy_gas_factor TO poolse_app;

COMMENT ON TABLE energy_gas_factor IS
  'kWh per m³ for a gas meter, as each gas bill prints it, effective from a date until the next. 12-11-2026.';

ALTER TYPE energy_meter_kind ADD VALUE IF NOT EXISTS 'make_up_water';
ALTER TYPE energy_meter_kind ADD VALUE IF NOT EXISTS 'backwash';

ALTER TABLE energy_reading ADD COLUMN backwashes smallint;
ALTER TABLE energy_reading
  ADD CONSTRAINT energy_reading_backwashes_range CHECK (backwashes IS NULL OR backwashes BETWEEN 0 AND 999);

COMMENT ON COLUMN energy_reading.backwashes IS
  'Filter backwashes (lavagens) in the interval this reading closes, on a water meter. 12-11-2026.';

-- Down Migration

ALTER TABLE energy_reading DROP CONSTRAINT energy_reading_backwashes_range;
ALTER TABLE energy_reading DROP COLUMN backwashes;
-- The two meter kinds stay: Postgres cannot drop an enum value.
DROP POLICY energy_gas_factor_tenant ON energy_gas_factor;
DROP TABLE energy_gas_factor;
