import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandLanes,
  previewTimetable,
  readClock,
  type RawTimetableRow,
  type TimetableContext,
} from './timetable-import.js';
import type { RuleBooking } from '@poolse/rules';

/**
 * A timetable arriving as a file — POOLSE-57.
 *
 * Two decisions are under test here and they are Rui's, not the model's:
 *
 * **Nothing is written while a conflict is unresolved.** `committable` is the
 * single boolean the commit reads, so "refuse the whole file until clean"
 * cannot be half-implemented by a caller that forgot a case.
 *
 * **A clash is never resolved by overwriting**, so every conflict names both
 * sides — what is arriving, what is already there, and whether that other thing
 * is on the grid or is an earlier line of the same file. Those are different
 * sentences for the operator and the dialog has to be able to tell them apart.
 *
 * The case most likely to be got wrong has a test of its own: **two rows of one
 * file colliding with each other**. Evaluating each row against the database
 * alone would miss every one of them, and it is the commonest clash there is.
 *
 * Run: pnpm api:test
 */

const LANES = [1, 2, 3, 4, 5, 6].map((position) => ({
  id: `lane-${position}`,
  name: `Pista ${position}`,
  poolId: 'pool-1',
  position,
  defaultCapacity: 8,
}));

function context(over: Partial<TimetableContext> = {}): TimetableContext {
  return {
    lanes: LANES,
    instructors: [
      { id: 'sandra', name: 'Sandra Moreira' },
      { id: 'nuno', name: 'Nuno Teixeira' },
    ],
    existing: [],
    openWeekdays: [1, 2, 3, 4, 5, 6],
    closures: [],
    laneLevelCapacity: {},
    maxConcurrentGroupsPerInstructor: null,
    ...over,
  };
}

function row(over: Partial<RawTimetableRow> = {}): RawTimetableRow {
  return {
    weekday: 2,
    startTime: '19:15',
    durationMinutes: 45,
    name: 'Absolutos',
    laneNames: ['Pista 2'],
    line: 2,
    ...over,
  };
}

function onGrid(over: Partial<RuleBooking> = {}): RuleBooking {
  return {
    id: 'existing-1',
    name: 'Infantis',
    weekday: 2,
    startMinutes: 19 * 60 + 15,
    durationMinutes: 45,
    laneIds: ['lane-2'],
    poolId: 'pool-1',
    instructorId: null,
    levelId: null,
    headcount: null,
    cancelled: false,
    ...over,
  };
}

test('a clean file is committable and says what it will write', () => {
  const preview = previewTimetable(
    [
      row({ name: 'Absolutos', laneNames: ['Pista 2'] }),
      row({ name: 'Cadetes', laneNames: ['Pista 3'], line: 3 }),
    ],
    context(),
  );

  assert.equal(preview.summary.total, 2);
  assert.equal(preview.summary.importable, 2);
  assert.equal(preview.summary.blocked, 0);
  assert.equal(preview.committable, true);
});

test('two rows of one file colliding with each other are both caught', () => {
  /*
   * The one this module exists for. Judging each row against the database alone
   * would let a file put two classes on Pista 2 at 19:15 and report nothing.
   */
  const preview = previewTimetable(
    [
      row({ name: 'Absolutos', laneNames: ['Pista 2'], line: 2 }),
      row({ name: 'Cadetes', laneNames: ['Pista 2'], line: 3 }),
    ],
    context(),
  );

  const second = preview.rows[1]!;
  const clash = second.clashes.find((one) => one.code === 'laneTaken');

  assert.ok(clash, 'the second row should collide with the first');
  // Both sides named — decision 2. "There is a conflict" is not enough for a
  // dialog that asks the operator to decide.
  assert.equal(clash.with, 'Absolutos');
  assert.equal(clash.lane, 'Pista 2');
  // And it says the other party is in this file, not on the grid.
  assert.equal(clash.withLine, 2);

  assert.equal(second.importable, false);
  assert.equal(preview.committable, false);
});

