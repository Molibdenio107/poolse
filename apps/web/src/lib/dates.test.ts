import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  isDate,
  isoWeekday,
  longDate,
  mediumDate,
  mondayOf,
  seasonOf,
  shortDate,
  weekOf,
} from './dates.ts';

/**
 * Calendar arithmetic, tested where it actually goes wrong.
 *
 * These are pure functions over `YYYY-MM-DD` strings, run by `node --test` with
 * Node's own type stripping — no test framework and no new dependency. The whole
 * suite is here because every one of these has a boundary that is easy to get
 * subtly wrong and impossible to notice: a season that ends in four days, a week
 * that starts on Sunday, a date that survives the clocks changing.
 *
 * Run: pnpm web:test
 */

test('seasonOf: August belongs to the season ahead, not the one closing', () => {
  // The bug this replaced. On the 27th of August the old pivot offered
  // 2025-09-01 → 2026-08-31: a season with four days left in it, every one
  // inside the August closure. Pressing "Gerar a época" produced a year that was
  // already over, and then an empty calendar that looked broken.
  assert.deepEqual(seasonOf('2026-08-27'), { from: '2026-09-01', to: '2027-08-31' });

  // The whole month, not just the end of it. August is shut throughout, so there
  // is never anything left to generate in it.
  assert.deepEqual(seasonOf('2026-08-01'), { from: '2026-09-01', to: '2027-08-31' });
  assert.deepEqual(seasonOf('2026-08-31'), { from: '2026-09-01', to: '2027-08-31' });
});

test('seasonOf: July is still the season under way', () => {
  // The other side of the pivot, and the one that must not move. Classes run in
  // July, so "this season" has to mean the one with those classes in it.
  assert.deepEqual(seasonOf('2026-07-31'), { from: '2025-09-01', to: '2026-08-31' });
  assert.deepEqual(seasonOf('2026-01-15'), { from: '2025-09-01', to: '2026-08-31' });
  assert.deepEqual(seasonOf('2026-06-30'), { from: '2025-09-01', to: '2026-08-31' });
});

test('seasonOf: September opens the season it starts', () => {
  assert.deepEqual(seasonOf('2026-09-01'), { from: '2026-09-01', to: '2027-08-31' });
  assert.deepEqual(seasonOf('2026-12-31'), { from: '2026-09-01', to: '2027-08-31' });
});

test('addDays crosses months, years and the clock change', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');

  // 2028 is a leap year; 2026 is not.
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');

  /*
   * The last Sunday in March is when Portugal moves to summer time. Done in
   * local time this returns the same day twice or skips one, depending on which
   * side of the world the server is on — which is the whole reason this module
   * works in UTC.
   */
  assert.equal(addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  // And the October change, the other direction.
  assert.equal(addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
});

test('isoWeekday: Monday is 1 and Sunday is 7, matching the database', () => {
  // 2026-09-07 is a Monday.
  assert.equal(isoWeekday('2026-09-07'), 1);
  assert.equal(isoWeekday('2026-09-12'), 6);
  // Sunday is 7 here and 0 in JavaScript, which is the mismatch this exists for.
  assert.equal(isoWeekday('2026-09-13'), 7);
});

test('mondayOf: a Sunday belongs to the week it ends, not the one it precedes', () => {
  assert.equal(mondayOf('2026-09-07'), '2026-09-07');
  assert.equal(mondayOf('2026-09-10'), '2026-09-07');
  // The one that catches a `getUTCDay` used raw: Sunday the 13th is the end of
  // the week beginning Monday the 7th.
  assert.equal(mondayOf('2026-09-13'), '2026-09-07');
  assert.equal(mondayOf('2026-09-14'), '2026-09-14');
});

test('weekOf returns seven consecutive days, Monday first', () => {
  assert.deepEqual(weekOf('2026-09-10'), [
    '2026-09-07',
    '2026-09-08',
    '2026-09-09',
    '2026-09-10',
    '2026-09-11',
    '2026-09-12',
    '2026-09-13',
  ]);
});

test('English dates are British, not American — POOLSE-02', () => {
  // Intl resolves a bare `en` to en-US, which renders "August 24, 2026". Poolse
  // is a Portuguese product whose English is for European readers, and the
  // ticket spells the expected form out.
  assert.equal(longDate('2026-08-24', 'en'), '24 August 2026');
  assert.equal(longDate('2026-08-24', 'pt-PT'), '24 de agosto de 2026');

  // The narrow-screen form keeps the year, because a range with no year is
  // ambiguous the moment somebody looks at January from December.
  assert.equal(mediumDate('2026-08-24', 'en'), '24 Aug 2026');
  assert.match(mediumDate('2026-08-24', 'pt-PT'), /2026/);

  assert.equal(shortDate('2026-08-24', 'en'), '24 Aug');
});

test('the week header reads correctly across a month and a year boundary', () => {
  // POOLSE-02 criterion 3, formatted rather than concatenated — each end of the
  // range carries its own month and year, so a week that straddles either says so.
  assert.equal(longDate('2026-08-31', 'pt-PT'), '31 de agosto de 2026');
  assert.equal(longDate('2026-09-06', 'pt-PT'), '6 de setembro de 2026');

  assert.equal(longDate('2026-12-28', 'en'), '28 December 2026');
  assert.equal(longDate('2027-01-03', 'en'), '3 January 2027');
});

test('isDate rejects what a query string can carry', () => {
  assert.equal(isDate('2026-09-07'), true);

  assert.equal(isDate(undefined), false);
  assert.equal(isDate(''), false);
  assert.equal(isDate('07-09-2026'), false);
  assert.equal(isDate('2026-9-7'), false);

  // `new Date('2026-02-31')` does not throw — it rolls into March. Formatting it
  // back is the only way to know the input was a real day.
  assert.equal(isDate('2026-02-31'), false);
  assert.equal(isDate('2026-13-01'), false);
});
