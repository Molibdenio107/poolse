import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeLanes, placeLaneCount, type HeldLanes, type PlacementLane } from './lane-placement.js';

/** POOLSE-223 rule 5 — a lane count placed on one pool's lanes. */

const pool = (n: number): PlacementLane[] =>
  Array.from({ length: n }, (_, i) => ({ id: `l${i + 1}`, name: `Pista ${i + 1}`, position: i + 1 }));
const monday7 = { weekday: 1, from: 7 * 60, to: 8 * 60 };
const names = (lanes: PlacementLane[]): string[] => lanes.map((lane) => lane.name);

test('two activities sharing an hour take side-by-side lanes in document order', () => {
  const lanes = pool(6);
  const held: HeldLanes[] = [];
  const first = placeLaneCount(3, monday7, lanes, held);
  held.push({ ...monday7, laneIds: first.lanes.map((lane) => lane.id) });
  const second = placeLaneCount(3, monday7, lanes, held);
  assert.deepEqual(names(first.lanes), ['Pista 1', 'Pista 2', 'Pista 3']);
  assert.deepEqual(names(second.lanes), ['Pista 4', 'Pista 5', 'Pista 6']);
  assert.equal(second.outcome, 'placed');
});

test('a held lane is skipped and the run stays side by side', () => {
  const held: HeldLanes[] = [{ ...monday7, laneIds: ['l2'] }];
  const placed = placeLaneCount(2, monday7, pool(6), held);
  assert.deepEqual(names(placed.lanes), ['Pista 3', 'Pista 4']);
});

test('a hold at another hour or day does not count', () => {
  const held: HeldLanes[] = [
    { weekday: 1, from: 8 * 60, to: 9 * 60, laneIds: ['l1'] },
    { weekday: 2, from: 7 * 60, to: 8 * 60, laneIds: ['l1'] },
  ];
  assert.deepEqual(names(freeLanes(pool(2), held, 1, 7 * 60, 8 * 60)), ['Pista 1', 'Pista 2']);
});

test('with no side-by-side run it takes the first free lanes', () => {
  const held: HeldLanes[] = [{ ...monday7, laneIds: ['l2', 'l4'] }];
  const placed = placeLaneCount(2, monday7, pool(4), held);
  assert.deepEqual(names(placed.lanes), ['Pista 1', 'Pista 3']);
  assert.equal(placed.outcome, 'placed');
});

test('fewer free lanes than asked is short, and takes the free ones', () => {
  const held: HeldLanes[] = [{ ...monday7, laneIds: ['l1', 'l2', 'l3'] }];
  const placed = placeLaneCount(3, monday7, pool(4), held);
  assert.deepEqual(names(placed.lanes), ['Pista 4']);
  assert.equal(placed.outcome, 'short');
});

test('more lanes than the pool has takes every lane and says so', () => {
  const placed = placeLaneCount(6, monday7, pool(4), []);
  assert.deepEqual(names(placed.lanes), ['Pista 1', 'Pista 2', 'Pista 3', 'Pista 4']);
  assert.equal(placed.outcome, 'overPool');
});
