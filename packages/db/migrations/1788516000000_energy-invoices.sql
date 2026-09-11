-- Faturas de energia — the bill, as a record — slice 5.3 (first half).
--
-- What an electricity bill actually is, read off two real EDP documents rather
-- than imagined. Three facts shaped these tables:
--
-- **One PDF is several faturas.** An EDP "documento" bundles the electricity
-- fatura with a Contribuição Audiovisual fatura, a services fatura and a
-- débitos/créditos note, and "quanto tenho a pagar" is their sum. The energy
-- cost is the electricity fatura; the cash out is the document. So the header
-- carries both, and everything that is not electricity is one figure —
-- `other_charges_cents` — so the document total reconciles without pretending
-- a TV licence is energy.
--
-- **Registers and billed lines are two different things.** The dial has three
-- registers — vazio, ponta, cheias — with a reading each, even on a *Simples*
-- tariff, where the supplier sums them and bills one line. Then that line is
-- split by VAT rate (the reduced rate on the first kWh, a rate change mid-
-- period), discounts arrive as negative lines of their own, and power is a
-- line priced per day. `energy_invoice_register` is what the meter said;
-- `energy_invoice_line` is what was charged, typed by kind so a screen can
-- read the energy rows, the power rows and the discounts from one query.
--
-- **Money is integer cents and unit prices are not**, per CLAUDE.md: a
-- per-kWh price of 0,1675 € in cents is 0,17 € and a 1,5 % error on the
-- figure the module exists to get right.
--
-- The meter gains `cpe` — the Código do Ponto de Entrega printed on every bill,
-- which is how an imported document finds its meter — and `serial`, the number
-- on the dial, which the bill also prints. Both nullable: a sub-meter in the
-- plant room has neither.

-- Up Migration

ALTER TABLE energy_meter
  ADD COLUMN cpe    text,
  ADD COLUMN serial text,
  ADD CONSTRAINT energy_meter_cpe_shape CHECK (cpe IS NULL OR cpe ~ '^[A-Z]{2}[A-Z0-9]{14,20}$'),
  ADD CONSTRAINT energy_meter_serial_not_blank CHECK (serial IS NULL OR btrim(serial) <> '');

COMMENT ON COLUMN energy_meter.cpe IS
  'Código do Ponto de Entrega, as printed on the bill with the spaces removed (PT0002000042466003BW). How an imported invoice finds its meter.';
COMMENT ON COLUMN energy_meter.serial IS
  'The number on the dial, as the bill prints it. Informational.';

-- One delivery point is one meter. Partial, because a replaced meter keeps the
-- CPE it was billed under and its replacement inherits it.
CREATE UNIQUE INDEX energy_meter_cpe_uq
  ON energy_meter (organization_id, cpe)
  WHERE archived_at IS NULL AND cpe IS NOT NULL;

CREATE TYPE energy_register AS ENUM ('vazio', 'ponta', 'cheias', 'super_vazio', 'total');
CREATE TYPE energy_tariff_period AS ENUM
  ('simples', 'ponta', 'cheias', 'vazio_normal', 'super_vazio', 'fora_vazio', 'vazio');
CREATE TYPE energy_line_kind AS ENUM ('energy', 'power', 'discount', 'tax', 'other');
CREATE TYPE energy_reading_quality AS ENUM ('real', 'estimated');

-- ---------------------------------------------------------------------------
-- energy_invoice — the header
-- ---------------------------------------------------------------------------

CREATE TABLE energy_invoice (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization (id),
  meter_id            uuid NOT NULL,

  supplier            text NOT NULL,
  -- The electricity fatura's own number ("FT2025 K3425/340041459032"), which is
  -- the one a club quotes to the supplier. Unique per supplier among live rows:
  -- the same bill twice is the same bill.
  invoice_number      text NOT NULL,
  atcud               text,
  -- The bundle the fatura arrived in ("C801178006477834"), when there is one.
  document_reference  text,

  issued_on           date NOT NULL,
  period_start        date NOT NULL,
  period_end          date NOT NULL,
  due_on              date,

  -- What the contract says, as the bill restates it.
  contracted_power_kva numeric(6,2),
  tariff              text,
  cycle               text,
  reading_quality     energy_reading_quality,

  -- The electricity fatura's money, and the document's.
  subtotal_cents      integer NOT NULL,
  vat_cents           integer NOT NULL,
  total_cents         integer NOT NULL,
  other_charges_cents integer NOT NULL DEFAULT 0,
  document_total_cents integer NOT NULL,

  -- Nice to have and on every bill: what part of the price is the network.
  network_access_cents integer,
  -- "Se optasse pela tarifa regulada, pagaria … -5,72 €". Signed: negative
  -- means the regulated tariff would have been cheaper.
  regulated_difference_cents integer,

  source              energy_reading_source NOT NULL DEFAULT 'manual',
  source_file_name    text,
  recorded_by         uuid,
  notes               text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  archived_at         timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, meter_id) REFERENCES energy_meter (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by) REFERENCES membership (organization_id, id),

  CHECK (btrim(supplier) <> ''),
  CHECK (btrim(invoice_number) <> ''),
  CHECK (period_end >= period_start),
  CHECK (due_on IS NULL OR due_on >= issued_on),
  CHECK (contracted_power_kva IS NULL OR contracted_power_kva > 0),
  CHECK (vat_cents >= 0),
  -- A credit note is a negative bill and is allowed; what is not allowed is a
  -- total that disagrees with its parts. The document total is the electricity
  -- total plus everything else in the envelope.
  CHECK (total_cents = subtotal_cents + vat_cents),
  CHECK (document_total_cents = total_cents + other_charges_cents),
  CHECK (notes IS NULL OR btrim(notes) <> '')
);

