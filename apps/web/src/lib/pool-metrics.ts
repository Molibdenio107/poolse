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
 * `const` cannot. `lib/skills.ts` is the same shape for the same reason.
 *
 * **The list itself now lives in `@poolse/rules` — slice 4.2.** It used to be
 * declared here with a comment saying it was kept in step with the API's copy
 * *by hand*, which is exactly the arrangement that goes wrong quietly. The
 * package is a leaf with no imports and no side effects, so it is as safe on the
 * client as this file ever was, and there is now one list rather than two.
 */
export { POOL_METRICS, type PoolMetric } from '@poolse/rules';
