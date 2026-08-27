import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, isDate, isoWeekday, mondayOf, seasonOf, weekOf } from './dates.ts';

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