test('a row colliding with the grid names the booking already there', () => {
  const preview = previewTimetable([row({ name: 'Absolutos', laneNames: ['Pista 2'] })], context({
    existing: [onGrid()],
  }));

  const clash = preview.rows[0]!.clashes.find((one) => one.code === 'laneTaken');
  assert.equal(clash?.with, 'Infantis');
  // Null line: it is on the grid, which is a different sentence from "line 2 of
  // the file you just uploaded".
  assert.equal(clash?.withLine, null);
  assert.equal(preview.committable, false);
});

test('the same time on different lanes is not a conflict', () => {
  // The club's ordinary Tuesday, and the first half of the rule: coinciding
  // hours are fine as long as the lanes differ.
  const preview = previewTimetable(
    [
      row({ name: 'Infantis A', laneNames: ['Pista 2'], line: 2 }),
      row({ name: 'Infantis B', laneNames: ['Pista 3'], line: 3 }),
      row({ name: 'Juvenis', laneNames: ['Pista 4'], line: 4 }),
    ],
    context(),
  );

  assert.equal(preview.summary.blocked, 0);
  assert.equal(preview.committable, true);
});

test('one instructor across adjacent lanes of one tank is allowed', () => {
  // POOLSE-51's whole argument, and an import must not undo it.
  const preview = previewTimetable(
    [
      row({ name: 'Infantis A', laneNames: ['Pista 2'], instructorName: 'Sandra Moreira', line: 2 }),
      row({ name: 'Infantis B', laneNames: ['Pista 3'], instructorName: 'Sandra Moreira', line: 3 }),
      row({ name: 'Juvenis', laneNames: ['Pista 4'], instructorName: 'Sandra Moreira', line: 4 }),
    ],
    context(),
  );

  assert.equal(preview.summary.blocked, 0);
  assert.equal(preview.committable, true);
});

test('one instructor in two pools at once is refused', () => {
  const otherTank = {
    id: 'lane-9',
    name: 'Tanque Pequeno',
    poolId: 'pool-2',
    position: 1,
    defaultCapacity: 6,
  };

  const preview = previewTimetable(
    [
      row({ name: 'Infantis', laneNames: ['Pista 2'], instructorName: 'Sandra Moreira', line: 2 }),
      row({
        name: 'Bebés',
        laneNames: ['Tanque Pequeno'],
        instructorName: 'Sandra Moreira',
        line: 3,
      }),
    ],
    context({ lanes: [...LANES, otherTank] }),
  );

  const clash = preview.rows[1]!.clashes.find((one) => one.code === 'instructorElsewhere');
  assert.ok(clash);
  assert.equal(clash.with, 'Infantis');
  assert.equal(preview.committable, false);
});

test('a lane the site does not have refuses its row', () => {
  /*
   * Harsher than the instructor below, deliberately. A booking with no lane is
   * legal in this schema and invisible on the grid, so importing one because
   * "Pista 9" matched nothing would put a class somewhere nobody can see it.
   */
  const preview = previewTimetable([row({ laneNames: ['Pista 9'] })], context());

  assert.deepEqual(
    preview.rows[0]!.problems.map((p) => p.code),
    ['laneNotFound'],
  );
  assert.equal(preview.rows[0]!.readable, false);
  assert.equal(preview.summary.refused, 1);
  assert.equal(preview.committable, false);
});

test('an instructor the club does not know is a warning, and the class still lands', () => {
  // The opposite call, and for a reason: the timetable is still true without the
  // name. Losing "Sandra" costs a click on the grid; losing the class costs the
  // class.
  const preview = previewTimetable(
    [row({ instructorName: 'Quem Quer Que Seja' })],
    context(),
  );

  const only = preview.rows[0]!;
  assert.equal(only.readable, true);
  assert.equal(only.importable, true);
  assert.equal(only.instructorId, null);
  assert.deepEqual(only.warnings.map((w) => w.code).sort(), [
    'headcountMissing',
    'instructorNotFound',
  ]);
  assert.equal(preview.committable, true);
});

