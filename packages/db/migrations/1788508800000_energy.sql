-- Energy — slices 5.1 and 5.2.
--
-- Two tables: the meter, and what it read. The shape is the one
-- docs/data-model.md has carried since phase 0, with one deliberate deviation
-- explained at `energy_reading`.
--
-- **`reads` settles what a value means, and it is the most important column
-- here.** A cumulative index — the number on the dial, ever increasing — and an
-- interval figure — "this month we used 412 kWh" — are turned into consumption
-- by completely different arithmetic, and getting it wrong is silently wrong
-- rather than loudly wrong: a chart that summed indices would show a club using
-- more energy every month for ever. The meter says which it is once; every
-- reading inherits it.
--
-- **A cumulative index cannot run backwards, and the database says so.** A
-- reading below the one before it, or above the one after it, is a typo nine
-- times in ten — 41,235 typed as 4,1235 — and the tenth time is a meter that was
-- replaced, which is `replaced_meter_id`: a new meter, a new series, and the old
-- one archived. The trigger carries the neighbouring figure in its DETAIL so the
-- refusal can say "the previous reading was 41,235", the same contract as
-- `pool_capacity_respected`.
--
-- **`initial_index` is what the first delta is measured from.** A meter installed
-- reading 0 needs nothing; a club that starts logging a meter that already reads
-- 18,402 sets it so the first month is not lost. Null means "start counting from
-- the first reading", and the first reading then yields no consumption — which
-- the screen says rather than showing a zero.

-- Up Migration

CREATE TYPE energy_meter_kind AS ENUM ('pump', 'heating', 'lighting', 'total', 'other');
CREATE TYPE energy_meter_reads AS ENUM ('cumulative_index', 'interval_consumption');
CREATE TYPE energy_reading_source AS ENUM ('manual', 'import', 'feed');

-- ---------------------------------------------------------------------------
-- energy_meter
-- ---------------------------------------------------------------------------

CREATE TABLE energy_meter (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization (id),
  facility_id       uuid NOT NULL,
  -- A meter serves a tank, or the site as a whole. Routed through the facility
  -- so a named pool is proved to be at this site, as every target here is.
  pool_id           uuid,

  name              text NOT NULL,
  kind              energy_meter_kind NOT NULL DEFAULT 'total',
  -- What the dial counts. Free text with a default rather than an enum, because
  -- a gas boiler's meter counts m³ and the next one will count something else;
  -- never derived from the kind, for the same reason a water reading carries
  -- its own unit.
  unit              text NOT NULL DEFAULT 'kWh',
  reads             energy_meter_reads NOT NULL DEFAULT 'cumulative_index',
  initial_index     numeric(14,3),
  -- The meter this one took over from. Its readings stay on the old row; the
  -- consumption view concatenates the two series and the join is the only
  -- place a swap is visible.
  replaced_meter_id uuid,
  notes             text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, facility_id, pool_id)
    REFERENCES pool (organization_id, facility_id, id),
  FOREIGN KEY (organization_id, replaced_meter_id) REFERENCES energy_meter (organization_id, id),

  CHECK (btrim(name) <> ''),
  CHECK (btrim(unit) <> ''),
  CHECK (notes IS NULL OR btrim(notes) <> ''),
  CHECK (initial_index IS NULL OR initial_index >= 0),
  -- Only a dial has a starting figure. An interval meter's first value is
  -- already a consumption.
  CHECK (reads = 'cumulative_index' OR initial_index IS NULL),
  CHECK (replaced_meter_id IS NULL OR replaced_meter_id <> id)
);

COMMENT ON TABLE energy_meter IS
  'A meter at a site, optionally serving one tank. `reads` says whether its values are a running index or per-interval consumption.';
COMMENT ON COLUMN energy_meter.reads IS
  'cumulative_index: the dial, ever increasing, consumption is the difference between readings. interval_consumption: each value is already a consumption.';
COMMENT ON COLUMN energy_meter.initial_index IS
  'The dial when logging began, so the first delta is not lost. Null means consumption starts at the second reading. Cumulative meters only.';
COMMENT ON COLUMN energy_meter.replaced_meter_id IS
  'The meter this one took over from, when a dial was swapped. The old series stays on the old row.';

-- Two meters called "Bomba" at one site are two meters nobody can tell apart on
-- a reading form. Partial, because a replaced meter is archived and its name
-- is the obvious name for its replacement.
CREATE UNIQUE INDEX energy_meter_name_uq
  ON energy_meter (organization_id, facility_id, lower(name))
  WHERE archived_at IS NULL;

