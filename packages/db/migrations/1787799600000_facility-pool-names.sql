-- Up Migration
--
-- Phase 1.1: the constraints `facility` and `pool` should have had since 0.2.
--
-- Both tables arrived with the columns and the row-level security but with
-- nothing stopping two facilities in one organization from being called the same
-- thing. That is not a cosmetic problem: the whole of module 1 hangs off picking
-- a facility from a list, and a list with two identical entries is one somebody
-- picks wrong from.
--
-- Partial, because both tables are soft-deletable and CLAUDE.md is explicit about
-- why: a plain unique index means closing a pool for the season and reopening it
-- next year collides with the archived row.
--
-- Case-insensitive, because "Piscina Norte" and "piscina norte" are the same
-- facility to everyone except the database. `lower()` rather than citext here —
-- the column is display text that should keep the capitalisation it was typed
-- with, and only the uniqueness check should ignore it.

CREATE UNIQUE INDEX facility_name_uq
  ON facility (organization_id, lower(name))
  WHERE archived_at IS NULL;

-- Scoped to the facility, not the organization: a club with two sites may well
-- have a "Piscina Grande" at each, and that is not a mistake.
CREATE UNIQUE INDEX pool_name_uq
  ON pool (organization_id, facility_id, lower(name))
  WHERE archived_at IS NULL;

-- A pool cannot be moved to another organization's facility — the composite
-- foreign key already refuses that. What it cannot refuse is a negative lane
-- count, which the form should stop and the database should not accept either.
ALTER TABLE pool
  ADD CONSTRAINT pool_lane_count_positive
  CHECK (lane_count IS NULL OR lane_count > 0);

ALTER TABLE pool
  ADD CONSTRAINT pool_volume_positive
  CHECK (volume_litres IS NULL OR volume_litres > 0);

ALTER TABLE facility
  ADD CONSTRAINT facility_name_not_blank CHECK (btrim(name) <> '');

ALTER TABLE pool
  ADD CONSTRAINT pool_name_not_blank CHECK (btrim(name) <> '');

-- Down Migration

ALTER TABLE pool DROP CONSTRAINT IF EXISTS pool_name_not_blank;
ALTER TABLE facility DROP CONSTRAINT IF EXISTS facility_name_not_blank;
ALTER TABLE pool DROP CONSTRAINT IF EXISTS pool_volume_positive;
ALTER TABLE pool DROP CONSTRAINT IF EXISTS pool_lane_count_positive;
DROP INDEX IF EXISTS pool_name_uq;
DROP INDEX IF EXISTS facility_name_uq;
