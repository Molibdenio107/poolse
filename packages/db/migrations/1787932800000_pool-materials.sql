-- Up Migration
--
-- What is in the pool room — round 4.
--
-- "How many items there are (inventory) — buoys, floats — a free text input, and
-- only then set up on a list." A small ask with a large trap in it: the obvious
-- build is a `material_type` enum or a lookup table of approved names, and it is
-- wrong here. Every club calls these things something slightly different —
-- pranchas, flutuadores, esparguetes, halteres — and a fixed vocabulary means
-- the first operator to want "arcos" cannot record their arcos and writes them
-- into a notes field instead. So the name is free text, exactly as asked.
--
-- **One row per kind of item, with a count.** Not one row per physical object:
-- nobody labels forty pull buoys, and a table with forty rows in it that all say
-- the same thing is a table nobody keeps up to date. The count is the fact the
-- operator actually holds in their head, and it is what they will correct after
-- a stock check.
--
-- **Per pool, not per facility.** Where a float is stored is where it is used —
-- the learner tank's kit and the main tank's kit are different piles of things,
-- and a building-level total answers no question anybody has while standing at
-- a lane.
--
-- **Not a stock ledger.** No movements, no reservations, no minimum levels. A
-- count somebody edits is what was asked for and it is honest about what it is;
-- a ledger that nobody posts movements to drifts from reality within a month and
-- then lies with more precision than the count did.
--
-- The Excel import the operator wants for this lands later, and it lands on the
-- staged pipeline the backoffice already uses (upload → parse → map → validate →
-- commit) rather than as a second one-off importer.

CREATE TABLE pool_material (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  pool_id         uuid NOT NULL,

  -- Free text, and deliberately so. See the header.
  name            text NOT NULL,

  -- How many there are. Zero is a real answer — "we have a box for these and it
  -- is empty" is worth recording, and is different from having no row at all.
  quantity        integer NOT NULL DEFAULT 0,

  -- What the number counts, when it is not just "items": pares, caixas, metros.
  -- Optional, because most of the time the name carries it.
  unit            text,

  -- Where in the room, what condition, which supplier — whatever the club needs
  -- to say. One free field rather than five columns guessed at in advance.
  notes           text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  -- The composite reference, as everywhere: an item cannot be put in another
  -- organization's pool.
  FOREIGN KEY (organization_id, pool_id) REFERENCES pool (organization_id, id),

  CHECK (btrim(name) <> ''),
  CHECK (quantity >= 0),
  CHECK (unit IS NULL OR btrim(unit) <> '')
);

COMMENT ON TABLE pool_material IS
  'Inventory of equipment at a pool. One row per kind of item, with a count — not a stock ledger.';

-- One name per pool, accent- and case-insensitively: "Flutuadores" and
-- "flutuadores" are the same pile of floats, and two rows for it is how a count
-- stops meaning anything.
--
-- Partial, as every unique index on a soft-deletable table in this schema is.
-- Otherwise archiving "Pranchas" and adding them back next season violates the
-- constraint against a dead row.
CREATE UNIQUE INDEX pool_material_name_uq
  ON pool_material (organization_id, pool_id, lower(strip_accents(name)))
  WHERE archived_at IS NULL;

CREATE INDEX pool_material_pool_idx
  ON pool_material (organization_id, pool_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER pool_material_updated_at BEFORE UPDATE ON pool_material
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE pool_material ENABLE ROW LEVEL SECURITY;

CREATE POLICY pool_material_tenant ON pool_material
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Down Migration

DROP POLICY IF EXISTS pool_material_tenant ON pool_material;
DROP TABLE IF EXISTS pool_material;
