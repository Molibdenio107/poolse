import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatDateLong, formatDateRange, formatDayMonth, formatStamp, formatTime } from './date-format.ts';

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

test('a day is the same day whatever clock the code runs on', () => {
  // Local midnight was right in Lisbon and wrong east of it — 1 October read as
  // 30 September in a browser in Madrid. These pass in this process's zone;
  // set process.env.TZ = 'Europe/Madrid' before importing to see the old parse
  // fail (a TZ= prefix is ignored by Git Bash on Windows).
  assert.equal(formatDate('2026-10-01'), '01-10-2026');
  assert.equal(formatDate('2026-03-29'), '29-03-2026'); // the spring-forward Sunday
  assert.equal(formatDate('2026-10-25'), '25-10-2026'); // and the fall-back one
});

/*
 * Dates in words — POOLSE-96. The week heading and the day columns of the
 * lifeguard roster, and only those; the strings are the ticket's own examples.
 */
/** ICU puts thin spaces (U+2009) round a dash between two whole dates. */
const THIN = String.fromCharCode(0x2009);

test('a week in words says what its ends share once — QA 4 and 5', () => {
  // QA 4: one month.
  assert.equal(formatDateRange('2026-11-16', '2026-11-22', 'pt-PT'), '16 a 22 de novembro de 2026');
  assert.equal(formatDateRange('2026-11-16', '2026-11-22', 'en'), '16–22 November 2026');

  // QA 5: across a month, and across a year.
  assert.equal(
    formatDateRange('2026-11-30', '2026-12-06', 'pt-PT'),
    '30 de novembro a 6 de dezembro de 2026',
  );
  assert.equal(formatDateRange('2026-11-30', '2026-12-06', 'en'), `30 November${THIN}–${THIN}6 December 2026`);
  assert.equal(
    formatDateRange('2026-12-28', '2027-01-03', 'pt-PT'),
    '28 de dezembro de 2026 a 3 de janeiro de 2027',
  );
  assert.equal(formatDateRange('2026-12-28', '2027-01-03', 'en'), `28 December 2026${THIN}–${THIN}3 January 2027`);
});

test('a day in words, long and as a column heading', () => {
  assert.equal(formatDateLong('2026-11-16', 'pt-PT'), 'segunda-feira, 16 de novembro de 2026');
  assert.equal(formatDateLong('2026-11-16', 'en'), 'Monday, 16 November 2026');
  assert.equal(formatDayMonth('2026-11-16', 'pt-PT'), '16 de novembro');
  assert.equal(formatDayMonth('2026-11-16', 'en'), '16 November');
  // A day is the day it says, in the club's zone, at any hour of the server.
  assert.equal(formatDayMonth('2026-03-29', 'pt-PT'), '29 de março');
});
