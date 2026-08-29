import type { PoolMetric } from './pool-metrics';

/**
 * What "in range" means for a pool, and how a reading is judged against it.
 *
 * A leaf module with no imports beyond a type, so both the server panel and the
 * client closure form can read it — see
 * [[typecheck-misses-server-client-boundary]] for why that matters here.
 *
 * **These are the ranges a Portuguese municipal pool is inspected against.** The
 * five metrics listed have a published band; the other four do not get an
 * invented one, because presenting a guess in the same visual language as a
 * regulation is worse than showing no band at all.
 */
export const HEALTHY: Partial<Record<PoolMetric, { from: number; to: number }>> = {
  ph: { from: 7.2, to: 7.6 },
  temperature: { from: 25, to: 29 },
  free_chlorine: { from: 0.5, to: 2 },
  combined_chlorine: { from: 0, to: 0.6 },
  total_alkalinity: { from: 80, to: 120 },
};

export interface Excursion {
  metric: PoolMetric;
  value: number;
  unit: string;
  from: number;
  to: number;
  /** Which side it fell off, so the message can say "too high" rather than "wrong". */
  direction: 'low' | 'high';
}

/**
 * Every reading in an analysis that sits outside its published band.
 *
 * **Only the metrics with a band are judged.** A pool with an unusual cyanuric
 * acid level produces no excursion here, because nothing in this file knows what
 * a bad one would be — and a warning derived from a number nobody chose is a
 * warning an operator learns to ignore.
 *
 * The result is deliberately a list rather than a boolean. "The water is unsafe"
 * is not something to tell somebody without saying which reading says so: an
 * operator who is about to close a pool for three days needs to know it was the
 * combined chlorine, not that a computer disapproved.
 */
export function excursions(
  values: { metric: PoolMetric; value: number; unit: string }[],
): Excursion[] {
  const out: Excursion[] = [];

  for (const reading of values) {
    const band = HEALTHY[reading.metric];
    if (band === undefined) continue;

    if (reading.value < band.from) {
      out.push({ ...reading, from: band.from, to: band.to, direction: 'low' });
    } else if (reading.value > band.to) {
      out.push({ ...reading, from: band.from, to: band.to, direction: 'high' });
    }
  }

  return out;
}
