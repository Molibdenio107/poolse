/**
 * The water-quality metrics, in a module the browser is allowed to import.
 *
 * **Why this is not in `api.ts`.** That file's first line is
 * `import { auth } from '@clerk/nextjs/server'`, which transitively pulls in
 * `server-only` — so importing *any runtime value* from it inside a
 * `'use client'` component fails the build with "'server-only' cannot be
 * imported from a Client Component module". Types are erased at compile time and
 * cross that boundary harmlessly, which is why every other client component in
 * this app can say `import type { Student } from '@/lib/api'` and be fine. A
 * `const` cannot.
 *
 * The analysis form needs the list at runtime, to render one input per metric.
 * So the list lives here — no imports, no side effects, safe on both sides — and
 * `api.ts` re-exports the type for the server code that already reads it there.
 * `lib/skills.ts` is the same shape for the same reason.
 *
 * Kept in step with the `pool_metric` enum and with `METRIC_UNITS` in
 * `apps/api/src/facilities/analyses.repository.ts` by hand. Adding one is a
 * migration, a unit, and two translations, so it is not a change anybody makes
 * by accident.
 */
export const POOL_METRICS = [
  'ph',
  'temperature',
  'free_chlorine',
  'combined_chlorine',
  'total_alkalinity',
  'calcium_hardness',
  'cyanuric_acid',
  'turbidity',
  'salt',
] as const;

export type PoolMetric = (typeof POOL_METRICS)[number];
