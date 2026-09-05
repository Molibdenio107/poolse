import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAnalysisRows,
  momentKey,
  parseReading,
  parseReadingTime,
  type RawAnalysisRow,
} from './analysis-import.js';

/**
 * Reading a club's water log — round 5, ticket 5.
 *
 * Two rules here would lose data silently if they were wrong, and both have
 * their own test:
 *
 * - **A Portuguese decimal is a number.** `Number('7,4')` is `NaN`. A parser
 *   built on it refuses every row of every pt-PT water log and accepts every
 *   English one, which is the shape of bug that ships because the person testing
 *   it typed a dot.
 * - **A bad reading is not a bad row.** Chlorine at 0.1 is exactly what the log
 *   exists to record. Refusing it would drop the days that matter most.
 *
 * Run: pnpm api:test
 */

const NOTHING = { poolName: 'Tanque Grande', existing: new Set<string>() };

function rows(...list: RawAnalysisRow[]): RawAnalysisRow[] {
  return list;
}

test('a reading is read the way a club writes it', () => {
  // pt-PT, which is the default locale and the one that would have broken.
  assert.equal(parseReading('7,4'), 7.4);
  assert.equal(parseReading('0,45'), 0.45);
  assert.equal(parseReading('27,5'), 27.5);

  // en, and whole numbers in either.
  assert.equal(parseReading('7.4'), 7.4);
  assert.equal(parseReading('110'), 110);
  assert.equal(parseReading(' 3200 '), 3200);
  assert.equal(parseReading('-0.2'), -0.2, 'a negative reading is a reading');

  // Not numbers.
  assert.equal(parseReading(''), null);
  assert.equal(parseReading('Bom'), null);
  assert.equal(parseReading('7,4,2'), null);
  assert.equal(parseReading('~7'), null);

  /*
   * A thousands separator is refused rather than guessed. `1.234` is 1234 in
   * pt-PT and 1.234 in en, and salt is the metric where both are plausible —
   * guessing would put a pool's salinity out by a factor of a thousand.
   */
  assert.equal(parseReading('1.234,5'), null);
  assert.equal(parseReading('1,234.5'), null);
});

test('a time is optional, and refused rather than guessed', () => {
  assert.deepEqual(parseReadingTime('08:30'), { time: '08:30' });
  assert.deepEqual(parseReadingTime('8:30'), { time: '08:30' }, 'padded');
  assert.deepEqual(parseReadingTime('08:30:00'), { time: '08:30' }, 'a spreadsheet writes seconds');
  assert.equal(parseReadingTime(''), null, 'absent is not an error');

  assert.deepEqual(parseReadingTime('25:00'), { error: true });
  assert.deepEqual(parseReadingTime('08:70'), { error: true });
  assert.deepEqual(parseReadingTime('manhã'), { error: true });
});

test('an out-of-range reading is imported, not refused', () => {
  // Free chlorine at 0.1 against a band of 0.5–2. This is the day the log is
  // for, and losing it would be the worst possible failure of an importer.
  const { rows: checked, summary } = checkAnalysisRows(
    rows({ takenOn: '2026-09-01', free_chlorine: '0,1', ph: '8,9' }),
    NOTHING,
  );

  assert.equal(checked[0]?.importable, true);
  assert.deepEqual(checked[0]?.problems, []);
  assert.equal(summary.importable, 1);
  assert.deepEqual(
    checked[0]?.values,
    [
      { metric: 'ph', value: 8.9 },
      { metric: 'free_chlorine', value: 0.1 },
    ],
    'both readings kept, in enum order',
  );
});

test('a row without a date, or without a reading, is refused', () => {
  const { rows: checked, summary } = checkAnalysisRows(
    rows(
      { ph: '7,4' },
      { takenOn: '2026-09-01' },
      { takenOn: 'não sei', ph: '7,4' },
      { takenOn: '2026-09-02', ph: '7,4' },
    ),
    NOTHING,
  );

  assert.deepEqual(checked[0]?.problems, ['dateMissing']);
  assert.deepEqual(checked[1]?.problems, ['noReadings'], 'a date with nothing in it is not a log');
  assert.deepEqual(checked[2]?.problems, ['dateInvalid']);
  assert.equal(checked[3]?.importable, true);

  assert.equal(summary.total, 4);
  assert.equal(summary.importable, 1);
  assert.equal(summary.refused, 3);
});

