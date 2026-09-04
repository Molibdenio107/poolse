import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellAt,
  groupOf,
  instructorDisplay,
  rowTimes,
  slotAt,
  slotsCovered,
  slotsFor,
  toMinutes,
  toTime,
  type Placeable,
} from './grid-layout.ts';

/**
 * Where a class sits on the week — POOLSE-49, shared with POOLSE-54.
 *
 * This module is now the one answer three renders give to the same question:
 * the interactive grid, the printed sheet and the `Horário` worksheet all ask it
 * which class is in lane 3 at 09:30 on a Thursday. That is exactly why it is
 * worth testing on its own — a disagreement between the wall and the screen is
 * the kind of bug a club finds before we do, and does not report, because it
 * looks like somebody mistyped something.
 *
 * The cases here are the ones the grid actually got wrong at some point: a
 * 90-minute class in 45-minute rows, a class ending exactly when the next row
 * starts, and a three-lane block that must be one block rather than three.
 *
 * Run: pnpm web:test
 */

const SLOTS = [
  { id: 'a', dayGroup: 'weekday' as const, startTime: '09:30', endTime: '10:15' },
  { id: 'b', dayGroup: 'weekday' as const, startTime: '10:15', endTime: '11:00' },
  { id: 'c', dayGroup: 'weekday' as const, startTime: '11:00', endTime: '11:45' },
  { id: 's', dayGroup: 'saturday' as const, startTime: '07:30', endTime: '08:15' },
];

function booking(over: Partial<Placeable> = {}): Placeable {
  return {
    weekday: 2,
    laneIds: ['l1'],
    slotId: 'a',
    startMinutes: toMinutes('09:30'),
    durationMinutes: 45,
    ...over,
  };
}

const LANES = new Set(['l1', 'l2', 'l3', 'l4']);

test('the clock survives a round trip in both directions', () => {
  assert.equal(toMinutes('09:30'), 570);
  assert.equal(toTime(570), '09:30');
  // Midnight as an end time is 24:00 and not 00:00 — a slot that runs to the
  // end of the day has to sort after 23:00, not before 06:30.
  assert.equal(toMinutes('24:00'), 1440);
  assert.equal(toTime(1440 - 15), '23:45');
});

test('Saturday and Sunday draw from their own rows', () => {
  assert.equal(groupOf(1), 'weekday');
  assert.equal(groupOf(5), 'weekday');
  assert.equal(groupOf(6), 'saturday');
  assert.equal(groupOf(7), 'sunday');
});

test('a 90-minute class covers both the rows it runs through', () => {
  // The bug POOLSE-49 fixed: drawn one row tall, the second half was invisible
  // and the 10:15 row looked free while the pool was busy.
  const covered = slotsCovered(toMinutes('09:30'), 90, SLOTS);
  assert.deepEqual(
    covered.map((slot) => slot.id),
    ['a', 'b'],
  );
});

test('a class ending exactly when the next row starts does not claim it', () => {
  // Half-open, and it matters: 09:30–10:15 is the 09:30 row and nothing else,
  // or every class in the club would look like it overruns by one row.
  const covered = slotsCovered(toMinutes('09:30'), 45, SLOTS);
  assert.deepEqual(
    covered.map((slot) => slot.id),
    ['a'],
  );
});

test('the week is drawn on every start time any shown day offers, in clock order', () => {
  // Saturday's 07:30 is a row of its own and sorts above the weekday 09:30 —
  // which is the whole reason a row is a start time rather than a slot.
  assert.deepEqual(rowTimes(SLOTS, [2, 6]), ['07:30', '09:30', '10:15', '11:00']);

  // Without Saturday on screen, its row is not drawn at all.
  assert.deepEqual(rowTimes(SLOTS, [2]), ['09:30', '10:15', '11:00']);
});

test('a day answers for itself whether it has a slot at a time', () => {
  assert.equal(slotAt(SLOTS, 2, '09:30')?.id, 'a');
  // A weekday has no 07:30 even though Saturday does. That gap is drawn as
  // unavailable rather than as an empty target.
  assert.equal(slotAt(SLOTS, 2, '07:30'), undefined);
  assert.equal(slotAt(SLOTS, 6, '07:30')?.id, 's');

  assert.deepEqual(
    slotsFor(SLOTS, 6).map((slot) => slot.id),
    ['s'],
  );
});

