import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readCell,
  readTime,
  readTimetableGrid,
  readWeekday,
} from './timetable-grid.ts';
import type { Sheet } from './sheet.ts';

/**
 * Reading the wall timetable — POOLSE-57.
 *
 * Every case here is a shape a real club's sheet has: a title above the grid,
 * two classes stacked in one hour with the time written once, lanes in brackets,
 * a legend underneath. The reader has to survive all of them without an agent,
 * because the agent is optional and the importer still has to work without a key.
 *
 * Run: pnpm web:test
 */

/** The reference club's sheet, in the shape it actually arrives in. */
function wallSheet(): Sheet {
  return {
    headers: ['Horário 2026/2027', '', '', ''],
    rows: [
      ['', 'Segunda', 'Terça', 'Quarta'],
      ['06:30', 'Masters (1-3)', '', 'Masters (1-3)'],
      ['09:30', '6A (1-3)', '', ''],
      ['', '6B (4-6)', '', ''],
      ['10:15', '', '10G 11B (1-3)', ''],
      ['19:15', '', 'Infantis A (2)', ''],
      ['', '', 'Infantis B (3)', ''],
      ['', '', '', ''],
      ['Legenda: DE = desporto escolar', '', '', ''],
    ],
  };
}

test('the day row is found even under a title', () => {
  const reading = readTimetableGrid(wallSheet());

  assert.deepEqual(
    reading.days.map((day) => day.weekday),
    [1, 2, 3],
  );
  assert.equal(reading.timeColumn, 0);
});

test('every cell of the grid becomes a booking with its day, time and lanes', () => {
  // 57.1 and 57.2.
  const { candidates } = readTimetableGrid(wallSheet());

  const masters = candidates.filter((one) => one.name === 'Masters');
  assert.equal(masters.length, 2, 'Monday and Wednesday');
  assert.deepEqual(masters.map((one) => one.weekday).sort(), [1, 3]);
  assert.equal(masters[0]!.startTime, '06:30');
  assert.deepEqual(masters[0]!.laneNames, ['1-3']);
});

test('two classes stacked under one hour both get that hour', () => {
  /*
   * The shape that would lose half a club's timetable. A wall sheet writes the
   * hour once and stacks 6A and 6B under it; reading only the timed row would
   * silently drop every second class in the busiest slots.
   */
  const { candidates } = readTimetableGrid(wallSheet());

  const at0930 = candidates.filter((one) => one.startTime === '09:30' && one.weekday === 1);
  assert.deepEqual(at0930.map((one) => one.name).sort(), ['6A', '6B']);
  assert.deepEqual(at0930.find((one) => one.name === '6B')?.laneNames, ['4-6']);

  const tuesday = candidates.filter((one) => one.startTime === '19:15' && one.weekday === 2);
  assert.deepEqual(tuesday.map((one) => one.name).sort(), ['Infantis A', 'Infantis B']);
});

test('a class is as long as the gap to the next hour', () => {
  // The only thing on a printed sheet that says how long a class runs.
  const { candidates } = readTimetableGrid({
    headers: ['Hora', 'Segunda'],
    rows: [
      ['09:30', 'A (1)'],
      ['10:15', 'B (1)'],
      ['11:00', 'C (1)'],
    ],
  });

  assert.deepEqual(
    candidates.map((one) => one.durationMinutes),
    [45, 45, 45],
  );
});

test('the midday gap is not a four-hour class', () => {
  // 11:45 to 14:45 is the club's lunch. Taking the gap literally would make the
  // last morning class three hours long and overlap everything after it.
  const { candidates } = readTimetableGrid({
    headers: ['Hora', 'Segunda'],
    rows: [
      ['11:00', 'A (1)'],
      ['11:45', 'B (1)'],
      ['14:45', 'C (1)'],
    ],
  });

  assert.equal(candidates[0]!.durationMinutes, 45);
  // The one before the gap falls back to the length of the row above it.
  assert.equal(candidates[1]!.durationMinutes, 45);
});

