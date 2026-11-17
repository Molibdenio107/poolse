import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMinutes, hoursLabel, hoursUnset, withinHours } from './opening-hours.ts';
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

// Rui, 17-11-2026: the turma's Horário tab warns when a site's hours were never set.
const dayOf = (weekday: number, opensAt: string, closesAt: string, available = true): FacilityDay => ({
  weekday,
  available,
  opensAt,
  closesAt,
  scheduledClasses: 0,
});

test('a site still open 00:00–24:00 every day has never had its hours set', () => {
  const born = [1, 2, 3, 4, 5, 6, 7].map((weekday) => dayOf(weekday, '00:00:00', '24:00:00'));
  assert.equal(hoursUnset(born), true);
  assert.equal(hoursUnset([]), true, 'no rows at all is unset too');
  assert.equal(hoursUnset([...born.slice(0, 6), dayOf(7, '00:00', '24:00', false)]), false, 'a closed Sunday is a decision');
  assert.equal(hoursUnset([dayOf(1, '07:00', '22:00'), ...born.slice(1)]), false, 'one narrowed day is a decision');
});

test('a slot end is the start plus its minutes, and may run past midnight', () => {
  assert.equal(addMinutes('18:30', 45), '19:15');
  assert.equal(addMinutes('21:45:00', 45), '22:30');
  assert.equal(addMinutes('23:30', 60), '24:30');
  // 21:30 + 45 against a 22:00 close is outside; the form says so before the API does.
  assert.equal(withinHours([dayOf(2, '07:00', '22:00')], 2, '21:30', addMinutes('21:30', 45)), false);
});
