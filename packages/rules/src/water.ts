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
 * What a tank is for — POOLSE-72. NP 4542:2017 Anexo D sets the water
 * temperature by it; null means nobody said, and temperature is then not
 * judged rather than guessed. Kept in step with the `pool_use` enum by hand.
 */
export const POOL_USES = ['sport', 'diving', 'learning', 'children', 'hydrotherapy'] as const;
export type PoolUse = (typeof POOL_USES)[number];

/** `pool.kind`: covered or open-air, which changes the free-chlorine band. */
export type PoolKind = 'indoor' | 'outdoor';

/** What a band needs to know about the tank it is for. */
export interface PoolContext {
  kind: PoolKind | null;
  use: PoolUse | null;
}

/**
 * A band that changes with the pH measured in the same analysis — free
 * chlorine, NP 4542 Quadro 2. At or below `at` the first band applies, above
 * it the second. NP 4542 leaves pH 7.4–7.5 uncovered for covered tanks; the
 * split at 7.4 is Poolse's decision (decisions, 13-10-2026).
 */
export interface PhSplit {
  at: number;
  atOrBelow: { from: number; to: number };
  above: { from: number; to: number };
}

/**
 * A band a reading is judged against.
 *
 * Both bounds are optional and independent, and **a null bound is not judged** —
 * the same rule as `pool.max_capacity` and every other ceiling in this schema.
 * So an outdoor tank can carry a floor and no ceiling, and a band with neither
 * bound is a metric this pool is not judged on at all.
 *
 * `byPh`, when present, is what the reading is actually judged by whenever the
 * same analysis carries a pH; `from`/`to` are then the union of its two sides —
 * the widest the reference allows, used when no pH was measured and for
 * drawing the band on a chart.
 */
export interface Band {
  from: number | null;
  to: number | null;
  byPh?: PhSplit;
}

/**
 * The national reference — **NP 4542:2017**, the standard Portuguese health
 * authorities grade pool samples with (decisions, 13-10-2026). Every figure is
 * cited to its quadro; the source record, with the text quoted and what is still
 * unverified, is `docs/research/water-reference-2026-10.md`.
 *
 * **These replace values that cited nothing** (pH 7.2–7.6, a flat chlorine
 * 0.5–2, 25–29 °C, alkalinity 80–120). A pool with no override of its own moves
 * to these the day they ship, which is the point.
 *
 * Free chlorine and temperature are not here: both depend on the tank, and
 * `nationalBands()` adds them. Calcium hardness and salt have no national band
 * and are judged only where a club sets one — a warning derived from a number
 * nobody chose is a warning an operator learns to ignore.
 */
export const NATIONAL_BANDS: Readonly<Partial<Record<PoolMetric, Band>>> = Object.freeze({
  // Quadro 2: VL 6,5 a 8,0. (With chlorine, "de preferência entre 7,0 e 7,4" —
  // a preference, not a limit, and not what an inspector grades.)
  ph: { from: 6.5, to: 8.0 },
  // Quadro 2: total chlorine "Máximo: cloro residual livre + 0,5 mg/L", so the
  // combined part is at most 0,5.
  combined_chlorine: { from: null, to: 0.5 },
  // Quadro 2: ≤ 100 mg/L, where stabilised chlorine is used.
  cyanuric_acid: { from: null, to: 100 },
  // Quadro 1: "Entre 75 mg/L e 250 mg/L CaCO3".
  total_alkalinity: { from: 75, to: 250 },
  // Quadro 1: ≤ 1,5 UNT.
  turbidity: { from: null, to: 1.5 },
});

/**
 * Free chlorine by pH — NP 4542 Quadro 2.
 *
 * Covered: 0,5–1,2 mg/L at pH 6,5–7,4 and 1,0–2,0 at pH 7,5–8,0.
 * Open-air: 0,8–1,5 at pH 6,5–7,4 and 1,5–3,0 at pH 7,4–8,0.
 * A tank whose kind is unknown is judged as covered, the stricter of the two.
 */
export function freeChlorineBand(kind: PoolKind | null): Band {
  const split: PhSplit =
    kind === 'outdoor'
      ? { at: 7.4, atOrBelow: { from: 0.8, to: 1.5 }, above: { from: 1.5, to: 3.0 } }
      : { at: 7.4, atOrBelow: { from: 0.5, to: 1.2 }, above: { from: 1.0, to: 2.0 } };
  return {
    from: Math.min(split.atOrBelow.from, split.above.from),
    to: Math.max(split.atOrBelow.to, split.above.to),
    byPh: split,
  };
}

