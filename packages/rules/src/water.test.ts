import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excursions, HEALTHY, METRIC_UNITS, POOL_METRICS } from './water.js';

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
