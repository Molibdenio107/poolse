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
 * Per-pool overrides are the next slice, not this one: a hotel tank kept at
 * 30 °C is a real case and it is out of range here. When they arrive, a null
 * bound means "not measured" and enforces nothing, as every other ceiling in
 * this schema does.
 */
export const HEALTHY: Partial<Record<PoolMetric, { from: number; to: number }>> = {
  ph: { from: 7.2, to: 7.6 },
  temperature: { from: 25, to: 29 },
  free_chlorine: { from: 0.5, to: 2 },
  combined_chlorine: { from: 0, to: 0.6 },
  total_alkalinity: { from: 80, to: 120 },
};

export interface Excursion {
  metric: PoolMetric;
  value: number;
  unit: string;
  from: number;
  to: number;
  /** Which side it fell off, so the message can say "too high" rather than "wrong". */
  direction: 'low' | 'high';
}

/**
 * Every reading in an analysis that sits outside its published band.
 *
 * **Only the metrics with a band are judged.** A pool with an unusual cyanuric
 * acid level produces no excursion here, because nothing in this file knows what
 * a bad one would be — and a warning derived from a number nobody chose is a
 * warning an operator learns to ignore.
 *
 * The result is deliberately a list rather than a boolean. "The water is unsafe"
 * is not something to tell somebody without saying which reading says so: an
 * operator who is about to close a pool for three days needs to know it was the
 * combined chlorine, not that a computer disapproved. The alert email is built
 * from the same list for the same reason.
 */
export function excursions(
  values: { metric: PoolMetric; value: number; unit: string }[],
): Excursion[] {
  const out: Excursion[] = [];

  for (const reading of values) {
    const band = HEALTHY[reading.metric];
    if (band === undefined) continue;

    if (reading.value < band.from) {
      out.push({ ...reading, from: band.from, to: band.to, direction: 'low' });
    } else if (reading.value > band.to) {
      out.push({ ...reading, from: band.from, to: band.to, direction: 'high' });
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
