import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageInYears, fitsLevel, rangeShape } from './ages.ts';

/**
 * Age arithmetic — backlog round 4, tickets 2 and 3.
 *
 * The interesting cases are all boundaries: the day before a birthday, the day
 * of it, the 29th of February, and the two answers that must never be a warning
 * — a level with no bounds, and a student with no birth date.
 *
 * Every assertion pins "today" explicitly. A test that reads the clock passes
 * for a year and then fails on somebody's birthday.
 *
 * Run: pnpm web:test
 */

const on = (date: string): Date => new Date(`${date}T00:00:00Z`);

test('ageInYears counts whole years, and a birthday is not early', () => {
  // Born 12 May 1990, asked on three consecutive relevant days.
  assert.equal(ageInYears('1990-05-12', on('2026-05-11')), 35, 'the day before');
  assert.equal(ageInYears('1990-05-12', on('2026-05-12')), 36, 'the day itself');
  assert.equal(ageInYears('1990-05-12', on('2026-05-13')), 36, 'the day after');

  // Same month, earlier day — the case a naive month-only comparison gets wrong.
  assert.equal(ageInYears('1990-05-30', on('2026-05-01')), 35);
});

test('ageInYears handles a 29 February birthday', () => {
  // Born on a leap day; 2026 has no 29th of February. On the 28th they have not
  // had a birthday yet by this reckoning, on the 1st of March they have.
  assert.equal(ageInYears('2028-02-29', on('2030-02-28')), 1);
  assert.equal(ageInYears('2028-02-29', on('2030-03-01')), 2);
});

test('ageInYears refuses what is not a date', () => {
  assert.equal(ageInYears('not-a-date'), null);
  assert.equal(ageInYears('2026-02-31'), null);
  // Born tomorrow is not an age.
  assert.equal(ageInYears('2026-05-13', on('2026-05-12')), null);
});

test('fitsLevel: a level with no bounds always fits', () => {
  const free = { minAgeYears: null, maxAgeYears: null };

  assert.equal(fitsLevel(free, '1959-03-02', on('2026-05-12')), 'fits');
  // Including for a student with no birth date. This is how every level behaved
  // before ranges existed, and nothing about adding them may change it.
  assert.equal(fitsLevel(free, null, on('2026-05-12')), 'fits');
});

test('fitsLevel: a missing birth date is never a warning', () => {
  // The one that matters most. Most students will have no birth date — the
  // spreadsheets waiting to be imported have a half-empty column — and treating
  // absent as "does not fit" would flag most of a register for no reason.
  const bebes = { minAgeYears: 0, maxAgeYears: 3 };

  assert.equal(fitsLevel(bebes, null, on('2026-05-12')), 'unknown');
  assert.equal(fitsLevel(bebes, '', on('2026-05-12')), 'unknown');
  assert.equal(fitsLevel(bebes, 'nonsense', on('2026-05-12')), 'unknown');
});

test('fitsLevel: both bounds are inclusive', () => {
  const three_to_five = { minAgeYears: 3, maxAgeYears: 5 };

  // Exactly three today: in, not out. An exclusive bound here would eject a
  // child on their birthday, which is the least defensible day to do it.
  assert.equal(fitsLevel(three_to_five, '2023-05-12', on('2026-05-12')), 'fits');
  // Exactly five, and the day they turn six.
  assert.equal(fitsLevel(three_to_five, '2021-05-12', on('2026-05-12')), 'fits');
  assert.equal(fitsLevel(three_to_five, '2020-05-12', on('2026-05-12')), 'tooOld');
  // The day before turning three.
  assert.equal(fitsLevel(three_to_five, '2023-05-13', on('2026-05-12')), 'tooYoung');
});

test('fitsLevel: one open bound', () => {
  const adultos = { minAgeYears: 18, maxAgeYears: null };
  assert.equal(fitsLevel(adultos, '2008-05-12', on('2026-05-12')), 'fits', 'exactly 18');
  assert.equal(fitsLevel(adultos, '2009-01-01', on('2026-05-12')), 'tooYoung');
  // No maximum means no maximum, however old.
  assert.equal(fitsLevel(adultos, '1930-01-01', on('2026-05-12')), 'fits');

  const bebes = { minAgeYears: null, maxAgeYears: 3 };
  assert.equal(fitsLevel(bebes, '2026-01-01', on('2026-05-12')), 'fits');
  assert.equal(fitsLevel(bebes, '1959-03-02', on('2026-05-12')), 'tooOld');
});

test('rangeShape names which of the three sentences a level needs', () => {
  assert.equal(rangeShape({ minAgeYears: null, maxAgeYears: null }), null);
  assert.deepEqual(rangeShape({ minAgeYears: 3, maxAgeYears: 5 }), {
    kind: 'both',
    min: 3,
    max: 5,
  });
  assert.deepEqual(rangeShape({ minAgeYears: 18, maxAgeYears: null }), {
    kind: 'min',
    min: 18,
    max: null,
  });
  assert.deepEqual(rangeShape({ minAgeYears: null, maxAgeYears: 3 }), {
    kind: 'max',
    min: null,
    max: 3,
  });

  // Zero is a bound, not an absence. "0–3" is a real level and `!min` would lose
  // its lower bound entirely.
  assert.deepEqual(rangeShape({ minAgeYears: 0, maxAgeYears: 3 }), {
    kind: 'both',
    min: 0,
    max: 3,
  });
});
