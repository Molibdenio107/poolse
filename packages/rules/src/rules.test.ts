import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capacityOf,
  concurrentGroups,
  evaluate,
  isContiguous,
  overlaps,
  verdictOf,
  type RuleBooking,
  type RuleContext,
  type RuleLane,
} from './index.js';

/**
 * The fixture both halves run — POOLSE-51, criterion 10.
 *
 * These are the rules the browser applies mid-drag and the rules the API applies
 * at the drop. A client that thinks a drop is fine and a server that refuses it
 * is the worst version of this feature, so the agreement is asserted here rather
 * than hoped for.
 *
 * Half of what is asserted is that something is **allowed**. The constraint this
 * ticket replaced refused one instructor running two groups at once anywhere,
 * which is the club's ordinary Tuesday — a scheduler wrong about that on its
 * first screen gets turned off.
 *
 * Run: pnpm --filter @poolse/rules test
 */

const LANES: RuleLane[] = [
  { id: 'l1', poolId: 'big', name: 'Pista 1', position: 1, defaultCapacity: 10 },
  { id: 'l2', poolId: 'big', name: 'Pista 2', position: 2, defaultCapacity: 10 },
  { id: 'l3', poolId: 'big', name: 'Pista 3', position: 3, defaultCapacity: 10 },
  { id: 'l4', poolId: 'big', name: 'Pista 4', position: 4, defaultCapacity: 10 },
  { id: 'l5', poolId: 'big', name: 'Pista 5', position: 5, defaultCapacity: 10 },
  { id: 'l6', poolId: 'big', name: 'Pista 6', position: 6, defaultCapacity: 10 },
  { id: 'p1', poolId: 'learner', name: 'Aprendizagem', position: 1, defaultCapacity: 6 },
];

/** 19:15, the hour the reference sheet is busiest. */
const AT = 19 * 60 + 15;

function booking(over: Partial<RuleBooking> & { id: string }): RuleBooking {
  return {
    weekday: 2,
    startMinutes: AT,
    durationMinutes: 45,
    laneIds: [],
    poolId: 'big',
    instructorId: null,
    levelId: null,
    headcount: null,
    cancelled: false,
    name: over.id,
    ...over,
  };
}

function context(over: Partial<RuleContext> = {}): RuleContext {
  return {
    lanes: LANES,
    bookings: [],
    laneLevelCapacity: {},
    openWeekdays: [1, 2, 3, 4, 5, 6, 7],
    closures: [],
    maxConcurrentGroupsPerInstructor: null,
    ...over,
  };
}

test('overlap is half-open, so back-to-back is free', () => {
  // The same comparison `tstzrange`'s && makes. If these disagreed, the grid
  // would name a collision the database allows, or miss one it refuses.
  assert.equal(overlaps(600, 45, 645, 45), false, '10:00-10:45 and 10:45-11:30');
  assert.equal(overlaps(600, 45, 630, 45), true, '10:00-10:45 and 10:30-11:15');
  assert.equal(overlaps(630, 45, 600, 60), true, 'the same pair, the other way round');
  assert.equal(overlaps(600, 60, 700, 30), false, 'no touching at all');
});

test('a lane span must be one unbroken run inside one pool', () => {
  assert.equal(isContiguous(['l2', 'l3', 'l4'], LANES), true);
  assert.equal(isContiguous(['l4', 'l2', 'l3'], LANES), true, 'order does not matter');
  assert.equal(isContiguous(['l2', 'l4'], LANES), false, 'lane 3 left free between');
  assert.equal(isContiguous(['l1'], LANES), true, 'one lane is trivially a run');
  // Position 6 of the big tank and position 1 of the learner tank are not
  // adjacent however the numbers happen to fall.
  assert.equal(isContiguous(['l6', 'p1'], LANES), false, 'across two tanks');
});

test('Sandra on three lanes of one tank is allowed, and badged x3', () => {
  // QA 51.4 and 51.5 together — the case the old constraint refused.
  const grid = [
    booking({ id: 'cadetes', instructorId: 'sandra', laneIds: ['l2'] }),
    booking({ id: 'infantis', instructorId: 'sandra', laneIds: ['l3'] }),
    booking({ id: 'absolutos', instructorId: 'sandra', laneIds: ['l4'] }),
  ];

  const reasons = evaluate(
    grid[0]!,
    { weekday: 2, startMinutes: AT, durationMinutes: 45, laneIds: ['l2'] },
    context({ bookings: grid }),
  );
  assert.equal(verdictOf(reasons), 'ok', 'the club ordinary Tuesday is not a conflict');

  assert.equal(
    concurrentGroups('sandra', { weekday: 2, startMinutes: AT, durationMinutes: 45 }, grid),
    3,
  );
});

