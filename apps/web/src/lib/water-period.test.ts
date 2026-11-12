import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BandMap } from '@poolse/rules';
import {
  clubDay,
  daysElapsed,
  inPeriod,
  periodsOffered,
  resolvePeriod,
  summarisePeriod,
  type PeriodAnalysis,
} from './water-period.ts';

const ph = (takenAt: string, value: number, chlorine?: number): PeriodAnalysis => ({
  takenAt,
  values: [
    { metric: 'ph', value, unit: 'pH' },
    ...(chlorine === undefined ? [] : [{ metric: 'free_chlorine' as const, value: chlorine, unit: 'mg/L' }]),
  ],
});

const LOG = [
  ph('2026-10-30T09:00:00Z', 7.3),
  ph('2026-11-01T09:00:00Z', 7.7, 1.69),
  ph('2026-11-01T14:00:00Z', 7.2, 0.26),
  ph('2026-11-02T09:00:00Z', 8.3, 1.2),
  ph('2025-06-10T09:00:00Z', 7.4),
];

test('a moment is placed on the club clock, summer time included', () => {
  // Winter: Lisbon is UTC, so 23:30 UTC on 31 October is still 31 October.
  assert.equal(clubDay('2026-10-31T23:30:00Z'), '2026-10-31');
  // Summer time: 31 August 23:30 UTC is 1 September 00:30 in Lisbon.
  assert.equal(clubDay('2026-08-31T23:30:00Z'), '2026-09-01');
});

test('the years with readings, newest first, and their months', () => {
  assert.deepEqual(periodsOffered(LOG), [
    { year: 2026, months: [10, 11] },
    { year: 2025, months: [6] },
  ]);
});

test('it opens on the latest analysis month, and keeps a valid choice', () => {
  assert.deepEqual(resolvePeriod(LOG, undefined, undefined), { year: 2026, month: 11 });
  assert.deepEqual(resolvePeriod(LOG, '2026', '10'), { year: 2026, month: 10 });
  assert.deepEqual(resolvePeriod(LOG, '2026', 'all'), { year: 2026, month: null });
  assert.deepEqual(resolvePeriod(LOG, '2025', '3'), { year: 2025, month: 6 }, 'a month with nothing opens the year’s latest');
  assert.deepEqual(resolvePeriod(LOG, '1999', '1'), { year: 2026, month: 11 }, 'a year with nothing opens the latest');
  assert.equal(resolvePeriod([], undefined, undefined), null);
});

test('in the period, by month or whole year', () => {
  assert.equal(inPeriod('2026-11-02T09:00:00Z', { year: 2026, month: 11 }), true);
  assert.equal(inPeriod('2026-10-30T09:00:00Z', { year: 2026, month: 11 }), false);
  assert.equal(inPeriod('2026-10-30T09:00:00Z', { year: 2026, month: null }), true);
});

test('days elapsed: a past month whole, a running month up to today', () => {
  assert.equal(daysElapsed({ year: 2026, month: 2 }, '2026-11-12'), 28);
  assert.equal(daysElapsed({ year: 2026, month: 11 }, '2026-11-12'), 12);
  assert.equal(daysElapsed({ year: 2026, month: 12 }, '2026-11-12'), 0);
  assert.equal(daysElapsed({ year: 2025, month: null }, '2026-11-12'), 365);
});

test('the summary counts, judges with the tank limits, and gives min / average / max', () => {
  const bands: BandMap = { ph: { from: 6.9, to: 8.0 }, free_chlorine: { from: 0.5, to: 2.0 } };
  const november = LOG.filter((one) => inPeriod(one.takenAt, { year: 2026, month: 11 }));
  const summary = summarisePeriod(november, bands, { year: 2026, month: 11 }, '2026-11-12');

  assert.equal(summary.analyses, 3);
  assert.equal(summary.daysWithReadings, 2);
  assert.equal(summary.daysInPeriod, 12);
  assert.equal(summary.outside, 2, 'pH 8,3 and chlorine 0,26');

  const phLine = summary.metrics.find((one) => one.metric === 'ph')!;
  assert.deepEqual([phLine.count, phLine.min, phLine.max, phLine.outside], [3, 7.2, 8.3, 1]);
  assert.ok(Math.abs(phLine.average - 7.733) < 0.001);
  const chlorine = summary.metrics.find((one) => one.metric === 'free_chlorine')!;
  assert.deepEqual([chlorine.count, chlorine.outside], [3, 1]);
});
