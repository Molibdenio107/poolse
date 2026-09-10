/**
 * Water quality — the metrics, their units, and what "in range" means.
 *
 * **Here because slice 4.2 needs it on both sides.** These constants were
 * written three times: `POOL_METRICS` and `METRIC_UNITS` in
 * `apps/api/src/facilities/analyses.repository.ts`, `POOL_METRICS` again in
 * `apps/web/src/lib/pool-metrics.ts` with a comment admitting the copy was kept
 * in step by hand, and `HEALTHY` / `excursions` in `apps/web/src/lib/water.ts`
 * where only the browser could reach them. The alert fires where the analysis is
 * written, which is the API — so the band rule had to be somewhere both apps can
 * import, and a fourth copy in `apps/api` is the failure this package exists to
 * prevent. Same argument as `isValidNif`: a screen that flags a reading the API
 * thinks is fine, or the reverse, is worse than either behaviour on its own.
 *
 * **Pure**, like everything else here. No database, no clock, no fetch — which
 * is what lets the pool page render a band and the request handler judge a
 * reading against the same numbers.
 *
 * The old locations are now one-line re-exports, so no call site changed.
 */

/**
 * The metrics `pool_metric` allows.
 *
 * Kept in step with the enum by hand — adding one is a migration, a unit and two
 * translations, so it is not a change anybody makes by accident. An enum rather
 * than a lookup table because the set is closed in practice: it is the standard
 * panel on every pool test kit sold.
 */
export const POOL_METRICS = [
  'ph',
  'temperature',
  'free_chlorine',
  'combined_chlorine',
  'total_alkalinity',
  'calcium_hardness',
  'cyanuric_acid',
  'turbidity',
  'salt',
] as const;

export type PoolMetric = (typeof POOL_METRICS)[number];

/**
 * The unit each metric is measured in.
 *
 * The single source of it. `pool_analysis_value.unit` stores a unit per row — so
 * a reading taken today still says what it meant in five years, whatever this
 * table comes to say — but every row Poolse writes takes its unit from here, so
 * the app never produces two spellings of "ppm" for one metric.
 */
export const METRIC_UNITS: Record<PoolMetric, string> = {
  ph: 'pH',
  temperature: '°C',
  free_chlorine: 'ppm',
  combined_chlorine: 'ppm',
  total_alkalinity: 'ppm',
  calcium_hardness: 'ppm',
  cyanuric_acid: 'ppm',
  turbidity: 'NTU',
  salt: 'ppm',
};

/**
 * What "in range" means for a pool.
 *
 * **These are the ranges a Portuguese municipal pool is inspected against.** The
 * five metrics listed have a published band; the other four do not get an
 * invented one, because presenting a guess in the same visual language as a
 * regulation is worse than showing no band at all — and because slice 4.2 sends
 * email off the back of these, and a threshold nobody chose would be a threshold
 * that pages somebody at midnight for no reason.
 *
 * **These are the defaults, not the whole answer.** A pool may override any of
 * them, drop one bound, or switch a metric off entirely — `resolveBands` is
 * where the two meet, and `pool_metric_range` is where a club's own numbers
 * live. Nothing reads this constant directly except that function and a caller
 * that genuinely means "what does the regulation say".
 */
export const HEALTHY: Partial<Record<PoolMetric, { from: number; to: number }>> = {
  ph: { from: 7.2, to: 7.6 },
  temperature: { from: 25, to: 29 },
  free_chlorine: { from: 0.5, to: 2 },
  combined_chlorine: { from: 0, to: 0.6 },
  total_alkalinity: { from: 80, to: 120 },
};

/**
 * A band a reading is judged against.
 *
 * Both bounds are optional and independent, and **a null bound is not judged** —
 * the same rule as `pool.max_capacity` and every other ceiling in this schema.
 * So an outdoor tank can carry a floor and no ceiling, and a band with neither
 * bound is a metric this pool is not judged on at all.
 */
export interface Band {
  from: number | null;
  to: number | null;
}

/** What a pool overrides, as it comes out of `pool_metric_range`. */
export interface BandOverride extends Band {
  metric: PoolMetric;
}

/**
 * The effective band per metric. A metric absent from the map is not judged —
 * either because nothing published a band for it, or because this pool switched
 * it off.
 */