test('one instructor on one three-lane booking is x1, not x3', () => {
  // QA 51.5, the counting mistake the ticket names. Badging this x3 would tell a
  // club its best-staffed hour is its worst.
  const grid = [
    booking({ id: 'hidro', instructorId: 'sandra', laneIds: ['l2', 'l3', 'l4'] }),
  ];

  assert.equal(
    concurrentGroups('sandra', { weekday: 2, startMinutes: AT, durationMinutes: 45 }, grid),
    1,
  );
});

test('a taken lane blocks, and names the lane and what holds it', () => {
  // QA 51.1 and 51.13 — the message has to be actionable before release.
  const grid = [booking({ id: 'infantis', name: 'Infantis', laneIds: ['l3'] })];

  const reasons = evaluate(
    booking({ id: 'cadetes', name: 'Cadetes' }),
    { weekday: 2, startMinutes: AT, durationMinutes: 45, laneIds: ['l3'] },
    context({ bookings: grid }),
  );

  assert.equal(verdictOf(reasons), 'block');
  const taken = reasons.find((reason) => reason.code === 'laneTaken');
  assert.equal(taken?.detail['lane'], 'Pista 3');
  assert.equal(taken?.detail['holder'], 'Infantis');
});

test('a multi-lane booking blocks a drop onto any lane it covers', () => {
  // QA 51.2. Lanes 2-4 are held by one block; lane 3 is not free just because
  // the block does not start there.
  const grid = [booking({ id: 'squad', name: 'Absolutos', laneIds: ['l2', 'l3', 'l4'] })];

  const reasons = evaluate(
    booking({ id: 'other', name: 'Cadetes' }),
    { weekday: 2, startMinutes: AT, durationMinutes: 45, laneIds: ['l3'] },
    context({ bookings: grid }),
  );
  assert.equal(verdictOf(reasons), 'block');

  // And lane 5, beside it, is fine — QA 49.4's rule seen from the other side.
  const beside = evaluate(
    booking({ id: 'other', name: 'Cadetes' }),
    { weekday: 2, startMinutes: AT, durationMinutes: 45, laneIds: ['l5'] },
    context({ bookings: grid }),
  );
  assert.equal(verdictOf(beside), 'ok');
});

test('a cancelled booking holds nothing', () => {
  // QA 51.3. A class that is not happening cannot be occupying a lane, and the
  // database agrees — the exclusion constraint excludes cancelled rows.
  const grid = [booking({ id: 'infantis', laneIds: ['l3'], cancelled: true })];

  const reasons = evaluate(
    booking({ id: 'cadetes' }),
    { weekday: 2, startMinutes: AT, durationMinutes: 45, laneIds: ['l3'] },
    context({ bookings: grid }),
  );
  assert.equal(verdictOf(reasons), 'ok');
});

test('the same instructor in a second pool blocks', () => {
  // QA 51.6. One person, one building — the rule the database now enforces with
  // `pool_id WITH <>`, predicted here so the cell can say so before release.
  const grid = [
    booking({ id: 'cadetes', name: 'Cadetes', instructorId: 'sandra', laneIds: ['l2'] }),
  ];

  const reasons = evaluate(
    booking({ id: 'hidro', name: 'Hidro', instructorId: 'sandra', poolId: 'learner' }),
    { weekday: 2, startMinutes: AT, durationMinutes: 45, laneIds: ['p1'] },
    context({ bookings: grid }),
  );

  assert.equal(verdictOf(reasons), 'block');
  assert.equal(
    reasons.find((reason) => reason.code === 'instructorElsewhere')?.detail['holder'],
    'Cadetes',
  );
});

test('back-to-back in another pool is fine — she walks across', () => {
  const grid = [booking({ id: 'cadetes', instructorId: 'sandra', laneIds: ['l2'] })];

  const reasons = evaluate(
    booking({ id: 'hidro', instructorId: 'sandra', poolId: 'learner' }),
    { weekday: 2, startMinutes: AT + 45, durationMinutes: 45, laneIds: ['p1'] },
    context({ bookings: grid }),
  );
  assert.equal(verdictOf(reasons), 'ok');
});

test('headcount over lane capacity warns, and names both numbers', () => {
  // QA 51.10. A club putting 12 in a lane rated 10 for a term is making a
  // decision, so this is never a block.
  const reasons = evaluate(
    booking({ id: 'cadetes', headcount: 12 }),
    { weekday: 2, startMinutes: AT, durationMinutes: 45, laneIds: ['l2'] },
    context(),
  );

  assert.equal(verdictOf(reasons), 'warn');
  const over = reasons.find((reason) => reason.code === 'overCapacity');
  assert.equal(over?.detail['lane'], 'Pista 2');
  assert.equal(over?.detail['headcount'], 12);
  assert.equal(over?.detail['capacity'], 10);
});

