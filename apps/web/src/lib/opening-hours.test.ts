import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoursLabel, withinHours } from './opening-hours.ts';
import type { FacilityDay } from './api.ts';

/**
 * The opening-hours rule — POOLSE-QA-03 and QA-04.
 *
 * The reported config is the fixture: a club open 06:30–22:00 every day except
 * Tuesday, which opens at 12:30, and Sunday, which does not open. Tuesday
 * morning is the case that shipped wrong on three separate screens.
 *
 * Run: pnpm web:test
 */

function day(weekday: number, over: Partial<FacilityDay> = {}): FacilityDay {
  return {
    weekday,
    available: true,
    opensAt: '06:30:00',
    closesAt: '22:00:00',
    scheduledClasses: 0,
    ...over,
  };
}

/** The club exactly as QA found it. */
const CLUB: FacilityDay[] = [
  day(1),
  day(2, { opensAt: '12:30:00' }),
  day(3),
  day(4),
  day(5),
  day(6),
  day(7, { available: false }),
];

test('an hour before the site opens is refused, on the day it applies to', () => {
  // The bug: Terça 06:30 was offered as an ordinary free slot.
  assert.equal(withinHours(CLUB, 2, '06:30', '07:15'), false);
  assert.equal(withinHours(CLUB, 2, '11:45', '12:30'), false);

  // And the same hour on a day that does open then is fine.
  assert.equal(withinHours(CLUB, 1, '06:30', '07:15'), true);
});

test('the first slot of a late-opening day is allowed', () => {
  assert.equal(withinHours(CLUB, 2, '12:30', '13:15'), true);
});

test('a class must fit inside the day, not merely begin inside it', () => {
  // 21:45 against a 22:00 close is half the class in the car park.
  assert.equal(withinHours(CLUB, 1, '21:45', '22:30'), false);
  assert.equal(withinHours(CLUB, 1, '21:15', '22:00'), true);
});

test('a day the club does not open refuses every hour', () => {
  assert.equal(withinHours(CLUB, 7, '10:00', '11:00'), false);
  assert.equal(withinHours(CLUB, 7, '06:30', '07:15'), false);
});

test('a club that never said keeps every hour', () => {
  /*
   * Unknown is not closed. A site with no hours row has no rule to break, and
   * the API stays the thing that decides — refusing here would lock a club out
   * of its own calendar for a row nobody has filled in.
   */
  assert.equal(withinHours([], 2, '06:30', '07:15'), true);
  assert.equal(withinHours(CLUB, 9, '06:30', '07:15'), true);
});

test('seconds on the stored time do not change the answer', () => {
  // `time` comes back as `HH:MM:SS`; the grid speaks `HH:MM`.
  assert.equal(withinHours(CLUB, 2, '12:30:00', '13:15:00'), true);
  assert.equal(withinHours(CLUB, 2, '06:30:00', '07:15:00'), false);
});

test('midnight closing sorts last rather than first', () => {
  // `24:00` is a real closing time in this schema, and `'23:00' <= '24:00'`
  // only because both are zero-padded — the reason the comparison is text.
  const late = [day(1, { closesAt: '24:00:00' })];
  assert.equal(withinHours(late, 1, '23:00', '24:00'), true);
});

test('the label names the hours the refusal is about', () => {
  assert.equal(hoursLabel(CLUB, 2), '12:30\u201322:00');
  assert.equal(hoursLabel(CLUB, 1), '06:30\u201322:00');
  assert.equal(hoursLabel([], 1), null);
});
