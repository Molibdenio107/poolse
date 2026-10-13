import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  excursions,
  freeChlorineBand,
  METRIC_UNITS,
  NATIONAL_BANDS,
  nationalBands,
  POOL_METRICS,
  resolveBands,
  temperatureBand,
} from './water.js';

/**
 * The band rule — slice 4.2, rebuilt on NP 4542:2017 by POOLSE-72.
 *
 * It decides whether a club's staff are emailed, which is the point at which
 * "it looks right on screen" stops being enough: a boundary read as exclusive
 * would page somebody every time a pH landed exactly on 8.0. Every figure here
 * is cited in `water.ts` and in `docs/research/water-reference-2026-10.md`.
 */

const COVERED = { kind: 'indoor', use: null } as const;

test('a reading inside its band is not an excursion, boundaries included', () => {
  assert.deepEqual(
    excursions([
      { metric: 'ph', value: 7.4, unit: 'pH' },
      { metric: 'free_chlorine', value: 1.0, unit: 'ppm' },
    ]),
    [],
  );
  // Inclusive at both ends: NP 4542's 6,5 a 8,0 means both are acceptable.
  assert.deepEqual(excursions([{ metric: 'ph', value: 6.5, unit: 'pH' }]), []);
  assert.deepEqual(excursions([{ metric: 'ph', value: 8.0, unit: 'pH' }]), []);
});

test('a reading outside its band says which side it fell off', () => {
  const [high] = excursions([{ metric: 'ph', value: 8.4, unit: 'pH' }]);
  assert.equal(high?.direction, 'high');
  assert.equal(high?.from, 6.5);
  assert.equal(high?.to, 8.0);

  const [low] = excursions([{ metric: 'free_chlorine', value: 0.1, unit: 'ppm' }]);
  assert.equal(low?.direction, 'low');
  assert.equal(low?.metric, 'free_chlorine');
});

test('QA 1: covered free chlorine follows the pH measured in the same analysis', () => {
  const bands = nationalBands(COVERED);

  // pH 7.2 → 0.5–1.2, so 1.5 is high against 1.2.
  const [high] = excursions(
    [
      { metric: 'ph', value: 7.2, unit: 'pH' },
      { metric: 'free_chlorine', value: 1.5, unit: 'ppm' },
    ],
    bands,
  );
  assert.equal(high?.metric, 'free_chlorine');
  assert.equal(high?.limit, 1.2);
  assert.equal(high?.ph, 7.2);

  // pH 7.6 → 1.0–2.0, so the same 1.5 is inside.
  assert.deepEqual(
    excursions(
      [
        { metric: 'ph', value: 7.6, unit: 'pH' },
        { metric: 'free_chlorine', value: 1.5, unit: 'ppm' },
      ],
      bands,
    ),
    [],
  );

  // The split is at 7.4: 7.4 itself takes the low band.
  const [atSplit] = excursions(
    [
      { metric: 'ph', value: 7.4, unit: 'pH' },
      { metric: 'free_chlorine', value: 1.3, unit: 'ppm' },
    ],
    bands,
  );
  assert.equal(atSplit?.limit, 1.2);
});

test('QA 2: an open-air tank uses the open-air chlorine bands', () => {
  const bands = nationalBands({ kind: 'outdoor', use: null });
  assert.deepEqual(
    excursions(
      [
        { metric: 'ph', value: 7.6, unit: 'pH' },
        { metric: 'free_chlorine', value: 2.5, unit: 'ppm' },
      ],
      bands,
    ),
    [],
  );
  const [low] = excursions(
    [
      { metric: 'ph', value: 7.0, unit: 'pH' },
      { metric: 'free_chlorine', value: 0.6, unit: 'ppm' },
    ],
    bands,
  );
  assert.equal(low?.limit, 0.8);
});

test('QA 3: with no pH in the analysis, chlorine is judged by the widest band and says so', () => {
  const bands = nationalBands(COVERED);
  assert.deepEqual(excursions([{ metric: 'free_chlorine', value: 1.8, unit: 'ppm' }], bands), []);
  const [high] = excursions([{ metric: 'free_chlorine', value: 2.4, unit: 'ppm' }], bands);
  assert.equal(high?.limit, 2.0);
  assert.equal(high?.ph, null, 'the excursion says no pH was measured');
});

