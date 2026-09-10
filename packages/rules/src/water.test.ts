import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excursions, HEALTHY, METRIC_UNITS, POOL_METRICS, resolveBands } from './water.js';

/**
 * The band rule — slice 4.2.
 *
 * It had no test at all while it only tinted a chart and drew a notice. It now
 * decides whether a club's staff are emailed, which is the point at which "it
 * looks right on screen" stops being enough: a boundary read as exclusive would
 * page somebody every time a pH landed exactly on 7.6.
 */

test('a reading inside its band is not an excursion, boundaries included', () => {
  assert.deepEqual(
    excursions([
      { metric: 'ph', value: 7.4, unit: 'pH' },
      { metric: 'temperature', value: 27, unit: '°C' },
    ]),
    [],
  );

  // Inclusive at both ends. A published band of 7.2–7.6 means 7.2 and 7.6 are
  // acceptable readings, not the first two that are not.
  assert.deepEqual(excursions([{ metric: 'ph', value: 7.2, unit: 'pH' }]), []);
  assert.deepEqual(excursions([{ metric: 'ph', value: 7.6, unit: 'pH' }]), []);
});

test('a reading outside its band says which side it fell off', () => {
  const [high] = excursions([{ metric: 'ph', value: 8.4, unit: 'pH' }]);
  assert.equal(high?.direction, 'high');
  assert.equal(high?.from, 7.2);
  assert.equal(high?.to, 7.6);

  const [low] = excursions([{ metric: 'free_chlorine', value: 0.1, unit: 'ppm' }]);
  assert.equal(low?.direction, 'low');
  assert.equal(low?.metric, 'free_chlorine');

  // "Too high" and "too low" are different things to do about a pool, which is
  // why the direction travels rather than a bare "out of range".
  assert.notEqual(high?.direction, low?.direction);
});

test('only the readings that failed are returned, and only they', () => {
  const failed = excursions([
    { metric: 'ph', value: 8.4, unit: 'pH' },
    { metric: 'temperature', value: 27, unit: '°C' },
    { metric: 'free_chlorine', value: 1.2, unit: 'ppm' },
    { metric: 'combined_chlorine', value: 0.9, unit: 'ppm' },
  ]);

  assert.deepEqual(
    failed.map((one) => one.metric),
    ['ph', 'combined_chlorine'],
  );
});

test('a metric with no published band produces nothing, however extreme', () => {
  // Four of the nine have no band, and inventing one would be worse than
  // showing none: a warning derived from a number nobody chose is a warning an
  // operator learns to ignore — and here it would be an email.
  const unbanded = POOL_METRICS.filter((metric) => HEALTHY[metric] === undefined);
  assert.equal(unbanded.length, 4);

  for (const metric of unbanded) {
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

  // A band written `from` above `to` would make every reading an excursion in
  // both directions at once, which is the kind of typo that reads fine.
  for (const [metric, band] of Object.entries(HEALTHY)) {
    assert.ok(band, metric);
    assert.ok(band.from < band.to, `${metric}: ${band.from} is not below ${band.to}`);
  }
});

/**
 * Per-pool bands — slice 4.2, second half.
 *
 * `resolveBands` is the only place a club's own numbers meet the published ones,
 * and the three states it distinguishes are the whole feature: no override, an
 * override, and an override that says "do not judge this at all". Conflating the
 * first and the third is the bug that would make a hotel pool alert every day
 * again, so both directions are pinned.
 */

test('with no overrides, the published bands stand', () => {
  const bands = resolveBands([]);
  assert.deepEqual(bands.ph, { from: 7.2, to: 7.6 });
  assert.equal(bands.cyanuric_acid, undefined);
});

test('an override replaces the published band for that metric only', () => {
  const bands = resolveBands([{ metric: 'temperature', from: 28, to: 31 }]);

  assert.deepEqual(bands.temperature, { from: 28, to: 31 });
  assert.deepEqual(bands.ph, { from: 7.2, to: 7.6 }, 'the others are untouched');

  // The hotel tank: 30 °C is out of the published band and inside its own.
  assert.deepEqual(excursions([{ metric: 'temperature', value: 30, unit: '°C' }]).length, 1);
  assert.deepEqual(
    excursions([{ metric: 'temperature', value: 30, unit: '°C' }], bands),
    [],
    'the same reading is fine against the pool that chose it',
  );
});

test('an override with neither bound drops the metric rather than falling back', () => {
  const bands = resolveBands([{ metric: 'temperature', from: null, to: null }]);

  assert.equal(bands.temperature, undefined, 'not the published band');
  assert.deepEqual(
    excursions([{ metric: 'temperature', value: 45, unit: '°C' }], bands),
    [],
    'a metric switched off never raises anything',
  );
});

test('a one-sided band is judged on that side alone', () => {
  const bands = resolveBands([{ metric: 'temperature', from: 24, to: null }]);

  assert.deepEqual(excursions([{ metric: 'temperature', value: 34, unit: '°C' }], bands), []);

  const [low] = excursions([{ metric: 'temperature', value: 21, unit: '°C' }], bands);
  assert.equal(low?.direction, 'low');
  assert.equal(low?.limit, 24, 'the crossed bound is always a number');
  assert.equal(low?.to, null, 'and the side nobody judges stays null');
});

test('an override can give a band to a metric that never had one', () => {
  // The case this form adds beyond the overrides it was built for: a club that
  // does test cyanuric acid can say what a bad one is.
  const bands = resolveBands([{ metric: 'cyanuric_acid', from: 30, to: 50 }]);

  const [high] = excursions([{ metric: 'cyanuric_acid', value: 80, unit: 'ppm' }], bands);
  assert.equal(high?.metric, 'cyanuric_acid');
  assert.equal(high?.limit, 50);
});

test('the last override for a metric wins, and the rest of the map survives it', () => {
  // Not a case the API can produce — it refuses a metric sent twice — but the
  // resolver is a pure function anybody may call, and silently keeping the first
  // would be the surprising half of the two.
  const bands = resolveBands([
    { metric: 'ph', from: 7, to: 8 },
    { metric: 'ph', from: null, to: null },
  ]);

  assert.equal(bands.ph, undefined);
  assert.deepEqual(bands.free_chlorine, { from: 0.5, to: 2 });
});

test('resolveBands does not mutate the published constant', () => {
  resolveBands([{ metric: 'ph', from: 1, to: 2 }]);
  resolveBands([{ metric: 'temperature', from: null, to: null }]);

  // A shallow copy taken the wrong way round would leave every later request in
  // the process judging pH from 1 to 2, which is the kind of bug that only shows
  // up on the second club of the afternoon.
  assert.deepEqual(HEALTHY.ph, { from: 7.2, to: 7.6 });
  assert.deepEqual(HEALTHY.temperature, { from: 25, to: 29 });
});
