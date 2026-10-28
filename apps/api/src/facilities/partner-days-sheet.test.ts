import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readClock, readDays, readMinutes } from './partner-days-sheet.js';

/** A partnerships sheet's days, hour and length — POOLSE-117. */

test('days are read in either language, however they are written', () => {
  assert.deepEqual(readDays('Seg, Qua'), { days: [1, 3] });
  assert.deepEqual(readDays('2ª e 4ª'), { days: [1, 3] });
  assert.deepEqual(readDays('segunda-feira e quinta-feira'), { days: [1, 4] });
  assert.deepEqual(readDays('Mon/Wed'), { days: [1, 3] });
  assert.deepEqual(readDays('Terça; Sábado'), { days: [2, 6] });
  assert.deepEqual(readDays('Quarta, Segunda, quarta'), { days: [1, 3] }, 'sorted and unique');
  assert.deepEqual(readDays(''), { days: [] });
});

test('a range is refused, never guessed, and an unknown word is refused', () => {
  assert.deepEqual(readDays('Seg a Qua'), { error: 'dayRange' });
  assert.deepEqual(readDays('Mon-Wed'), { error: 'dayRange' });
  assert.deepEqual(readDays('Mon to Wed'), { error: 'dayRange' });
  assert.deepEqual(readDays('Seg, feriados'), { error: 'badDays' });
});

test('an hour and a length, as a sheet writes them', () => {
  assert.equal(readClock('10:00'), '10:00');
  assert.equal(readClock('9h30'), '09:30');
  assert.equal(readClock('14h'), '14:00');
  assert.equal(readClock('10:20:00'), '10:20');
  assert.equal(readClock('0.4166666667'), '10:00', 'a spreadsheet time');
  assert.equal(readClock('25:00'), null);
  assert.equal(readMinutes('45'), 45);
  assert.equal(readMinutes('45 min'), 45);
  assert.equal(readMinutes('1h30'), 90);
  assert.equal(readMinutes('01:00'), 60);
  assert.equal(readMinutes('três'), null);
  assert.equal(readMinutes('2'), null, 'under five minutes is not a lesson');
});
