-- Up Migration
--
-- Inventory grows out of the pool it was born in — round 6.
--
-- `pool_material` was one row per kind of item, hard-scoped to one tank, and the
-- scoping is the part that turned out to be wrong. Almost nothing a club owns
-- belongs to a single pool: the pranchas live in one store room and are carried
-- to whichever tank needs them, the desfibrilhador belongs to the building, and
-- the lane ropes belong to the two competition tanks and not the learner pool.
-- Forcing each of those into one pool meant either duplicating a row per tank —
-- and then no count meant anything — or picking a pool arbitrarily and writing
-- the truth into the notes field.
--
-- So an item belongs to a **facility**, and says which pools it serves:
--
--   `facility`   — the building, not any tank. A store room, an office, the AED.
--   `pools`      — a chosen set, listed in `inventory_item_pool`.
--   `all_pools`  — every tank at this facility, including ones added later.
--
-- `all_pools` is a scope rather than a junction row per pool, deliberately. A
-- club that buys a third tank next season should not discover that the "todas as
-- piscinas" items quietly stopped covering it, which is exactly what a snapshot
-- of pool ids at the moment of saving would do.
--
-- **The facility is the boundary that matters here**, and it is enforced
-- structurally rather than trusted. The junction carries `facility_id` and both
-- of its composite keys go through it, so an item at Piscina Municipal cannot
-- name a tank at the hotel across town — the same trick the rest of the schema
-- uses for `organization_id`, one level down.

CREATE TYPE inventory_scope AS ENUM ('facility', 'pools', 'all_pools');

