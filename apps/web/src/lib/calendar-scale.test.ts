import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COL_WIDTH,
  columnAt,
  columnX,
  dayRange,
  hourMarks,
  levelOrder,
  levelTint,
  minutesToPx,
  NO_LANE_ID,
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
  { id: 'a', colour: 'teal' },
  { id: 'b', colour: 'green' },
  { id: 'v', colour: 'violet' },
  // A level created since the backfill, with nobody having picked a colour.
  { id: 'none', colour: null },
];

test('a turma takes its level’s own colour', () => {
  const order = levelOrder(LEVELS);
  assert.equal(levelTint({ subjectType: 'turma', levelId: 'a' } as never, order), 1);
  assert.equal(levelTint({ subjectType: 'turma', levelId: 'b' } as never, order), 2);
  assert.equal(levelTint({ subjectType: 'turma', levelId: 'v' } as never, order), 8);
});

/**
 * A level nobody has coloured is neutral, not tint 1. "Not said" must not be
 * indistinguishable from the club's first colour — the same rule the turma
 * itself follows.
 */
test('a level with no colour of its own paints nothing', () => {
  const order = levelOrder(LEVELS);
  assert.equal(levelTint({ subjectType: 'turma', levelId: 'none' } as never, order), null);
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

/*
 * -----------------------------------------------------------------------------
 * The horizontal scale, and the drag that used to disagree with it
 * -----------------------------------------------------------------------------
 *
 * A block's lane came from whichever droppable the pointer was over, which put
 * the block's *left edge* under the pointer. Grab a four-lane block by its third
 * lane and it jumped two pistas right of where it was drawn -- onto lanes nobody
 * had pointed at, colliding with whatever was in them. That is what "the lane
 * conflict looks non-existent" was: the conflict was real, in a lane the screen
 * was not showing the block in.
 *
 * The fix is to resolve the lane from travel, exactly as the time already was.
 * These tests are that arithmetic, which is the whole of it.
 */

const LANES = 6;
const DAYS = 7;

test('a column and its offset are inverses of each other', () => {
  for (let day = 0; day < DAYS; day += 1) {
    for (let lane = 0; lane < LANES; lane += 1) {
      const at = columnAt(columnX(day, lane, LANES), LANES, DAYS);
      assert.deepEqual(at, { dayIndex: day, laneIndex: lane });
    }
  }
});

test('a block travels by the pointer, not by where it was grabbed', () => {
  // Four lanes wide, starting at pista 1 of Tuesday. This is the shape that
  // broke: grabbing it anywhere but its left edge used to move it further than
  // the pointer went.
  const start = columnX(1, 0, LANES);

  // Nudged one column right.
  assert.deepEqual(columnAt(start + COL_WIDTH, LANES, DAYS), { dayIndex: 1, laneIndex: 1 });
  // Not moved at all is not moved at all, whatever the grab offset was.
  assert.deepEqual(columnAt(start, LANES, DAYS), { dayIndex: 1, laneIndex: 0 });
  // Less than half a column does not step.
  assert.deepEqual(columnAt(start + COL_WIDTH / 2 - 1, LANES, DAYS), {
    dayIndex: 1,
    laneIndex: 0,
  });
  // Half a column does.
  assert.deepEqual(columnAt(start + COL_WIDTH / 2 + 1, LANES, DAYS), {
    dayIndex: 1,
    laneIndex: 1,
  });
});

test('dragged off the end of a day, a block arrives at the start of the next', () => {
  const lastOfTuesday = columnX(1, LANES - 1, LANES);

  // One column past Tuesday's last pista is Wednesday's first, not Tuesday's
  // last clamped in place.
  assert.deepEqual(columnAt(lastOfTuesday + COL_WIDTH, LANES, DAYS), {
    dayIndex: 2,
    laneIndex: 0,
  });

  // And backwards over the same boundary.
  const firstOfWednesday = columnX(2, 0, LANES);
  assert.deepEqual(columnAt(firstOfWednesday - COL_WIDTH, LANES, DAYS), {
    dayIndex: 1,
    laneIndex: LANES - 1,
  });
});

test('the day rule does not accumulate across the week', () => {
  // Seven days of a two-pixel rule is fourteen pixels, a fifth of a column. If
  // the drag maths used a plain multiplication it would drift, and Sunday would
  // land one pista out -- which is the bug DAY_RULE was written to prevent on
  // the block layer and would have come back here.
  const sundayLane3 = columnX(6, 3, LANES);
  assert.deepEqual(columnAt(sundayLane3, LANES, DAYS), { dayIndex: 6, laneIndex: 3 });
  assert.deepEqual(columnAt(sundayLane3 + COL_WIDTH, LANES, DAYS), {
    dayIndex: 6,
    laneIndex: 4,
  });
});

test('a drag past either end of the grid is held at the edge', () => {
  assert.deepEqual(columnAt(-10_000, LANES, DAYS), { dayIndex: 0, laneIndex: 0 });
  assert.deepEqual(columnAt(10_000, LANES, DAYS), {
    dayIndex: DAYS - 1,
    laneIndex: LANES - 1,
  });
});

test('a one-lane tank has no sideways travel to get wrong', () => {
  assert.deepEqual(columnAt(columnX(3, 0, 1), 1, DAYS), { dayIndex: 3, laneIndex: 0 });
  // A nudge inside the single column stays put; a full column is the next day.
  assert.deepEqual(columnAt(columnX(3, 0, 1) + 10, 1, DAYS), { dayIndex: 3, laneIndex: 0 });
  assert.deepEqual(columnAt(columnX(3, 0, 1) + COL_WIDTH, 1, DAYS), {
    dayIndex: 4,
    laneIndex: 0,
  });
});

/*
 * -----------------------------------------------------------------------------
 * The Sem pista column — round 8
 * -----------------------------------------------------------------------------
 *
 * A class in no pista is drawn in a synthetic lane prepended to every day, so
 * that it is drawn at all. The geometry is not special-cased for it: the day's
 * stride simply grows by one column, and the ruler the blocks, the ghost and the
 * drag all share goes on being the same ruler.
 *
 * These hold that still. The failure they guard against is the one rounds 6 and
 * 7 kept meeting — a block drawn at one column and landing at another — arriving
 * again through a column that is a lane in the arithmetic and not in the data.
 */

test('the extra column widens the day and nothing else', () => {
  // Same day, same real pista, one column further along — and exactly one.
  for (let day = 0; day < DAYS; day += 1) {
    assert.equal(
      columnX(day, 1, LANES + 1) - columnX(day, 0, LANES),
      day * COL_WIDTH + COL_WIDTH,
      `day ${day} did not shift by exactly one column plus its own strides`,
    );
  }
});

test('a column and its offset are still inverses with the extra column', () => {
  // Including index 0, which is the Sem pista column itself: the arithmetic has
  // to be able to name it, because that is where a lane-less block is drawn.
  for (let day = 0; day < DAYS; day += 1) {
    for (let lane = 0; lane < LANES + 1; lane += 1) {
      const at = columnAt(columnX(day, lane, LANES + 1), LANES + 1, DAYS);
      assert.deepEqual(at, { dayIndex: day, laneIndex: lane });
    }
  }
});

test('a block dragged off the end of a day still lands in the next day’s first column', () => {
  /*
   * The carry loop, with the extra column in the stride. This is what would go
   * wrong if the column count and the stride ever disagreed: a drag off the
   * right-hand edge of Tuesday would arrive somewhere inside Tuesday.
   *
   * Note what "first column" now means — index 0 is Sem pista, and the component
   * is what floors a real block past it. The ruler's job is to say where the
   * pointer is; refusing the column is a separate decision, made once, where the
   * lane list is built.
   */
  const from = columnX(1, LANES, LANES + 1) + COL_WIDTH;
  assert.deepEqual(columnAt(from, LANES + 1, DAYS), { dayIndex: 2, laneIndex: 0 });
});

test('the synthetic lane’s id cannot be a real lane’s', () => {
  // It is written into `laneIds` nowhere, but it does travel through the same
  // arrays as real ids. A collision with something a database could generate
  // would put it in a booking.
  assert.match(NO_LANE_ID, /^__poolse:/);
  assert.doesNotMatch(
    NO_LANE_ID,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'a uuid-shaped id could collide with a real lane',
  );
});
