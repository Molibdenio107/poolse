import type { Excursion } from '@/lib/water';

/**
 * Which sentence an excursion is, and what fills it — slice 4.5.
 *
 * The whole range where both ends are judged, the crossed bound alone where
 * they are not — a pool may carry a floor and no ceiling. `limit` is always a
 * number, because a reading cannot be above a ceiling that does not exist, so
 * this is a choice of sentence rather than a null check.
 *
 * Lived inline in `UnsafeWaterNotice` until the personal dashboard needed the
 * same sentence in a second place. It returns a key and values rather than a
 * string so that a server component and a client one can each call their own
 * `t` with it.
 */
export function excursionText(excursion: Excursion): {
  key: string;
  values: Record<string, number>;
} {
  if (excursion.from !== null && excursion.to !== null) {
    return {
      key: excursion.direction === 'high' ? 'facilities.aboveRange' : 'facilities.belowRange',
      values: { from: excursion.from, to: excursion.to },
    };
  }
  return {
    key: excursion.direction === 'high' ? 'facilities.aboveLimit' : 'facilities.belowLimit',
    values: { limit: excursion.limit },
  };
}
