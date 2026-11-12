import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromGridReading, narrowReading } from './timetable-reading.ts';
import { readTimetableGrid } from './timetable-grid.ts';

/**
 * Rows of meaning — POOLSE-223. The model's reply is narrowed by hand, a
 * spreadsheet is converted to the same rows.
 *
 * Run: pnpm web:test
 */

/** A reply as the model gives it for Vale Serrado's Monday morning. */
const reply = {
  validity: 'em vigor de 14 de setembro a 30 de junho',
  rows: [
    { sourcePool: 'Piscina de 25 m', weekday: 1, start: '07:00', end: '08:00', activity: 'Hidroginástica', lanes: 3, laneNames: [], closed: false },
    { sourcePool: 'Piscina de 25 m', weekday: 1, start: '07:00', end: '08:00', activity: 'Natação Livre', lanes: 3, laneNames: [], closed: false },
    { sourcePool: 'Piscina de 25 m', weekday: 1, start: '10:00', end: '13:00', activity: 'Natação Livre', lanes: 6, laneNames: [], closed: false },
    { sourcePool: 'Piscina de 25 m', weekday: 1, start: '13:00', end: '14:00', activity: '', lanes: null, laneNames: [], closed: true },
  ],
};

test('a reply is narrowed into rows, validity kept as printed', () => {
  const reading = narrowReading(reply);
  assert.equal(reading.rows.length, 4);
  assert.equal(reading.validity, 'em vigor de 14 de setembro a 30 de junho');
  assert.deepEqual(reading.rows[2], {
    sourcePool: 'Piscina de 25 m',
    weekday: 1,
    start: '10:00',
    end: '13:00',
    activity: 'Natação Livre',
    lanes: 6,
    laneNames: [],
    closed: false,
    line: 3,
  });
});

test('rows that break the shape are dropped, not passed on', () => {
  const reading = narrowReading({
    validity: '',
    rows: [
      { weekday: 8, start: '07:00', end: '08:00', activity: 'X', lanes: null, laneNames: [], closed: false },
      { weekday: 1, start: '9h', end: '10:00', activity: 'X', lanes: null, laneNames: [], closed: false },
      { weekday: 1, start: '10:00', end: '09:00', activity: 'X', lanes: null, laneNames: [], closed: false },
      { weekday: 1, start: '10:00', end: '11:00', activity: '  ', lanes: null, laneNames: [], closed: false },
      { weekday: 2, start: '6h30', end: '7.15', activity: 'Masters', lanes: 0, laneNames: ['1-3', 7], closed: false },
      null,
    ],
  });
  assert.equal(reading.validity, null);
  assert.equal(reading.rows.length, 1);
  assert.deepEqual(reading.rows[0], {
    sourcePool: '',
    weekday: 2,
    start: '06:30',
    end: '07:15',
    activity: 'Masters',
    lanes: null,
    laneNames: ['1-3'],
    closed: false,
    line: 5,
  });
});

test('a reply that is not an object reads as nothing', () => {
  assert.deepEqual(narrowReading(null), { rows: [], validity: null });
  assert.deepEqual(narrowReading('rows'), { rows: [], validity: null });
});

test('a spreadsheet becomes the same rows: count out of the name, Encerrado closed', () => {
  const grid = readTimetableGrid({
    headers: ['', 'Segunda', 'Terça'],
    rows: [
      ['07:00', 'Hidroginástica (3 pistas)', 'Encerrado'],
      ['08:00', 'Masters 1-3', ''],
      ['09:00', '', ''],
    ],
  });
  const reading = fromGridReading(grid);
  const [hydro, closed, masters] = [...reading.rows].sort((a, b) => a.line - b.line || a.weekday - b.weekday);
  assert.equal(hydro?.activity, 'Hidroginástica');
  assert.equal(hydro?.lanes, 3);
  assert.equal(hydro?.end, '08:00');
  assert.equal(closed?.closed, true);
  assert.equal(closed?.activity, '');
  assert.equal(masters?.activity, 'Masters');
  assert.deepEqual(masters?.laneNames, ['1-3']);
  assert.equal(masters?.lanes, null);
  assert.equal(reading.rows.every((row) => row.sourcePool === ''), true);
});