test('a legend below the grid is reported, never imported', () => {
  const { candidates, unplaced } = readTimetableGrid(wallSheet());

  assert.ok(!candidates.some((one) => one.name.startsWith('Legenda')));
  // Nothing in a *day* column down there, so there is nothing to report either.
  assert.ok(unplaced.every((entry) => !entry.text.includes('Legenda')));
});

test('a sheet with no day row is read as no grid at all', () => {
  // Better than guessing: the screen says it could not find a timetable, which
  // is a thing somebody can act on.
  const reading = readTimetableGrid({
    headers: ['Nome', 'Quantidade'],
    rows: [['Pranchas', '36']],
  });

  assert.deepEqual(reading.candidates, []);
  assert.deepEqual(reading.days, []);
});

test('weekday headings are read in both languages and the club abbreviations', () => {
  for (const [cell, weekday] of [
    ['Segunda', 1],
    ['segunda-feira', 1],
    ['2ª', 1],
    ['Seg', 1],
    ['Monday', 1],
    ['Terça', 2],
    ['terca', 2],
    ['Sábado', 6],
    ['Domingo', 7],
    // A dated heading, which is how a calendar week is written.
    ['Segunda 15/09', 1],
  ] as const) {
    assert.equal(readWeekday(cell), weekday, `${cell} should be day ${weekday}`);
  }

  assert.equal(readWeekday('Hora'), null);
  assert.equal(readWeekday(''), null);
});

test('an hour is read the several ways a sheet writes one', () => {
  assert.equal(readTime('06:30'), '06:30');
  assert.equal(readTime('6:30'), '06:30');
  assert.equal(readTime('6h30'), '06:30');
  assert.equal(readTime('6.30'), '06:30');
  assert.equal(readTime('18h'), '18:00');
  assert.equal(readTime('18'), '18:00');

  assert.equal(readTime('Manhã'), null);
  assert.equal(readTime('25:00'), null);
  // A headcount of 24 must never read as midnight — the bare form only accepts
  // an hour somebody could actually swim at.
  assert.equal(readTime('24'), null);
  assert.equal(readTime('3'), null);
});

test('a cell is split into the class and the lanes it takes', () => {
  assert.deepEqual(readCell('Masters (1-3)'), { name: 'Masters', laneNames: ['1-3'] });
  assert.deepEqual(readCell('6A [1-3]'), { name: '6A', laneNames: ['1-3'] });
  assert.deepEqual(readCell('Absolutos 5,6'), { name: 'Absolutos', laneNames: ['5', '6'] });
  assert.deepEqual(readCell('Infantis - 2'), { name: 'Infantis', laneNames: ['2'] });
  assert.deepEqual(readCell('Juvenis (Pista 4)'), { name: 'Juvenis', laneNames: ['4'] });

  // A class with no lanes written is still a class. The API refuses it for
  // having none and says so, which beats inventing one.
  assert.deepEqual(readCell('Hidroginástica'), {
    name: 'Hidroginástica',
    laneNames: [],
  });

  assert.equal(readCell('   '), null);
});

test('a class name containing digits is not eaten by the lane reader', () => {
  /*
   * The trap. `10G 11B` and `Sub-16` are class names that look exactly like
   * lane lists, and a greedy split would import a school class called "10G" on
   * lane 11.
   */
  assert.deepEqual(readCell('10G 11B (1-3)'), { name: '10G 11B', laneNames: ['1-3'] });
  assert.deepEqual(readCell('Sub-16 (5,6)'), { name: 'Sub-16', laneNames: ['5', '6'] });
  assert.deepEqual(readCell('11H/I (2)'), { name: '11H/I', laneNames: ['2'] });
});

test('the reader survives a grid with ragged rows', () => {
  // Excel gives short rows for trailing blanks, and a naive index would throw.
  const reading = readTimetableGrid({
    headers: ['Hora', 'Segunda', 'Terça'],
    rows: [['09:30', 'A (1)'], ['10:15'], []],
  });

  assert.equal(reading.candidates.length, 1);
  assert.equal(reading.candidates[0]!.name, 'A');
});
