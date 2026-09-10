-- Up Migration
--
-- A pool's own safe range — slice 4.2, second half.
--
-- 4.2 shipped with the published Portuguese municipal bands as the only ones,
-- and said so: a hotel tank kept at 30 °C is outside the temperature band every
-- day of its life, so it would have raised an alert every day until somebody
-- stopped reading them. This is the table that lets a club say what its own
-- water is supposed to look like.
--
-- **A row is an exception, and no row is the answer for almost every pool.** The
-- alternative — seeding nine rows per pool from the published set — was
-- rejected: it makes "has anybody changed this?" unanswerable, it silently
-- freezes every tank at whatever the constant said the day the pool was created,
-- and a later correction to a published band would then reach nobody. So the
-- published values stay in `@poolse/rules` as the default, and this table holds
-- only what a club has deliberately decided.
--
-- **Both bounds are nullable and independent, and a null bound is not judged.**
-- The standing rule about `pool.max_capacity` and every other ceiling here,
-- applied to a threshold: an outdoor tank can carry a floor and no ceiling. It
-- also gives the off switch for free — a row with neither bound means this pool
-- is not judged on that metric at all, which is a different statement from
-- having no row, and `resolveBands` is where the difference is enforced.
--
-- **Soft-deleted, and the unique index is therefore partial**, as every unique
-- constraint on a soft-deletable table here is. A club that overrides pH,
-- reverts to the reference and overrides it again next season must not collide
-- with a dead row — and a threshold that decided whether anybody was warned is
-- worth keeping a record of, which is why reverting archives rather than
-- deletes.

CREATE TABLE pool_metric_range (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  pool_id         uuid NOT NULL,

  metric          pool_metric NOT NULL,

  -- numeric(10,3), matching `pool_analysis_value.value` exactly. A band compared
  -- against a reading of a different type is a comparison with a rounding step
  -- hidden in it.
  --
  -- No unit column, deliberately: the band is stated in the metric's own unit
  -- from `METRIC_UNITS`, which is the same unit every row Poolse writes carries.
  -- A band in one unit and a reading in another is not a state to make
  -- expressible.
  min_value       numeric(10,3),
  max_value       numeric(10,3),

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, pool_id)
    REFERENCES pool (organization_id, id),

  -- The same floor the readings carry: no negative measurement on this panel is
  -- meaningful, so no negative bound is either.
  CHECK (min_value IS NULL OR min_value >= 0),
  CHECK (max_value IS NULL OR max_value >= 0),

  -- A band with its ends the wrong way round would make every reading an
  -- excursion in both directions at once, which is the kind of typo that reads
  -- fine on a form. Equal is allowed: "exactly 7.4" is a strict club, not a bug.
  CHECK (min_value IS NULL OR max_value IS NULL OR max_value >= min_value),

  -- pH has a real ceiling, as it does on the value itself.
  CHECK (
    metric <> 'ph'
    OR ((min_value IS NULL OR min_value <= 14) AND (max_value IS NULL OR max_value <= 14))
  )
);

COMMENT ON TABLE pool_metric_range IS
  'One pool''s own safe range for one metric. No row means the published band applies; a row with neither bound means the metric is not judged on this pool.';
COMMENT ON COLUMN pool_metric_range.min_value IS
  'Floor, in the metric''s own unit. Null is not judged from below — never read as zero.';
COMMENT ON COLUMN pool_metric_range.max_value IS
  'Ceiling, in the metric''s own unit. Null is not judged from above — never read as zero.';

-- Partial, because the table is soft-deletable. See the header.
CREATE UNIQUE INDEX pool_metric_range_uq
  ON pool_metric_range (organization_id, pool_id, metric)
  WHERE archived_at IS NULL;

-- The read every alert and every render makes: this tank's live overrides.
CREATE INDEX pool_metric_range_pool_idx
  ON pool_metric_range (organization_id, pool_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER pool_metric_range_updated_at BEFORE UPDATE ON pool_metric_range
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE pool_metric_range ENABLE ROW LEVEL SECURITY;

CREATE POLICY pool_metric_range_tenant ON pool_metric_range
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- All four, unlike the alert beside it. This is a setting rather than a record:
-- it is edited in place and reverted by archiving, and nothing about it is a
-- statement that something happened.
GRANT SELECT, INSERT, UPDATE, DELETE ON pool_metric_range TO poolse_app;

-- Down Migration

DROP POLICY IF EXISTS pool_metric_range_tenant ON pool_metric_range;

DROP TABLE IF EXISTS pool_metric_range;