export type BandMap = Partial<Record<PoolMetric, Band>>;

export interface Excursion {
  metric: PoolMetric;
  value: number;
  unit: string;
  from: number | null;
  to: number | null;
  /** Which side it fell off, so the message can say "too high" rather than "wrong". */
  direction: 'low' | 'high';
  /**
   * The bound that was actually crossed — `to` for a high reading, `from` for a
   * low one.
   *
   * Always a number, which is what makes every sentence about an excursion
   * sayable without a null check: a reading cannot be above a ceiling that does
   * not exist. The full range is still on the row for the sentence that wants to
   * name both ends, and it is null on the side that is not judged.
   */
  limit: number;
}

/**
 * The band each metric is judged by on one pool, published values overridden.
 *
 * **One merge, in one place, or the screen and the email disagree** — which is
 * the failure 4.2 existed to fix and would be reintroduced by a second copy of
 * this loop. The API resolves it and ships the answer; the client renders what
 * it is given and never merges anything itself.
 *
 * Three states, and the third is the reason the bounds are nullable:
 *
 * - **No override** — the published band stands. The ordinary case, and what
 *   every pool has until somebody says otherwise.
 * - **An override with a bound** — that bound, on that side. A tank with a floor
 *   and no ceiling is judged only from below.
 * - **An override with neither bound** — the metric is dropped from the map, so
 *   this pool is not judged on it at all. A hotel tank kept at 30 °C is the case:
 *   it is out of the published temperature band every day of its life, and
 *   without this it would alert every day.
 */
export function resolveBands(overrides: readonly BandOverride[]): BandMap {
  const bands: BandMap = { ...HEALTHY };

  for (const override of overrides) {
    if (override.from === null && override.to === null) {
      // Not "fall back to the published band" — an explicit refusal to judge.
      // The two are different answers and a club that switched temperature off
      // would be very surprised by the other one.
      delete bands[override.metric];
      continue;
    }

    bands[override.metric] = { from: override.from, to: override.to };
  }

  return bands;
}

/**
 * Every reading in an analysis that sits outside its band.
 *
 * **Only the metrics with a band are judged.** A pool with an unusual cyanuric
 * acid level produces no excursion here, because nothing in this file knows what
 * a bad one would be — and a warning derived from a number nobody chose is a
 * warning an operator learns to ignore. The same silence now covers a metric a
 * pool has switched off, which is the same statement arrived at deliberately.
 *
 * `bands` defaults to the published set, so a caller with no pool in hand — a
 * unit test, or a screen showing what the regulation says — gets the regulation.
 * Every caller that has a pool passes that pool's resolved map.
 *
 * The result is deliberately a list rather than a boolean. "The water is unsafe"
 * is not something to tell somebody without saying which reading says so: an
 * operator who is about to close a pool for three days needs to know it was the
 * combined chlorine, not that a computer disapproved. The alert email is built
 * from the same list for the same reason.
 */
export function excursions(
  values: { metric: PoolMetric; value: number; unit: string }[],
  bands: BandMap = HEALTHY,
): Excursion[] {
  const out: Excursion[] = [];

  for (const reading of values) {
    const band = bands[reading.metric];
    if (band === undefined) continue;

    if (band.from !== null && reading.value < band.from) {
      out.push({ ...reading, from: band.from, to: band.to, direction: 'low', limit: band.from });
    } else if (band.to !== null && reading.value > band.to) {
      out.push({ ...reading, from: band.from, to: band.to, direction: 'high', limit: band.to });
    }
  }

  return out;
}

/**
 * How stale a sample may be and still raise an alert — slice 4.2.
 *
 * **Because a club's first act is to import its history.** Forty lab sheets from
 * last winter, half of them out of range, would send forty emails about water
 * that was dosed and retested months ago — and an alert channel that opens with
 * forty false alarms is a channel nobody reads again. An analysis older than
 * this writes no alert and sends nothing; the pool's page still flags it, and the
 * band still shows on the chart, so nothing is hidden.
 *
 * The same window applies to the form as to the importer. An operator typing in
 * last month's sheet is doing the same thing as the importer, more slowly, and an
 * alert is about the water as it is now. Named here rather than inlined in the
 * SQL so both paths and the test read one number.
 */
export const ALERT_WINDOW_HOURS = 48;