test('a headcount spread across a span is judged per lane', () => {
  // 24 swimmers on three lanes is 8 a lane, not 24 in each. Comparing the whole
  // headcount against one lane would warn about every span a club ever makes.
  const reasons = evaluate(
    booking({ id: 'squad', headcount: 24 }),
    { weekday: 2, startMinutes: AT, durationMinutes: 45, laneIds: ['l2', 'l3', 'l4'] },
    context(),
  );
  assert.equal(verdictOf(reasons), 'ok');
});

test('a per-level capacity override beats the lane default', () => {
  const overrides = { 'l2:infantis': 6 };
  assert.equal(capacityOf(LANES[1]!, 'infantis', overrides), 6);
  assert.equal(capacityOf(LANES[1]!, 'adultos', overrides), 10, 'another level falls back');
  assert.equal(capacityOf(LANES[1]!, null, overrides), 10, 'no level falls back');

  const reasons = evaluate(
    booking({ id: 'cadetes', headcount: 8, levelId: 'infantis' }),
    { weekday: 2, startMinutes: AT, durationMinutes: 45, laneIds: ['l2'] },
    context({ laneLevelCapacity: overrides }),
  );
  assert.equal(verdictOf(reasons), 'warn', '8 is over the 6 this level takes in this lane');
});

test('the concurrency limit warns above it and is silent when unset', () => {
  const grid = [
    booking({ id: 'a', instructorId: 'sandra', laneIds: ['l1'] }),
    booking({ id: 'b', instructorId: 'sandra', laneIds: ['l2'] }),
    booking({ id: 'c', instructorId: 'sandra', laneIds: ['l3'] }),
  ];

  const subject = booking({ id: 'd', instructorId: 'sandra' });
  const placement = { weekday: 2, startMinutes: AT, durationMinutes: 45, laneIds: ['l4'] };

  // QA 51.8 — a fourth concurrent group, with a limit of 3.
  const warned = evaluate(
    subject,
    placement,
    context({ bookings: grid, maxConcurrentGroupsPerInstructor: 3 }),
  );
  assert.equal(verdictOf(warned), 'warn');
  const over = warned.find((reason) => reason.code === 'overConcurrency');
  assert.equal(over?.detail['count'], 4);
  assert.equal(over?.detail['limit'], 3);

  // QA 51.9 — null means the club has no opinion, so no number is wrong.
  const silent = evaluate(
    subject,
    placement,
    context({ bookings: grid, maxConcurrentGroupsPerInstructor: null }),
  );
  assert.equal(verdictOf(silent), 'ok');
});

test('a disabled weekday warns for what is already there, and a closure blocks', () => {
  // QA 51.11 — disabling a weekday keeps the classes on it. The asymmetry is the
  // rule: an existing booking warns, a new drop is refused at the drop.
  const warned = evaluate(
    booking({ id: 'cadetes', weekday: 3 }),
    { weekday: 3, startMinutes: AT, durationMinutes: 45, laneIds: ['l2'] },
    context({ openWeekdays: [1, 2, 4, 5] }),
  );
  assert.equal(verdictOf(warned), 'warn');
  assert.ok(warned.some((reason) => reason.code === 'weekdayDisabled'));

  // A dated closure is a different thing and does block.
  const blocked = evaluate(
    booking({ id: 'cadetes' }),
    { weekday: 2, startMinutes: AT, durationMinutes: 45, laneIds: ['l2'] },
    context({ closures: [{ weekday: 2, reason: 'Natal' }] }),
  );
  assert.equal(verdictOf(blocked), 'block');
  assert.equal(
    blocked.find((reason) => reason.code === 'dayClosed')?.detail['reason'],
    'Natal',
  );
});

test('a booking never conflicts with itself', () => {
  // The mistake that makes every move look like a collision.
  const self = booking({ id: 'cadetes', laneIds: ['l2'] });

  const reasons = evaluate(
    self,
    { weekday: 2, startMinutes: AT, durationMinutes: 45, laneIds: ['l2'] },
    context({ bookings: [self] }),
  );
  assert.equal(verdictOf(reasons), 'ok');
});

test('every reason is returned, not just the first', () => {
  // A drop can be both over capacity and on a disabled weekday. Telling somebody
  // one thing at a time makes them fix it twice.
  const reasons = evaluate(
    booking({ id: 'cadetes', weekday: 3, headcount: 20 }),
    { weekday: 3, startMinutes: AT, durationMinutes: 45, laneIds: ['l2'] },
    context({ openWeekdays: [1, 2, 4, 5] }),
  );

  assert.ok(reasons.some((reason) => reason.code === 'weekdayDisabled'));
  assert.ok(reasons.some((reason) => reason.code === 'overCapacity'));
});
