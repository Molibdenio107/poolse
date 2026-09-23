import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatStamp, formatTime } from './date-format.ts';

/**
 * Every date in one shape — `dd-MM-yyyy`, decided 13 September 2026.
 *
 * Three of these are the traps rather than the happy path, and each has already
 * cost this product an afternoon somewhere:
 *
 * - **a `YYYY-MM-DD` string is a day, not an instant.** `new Date('2026-10-01')`
 *   parses as UTC midnight, which in a zone behind UTC is the previous day —
 *   the bug that made a salary effective on 1 October display as 30 September.
 * - **a `timestamptz` is rendered in the club's zone**, not the runtime's, or a
 *   late-evening entry reads as tomorrow on a server in another country.
 * - **the shape does not follow the reader's locale.** An English-speaking
 *   operator of a Portuguese pool must not be shown `09-13-2026` and read it as
 *   9 September.
 *
 * Run: pnpm web:test
 */

test('a day string is the day it says, in any season', () => {
  assert.equal(formatDate('2026-10-01'), '01-10-2026');
  assert.equal(formatDate('2026-01-05'), '05-01-2026');
  // Summer time in Lisbon, when the zone is an hour ahead of UTC: the naive
  // `new Date(...)` reading of this would be 30 September.
  assert.equal(formatDate('2026-07-01'), '01-07-2026');
});

test('an instant is rendered in the club’s zone, not the runtime’s', () => {
  // 22:30 UTC on the 13th is 23:30 in Lisbon on the 13th — still the 13th.
  assert.equal(formatDate('2026-09-13T22:30:00Z'), '13-09-2026');
  // And 23:30 UTC is already the 14th there.
  assert.equal(formatDate('2026-09-13T23:30:00Z'), '14-09-2026');
});

test('a stamp carries the time, on a 24-hour clock', () => {
  // September: Lisbon is UTC+1.
  assert.equal(formatStamp('2026-09-13T13:30:00Z'), '13-09-2026 14:30');
  // January: UTC+0, so the same UTC time reads an hour earlier.
  assert.equal(formatStamp('2026-01-13T13:30:00Z'), '13-01-2026 13:30');
  // Never am/pm, whatever the reader's locale would have chosen.
  assert.equal(formatStamp('2026-01-13T20:05:00Z'), '13-01-2026 20:05');
});

test('a Date is taken as it is', () => {
  assert.equal(formatDate(new Date('2026-12-31T23:00:00Z')), '31-12-2026');
});

test('the time half is the same clock as the stamp, in the club’s zone', () => {
  // The pairing that matters: a sentence which needs the two apart must not
  // disagree with the one that puts them together.
  assert.equal(formatTime('2026-09-13T13:30:00Z'), '14:30');
  assert.equal(formatStamp('2026-09-13T13:30:00Z'), '13-09-2026 14:30');

  // Never am/pm. A call site asking next-intl for `{ hour, minute }` rendered
  // `2:30 PM` under `en` while every stamp beside it said 24-hour; that is the
  // drift this function exists to end.
  assert.equal(formatTime('2026-01-13T20:05:00Z'), '20:05');
  assert.equal(formatTime('2026-01-13T08:04:00Z'), '08:04');

  assert.equal(formatTime(null), '');
  assert.equal(formatTime('nope'), '');
});

test('what is not a date is nothing, never "Invalid Date" on a screen', () => {
  assert.equal(formatDate(null), '');
  assert.equal(formatDate(undefined), '');
  assert.equal(formatDate(''), '');
  assert.equal(formatDate('quando calhar'), '');
  assert.equal(formatStamp(null), '');
  assert.equal(formatStamp('nope'), '');
});

test('the day is always two digits, and the year always four', () => {
  // A one-digit day padded, because a column of dates that jump a character
  // wide is a column that is hard to scan.
  assert.equal(formatDate('2026-03-07'), '07-03-2026');
  assert.match(formatDate('2026-03-07'), /^\d{2}-\d{2}-\d{4}$/);
  assert.match(formatStamp('2026-03-07T08:04:00Z'), /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);
});
