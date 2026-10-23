import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportDestination } from './analysis-report.ts';
import { mergeAnswers, splitByDestination } from './water-import-routing.ts';

/**
 * POOLSE-101 — a report's rows go to the laboratory's results or to the
 * readings, and the preview and the ticks keep each row's place in the file.
 *
 * Run: pnpm web:test
 */

test('an organism count makes a row a laboratory\'s; chemistry alone is a reading', () => {
  assert.equal(reportDestination({ takenOn: '14/10/2026', e_coli: '<1', ph: '7,4' }), 'lab');
  assert.equal(reportDestination({ takenOn: '14/10/2026', total_coliforms: '0' }), 'lab');
  assert.equal(reportDestination({ takenOn: '14/10/2026', ph: '7,4', free_chlorine: '1,2' }), 'readings');
  // A blank organism is not a count.
  assert.equal(reportDestination({ takenOn: '14/10/2026', ph: '7,4', e_coli: '  ' }), 'readings');
});

test('the split keeps each row\'s file position, and the ticks follow their rows', () => {
  const rows = [
    { takenOn: 'a', ph: '7' },
    { takenOn: 'b', e_coli: '0' },
    { takenOn: 'c', ph: '7' },
    { takenOn: 'd', enterococci: '0' },
  ];
  const parts = splitByDestination(rows, [1, 2]);
  assert.deepEqual(parts.readings.origin, [0, 2]);
  assert.deepEqual(parts.lab.origin, [1, 3]);
  assert.deepEqual(parts.readings.include, [1], 'file row 2 is the second reading');
  assert.deepEqual(parts.lab.include, [0], 'file row 1 is the first lab row');

  const none = splitByDestination(rows, null);
  assert.equal(none.readings.include, null);
  assert.equal(none.lab.include, null);
});

test('the two answers come back as one list in file order, each saying where it lands', () => {
  const summary = (n: number) => ({ total: n, importable: n, refused: 0, duplicates: 0 });
  const merged = mergeAnswers(
    {
      origin: [0, 2],
      answer: {
        summary: summary(2),
        created: 1,
        skipped: 1,
        rows: [0, 1].map((index) => ({
          index, takenOn: '2026-10-14', takenTime: null, notes: null,
          values: [{ metric: 'ph', value: 7 }], badMetrics: [], problems: [], warnings: [], importable: true,
        })),
      },
    },
    {
      origin: [1],
      answer: {
        summary: summary(1),
        created: 1,
        rows: [{
          index: 0, takenOn: '2026-10-14', takenTime: '09:00', notes: null,
          values: [{ parameter: 'e_coli', value: 0 }], badParameters: [], problems: [], warnings: [], importable: true,
        }],
      },
    },
  );
  assert.deepEqual(merged.rows.map((row) => [row.index, row.line, row.destination]), [
    [0, 2, 'readings'],
    [1, 3, 'lab'],
    [2, 4, 'readings'],
  ]);
  assert.deepEqual(merged.rows[0]?.values, [{ parameter: 'ph', value: 7 }]);
  assert.equal(merged.summary.total, 3);
  assert.equal(merged.created, 2);
  assert.equal(merged.skipped, 1);
});

test('one side alone still answers, and a preview carries no counts of what was written', () => {
  const merged = mergeAnswers(null, {
    origin: [0],
    answer: {
      summary: { total: 1, importable: 0, refused: 1, duplicates: 0 },
      rows: [{
        index: 0, takenOn: '', takenTime: null, notes: null, values: [],
        badParameters: [], problems: ['dateMissing'], warnings: [], importable: false,
      }],
    },
  });
  assert.equal(merged.rows[0]?.destination, 'lab');
  assert.equal(merged.created, undefined);
  assert.equal(merged.summary.refused, 1);
});