/**
 * Water temperature by what the tank is for — NP 4542 Anexo D, Quadro D.1.
 *
 * Undefined when the use is unset: not judged rather than guessed. An open-air
 * tank takes the standard's 24–28 °C for heated open-air pools whatever its use.
 */
export function temperatureBand(use: PoolUse | null, kind: PoolKind | null): Band | undefined {
  if (use === null) return undefined;
  if (kind === 'outdoor') return { from: 24, to: 28 };
  switch (use) {
    case 'sport':
      return { from: 24, to: 26 };
    case 'diving':
    case 'learning':
      return { from: 26, to: 28 };
    case 'children':
      return { from: 28, to: 32 };
    case 'hydrotherapy':
      return { from: 30, to: 36 };
  }
}

/** The national reference for one tank: the fixed bands plus the two that depend on it. */
export function nationalBands(pool: PoolContext): BandMap {
  const bands: BandMap = { ...NATIONAL_BANDS, free_chlorine: freeChlorineBand(pool.kind) };
  const temperature = temperatureBand(pool.use, pool.kind);
  if (temperature !== undefined) bands.temperature = temperature;
  return bands;
}

/** What a pool overrides, as it comes out of `pool_metric_range`. */
export interface BandOverride {
  metric: PoolMetric;
  from: number | null;
  to: number | null;
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
  /**
   * For a band that depends on pH (free chlorine): the pH it was judged at, or
   * null when the analysis measured none and the widest band was used — which
   * the screen says. Absent for every other metric.
   */
  ph?: number | null;
}

/**
 * The band each metric is judged by on one pool, the national reference
 * overridden by the club.
 *
 * **One merge, in one place, or the screen and the email disagree** — which is
 * the failure 4.2 existed to fix and would be reintroduced by a second copy of
 * this loop. The API resolves it and ships the answer; the client renders what
 * it is given and never merges anything itself.
 *
 * The tank is required: free chlorine depends on whether it is covered and
 * temperature on what it is for (POOLSE-72), so a caller with a pool in hand
 * must say which pool.
 *
 * Three states, and the third is the reason the bounds are nullable:
 *
 * - **No override** — the national band stands. The ordinary case.
 * - **An override with a bound** — that bound, on that side, and no pH split:
 *   a club's own chlorine range is the club's whole answer.
 * - **An override with neither bound** — the metric is dropped from the map, so
 *   this pool is not judged on it at all. A hotel tank kept at 30 °C is the case:
 *   without this it would alert every day.
 */
export function resolveBands(overrides: readonly BandOverride[], pool: PoolContext): BandMap {
  const bands = nationalBands(pool);

  for (const override of overrides) {
    if (override.from === null && override.to === null) {
      // Not "fall back to the national band" — an explicit refusal to judge.
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
 * **`values` is one analysis.** That is what lets a pH-dependent band work with
 * no change to any caller: free chlorine is judged by the pH measured in the
 * same set of values, never the latest pH from another visit. With no pH in
 * it, the reading is judged against the widest band the reference allows and
 * the excursion says `ph: null`.
 *
 * **Only the metrics with a band are judged.** The same silence covers a metric
 * a pool has switched off, which is the same statement arrived at deliberately.
 *
 * `bands` defaults to the national reference for a covered tank of unknown use,
 * so a caller with no pool in hand — a unit test, or a screen showing what the
 * reference says — gets the reference. Every caller that has a pool passes that
 * pool's resolved map.
 *
 * The result is a list rather than a boolean: an operator who is about to close
 * a pool needs to know it was the combined chlorine, not that a computer
 * disapproved. The alert email is built from the same list.
 */
export function excursions(
  values: { metric: PoolMetric; value: number; unit: string }[],
  bands: BandMap = nationalBands({ kind: null, use: null }),
): Excursion[] {
  const out: Excursion[] = [];
  const ph = values.find((reading) => reading.metric === 'ph')?.value ?? null;

  for (const reading of values) {
    const band = bands[reading.metric];
    if (band === undefined) continue;

    let from = band.from;
    let to = band.to;
    let judgedAt: { ph: number | null } | undefined;
    if (band.byPh !== undefined) {
      if (ph !== null) {
        const side = ph <= band.byPh.at ? band.byPh.atOrBelow : band.byPh.above;
        from = side.from;
        to = side.to;
      }
      judgedAt = { ph };
    }

    if (from !== null && reading.value < from) {
      out.push({ ...reading, from, to, direction: 'low', limit: from, ...judgedAt });
    } else if (to !== null && reading.value > to) {
      out.push({ ...reading, from, to, direction: 'high', limit: to, ...judgedAt });
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