COMMENT ON TABLE energy_invoice IS
  'One electricity bill on one meter. The electricity fatura is the energy cost; the document total is what was paid, other charges included.';
COMMENT ON COLUMN energy_invoice.other_charges_cents IS
  'Everything in the envelope that is not electricity — a TV licence, a services pack, a late fee — so the document total reconciles.';

CREATE UNIQUE INDEX energy_invoice_number_uq
  ON energy_invoice (organization_id, lower(supplier), lower(invoice_number))
  WHERE archived_at IS NULL;

CREATE INDEX energy_invoice_meter_idx
  ON energy_invoice (organization_id, meter_id, period_end DESC)
  WHERE archived_at IS NULL;

CREATE TRIGGER energy_invoice_updated_at BEFORE UPDATE ON energy_invoice
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- energy_invoice_register — what the dial said
-- ---------------------------------------------------------------------------

CREATE TABLE energy_invoice_register (
  organization_id uuid NOT NULL REFERENCES organization (id),
  invoice_id      uuid NOT NULL,
  register        energy_register NOT NULL,
  previous_index  numeric(14,3),
  current_index   numeric(14,3),
  -- Stored rather than derived: a bill may print the kWh and not the indexes,
  -- or an estimated figure that is not the difference.
  kwh             numeric(12,3) NOT NULL,

  PRIMARY KEY (organization_id, invoice_id, register),
  FOREIGN KEY (organization_id, invoice_id)
    REFERENCES energy_invoice (organization_id, id) ON DELETE CASCADE,

  CHECK (kwh >= 0),
  CHECK (previous_index IS NULL OR previous_index >= 0),
  CHECK (current_index IS NULL OR current_index >= previous_index)
);

COMMENT ON TABLE energy_invoice_register IS
  'One register of the dial as the bill reports it: vazio, ponta, cheias. On a Simples tariff the supplier sums these into one billed line.';

-- ---------------------------------------------------------------------------
-- energy_invoice_line — what was charged
-- ---------------------------------------------------------------------------

CREATE TABLE energy_invoice_line (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  invoice_id      uuid NOT NULL,
  position        smallint NOT NULL,

  kind            energy_line_kind NOT NULL,
  -- The words on the bill, kept: "Consumo real Simples", "Desconto Tarifa
  -- Social". A translated enum would not survive a second supplier.
  description     text NOT NULL,
  period          energy_tariff_period,
  from_on         date,
  to_on           date,
  quantity        numeric(12,3),
  -- "kWh", "dias", "mês". Free text, because that is how the bill says it.
  unit            text,
  unit_price      numeric(12,6),
  amount_cents    integer NOT NULL,
  discount_cents  integer NOT NULL DEFAULT 0,
  -- Total s/IVA, as printed. Stored, not derived: rounding on the bill wins.
  total_cents     integer NOT NULL,
  -- Percent, as printed: 6 or 23. Null for a line the bill marks not subject.
  vat_rate        numeric(5,2),

  PRIMARY KEY (id),
  UNIQUE (organization_id, invoice_id, position),
  FOREIGN KEY (organization_id, invoice_id)
    REFERENCES energy_invoice (organization_id, id) ON DELETE CASCADE,

  CHECK (btrim(description) <> ''),
  CHECK (position >= 0),
  CHECK (to_on IS NULL OR from_on IS NULL OR to_on >= from_on),
  CHECK (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate <= 100))
);

COMMENT ON TABLE energy_invoice_line IS
  'One billed row: energy by tariff period and date range, power per day, a discount, a tax, or something else. Money in cents; the unit price is not.';

CREATE INDEX energy_invoice_line_invoice_idx
  ON energy_invoice_line (organization_id, invoice_id, position);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE energy_invoice          ENABLE ROW LEVEL SECURITY;
ALTER TABLE energy_invoice_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE energy_invoice_line     ENABLE ROW LEVEL SECURITY;

CREATE POLICY energy_invoice_tenant ON energy_invoice
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
CREATE POLICY energy_invoice_register_tenant ON energy_invoice_register
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
CREATE POLICY energy_invoice_line_tenant ON energy_invoice_line
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON energy_invoice          TO poolse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON energy_invoice_register TO poolse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON energy_invoice_line     TO poolse_app;

-- Down Migration

DROP POLICY IF EXISTS energy_invoice_line_tenant     ON energy_invoice_line;
DROP POLICY IF EXISTS energy_invoice_register_tenant ON energy_invoice_register;
DROP POLICY IF EXISTS energy_invoice_tenant          ON energy_invoice;

DROP TABLE IF EXISTS energy_invoice_line;
DROP TABLE IF EXISTS energy_invoice_register;
DROP TABLE IF EXISTS energy_invoice;

DROP TYPE IF EXISTS energy_reading_quality;
DROP TYPE IF EXISTS energy_line_kind;
DROP TYPE IF EXISTS energy_tariff_period;
DROP TYPE IF EXISTS energy_register;

DROP INDEX IF EXISTS energy_meter_cpe_uq;
ALTER TABLE energy_meter
  DROP CONSTRAINT IF EXISTS energy_meter_serial_not_blank,
  DROP CONSTRAINT IF EXISTS energy_meter_cpe_shape,
  DROP COLUMN IF EXISTS serial,
  DROP COLUMN IF EXISTS cpe;
