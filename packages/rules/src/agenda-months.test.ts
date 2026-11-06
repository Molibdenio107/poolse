import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agendaMonthRange,
  agendaWeekOf,
  agendaWeekRange,
  agendaWindowAllowed,
  isAgendaWeek,
  monthDays,
  shiftMonth,
} from './agenda-months.js';

const TODAY = '2026-11-05';

test('a month steps across a year in both directions', () => {
  assert.equal(shiftMonth('2026-11', 2), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('a month has its own last day, a leap February included', () => {
  assert.deepEqual(monthDays('2026-12'), { from: '2026-12-01', to: '2026-12-31' });
  assert.equal(monthDays('2028-02').to, '2028-02-29');
  assert.equal(monthDays('2027-02').to, '2027-02-28');
});

test('the calendar reaches six months ahead and three back', () => {
  assert.deepEqual(agendaMonthRange(TODAY), { first: '2026-08', last: '2027-05' });
});

test('a window inside the range is answered, whole months at either edge', () => {
  assert.equal(agendaWindowAllowed(TODAY, '2026-08-01', '2026-08-31'), true);
  assert.equal(agendaWindowAllowed(TODAY, '2027-05-01', '2027-05-31'), true);
});

test('a window past the range, too long, backwards or not a date is refused', () => {
  assert.equal(agendaWindowAllowed(TODAY, '2027-06-01', '2027-06-30'), false, 'seven months ahead');
  assert.equal(agendaWindowAllowed(TODAY, '2026-07-31', '2026-08-15'), false, 'four months back');
  assert.equal(agendaWindowAllowed(TODAY, '2026-12-01', '2027-01-15'), false, 'longer than a month');
  assert.equal(agendaWindowAllowed(TODAY, '2026-12-31', '2026-12-01'), false, 'backwards');
  assert.equal(agendaWindowAllowed(TODAY, 'soon', '2026-12-01'), false);
  assert.equal(agendaWindowAllowed(TODAY, '2026-13-01', '2026-13-02'), false);
});

test('a week is named by its Monday, across a month and a year', () => {
  assert.equal(agendaWeekOf('2026-11-05'), '2026-11-02');
  assert.equal(agendaWeekOf('2026-11-08'), '2026-11-02');
  assert.equal(agendaWeekOf('2026-11-02'), '2026-11-02');
  assert.equal(agendaWeekOf('2027-01-01'), '2026-12-28');
});

test('only a real Monday names a week', () => {
  assert.equal(isAgendaWeek('2026-11-02'), true);
  assert.equal(isAgendaWeek('2026-11-03'), false);
  assert.equal(isAgendaWeek('2026-02-30'), false);
  assert.equal(isAgendaWeek('soon'), false);
  assert.equal(isAgendaWeek(undefined), false);
});

test('the weeks stop where the API does, and both edge weeks are answered', () => {
  const { first, last } = agendaWeekRange(TODAY);
  assert.equal(first, '2026-08-03');
  assert.equal(last, '2027-05-24');
  const sunday = (monday: string): string =>
    new Date(Date.parse(`${monday}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  assert.equal(agendaWindowAllowed(TODAY, first, sunday(first)), true);
  assert.equal(agendaWindowAllowed(TODAY, last, sunday(last)), true);
  assert.equal(agendaWindowAllowed(TODAY, '2026-07-27', sunday('2026-07-27')), false);
  assert.equal(agendaWindowAllowed(TODAY, '2027-05-31', sunday('2027-05-31')), false);
});
