import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageInMonths, ageInYears, ageOptions, fitsLevel, rangeShape, shapeOfMonths } from './ages.ts';

/**
 * Age arithmetic — backlog round 4 tickets 2 and 3, and POOLSE-06.
 *
 * The interesting cases are all boundaries: the day before a birthday, the 29th
 * of February, the month below a year that whole years could not express, and
 * the two answers that must never be a warning — a level with no bounds, and a
 * student with no birth date.
 *
 * Every assertion pins "today" explicitly. A test that reads the clock passes for
 * a year and then fails on somebody's birthday.
 *
 * Run: pnpm web:test
 */

const on = (date: string): Date => new Date(`${date}T00:00:00Z`);

test('ageInMonths counts whole months, and a birthday is not early', () => {
  // Born 12 May 1990, asked on three consecutive relevant days.
  assert.equal(ageInMonths('1990-05-12', on('2026-05-11')), 431, 'the day before');
  assert.equal(ageInMonths('1990-05-12', on('2026-05-12')), 432, 'the day itself');
  assert.equal(ageInMonths('1990-05-12', on('2026-05-13')), 432, 'the day after');

  // 432 months is exactly 36 years.
  assert.equal(ageInYears('1990-05-12', on('2026-05-12')), 36);
});

test('months below a year are the point of POOLSE-06', () => {
  // A six-month-old. In whole years this child was zero, and so was a newborn —
  // which is precisely why a baby class could not say who it was for.
  assert.equal(ageInMonths('2026-02-12', on('2026-08-12')), 6);
  assert.equal(ageInYears('2026-02-12', on('2026-08-12')), 0);

  // The day before the six-month mark.
  assert.equal(ageInMonths('2026-02-12', on('2026-08-11')), 5);
});

test('ageInMonths handles a 29 February birthday', () => {
  assert.equal(ageInMonths('2028-02-29', on('2030-02-28')), 23);
  assert.equal(ageInMonths('2028-02-29', on('2030-03-01')), 24);
});

test('ageInMonths refuses what is not a date', () => {
  assert.equal(ageInMonths('not-a-date'), null);
  // `new Date('2026-02-31')` rolls into March rather than throwing, so the only
  // way to know the input was real is to format it back.
  assert.equal(ageInMonths('2026-02-31'), null);
  // Born tomorrow is not an age.
  assert.equal(ageInMonths('2026-05-13', on('2026-05-12')), null);
});

test('fitsLevel: a level with no bounds always fits', () => {
  const free = { minAgeMonths: null, maxAgeMonths: null };

  assert.equal(fitsLevel(free, '1959-03-02', on('2026-05-12')), 'fits');
  // Including for a student with no birth date. This is how every level behaved
  // before ranges existed, and nothing about adding them may change it.
  assert.equal(fitsLevel(free, null, on('2026-05-12')), 'fits');
});

test('fitsLevel: a missing birth date is never a warning', () => {
  // The one that matters most. Most students will have no birth date — the
  // spreadsheets waiting to be imported have a half-empty column — and treating
  // absent as "does not fit" would flag most of a register for no reason.
  const bebes = { minAgeMonths: 6, maxAgeMonths: 24 };

  assert.equal(fitsLevel(bebes, null, on('2026-05-12')), 'unknown');
  assert.equal(fitsLevel(bebes, '', on('2026-05-12')), 'unknown');
  assert.equal(fitsLevel(bebes, 'nonsense', on('2026-05-12')), 'unknown');
});

test('fitsLevel compares in months, not years — POOLSE-06 criterion 4', () => {
  // A baby class from six months. Comparing in years would have called both of
  // these children zero and let the younger one in.
  const bebes = { minAgeMonths: 6, maxAgeMonths: 24 };

  assert.equal(fitsLevel(bebes, '2026-02-12', on('2026-08-12')), 'fits', 'exactly 6 months');
  assert.equal(fitsLevel(bebes, '2026-03-12', on('2026-08-12')), 'tooYoung', '5 months');
  assert.equal(fitsLevel(bebes, '2024-08-12', on('2026-08-12')), 'fits', 'exactly 24 months');
  assert.equal(fitsLevel(bebes, '2024-07-12', on('2026-08-12')), 'tooOld', '25 months');
});

test('fitsLevel: both bounds are inclusive', () => {
  const three_to_five = { minAgeMonths: 36, maxAgeMonths: 71 };

  // Exactly three today: in, not out. An exclusive bound would eject a child on
  // their birthday, which is the least defensible day to do it.
  assert.equal(fitsLevel(three_to_five, '2023-05-12', on('2026-05-12')), 'fits');
  assert.equal(fitsLevel(three_to_five, '2023-05-13', on('2026-05-12')), 'tooYoung');
});

test('fitsLevel: one open bound', () => {
  const adultos = { minAgeMonths: 216, maxAgeMonths: null };
  assert.equal(fitsLevel(adultos, '2008-05-12', on('2026-05-12')), 'fits', 'exactly 18');
  assert.equal(fitsLevel(adultos, '2009-01-01', on('2026-05-12')), 'tooYoung');
  // No maximum means no maximum, however old.
  assert.equal(fitsLevel(adultos, '1930-01-01', on('2026-05-12')), 'fits');
});

test('shapeOfMonths says it the way a person would — POOLSE-06 criterion 3', () => {
  assert.deepEqual(shapeOfMonths(6), { unit: 'months', months: 6 });
  assert.deepEqual(shapeOfMonths(11), { unit: 'months', months: 11 });

  // A year is a year, not "12 months".
  assert.deepEqual(shapeOfMonths(12), { unit: 'years', years: 1 });
  assert.deepEqual(shapeOfMonths(36), { unit: 'years', years: 3 });

  // And the awkward middle keeps both halves.
  assert.deepEqual(shapeOfMonths(18), { unit: 'yearsAndMonths', years: 1, months: 6 });

  // Zero is "from birth", a real answer for a baby class — not an absence.
  assert.deepEqual(shapeOfMonths(0), { unit: 'months', months: 0 });
});

test('the picker offers months below a year, then whole years', () => {
  const options = ageOptions(3);

  // 0 to 11 months, then 12, 24, 36.
  assert.deepEqual(options, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24, 36]);

  // Nothing between the years: nobody sets a level boundary at seven years and
  // four months.
  assert.equal(options.includes(13), false);
  assert.equal(options.includes(30), false);
});

test('rangeShape names which of the three sentences a level needs', () => {
  assert.equal(rangeShape({ minAgeMonths: null, maxAgeMonths: null }), null);

  assert.deepEqual(rangeShape({ minAgeMonths: 36, maxAgeMonths: 60 }), {
    kind: 'both',
    min: { unit: 'years', years: 3 },
    max: { unit: 'years', years: 5 },
  });

  assert.deepEqual(rangeShape({ minAgeMonths: 216, maxAgeMonths: null }), {
    kind: 'min',
    min: { unit: 'years', years: 18 },
    max: null,
  });

  assert.deepEqual(rangeShape({ minAgeMonths: null, maxAgeMonths: 6 }), {
    kind: 'max',
    min: null,
    max: { unit: 'months', months: 6 },
  });

  // Zero is a bound, not an absence. "From birth to 2 years" is a real level and
  // `!min` would lose its lower bound entirely.
  assert.deepEqual(rangeShape({ minAgeMonths: 0, maxAgeMonths: 24 }), {
    kind: 'both',
    min: { unit: 'months', months: 0 },
    max: { unit: 'years', years: 2 },
  });
});
