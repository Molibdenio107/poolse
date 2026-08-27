/**
 * The four skill states — POOLSE-20.
 *
 * **Kept out of `lib/api.ts` deliberately.** That module imports Clerk's server
 * auth, which marks it server-only; a Client Component importing a *value* from
 * it drags the whole chain into the browser bundle and the build fails. Types
 * are erased at compile time and travel fine, but `SKILL_STATES` is a real array
 * at runtime — the grid walks it to work out what the next tap should do.
 *
 * The failure only appears in a production build, not in dev, which is what
 * makes it worth a comment rather than a fix and silence.
 */
export type SkillState = 'not_started' | 'started' | 'tested' | 'attained';

/** In order. The grid advances through this list and wraps. */
export const SKILL_STATES: readonly SkillState[] = [
  'not_started',
  'started',
  'tested',
  'attained',
];
