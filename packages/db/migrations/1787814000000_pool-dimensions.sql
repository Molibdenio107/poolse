-- Up Migration
--
-- Backlog story 1: a pool's length, width and maximum depth.
--
-- `numeric(5,2)`, not integers, and that is the whole point of the story. A
-- 12.5 m pool is an ordinary pool; rounding it to 12 or 13 makes the field worse
-- than useless, because it looks precise and is wrong. The same reasoning the
-- data model applies to unit prices — an integer is right for money and wrong
-- for a measurement.
--
-- Up to 999.99 m, which comfortably covers every swimming pool ever built and
-- refuses a typo of 12000.
--
-- All three are optional. An operator who does not know the depth of a pool they
-- inherited should not be blocked from recording the pool, and nothing that was
-- saved before this migration becomes invalid because of it.

ALTER TABLE pool
  ADD COLUMN length_m    numeric(5,2),
  ADD COLUMN width_m     numeric(5,2),
  ADD COLUMN max_depth_m numeric(5,2);

-- Zero is not a measurement, it is a form that was submitted empty. Negative is a
-- typo. Both are refused here rather than only in the form, for the same reason
-- lane_count is: a second write path will exist the moment the Excel importer
-- lands in 1.10.
ALTER TABLE pool
  ADD CONSTRAINT pool_length_positive    CHECK (length_m    IS NULL OR length_m    > 0),
  ADD CONSTRAINT pool_width_positive     CHECK (width_m     IS NULL OR width_m     > 0),
  ADD CONSTRAINT pool_max_depth_positive CHECK (max_depth_m IS NULL OR max_depth_m > 0);

COMMENT ON COLUMN pool.length_m IS 'Metres. numeric, not integer: 12.5 m is a real pool.';
COMMENT ON COLUMN pool.width_m IS 'Metres.';
COMMENT ON COLUMN pool.max_depth_m IS 'Metres, at the deepest point.';

-- Down Migration

ALTER TABLE pool DROP CONSTRAINT IF EXISTS pool_max_depth_positive;
ALTER TABLE pool DROP CONSTRAINT IF EXISTS pool_width_positive;
ALTER TABLE pool DROP CONSTRAINT IF EXISTS pool_length_positive;

ALTER TABLE pool
  DROP COLUMN IF EXISTS max_depth_m,
  DROP COLUMN IF EXISTS width_m,
  DROP COLUMN IF EXISTS length_m;