-- What the junction's composite key needs on the parent side. `(organization_id,
-- id)` already exists and is not enough: it proves the pool is in this tenant,
-- not that it is in this facility.
ALTER TABLE pool ADD CONSTRAINT pool_org_facility_id_uq
  UNIQUE (organization_id, facility_id, id);

CREATE TABLE inventory_item (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  facility_id     uuid NOT NULL,

  -- Free text, and still deliberately so. Every club calls this kit something
  -- slightly different — pranchas, flutuadores, esparguetes, halteres, arcos —
  -- and a fixed vocabulary means the first operator with a word we did not think
  -- of writes it into the notes instead.
  name            text NOT NULL,

  -- How many there are. Zero is a real answer: "we have a box for these and it
  -- is empty" is different from having no row at all.
  quantity        integer NOT NULL DEFAULT 0,

  -- What the number counts, when the name does not carry it: pares, caixas, metros.
  unit            text,

  notes           text,

  scope           inventory_scope NOT NULL DEFAULT 'facility',

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  -- The key the junction hangs off. See the header.
  UNIQUE (organization_id, facility_id, id),

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),

  CHECK (btrim(name) <> ''),
  CHECK (quantity >= 0),
  CHECK (unit IS NULL OR btrim(unit) <> '')
);

COMMENT ON TABLE inventory_item IS
  'Equipment at a facility. One row per kind of item, with a count and the pools it serves — not a stock ledger.';

-- One name per facility, accent- and case-insensitively. The scope is not part of
-- the key on purpose: two "Pranchas" rows at one site, one for the learner tank
-- and one for the main tank, is precisely the duplication this model exists to
-- remove — the second one is a pool added to the first.
--
-- Partial, as every unique index on a soft-deletable table here is. Otherwise
-- archiving "Pranchas" and adding them back next season violates the constraint
-- against a dead row.
CREATE UNIQUE INDEX inventory_item_name_uq
  ON inventory_item (organization_id, facility_id, lower(strip_accents(name)))
  WHERE archived_at IS NULL;

CREATE INDEX inventory_item_facility_idx
  ON inventory_item (organization_id, facility_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER inventory_item_updated_at BEFORE UPDATE ON inventory_item
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Which pools a `pools`-scoped item serves.
-- ---------------------------------------------------------------------------
--
-- Rows exist only for `scope = 'pools'`. A `facility` item serves no tank and an
-- `all_pools` item serves every tank there will ever be, and neither is a list.

CREATE TABLE inventory_item_pool (
  organization_id uuid NOT NULL REFERENCES organization (id),
  facility_id     uuid NOT NULL,
  item_id         uuid NOT NULL,
  pool_id         uuid NOT NULL,

  PRIMARY KEY (item_id, pool_id),

  -- Both keys route through `facility_id`, so the pool and the item are proved
  -- to be at the same site as well as in the same tenant.
  FOREIGN KEY (organization_id, facility_id, item_id)
    REFERENCES inventory_item (organization_id, facility_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, facility_id, pool_id)
    REFERENCES pool (organization_id, facility_id, id)
);

CREATE INDEX inventory_item_pool_pool_idx
  ON inventory_item_pool (organization_id, pool_id);

-- ---------------------------------------------------------------------------
-- What was already recorded, moved across.
-- ---------------------------------------------------------------------------
--
-- Merged by name within a facility, because that is what the new unique index
-- means and because it is also the honest reading: "Pranchas 10" at the learner
-- tank and "Pranchas 14" at the main tank were always one pile of 24 that the
-- old model could not express. Quantities add; the notes are kept, joined, so
-- nothing an operator typed is thrown away by a migration.

INSERT INTO inventory_item
  (organization_id, facility_id, name, quantity, unit, notes, scope, created_at)
SELECT
  m.organization_id,
  p.facility_id,
  min(m.name)                AS name,
  sum(m.quantity)::integer   AS quantity,
  min(m.unit)                AS unit,
  string_agg(DISTINCT nullif(btrim(m.notes), ''), ' · ') AS notes,
  'pools'::inventory_scope,
  min(m.created_at)          AS created_at
  FROM pool_material m
  JOIN pool p ON p.id = m.pool_id AND p.organization_id = m.organization_id
 WHERE m.archived_at IS NULL
 GROUP BY m.organization_id, p.facility_id, lower(strip_accents(m.name));

INSERT INTO inventory_item_pool (organization_id, facility_id, item_id, pool_id)
SELECT DISTINCT
  i.organization_id, i.facility_id, i.id, m.pool_id
  FROM pool_material m
  JOIN pool p ON p.id = m.pool_id AND p.organization_id = m.organization_id
  JOIN inventory_item i
    ON i.organization_id = m.organization_id
   AND i.facility_id = p.facility_id
   AND lower(strip_accents(i.name)) = lower(strip_accents(m.name))
 WHERE m.archived_at IS NULL;

DROP TABLE pool_material;

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------

ALTER TABLE inventory_item      ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_item_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_item_tenant ON inventory_item
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY inventory_item_pool_tenant ON inventory_item_pool
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_item      TO poolse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_item_pool TO poolse_app;

-- Down Migration
--
-- Best effort, and it cannot be perfect: `pool_material` had nowhere to put an
-- item that belongs to the building rather than to a tank, so `facility`-scoped
-- rows have no home to go back to and are dropped. `all_pools` is expanded to
-- the pools that exist at the moment of rolling back, which is the closest the
-- old shape can come to "and any added later".

CREATE TABLE pool_material (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  pool_id         uuid NOT NULL,
  name            text NOT NULL,
  quantity        integer NOT NULL DEFAULT 0,
  unit            text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, pool_id) REFERENCES pool (organization_id, id),
  CHECK (btrim(name) <> ''),
  CHECK (quantity >= 0),
  CHECK (unit IS NULL OR btrim(unit) <> '')
);

CREATE UNIQUE INDEX pool_material_name_uq
  ON pool_material (organization_id, pool_id, lower(strip_accents(name)))
  WHERE archived_at IS NULL;

CREATE INDEX pool_material_pool_idx
  ON pool_material (organization_id, pool_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER pool_material_updated_at BEFORE UPDATE ON pool_material
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO pool_material (organization_id, pool_id, name, quantity, unit, notes, created_at)
SELECT i.organization_id, link.pool_id, i.name, i.quantity, i.unit, i.notes, i.created_at
  FROM inventory_item i
  JOIN inventory_item_pool link
    ON link.item_id = i.id AND link.organization_id = i.organization_id
 WHERE i.archived_at IS NULL AND i.scope = 'pools'
UNION ALL
SELECT i.organization_id, p.id, i.name, i.quantity, i.unit, i.notes, i.created_at
  FROM inventory_item i
  JOIN pool p
    ON p.organization_id = i.organization_id
   AND p.facility_id = i.facility_id
   AND p.archived_at IS NULL
 WHERE i.archived_at IS NULL AND i.scope = 'all_pools';

ALTER TABLE pool_material ENABLE ROW LEVEL SECURITY;

CREATE POLICY pool_material_tenant ON pool_material
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON pool_material TO poolse_app;

DROP POLICY IF EXISTS inventory_item_pool_tenant ON inventory_item_pool;
DROP POLICY IF EXISTS inventory_item_tenant ON inventory_item;
DROP TABLE IF EXISTS inventory_item_pool;
DROP TABLE IF EXISTS inventory_item;
DROP TYPE IF EXISTS inventory_scope;

ALTER TABLE pool DROP CONSTRAINT IF EXISTS pool_org_facility_id_uq;
