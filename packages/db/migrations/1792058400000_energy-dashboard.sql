-- POOLSE-106 — the Energia dashboard, and a count of bills read automatically.
--
-- **What a meter measures, by carrier.** The dashboard splits a club's running
-- cost into electricity, gas and water, and nothing in the schema said which a
-- meter is: `kind` is what the meter is *for* (a pump, the heating, the whole
-- site), and a boiler on gas and a heat pump on electricity are both `heating`.
-- So a closed enum on the meter, defaulting to electricity — every meter built
-- before this was an electricity meter, because the bill form and its parser
-- only ever knew EDP-shaped electricity bills.
--
-- **A bill read automatically costs money, so it leaves a row.** Rui switched
-- the reading on for the pilot on condition that the cost stays visible
-- (22-10-2026). Each read is one row here, written by the club's own login in
-- the request that read it, and counted per month on /admin by the platform's
-- login — the `tenant_request_stats` arrangement: the app writes, cannot read,
-- and cannot rewrite; the platform reads and cannot write. A row holds the club,
-- the moment and whether anything came back. Never the file, the supplier, or a
-- figure from the bill: what is counted is the call, not the club's energy.

-- Up Migration

CREATE TYPE energy_carrier AS ENUM ('electricity', 'gas', 'water');

ALTER TABLE energy_meter
  ADD COLUMN carrier energy_carrier NOT NULL DEFAULT 'electricity';

COMMENT ON COLUMN energy_meter.carrier IS
  'What the meter measures: electricity, gas or water. `kind` is what it is for (pump, heating, total); a gas boiler and a heat pump are both heating. POOLSE-106.';

CREATE TABLE energy_invoice_read (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  read_at         timestamptz NOT NULL DEFAULT now(),
  -- False when the call was made and nothing usable came back: still a call
  -- that was paid for, so still counted.
  succeeded       boolean NOT NULL
);

CREATE INDEX energy_invoice_read_month_idx ON energy_invoice_read (read_at);

REVOKE ALL ON energy_invoice_read FROM poolse_app;
GRANT INSERT ON energy_invoice_read TO poolse_app;

ALTER TABLE energy_invoice_read ENABLE ROW LEVEL SECURITY;

-- The club writes its own reads and nothing else; with no SELECT grant it
-- cannot read them back, and with no UPDATE or DELETE it cannot thin them.
CREATE POLICY energy_invoice_read_writer ON energy_invoice_read
  FOR INSERT TO poolse_app
  WITH CHECK (organization_id = current_organization_id());

-- The operator, who reads every club's count and writes none.
CREATE POLICY energy_invoice_read_platform ON energy_invoice_read
  FOR SELECT TO poolse_platform USING (true);

GRANT SELECT ON energy_invoice_read TO poolse_platform;

-- Down Migration

DROP POLICY IF EXISTS energy_invoice_read_platform ON energy_invoice_read;
DROP POLICY IF EXISTS energy_invoice_read_writer ON energy_invoice_read;
DROP TABLE IF EXISTS energy_invoice_read;

ALTER TABLE energy_meter DROP COLUMN IF EXISTS carrier;
DROP TYPE IF EXISTS energy_carrier;
