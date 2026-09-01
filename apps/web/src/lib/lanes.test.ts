import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneLabel } from './lanes.ts';

/**
 * How a set of lanes reads — POOLSE-46.
 *
 * The rule worth pinning is the gap: `[2,3,4]` is a range and `[1,4]` is not,
 * and smoothing the second into "pistas 1–4" would claim two lanes the class
 * does not have — on the printed sheet a club pins to a wall.
 */

/** Stands in for next-intl, so the test asserts the shape rather than the prose. */
const t = (key: string, values?: Record<string, string | number>): string =>
  `${key}(${Object.entries(values ?? {})
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(',')})`;

test('no lane is nothing to say, not an empty label', () => {
  // The commonest case by far: a turma nobody has given a lane yet.
  assert.equal(laneLabel([], t), null);
});

test('one lane reads as one lane', () => {
  assert.equal(laneLabel([3], t), 'classes.laneN(lane=3)');
});

test('contiguous lanes read as a range', () => {
  assert.equal(laneLabel([2, 3, 4], t), 'classes.laneRange(from=2,to=4)');
});

test('a gap is never smoothed into a range', () => {
  // "pistas 1–4" would claim lanes 2 and 3, which somebody else is swimming in.
  assert.equal(laneLabel([1, 4], t), 'classes.laneList(lanes=1, 4)');
  assert.equal(laneLabel([1, 2, 4], t), 'classes.laneList(lanes=1, 2, 4)');
});

test('the order they arrive in does not matter', () => {
  assert.equal(laneLabel([4, 2, 3], t), 'classes.laneRange(from=2,to=4)');
  assert.equal(laneLabel([4, 1], t), 'classes.laneList(lanes=1, 4)');
});

test('the input is not mutated', () => {
  // It comes straight off an API response that the caller may render twice.
  const lanes = [4, 2, 3];
  laneLabel(lanes, t);
  assert.deepEqual(lanes, [4, 2, 3]);
});