CREATE INDEX energy_meter_facility_idx
  ON energy_meter (organization_id, facility_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER energy_meter_updated_at BEFORE UPDATE ON energy_meter
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- energy_reading
-- ---------------------------------------------------------------------------
--
-- **Hypertable-shaped, and not a hypertable.** The natural key is
-- (organization_id, meter_id, taken_at) with no surrogate id, which is the one
-- thing TimescaleDB needs of a table it is to partition. It is not converted
-- here because there is nothing yet to partition: a club types one figure per
-- meter per month, and the automated feeds that would turn this into a
-- time-series are deferred until manual entry is the bottleneck
-- (docs/roadmap.md, "Deferred, with their trigger"). Enabling the extension
-- constrains the hosting provider — the half the phase-0 note says cannot be
-- swapped — and doing that for a few hundred rows a year buys nothing for the
-- free pilot. When feeds land, the conversion is one migration:
-- `SELECT create_hypertable('energy_reading', 'taken_at', migrate_data => true)`,
-- and nothing in the application changes, because the key is already right.
--
-- **Corrected in place, removed by archiving.** A reading is a claim about a
-- moment; a wrong figure is edited and a reading that never happened is
-- archived, and the key means a second reading at the same instant is the same
-- reading. `archived_at` is a column the eventual hypertable carries without
-- complaint — only unique indexes have to include the time column.

CREATE TABLE energy_reading (
  organization_id uuid NOT NULL REFERENCES organization (id),
  meter_id        uuid NOT NULL,
  -- When the dial was read, UTC. Bucketed into months in the facility's
  -- timezone on read, never stored as a month.
  taken_at        timestamptz NOT NULL,
  value           numeric(14,3) NOT NULL,
  source          energy_reading_source NOT NULL DEFAULT 'manual',
  recorded_by     uuid,
  note            text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (organization_id, meter_id, taken_at),

  FOREIGN KEY (organization_id, meter_id) REFERENCES energy_meter (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by) REFERENCES membership (organization_id, id),

  CHECK (value >= 0),
  CHECK (note IS NULL OR btrim(note) <> ''),
  CHECK (taken_at > TIMESTAMPTZ '2000-01-01')
);

COMMENT ON TABLE energy_reading IS
  'One figure read off one meter at one moment. Natural key, no surrogate id: hypertable-shaped for the day automated feeds arrive.';
COMMENT ON COLUMN energy_reading.value IS
  'What the meter showed. An index or a consumption, as energy_meter.reads says — never both on one meter.';

CREATE TRIGGER energy_reading_updated_at BEFORE UPDATE ON energy_reading
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- A dial does not run backwards
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION energy_index_monotonic() RETURNS trigger AS $$
DECLARE
  v_reads         energy_meter_reads;
  v_initial       numeric;
  v_previous      numeric;
  v_next          numeric;
BEGIN
  -- An archived reading is out of the series and may say anything.
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT reads, initial_index INTO v_reads, v_initial
    FROM energy_meter
   WHERE organization_id = NEW.organization_id AND id = NEW.meter_id;

  IF v_reads <> 'cumulative_index' THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_previous
    FROM energy_reading
   WHERE organization_id = NEW.organization_id
     AND meter_id = NEW.meter_id
     AND taken_at < NEW.taken_at
     AND archived_at IS NULL
   ORDER BY taken_at DESC
   LIMIT 1;

  -- No earlier reading: the floor is the dial when logging began, if known.
  v_previous := coalesce(v_previous, v_initial);

  SELECT value INTO v_next
    FROM energy_reading
   WHERE organization_id = NEW.organization_id
     AND meter_id = NEW.meter_id
     AND taken_at > NEW.taken_at
     AND archived_at IS NULL
   ORDER BY taken_at
   LIMIT 1;

  IF v_previous IS NOT NULL AND NEW.value < v_previous THEN
    RAISE EXCEPTION 'Meter % read % at %, below the earlier reading of %',
      NEW.meter_id, NEW.value, NEW.taken_at, v_previous
      USING ERRCODE = 'check_violation',
            -- Machine-readable, for the API to turn into the operator's own
            -- sentence with the figure in it. Same contract as pool_capacity.
            DETAIL = format('energy_index_backwards|%s|%s', v_previous, NEW.value);
  END IF;

  IF v_next IS NOT NULL AND NEW.value > v_next THEN
    RAISE EXCEPTION 'Meter % read % at %, above the later reading of %',
      NEW.meter_id, NEW.value, NEW.taken_at, v_next
      USING ERRCODE = 'check_violation',
            DETAIL = format('energy_index_ahead|%s|%s', v_next, NEW.value);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER energy_reading_monotonic
  BEFORE INSERT OR UPDATE OF value, taken_at, archived_at ON energy_reading
  FOR EACH ROW EXECUTE FUNCTION energy_index_monotonic();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE energy_meter   ENABLE ROW LEVEL SECURITY;
ALTER TABLE energy_reading ENABLE ROW LEVEL SECURITY;

CREATE POLICY energy_meter_tenant ON energy_meter
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY energy_reading_tenant ON energy_reading
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON energy_meter   TO poolse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON energy_reading TO poolse_app;

-- Down Migration

DROP POLICY IF EXISTS energy_reading_tenant ON energy_reading;
DROP POLICY IF EXISTS energy_meter_tenant   ON energy_meter;

DROP TABLE IF EXISTS energy_reading;
DROP FUNCTION IF EXISTS energy_index_monotonic();
DROP TABLE IF EXISTS energy_meter;

DROP TYPE IF EXISTS energy_reading_source;
DROP TYPE IF EXISTS energy_meter_reads;
DROP TYPE IF EXISTS energy_meter_kind;
