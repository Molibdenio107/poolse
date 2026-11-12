/**
 * A lane count placed on lanes — POOLSE-223, rule 5 (moved here from the API's
 * timetable import, Rui 12-11-2026, so it is one tested function).
 *
 * A timetable says "Hidroginástica (3 pistas)", not which three. For one pool,
 * day and hour, rows with a count take the pool's lanes in document order:
 * whatever is already held (on the grid, or by an earlier row of the same file)
 * is skipped, so two activities sharing an hour take side-by-side lanes rather
 * than the same ones, and never clash with each other.
 *
 * Pure: the caller passes the pool's lanes and what is held.
 */

export interface PlacementLane {
  id: string;
  name: string;
  position: number;
}

/** Lanes some booking holds on a weekday from `from` to `to` (minutes). */
export interface HeldLanes {
  weekday: number;
  from: number;
  to: number;
  laneIds: readonly string[];
}

export interface Placement {
  lanes: PlacementLane[];
  /**
   * `placed`: the count, side by side where possible. `short`: fewer free lanes
   * than asked, so it took the free ones. `overPool`: the pool has fewer lanes
   * than the count, so it took every free lane ("6 pistas, a piscina tem 4").
   */
  outcome: 'placed' | 'short' | 'overPool';
}

/** The free lanes of a pool at a weekday and time, by position. */
export function freeLanes(
  lanes: readonly PlacementLane[],
  held: readonly HeldLanes[],
  weekday: number,
  from: number,
  to: number,
): PlacementLane[] {
  return [...lanes]
    .sort((a, b) => a.position - b.position)
    .filter(
      (lane) => !held.some((h) => h.weekday === weekday && h.from < to && from < h.to && h.laneIds.includes(lane.id)),
    );
}

/**
 * `count` lanes of `lanes` (one pool's) at a weekday and time: the first run of
 * side-by-side free lanes, else the first free ones.
 */
export function placeLaneCount(
  count: number,
  at: { weekday: number; from: number; to: number },
  lanes: readonly PlacementLane[],
  held: readonly HeldLanes[],
): Placement {
  const free = freeLanes(lanes, held, at.weekday, at.from, at.to);
  if (count > lanes.length) return { lanes: free, outcome: 'overPool' };

  for (let start = 0; start + count <= free.length; start += 1) {
    const run = free.slice(start, start + count);
    if (run.every((lane, i) => i === 0 || lane.position === run[i - 1]!.position + 1)) {
      return { lanes: run, outcome: 'placed' };
    }
  }
  const taken = free.slice(0, count);
  return { lanes: taken, outcome: taken.length === count ? 'placed' : 'short' };
}
