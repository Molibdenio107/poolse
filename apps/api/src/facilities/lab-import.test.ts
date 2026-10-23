import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLabRows, parseOrganismCount } from './lab-import.js';

/**
 * Checking a laboratory report's rows — POOLSE-101.
 *
 * The one rule here that could quietly mis-grade a tank is reading a colony
 * count: "<1" and "Ausência" are a laboratory's way of writing none, and a
 * detection limit above one colony is not a count at all.
 *
 * Run: pnpm api:test
 */

const CONTEXT = { poolName: 'Tanque Grande', existing: new Set<string>(), now: '2026-10-23 15:00' };

test('a count of none is 0, in every way a laboratory writes it', () => {
  for (const none of ['<1', '< 1', '<1,0', 'Ausência', 'ausente', 'ND', 'não detetado', 'Not detected']) {
    assert.equal(parseOrganismCount(none), 0, none);
  }
  assert.equal(parseOrganismCount('12'), 12);
  assert.equal(parseOrganismCount(''), null);
});

test('a detection limit above one colony is not a count, and a negative one never is', () => {
  assert.equal(parseOrganismCount('<10'), null);
  assert.equal(parseOrganismCount('-3'), null);
  assert.equal(parseOrganismCount('muitas'), null);
});

test('a lab report row reads organisms, chemistry and the lab\'s own labels', () => {
  const { rows, summary } = checkLabRows(
    [
      {
        takenOn: '14/10/2026',
        takenTime: '9:30',
        laboratory: 'Lab Aveiro',
        reportReference: 'B-2026/118',
        e_coli: '<1',
        total_coliforms: '3',
        ph: '7,4',
        free_chlorine: '1,2',
      },
    ],
    CONTEXT,
  );
  assert.equal(summary.importable, 1);
  const [row] = rows;
  assert.equal(row?.takenOn, '2026-10-14');
  assert.equal(row?.takenTime, '09:30');
  assert.equal(row?.laboratory, 'Lab Aveiro');
  assert.equal(row?.reportReference, 'B-2026/118');
  assert.deepEqual(
    row?.values.map((v) => [v.parameter, v.value]),
    [
      ['total_coliforms', 3],
      ['e_coli', 0],
      ['ph', 7.4],
      ['free_chlorine', 1.2],
    ],
  );
});

test('a refused row names what is wrong in the readings preview\'s own words', () => {
  const { rows } = checkLabRows(
    [
      { takenOn: '14/10/2026', e_coli: '<10' },
      { takenOn: '14/10/2026', ph: '15' },
      { e_coli: '0' },
      { takenOn: '14/10/2026', pool: 'Tanque Pequeno', e_coli: '0' },
      { takenOn: '24/10/2026', e_coli: '0' },
      { takenOn: '23/10/2026', takenTime: '16:00', e_coli: '0' },
    ],
    CONTEXT,
  );
  // Its only value unreadable, so it also has none — as a readings row would.
  assert.deepEqual(rows[0]?.problems, ['valueInvalid', 'noReadings']);
  assert.deepEqual(rows[0]?.badParameters, ['e_coli']);
  assert.deepEqual(rows[1]?.badParameters, ['ph']);
  assert.deepEqual(rows[2]?.problems, ['dateMissing']);
  assert.deepEqual(rows[3]?.problems, ['otherPool']);
  assert.deepEqual(rows[4]?.problems, ['dateInFuture']);
  assert.deepEqual(rows[5]?.problems, ['dateInFuture'], 'later today on the facility clock');
  assert.equal(rows.filter((row) => row.importable).length, 0);
});

test('a report already on file, or repeated in the file, is flagged and still importable', () => {
  const { rows, summary } = checkLabRows(
    [
      { takenOn: '14/10/2026', e_coli: '0' },
      { takenOn: '14/10/2026', e_coli: '0' },
      { takenOn: '13/10/2026', takenTime: '10:00', e_coli: '0' },
    ],
    { ...CONTEXT, existing: new Set(['2026-10-13 10:00', '2026-10-13']) },
  );
  assert.deepEqual(rows[0]?.warnings, []);
  assert.deepEqual(rows[1]?.warnings, ['duplicateInFile']);
  assert.deepEqual(rows[2]?.warnings, ['alreadyRecorded']);
  assert.equal(summary.importable, 3);
  assert.equal(summary.duplicates, 2);
});
