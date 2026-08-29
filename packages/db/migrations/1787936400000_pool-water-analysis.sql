-- Up Migration
--
-- Water quality — round 4.
--
-- `readings-block.tsx` has been a styled placeholder since phase 1, on the
-- explicit grounds that readings are time-series with per-metric units and
-- guessing at the shape a month early would be worse than an honest empty
-- panel. The ask now is specific enough to build against: record each analysis,
-- show how a value has moved between analyses, and export the set as a report.
--
-- **Two tables, not one.** An analysis is a visit — somebody dipped a probe or a
-- lab sent a sheet back — and it carries one date, one author and one set of
-- notes. The individual measurements hang off it. The alternative, one flat row
-- per measurement with the date repeated, makes "the analysis" a group-by rather
-- than a thing, and the report this round has to export is per analysis. Notes
-- would also have nowhere honest to live: "sample taken before backwash"
-- describes the visit, not the pH.
--
-- **Not a hypertable, and deliberately not.** CLAUDE.md puts TimescaleDB in the
-- stack for energy and sensor time-series, and the skill is right that a
-- hypertable cannot carry a surrogate `id`. This is neither: it is a handful of
-- operator-entered rows per pool per month, which an operator edits and archives
-- like any other record. It wants a normal primary key and a normal soft delete.
-- When automated probes land they get their own `reading` table with a natural
-- composite key, and this one stays what it is — the manual record.
--
-- **`numeric(10,3)` with an explicit unit per row**, as CLAUDE.md requires. pH,
-- °C and ppm do not share a type and must not share a column with an implied
-- unit. The unit is stored rather than derived so that a row read five years
-- from now still says what it meant, even if the app's idea of the canonical
-- unit for a metric has moved.

-- The metrics a club actually tests for. An enum rather than a lookup table
-- because this set is closed in practice — it is the standard panel on every
-- pool test kit sold — and because the chart and the report need to know what
-- each one is to label an axis. Adding one is a migration, which is the right
-- cost for a change that also needs a translation and an axis label.
CREATE TYPE pool_metric AS ENUM (
  'ph',
  'temperature',
  'free_chlorine',
  'combined_chlorine',
  'total_alkalinity',
  'calcium_hardness',
  'cyanuric_acid',
  'turbidity',
  'salt'
);

-- ---------------------------------------------------------------------------
-- pool_analysis — the visit
-- ---------------------------------------------------------------------------

CREATE TABLE pool_analysis (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  pool_id         uuid NOT NULL,

  -- UTC, displayed in the facility's timezone, like every other instant in this
  -- schema. A water analysis is stamped to the minute the sample was taken and
  -- not to the day: two analyses on either side of a chlorine dose on the same
  -- afternoon are the whole point of the trend.
  taken_at        timestamptz NOT NULL,

  -- Who recorded it. Nullable because an analysis imported from a lab sheet has
  -- no member behind it, and inventing one would be a lie in the audit trail.
  recorded_by     uuid,

  -- About the visit, not about any one measurement: "sample taken before
  -- backwash", "lab report 2026-114".
  notes           text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  -- The composite reference: an analysis cannot be attached to another
  -- organization's pool.
  FOREIGN KEY (organization_id, pool_id)
    REFERENCES pool (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by)
    REFERENCES membership (organization_id, id),

  -- A sample taken in 1974 is a typo, and one taken next year is a different
  -- typo. The upper bound is generous rather than `now()` because a CHECK
  -- against `now()` is not immutable and would fail on restore.
  CHECK (taken_at > TIMESTAMPTZ '2000-01-01')
);

COMMENT ON TABLE pool_analysis IS
  'One water-quality analysis of a pool: a moment, an author, and the values measured then.';
COMMENT ON COLUMN pool_analysis.taken_at IS
  'When the sample was taken, UTC. Displayed in the facility timezone.';

-- Two analyses of one pool at the same instant is a double submit, not a second
-- sample. Partial, as every unique index on a soft-deletable table here is:
-- archiving a mistyped analysis must not block re-entering it at the same time.
CREATE UNIQUE INDEX pool_analysis_moment_uq
  ON pool_analysis (organization_id, pool_id, taken_at)
  WHERE archived_at IS NULL;

-- The chart's query: every analysis for one pool, newest first.
CREATE INDEX pool_analysis_pool_idx
  ON pool_analysis (organization_id, pool_id, taken_at DESC)
  WHERE archived_at IS NULL;

CREATE TRIGGER pool_analysis_updated_at BEFORE UPDATE ON pool_analysis
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- pool_analysis_value — one measurement within a visit
-- ---------------------------------------------------------------------------

CREATE TABLE pool_analysis_value (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  analysis_id     uuid NOT NULL,

  metric          pool_metric NOT NULL,

  -- numeric, never float. Three decimals covers a pH of 7.245 and a free
  -- chlorine of 0.625 ppm with room to spare.
  value           numeric(10,3) NOT NULL,

  -- Stored, not derived. See the header.
  unit            text NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  -- ON DELETE CASCADE because a measurement means nothing without its analysis,
  -- and an analysis is archived rather than deleted in ordinary use — this fires
  -- only when one is genuinely destroyed.
  FOREIGN KEY (organization_id, analysis_id)
    REFERENCES pool_analysis (organization_id, id) ON DELETE CASCADE,

  -- One value per metric per analysis. Not partial: this table has no
  -- `archived_at` — a measurement is corrected in place or removed with its
  -- analysis, and a half-archived analysis is not a state worth having.
  UNIQUE (analysis_id, metric),

  CHECK (btrim(unit) <> ''),
  -- No negative measurement is meaningful on this panel, and pH has a real
  -- ceiling. The rest are bounded loosely, to catch a decimal point in the
  -- wrong place without arguing with an unusual pool.
  CHECK (value >= 0),
  CHECK (metric <> 'ph' OR value <= 14)
);

COMMENT ON TABLE pool_analysis_value IS
  'One measured value within an analysis. Its unit travels with it — pH, °C and ppm do not share a type.';

CREATE INDEX pool_analysis_value_analysis_idx
  ON pool_analysis_value (organization_id, analysis_id);

-- The trend query reads one metric across every analysis of a pool.
CREATE INDEX pool_analysis_value_metric_idx
  ON pool_analysis_value (organization_id, metric);

CREATE TRIGGER pool_analysis_value_updated_at BEFORE UPDATE ON pool_analysis_value
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE pool_analysis       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_analysis_value ENABLE ROW LEVEL SECURITY;

CREATE POLICY pool_analysis_tenant ON pool_analysis
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY pool_analysis_value_tenant ON pool_analysis_value
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON pool_analysis       TO poolse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pool_analysis_value TO poolse_app;

-- Down Migration

DROP POLICY IF EXISTS pool_analysis_value_tenant ON pool_analysis_value;
DROP POLICY IF EXISTS pool_analysis_tenant       ON pool_analysis;

DROP TABLE IF EXISTS pool_analysis_value;
DROP TABLE IF EXISTS pool_analysis;

DROP TYPE IF EXISTS pool_metric;