test('a closed day blocks the row rather than importing onto it', () => {
  const preview = previewTimetable([row({ weekday: 7 })], context({ openWeekdays: [1, 2, 3, 4, 5] }));

  assert.ok(preview.rows[0]!.clashes.some((one) => one.code === 'weekdayDisabled'));
  assert.equal(preview.committable, false);
});

test('one unresolved conflict refuses the whole file', () => {
  // Decision 1, in the only form that matters: nineteen perfectly good rows do
  // not buy their way past the twentieth.
  const rows = Array.from({ length: 19 }, (_, n) =>
    row({ name: `Turma ${n}`, laneNames: [`Pista ${(n % 6) + 1}`], weekday: (n % 5) + 1, line: n + 2 }),
  );
  rows.push(row({ name: 'Colide', laneNames: ['Pista 1'], weekday: 1, line: 21 }));

  const preview = previewTimetable(rows, context());

  assert.ok(preview.summary.blocked > 0);
  assert.equal(preview.committable, false, 'one clash refuses the file');
});

test('an empty file is not quietly committable', () => {
  const preview = previewTimetable([], context());
  assert.equal(preview.committable, false);
});

test('lanes are read the way a club writes them', () => {
  // "1-3", "1,2,3", "Pista 2", "Pista 1 a 3" — all of these are on real sheets.
  assert.deepEqual(expandLanes(['1-3'], LANES).ids, ['lane-1', 'lane-2', 'lane-3']);
  assert.deepEqual(expandLanes(['1 a 3'], LANES).ids, ['lane-1', 'lane-2', 'lane-3']);
  assert.deepEqual(expandLanes(['1', '2', '3'], LANES).ids, ['lane-1', 'lane-2', 'lane-3']);
  assert.deepEqual(expandLanes(['Pista 2'], LANES).ids, ['lane-2']);
  assert.deepEqual(expandLanes(['pista 2'], LANES).ids, ['lane-2']);

  // A repeat is not a second lane.
  assert.deepEqual(expandLanes(['2', 'Pista 2'], LANES).ids, ['lane-2']);

  // And a name nothing matches is reported rather than dropped.
  assert.deepEqual(expandLanes(['Pista 9'], LANES).missing, ['Pista 9']);
});

test('the clock is read the way a sheet writes one', () => {
  assert.equal(readClock('19:15'), 19 * 60 + 15);
  assert.equal(readClock(' 6:30 '), 6 * 60 + 30);
  assert.equal(readClock('19h15'), 19 * 60 + 15);
  assert.equal(readClock('19.15'), 19 * 60 + 15);

  assert.equal(readClock('manhã'), null);
  assert.equal(readClock('25:00'), null);
  assert.equal(readClock('19:75'), null);
});

test('a row the reader could not make sense of is refused, not guessed', () => {
  const preview = previewTimetable(
    [
      row({ name: '', line: 2 }),
      row({ startTime: 'manhã', line: 3 }),
      row({ durationMinutes: 0, line: 4 }),
    ],
    context(),
  );

  assert.deepEqual(
    preview.rows.map((r) => r.problems[0]?.code),
    ['nameRequired', 'badTime', 'badDuration'],
  );
  assert.equal(preview.summary.refused, 3);
  assert.equal(preview.committable, false);
});

test('a refused row is not judged for conflicts it cannot have', () => {
  /*
   * A row with no readable time cannot collide with anything, and reporting a
   * clash on it would give the operator two problems to fix where there is one.
   */
  const preview = previewTimetable(
    [
      row({ name: 'Absolutos', laneNames: ['Pista 2'], line: 2 }),
      row({ name: 'Ilegível', startTime: 'manhã', laneNames: ['Pista 2'], line: 3 }),
    ],
    context(),
  );

  assert.deepEqual(preview.rows[1]!.clashes, []);
});

test('a cancelled booking on the grid frees its lane', () => {
  const preview = previewTimetable(
    [row({ laneNames: ['Pista 2'] })],
    context({ existing: [onGrid({ cancelled: true })] }),
  );

  assert.equal(preview.committable, true);
});