test('QA 4: temperature comes from what the tank is for, and an unset use judges nothing', () => {
  assert.equal(temperatureBand(null, 'indoor'), undefined);
  assert.deepEqual(
    excursions([{ metric: 'temperature', value: 45, unit: '°C' }], nationalBands(COVERED)),
    [],
  );

  const children = nationalBands({ kind: 'indoor', use: 'children' });
  const [low] = excursions([{ metric: 'temperature', value: 27, unit: '°C' }], children);
  assert.equal(low?.direction, 'low');
  assert.equal(low?.limit, 28);

  assert.deepEqual(temperatureBand('sport', 'indoor'), { from: 24, to: 26 });
  assert.deepEqual(temperatureBand('hydrotherapy', 'indoor'), { from: 30, to: 36 });
  // An open-air tank takes the heated open-air band whatever its use.
  assert.deepEqual(temperatureBand('children', 'outdoor'), { from: 24, to: 28 });
});

test('a metric with no national band produces nothing, however extreme', () => {
  for (const metric of ['calcium_hardness', 'salt'] as const) {
    assert.equal(NATIONAL_BANDS[metric], undefined);
    assert.deepEqual(
      excursions([{ metric, value: 9999, unit: METRIC_UNITS[metric] }]),
      [],
      `${metric} has no band and must never raise anything`,
    );
  }
});

test('every metric has a unit, and every band is the right way round', () => {
  for (const metric of POOL_METRICS) {
    assert.equal(typeof METRIC_UNITS[metric], 'string');
    assert.notEqual(METRIC_UNITS[metric], '');
  }
  const all = [
    ...Object.values(NATIONAL_BANDS),
    freeChlorineBand('indoor'),
    freeChlorineBand('outdoor'),
  ];
  for (const band of all) {
    assert.ok(band);
    if (band.from !== null && band.to !== null) assert.ok(band.from < band.to);
    if (band.byPh) {
      assert.ok(band.byPh.atOrBelow.from < band.byPh.atOrBelow.to);
      assert.ok(band.byPh.above.from < band.byPh.above.to);
    }
  }
});

/**
 * Per-pool bands. `resolveBands` is the only place a club's own numbers meet
 * the national ones; no override, an override, and an override that says
 * "do not judge this at all" are three different answers.
 */

test('QA 5: with no overrides, the national bands stand', () => {
  const bands = resolveBands([], COVERED);
  assert.deepEqual(bands.ph, { from: 6.5, to: 8.0 });
  assert.ok(bands.free_chlorine?.byPh, 'free chlorine keeps its pH split');
});

test('QA 5: an override replaces the national band for that metric only, split included', () => {
  const bands = resolveBands(
    [
      { metric: 'ph', from: 7.2, to: 7.6 },
      { metric: 'free_chlorine', from: 1, to: 3 },
    ],
    COVERED,
  );
  assert.deepEqual(bands.ph, { from: 7.2, to: 7.6 });
  assert.deepEqual(bands.free_chlorine, { from: 1, to: 3 }, "a club's own range is its whole answer");
  assert.deepEqual(bands.total_alkalinity, { from: 75, to: 250 }, 'the others are untouched');
});

test('an override with neither bound drops the metric rather than falling back', () => {
  const bands = resolveBands(
    [{ metric: 'temperature', from: null, to: null }],
    { kind: 'indoor', use: 'sport' },
  );
  assert.equal(bands.temperature, undefined, 'not the national band');
  assert.deepEqual(excursions([{ metric: 'temperature', value: 45, unit: '°C' }], bands), []);
});

test('a one-sided band is judged on that side alone', () => {
  const bands = resolveBands([{ metric: 'temperature', from: 24, to: null }], COVERED);
  assert.deepEqual(excursions([{ metric: 'temperature', value: 34, unit: '°C' }], bands), []);
  const [low] = excursions([{ metric: 'temperature', value: 21, unit: '°C' }], bands);
  assert.equal(low?.limit, 24, 'the crossed bound is always a number');
  assert.equal(low?.to, null, 'and the side nobody judges stays null');
});

test('an override can give a band to a metric that never had one', () => {
  const bands = resolveBands([{ metric: 'salt', from: 3000, to: 4000 }], COVERED);
  const [high] = excursions([{ metric: 'salt', value: 4500, unit: 'ppm' }], bands);
  assert.equal(high?.limit, 4000);
});

test('resolveBands does not mutate the national constant', () => {
  resolveBands([{ metric: 'ph', from: 1, to: 2 }], COVERED);
  resolveBands([{ metric: 'turbidity', from: null, to: null }], COVERED);
  assert.deepEqual(NATIONAL_BANDS.ph, { from: 6.5, to: 8.0 });
  assert.deepEqual(NATIONAL_BANDS.turbidity, { from: null, to: 1.5 });
});