test('a three-lane class is one block on its first lane, not three', () => {
  const wide = booking({ laneIds: ['l2', 'l3', 'l4'] });
  const day = slotsFor(SLOTS, 2);

  const first = cellAt([wide], 2, 'l2', SLOTS[0]!, day, LANES);
  assert.equal(first?.span, 3);
  assert.equal(first?.continues, false);

  // The lanes it swallows hold nothing of their own — the render is what draws
  // it across them, and finding it three times would draw three copies.
  assert.equal(cellAt([wide], 2, 'l3', SLOTS[0]!, day, LANES), null);
  assert.equal(cellAt([wide], 2, 'l4', SLOTS[0]!, day, LANES), null);
});

test('a span is clipped to the lanes actually being drawn', () => {
  // "Esconder pistas vazias" can hide a lane in the middle of a span, and a
  // block that kept its original height would overhang the slot below it.
  const wide = booking({ laneIds: ['l2', 'l3', 'l4'] });
  const showing = new Set(['l1', 'l2', 'l4']);

  const cell = cellAt([wide], 2, 'l2', SLOTS[0]!, slotsFor(SLOTS, 2), showing);
  assert.equal(cell?.span, 2);
});

test('the later rows of a long class are continuations, not new blocks', () => {
  const long = booking({ durationMinutes: 90 });
  const day = slotsFor(SLOTS, 2);

  assert.equal(cellAt([long], 2, 'l1', SLOTS[0]!, day, LANES)?.continues, false);
  assert.equal(cellAt([long], 2, 'l1', SLOTS[1]!, day, LANES)?.continues, true);
  // And it stops where it stops.
  assert.equal(cellAt([long], 2, 'l1', SLOTS[2]!, day, LANES), null);
});

test('a booking is judged against its own day, never another', () => {
  const tuesday = booking({ weekday: 2 });
  assert.equal(cellAt([tuesday], 4, 'l1', SLOTS[0]!, slotsFor(SLOTS, 2), LANES), null);
});

test('a booking with no slot belongs to no cell', () => {
  // Fora da grelha. It is listed under the grid, on screen and on the sheet, and
  // must never be silently placed in a row its time does not match.
  const stray = booking({ slotId: null });
  assert.equal(cellAt([stray], 2, 'l1', SLOTS[0]!, slotsFor(SLOTS, 2), LANES), null);
});

test('the instructor states resolve to the right name, or to none', () => {
  const base = { instructorName: null, ownInstructorName: null, subtitle: null };

  assert.deepEqual(
    instructorDisplay({ ...base, instructorStatus: 'assigned', instructorName: 'Sandra Lopes' }),
    { state: 'assigned', name: 'Sandra Lopes', alert: false },
  );

  // 53.8 — the group's own teacher wins.
  assert.equal(
    instructorDisplay({
      ...base,
      instructorStatus: 'external',
      ownInstructorName: 'Prof. Silva',
      subtitle: 'ES D. Dinis',
    }).name,
    'Prof. Silva',
  );

  // 53.9 — with no name given, the partner's own name stands in, because "a
  // school is sending somebody" is still more than the club knows about a gap.
  assert.equal(
    instructorDisplay({ ...base, instructorStatus: 'external', subtitle: 'ES D. Dinis' }).name,
    'ES D. Dinis',
  );

  // The two gaps carry no name at all, and only one of them is an alert.
  assert.deepEqual(instructorDisplay({ ...base, instructorStatus: 'uncovered' }), {
    state: 'uncovered',
    name: null,
    alert: true,
  });
  assert.deepEqual(instructorDisplay({ ...base, instructorStatus: 'to_define' }), {
    state: 'to_define',
    name: null,
    alert: false,
  });
});

test('an uncovered booking never borrows a name from anywhere', () => {
  /*
   * The one that would be easy to get wrong. A booking escalated to `uncovered`
   * can still carry a stale `instructorName` — the trigger only clears the
   * *status*, not the column a turma reaches through — and printing that name
   * beside "Sem professor" would put a person's name on the club's wall next to
   * a slot they are not teaching.
   */
  const stale = instructorDisplay({
    instructorStatus: 'uncovered',
    instructorName: 'Sandra Lopes',
    ownInstructorName: 'Prof. Silva',
    subtitle: 'ES D. Dinis',
  });

  assert.equal(stale.name, null);
});
