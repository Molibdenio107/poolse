import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agendaMonthRange, agendaWindowAllowed, isAgendaMonth, monthDays, shiftMonth } from './agenda-months.js';

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

test('only a real month is a month', () => {
  assert.equal(isAgendaMonth('2026-12'), true);
  assert.equal(isAgendaMonth('2026-13'), false);
  assert.equal(isAgendaMonth('2026-1'), false);
  assert.equal(isAgendaMonth(undefined), false);
});
