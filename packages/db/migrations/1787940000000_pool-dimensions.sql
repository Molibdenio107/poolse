-- Up Migration
--
-- The shallow end, and the volume the dimensions imply — round 4.
--
-- Slice 1 gave `pool` its `length_m`, `width_m` and `max_depth_m`. That is
-- enough to describe a box and not enough to describe a pool: almost every tank
-- with lessons in it slopes, and the depth an operator quotes for the teaching
-- end is the one this schema could not hold. `min_depth_m` completes the pair,
-- named to match the column that already exists rather than introducing a second
-- convention beside it.
--
-- **The volume stays a stored, overridable column.** The obvious move is a
-- generated column — computed from the other four and never disagreeing with
-- them. It is the wrong move for one concrete reason: not every pool is a box.
-- An L-shaped municipal tank, a free-form hotel pool, anything with a beach
-- entry has a real volume that no length × width × depth will produce, and a
-- generated column would overwrite the figure from the builder's drawings with a
-- worse one. So the form computes it, shows its working and fills the field in;
-- the column goes on holding whatever the operator will stand behind. That also
-- keeps this migration reversible against rows that already carry a volume.
--
-- **Average depth, and the form says so.** `length × width × (min + max) / 2`,
-- cubic metres, times 1000. Exact for an evenly sloping floor; an estimate for a
-- flat shallow section and a sudden trough — which is exactly why the number is
-- offered rather than imposed.
--
-- **`numeric`, not float, and now not `integer` either.** The old column could
-- not hold the two decimals the calculation produces and would have truncated
-- them silently. The widening is lossless: every whole number already stored
-- survives it unchanged.

ALTER TABLE pool
  ADD COLUMN min_depth_m numeric(5,2);

COMMENT ON COLUMN pool.min_depth_m IS 'Metres, at the shallowest point.';

ALTER TABLE pool
  -- Same reasoning as its three siblings: zero is an empty form, not a
  -- measurement, and the importer in 1.10 is a second write path.
  ADD CONSTRAINT pool_min_depth_positive CHECK (min_depth_m IS NULL OR min_depth_m > 0),
  -- The deep end is not shallower than the shallow end. Equality is ordinary —
  -- a flat-bottomed teaching tank has one depth, entered at both ends.
  ADD CONSTRAINT pool_depth_order CHECK (
    max_depth_m IS NULL OR min_depth_m IS NULL OR max_depth_m >= min_depth_m
  );

ALTER TABLE pool
  ALTER COLUMN volume_litres TYPE numeric(12,2);

COMMENT ON COLUMN pool.volume_litres IS
  'Litres. Offered from the dimensions when all four are present, and overridable — not every pool is a box.';

-- Down Migration

ALTER TABLE pool
  DROP CONSTRAINT IF EXISTS pool_depth_order,
  DROP CONSTRAINT IF EXISTS pool_min_depth_positive;

-- Rounding rather than truncating, so a pool stored as 562500.50 comes back as
-- 562501 instead of quietly losing half a litre.
ALTER TABLE pool
  ALTER COLUMN volume_litres TYPE integer USING round(volume_litres)::integer;

ALTER TABLE pool
  DROP COLUMN IF EXISTS min_depth_m;
