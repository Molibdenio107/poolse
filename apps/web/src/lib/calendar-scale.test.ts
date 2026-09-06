import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayRange,
  hourMarks,
  levelOrder,
  levelTint,
  minutesToPx,
  snapDuration,
  snapStart,
  snapStep,
} from './calendar-scale.ts';

/**
 * The arithmetic the calendar is drawn from.
 *
 * Worth testing on its own because every visible property depends on it and none
 * of it is visible when it is wrong — a block an hour too low still looks like a
 * block, and a snap that quietly rounds 06:30 to 06:45 looks like the operator
 * missed.
 */

const slot = (dayGroup: string, startTime: string, endTime: string) =>
  ({ id: `${dayGroup}-${startTime}`, dayGroup, startTime, endTime }) as never;

// An ordinary weekday grid: 45-minute pitches from 08:00, and an early one.
const GRID = [
  slot('weekday', '06:30', '07:15'),
  slot('weekday', '08:00', '08:45'),
  slot('weekday', '08:45', '09:30'),
  slot('weekday', '09:30', '10:15'),
  slot('saturday', '09:00', '10:00'),
];

const booking = (startTime: string, durationMinutes: number) =>
  ({ startTime, durationMinutes }) as never;

test('the canvas spans whole hours around the slots', () => {
  const range = dayRange(GRID, []);
  assert.equal(range.startMinutes, 6 * 60);
  assert.equal(range.endMinutes, 11 * 60);
});

/**
 * A booking can sit outside the grid — the schema allows a null `slotId`. A
 * canvas sized only to the slots would clip it out of sight, which turns a
 * problem the operator needs to see into one they cannot.
 */
test('a booking outside the slots widens the canvas rather than being clipped', () => {
  const range = dayRange(GRID, [booking('21:30', 60)]);
  assert.equal(range.endMinutes, 23 * 60);
});

test('a facility with no grid still gets a day to draw', () => {
  const range = dayRange([], []);
  assert.ok(range.endMinutes > range.startMinutes);
});

test('hour marks land on the hour, first and last included', () => {
  const marks = hourMarks({ startMinutes: 6 * 60, endMinutes: 9 * 60 });
  assert.deepEqual(marks, [360, 420, 480, 540]);
  assert.equal(minutesToPx(60) * 3, minutesToPx(marks[3]! - marks[0]!));
});

test('the snap step is the grid’s own granularity', () => {
  // 06:30, 08:00 and 45-minute lengths have 15 as their common divisor.
  assert.equal(snapStep(GRID), 15);
  // A club on the hour gets an hour.
  assert.equal(snapStep([slot('weekday', '08:00', '09:00')]), 60);
  // No grid at all still snaps to something usable.
  assert.equal(snapStep([]), 15);
});

/**
 * The club's own rows beat the arithmetic. Landing exactly on 06:30 — the hour
 * the masters swim — matters more than landing on a tidy multiple of fifteen.
 */
test('a drop near a slot start lands exactly on it', () => {
  assert.equal(snapStart(6 * 60 + 34, 1, GRID, 15), 6 * 60 + 30);
  assert.equal(snapStart(7 * 60 + 58, 1, GRID, 15), 8 * 60);
});

test('a drop in a gap the grid has no row for still snaps to the step', () => {
  // 12:07 on a grid whose last slot ends at 10:15: nothing is near, so the step
  // decides. Refusing the drop instead would make the gaps unusable.
  assert.equal(snapStart(12 * 60 + 7, 1, GRID, 15), 12 * 60);
});

test('Saturday snaps to Saturday’s rows, not to the weekday grid', () => {
  // 08:56 on a Saturday: the weekday 09:30 is far, Saturday's own 09:00 is near.
  assert.equal(snapStart(8 * 60 + 56, 6, GRID, 15), 9 * 60);
  // The same instant on a Tuesday has no 09:00 row and falls to the step.
  assert.equal(snapStart(8 * 60 + 56, 2, GRID, 15), 9 * 60);
});

test('resizing snaps to a slot end and keeps a real duration', () => {
  // Dragged to 08:47, and 08:45 is a slot end.
  assert.equal(snapDuration(8 * 60, 8 * 60 + 47, 1, GRID, 15), 45);
});

/**
 * The bottom edge dragged above the top one. Without a floor this leaves a block
 * of zero minutes, which is invisible and therefore cannot be grabbed to undo.
 */
test('a block cannot be resized to nothing', () => {
  assert.equal(snapDuration(8 * 60, 7 * 60, 1, GRID, 15), 15);
});

const LEVELS = [
  { id: 'a' },
  { id: 'b' },
  { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }, { id: 'g' }, { id: 'h' }, { id: 'i' },
];

test('a turma takes the tint of its level’s place in the club’s order', () => {
  const order = levelOrder(LEVELS);
  assert.equal(levelTint({ subjectType: 'turma', levelId: 'a' } as never, order), 1);
  assert.equal(levelTint({ subjectType: 'turma', levelId: 'b' } as never, order), 2);
  // A ninth level wraps rather than running out; the legend names it in words.
  assert.equal(levelTint({ subjectType: 'turma', levelId: 'i' } as never, order), 1);
});

/**
 * "Not said" must not look like "Iniciados". A turma with no level taking tint 1
 * would be indistinguishable from the club's first level, which is exactly the
 * confusion a colour is supposed to remove.
 */
test('no level, and everything that is not a turma, takes the neutral', () => {
  const order = levelOrder(LEVELS);
  assert.equal(levelTint({ subjectType: 'turma', levelId: null } as never, order), null);
  assert.equal(levelTint({ subjectType: 'parceria', levelId: 'a' } as never, order), null);
  assert.equal(levelTint({ subjectType: 'evento', levelId: null } as never, order), null);
  // A level the client has never heard of is neutral too, not a crash.
  assert.equal(levelTint({ subjectType: 'turma', levelId: 'zzz' } as never, order), null);
});

/**
 * A turma's own colour beats its level's — round 6.
 *
 * The level answers "what kind of class is this"; it cannot answer "which one is
 * mine", which is why a club with Competição A and Competição B asked for this.
 */
test('a chosen colour wins over the level, and an unset one falls back', () => {
  const order = levelOrder(LEVELS);
  const turma = (levelId: string | null, classColour: string | null) =>
    ({ subjectType: 'turma', levelId, classColour }) as never;

  assert.equal(levelTint(turma('a', 'violet'), order), 8);
  // Falls back to the level, which is what every uncoloured club goes on seeing.
  assert.equal(levelTint(turma('b', null), order), 2);
  // A colour on a turma with no level still paints: the choice is the answer.
  assert.equal(levelTint(turma(null, 'rose'), order), 6);
  // A token this build has never heard of is neutral rather than a crash.
  assert.equal(levelTint(turma('a', 'chartreuse'), order), 1);
});
