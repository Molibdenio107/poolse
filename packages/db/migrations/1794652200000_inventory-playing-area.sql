-- Up Migration

-- POOLSE-154 (Rui, 04-11-2026) — an item can live on a court.
--
-- *Localização* became one choice from the site's own places: a space
-- (`space_id`, since 4.3), a pool (the `inventory_item_pool` junction, kept
-- many-to-many though the form offers one — the ticket's Open point, default
-- taken), or a recinto of another sport, which is this column. A boia belongs to
-- the Piscina principal; the nets belong to Campo 1.
--
-- **Composite key on the facility**, so an item cannot sit on another site's
-- court, nor another club's: `playing_area` has `UNIQUE (organization_id,
-- facility_id, id)` for exactly this.
--
-- **A space or a recinto, never both**, by CHECK — one place is one place. The
-- pool scope is not part of the CHECK: rows backfilled by 4.3 may carry a space
-- and a pool scope at once, and that history is not this migration's to rewrite.
--
-- The free-text `location` stays (data-model note): the form no longer offers
-- it, the list still shows what was written.

ALTER TABLE inventory_item
  ADD COLUMN playing_area_id uuid,
  ADD CONSTRAINT inventory_item_playing_area_fkey
    FOREIGN KEY (organization_id, facility_id, playing_area_id)
    REFERENCES playing_area (organization_id, facility_id, id),
  ADD CONSTRAINT inventory_item_one_place
    CHECK (space_id IS NULL OR playing_area_id IS NULL);

COMMENT ON COLUMN inventory_item.playing_area_id IS
  'POOLSE-154: the recinto of another sport the item lives on (a court, a pitch). A pool is the '
  'inventory_item_pool junction, a room is space_id; never a space and a recinto at once.';

CREATE INDEX inventory_item_playing_area_idx
  ON inventory_item (organization_id, playing_area_id)
  WHERE archived_at IS NULL AND playing_area_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS inventory_item_playing_area_idx;
ALTER TABLE inventory_item
  DROP CONSTRAINT IF EXISTS inventory_item_one_place,
  DROP CONSTRAINT IF EXISTS inventory_item_playing_area_fkey,
  DROP COLUMN IF EXISTS playing_area_id;
