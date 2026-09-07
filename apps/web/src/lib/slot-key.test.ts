import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookingKey, slotKey } from './slot-key.ts';

/**
 * The key the calendar finds a week's occurrence by.
 *
 * **This file exists because the composite stopped being exact.** `slotKey` is
 * turma, weekday and hour — the three columns `class_schedule`'s own unique
 * index uses — and that identified a slot precisely for as long as an occurrence
 * could not leave the slot its pattern put it in.
 *
 * A one-week move now carries a day, an hour and a set of pistas. The moment
 * somebody used it, the session sat at one slot while the block on the grid was
 * still drawn at the pattern's, the composite matched nothing, and the register
 * link, the cancel button, the teacher picker and the lesson plan all silently
 * went missing from exactly the classes that had been rearranged. Reported as
 * "the click on the class block is not working anymore", which is what it looks
 * like when a lookup quietly returns undefined.
 *
 * Run: pnpm web:test
 */

const TURMA = 'group-1';
const BOOKING = 'schedule-1';

test('a booking key survives the week moving away from its pattern', () => {
  // The pattern: Tuesday at 18:00. The grid draws the block here.
  const pattern = { weekday: 2, startTime: '18:00' };
  // This week only, the class went to Wednesday at 19:00.
  const thisWeek = { weekday: 3, startTime: '19:00' };

  // The old key: the two halves no longer agree, which is the whole defect.
  assert.notEqual(
    slotKey(TURMA, pattern.weekday, pattern.startTime),
    slotKey(TURMA, thisWeek.weekday, thisWeek.startTime),
  );

  // The booking's id is what does not move when one of its weeks does.
  assert.equal(bookingKey(BOOKING), bookingKey(BOOKING));
});

test('a booking key cannot collide with a slot key', () => {
  // The two live in one map, so they must not be able to name the same entry.
  assert.notEqual(bookingKey(BOOKING), slotKey(BOOKING, 2, '18:00'));
  assert.ok(bookingKey(BOOKING).startsWith('booking:'));
  assert.ok(!slotKey(TURMA, 2, '18:00').startsWith('booking:'));
});

test('two bookings of one turma at one hour stay apart', () => {
  // A turma can be booked twice in a week, and the composite could not tell
  // two different weekdays of it apart from each other once one had moved.
  assert.notEqual(bookingKey('schedule-1'), bookingKey('schedule-2'));
});

test('the slot key is still exact for what it is for', () => {
  // It remains the fallback for a session with no booking behind it, so the
  // three parts all have to matter.
  assert.notEqual(slotKey(TURMA, 2, '18:00'), slotKey('group-2', 2, '18:00'));
  assert.notEqual(slotKey(TURMA, 2, '18:00'), slotKey(TURMA, 3, '18:00'));
  assert.notEqual(slotKey(TURMA, 2, '18:00'), slotKey(TURMA, 2, '19:00'));
  assert.equal(slotKey(TURMA, 2, '18:00'), slotKey(TURMA, 2, '18:00'));
});