test('a cell that is not a number names the metric it came from', () => {
  const { rows: checked } = checkAnalysisRows(
    rows({ takenOn: '2026-09-01', ph: 'ver folha', free_chlorine: '1,2' }),
    NOTHING,
  );

  assert.deepEqual(checked[0]?.problems, ['valueInvalid']);
  assert.deepEqual(checked[0]?.badMetrics, ['ph'], 'so the message can say which column');
  assert.equal(checked[0]?.importable, false);

  // The readable half is still parsed, so a corrected file needs one edit rather
  // than a re-import of everything.
  assert.deepEqual(checked[0]?.values, [{ metric: 'free_chlorine', value: 1.2 }]);
});

test('a tank column naming another tank refuses the row', () => {
  /*
   * A club exporting every tank into one sheet is ordinary. Importing all of it
   * into whichever tank the operator happened to open would be silent and wrong.
   */
  const { rows: checked } = checkAnalysisRows(
    rows(
      { takenOn: '2026-09-01', ph: '7,4', pool: 'Tanque Grande' },
      { takenOn: '2026-09-01', ph: '7,1', pool: 'Tanque de Aprendizagem' },
      { takenOn: '2026-09-02', ph: '7,3', pool: 'tanque grande' },
      { takenOn: '2026-09-03', ph: '7,2' },
    ),
    NOTHING,
  );

  assert.equal(checked[0]?.importable, true, 'this tank');
  assert.deepEqual(checked[1]?.problems, ['otherPool'], 'somebody else’s');
  assert.equal(checked[2]?.importable, true, 'case and accents folded');
  assert.equal(checked[3]?.importable, true, 'no tank column is this tank');
});

test('a repeated moment is a warning, never a refusal', () => {
  const { rows: checked, summary } = checkAnalysisRows(
    rows(
      { takenOn: '2026-09-01', takenTime: '08:30', ph: '7,4' },
      { takenOn: '2026-09-01', takenTime: '08:30', ph: '7,4' },
      { takenOn: '2026-09-01', takenTime: '17:00', ph: '7,5' },
      { takenOn: '2026-09-02', ph: '7,3' },
    ),
    { poolName: 'Tanque Grande', existing: new Set(['2026-09-02']) },
  );

  assert.deepEqual(checked[0]?.warnings, []);
  assert.deepEqual(checked[1]?.warnings, ['duplicateInFile'], 'a copy-pasted line');
  assert.deepEqual(checked[2]?.warnings, [], 'twice in one day is two samples, not a duplicate');
  assert.deepEqual(checked[3]?.warnings, ['alreadyRecorded']);

  // Every one of them still imports — a club re-uploading a month that overlaps
  // last month's file is doing something ordinary, and being told is enough.
  assert.equal(summary.importable, 4);
  assert.equal(summary.duplicates, 2);
});

test('the line number counts the header', () => {
  const { rows: checked } = checkAnalysisRows(
    rows({ takenOn: '2026-09-01', ph: '7,4' }, { takenOn: '2026-09-02', ph: '7,3' }),
    NOTHING,
  );

  // "Row 2 is wrong" has to mean the second line of the file the operator is
  // looking at, not the second data row.
  assert.equal(checked[0]?.line, 2);
  assert.equal(checked[1]?.line, 3);
  assert.equal(checked[0]?.index, 0, 'the handle stays 0-based');
});

test('a moment is keyed by the minute, or by the day when there is no time', () => {
  assert.equal(momentKey('2026-09-01', '08:30'), '2026-09-01 08:30');
  assert.equal(momentKey('2026-09-01', null), '2026-09-01');
});
