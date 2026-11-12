import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intervalUsage, summariseUsage, type UsageInterval } from './energy-usage.js';

/** Readings on the 1st of each month from `start`, with what each used. */
function monthly(used: (number | null)[]): UsageInterval[] {
  return used.map((consumed, index) => ({
    takenAt: new Date(Date.UTC(2026, index, 1, 8)).toISOString(),
    previousAt: index === 0 ? null : new Date(Date.UTC(2026, index - 1, 1, 8)).toISOString(),
    consumed: index === 0 ? null : consumed,
  }));
}

test('use is compared per day, so a long month is not a high one', () => {
  // January 31 days, February 28: the same 10/day is not unusual.
  const usage = intervalUsage(monthly([null, 310, 280, 310, 300, 310]));
  assert.deepEqual(usage.map((one) => one.flag), [null, null, null, null, null, null]);
  assert.equal(Math.round(usage[1]!.perDay! * 100) / 100, 10);
});

test('a month 50 % above the median of the ones before it is high; one far below is low', () => {
  const usage = intervalUsage(monthly([null, 310, 280, 310, 450, 150]));
  assert.equal(usage[4]!.flag, 'high');
  assert.ok(Math.abs(usage[4]!.deviation! - 0.5) < 0.01);
  assert.equal(usage[5]!.flag, 'low');
});

test('nothing is unusual until three intervals make a usual', () => {
  const usage = intervalUsage(monthly([null, 310, 900, 310]));
  assert.deepEqual(usage.map((one) => one.flag), [null, null, null, null]);
});

test('the summary names the highest and lowest interval, the average per day and the unusual count', () => {
  const series = monthly([null, 310, 280, 310, 450, 150]);
  const summary = summariseUsage(series, intervalUsage(series), '2026-01-01');
  assert.equal(summary.intervals, 5);
  assert.equal(summary.highest?.takenAt, series[4]!.takenAt);
  assert.equal(summary.lowest?.takenAt, series[5]!.takenAt);
  assert.equal(summary.unusual, 2);
  assert.ok(summary.averagePerDay !== null && summary.averagePerDay > 9 && summary.averagePerDay < 11);
});
