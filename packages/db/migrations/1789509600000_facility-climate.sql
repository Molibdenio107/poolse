-- Up Migration
--
-- Air temperature, kept beside consumption — roadmap 5.3/5.4's remaining half
-- and POOLSE-28 AC 7, "weather data is retained alongside consumption so a cold
-- week is explicable".
--
-- **Why air and not water.** Poolse already stores water temperature, in
-- `pool_analysis`. It is useless for this: a heated tank is held at a setpoint
-- all year, so plotting it against consumption produces a flat line that looks
-- like insight and is none. What makes January expensive is how cold it was
-- *outside*, which is the one thing the product did not hold — the existing
-- Open-Meteo integration is a live forecast for a panel and keeps no history.
--
-- **It is context, never a correction.** Nothing here adjusts a headline figure.
-- The club is told what it used, what it cost, and how cold it was, and draws
-- its own conclusion. A "weather-normalised consumption" would be a model with
-- opinions, presented with the confidence of a measurement — the thing AC 5 of
-- that same ticket exists to forbid.
--
-- **A cache of public data, so no soft delete and no author.** Every row is
-- refetchable from a public API by (place, month) and no person writes one, so
-- there is no operator act to undo and nobody to record — the reasoning
-- `tenant_request_stats` already uses. `fetched_at` says how stale it is, and a
-- refetch overwrites in place. It is still tenant-scoped, because the *facility*
-- is: where a club's pools are is not public information about the club.
--
-- **`heating_degree_days` is stored with the base it was computed against.** HDD
-- is what the energy world actually correlates against — the sum over the month
-- of how far each day fell below a threshold — and it is far better than a mean
-- for explaining a heating bill, because a month of 10 °C days and a month
-- averaging 10 °C around a mild spell are different amounts of heating. The base
-- is a judgement (15.5 °C is the usual European figure) and judgements change,
-- so the row carries the one it used rather than leaving every historical value
-- silently re-meaning itself the day somebody edits a constant.

CREATE TABLE facility_climate_month (
  organization_id uuid NOT NULL REFERENCES organization (id),
  facility_id     uuid NOT NULL,

  -- The first day of the month, in the facility's own clock. A `date` and not a
  -- pair of integers: it sorts, it subtracts, and it cannot hold month 13.
  month           date NOT NULL,

  /*
   * Degrees Celsius. `numeric(4,1)` holds -99.9 to 999.9 — far beyond anywhere
   * a pool has ever been built, and exact, which a float is not.
   */
  mean_temp_c     numeric(4,1) NOT NULL,
  min_temp_c      numeric(4,1),
  max_temp_c      numeric(4,1),

  /*
   * Heating degree days for the month, and the base they were computed against.
   * Sum over the month's days of max(0, base - that day's mean).
   */
  heating_degree_days numeric(7,1) NOT NULL,
  hdd_base_c          numeric(4,1) NOT NULL,

  /*
   * How many days actually had a reading. The archive is complete for past
   * months and partial for the current one, and a month built from nine days is
   * not comparable with one built from thirty-one — so the count travels with
   * the figure and the screen can leave a partial month out.
   */
  days_counted    smallint NOT NULL,

  -- Where it came from. Text rather than an enum: a second source is a row, and
  -- this is a cache rather than a decision the schema should police.
  source          text NOT NULL DEFAULT 'open_meteo',
  fetched_at      timestamptz NOT NULL DEFAULT now(),

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- One row per site per month. The natural key: there is no second answer to
  -- "how cold was it in Leiria last January", so there is no surrogate id.
  PRIMARY KEY (organization_id, facility_id, month),

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),

  CONSTRAINT facility_climate_month_is_first
    CHECK (month = date_trunc('month', month)::date),
  CONSTRAINT facility_climate_month_plausible
    CHECK (mean_temp_c BETWEEN -60 AND 60),
  CONSTRAINT facility_climate_month_ordered
    CHECK (
      (min_temp_c IS NULL OR min_temp_c <= mean_temp_c)
      AND (max_temp_c IS NULL OR max_temp_c >= mean_temp_c)
    ),
  CONSTRAINT facility_climate_month_hdd_positive
    CHECK (heating_degree_days >= 0),
  CONSTRAINT facility_climate_month_days_counted
    CHECK (days_counted BETWEEN 1 AND 31),
  CONSTRAINT facility_climate_month_source_not_blank
    CHECK (btrim(source) <> '')
);

COMMENT ON TABLE facility_climate_month IS
  'Monthly outside air temperature at a site, cached from a public archive. Context for energy consumption, never a correction to it. Refetchable, so no soft delete and no author.';

COMMENT ON COLUMN facility_climate_month.heating_degree_days IS
  'Sum over the month of max(0, hdd_base_c - that day''s mean). What actually explains a heating bill; a mean cannot tell a cold month from a mild one with a cold snap.';

COMMENT ON COLUMN facility_climate_month.hdd_base_c IS
  'The base the figure above was computed against, stored so changing the constant later cannot silently re-mean every historical row.';

COMMENT ON COLUMN facility_climate_month.days_counted IS
  'Days with data. The current month is partial and a month of nine days is not comparable with one of thirty-one.';

CREATE TRIGGER facility_climate_month_updated_at
  BEFORE UPDATE ON facility_climate_month
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE facility_climate_month ENABLE ROW LEVEL SECURITY;

CREATE POLICY facility_climate_month_tenant ON facility_climate_month
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- No DELETE: a month's weather is not an operator's to remove, and a wrong row
-- is corrected by refetching it. INSERT and UPDATE are the upsert the filler
-- performs.
GRANT SELECT, INSERT, UPDATE ON facility_climate_month TO poolse_app;

-- Down Migration

DROP POLICY IF EXISTS facility_climate_month_tenant ON facility_climate_month;
DROP TABLE IF EXISTS facility_climate_month;
