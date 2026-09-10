/**
 * The band rule moved to `@poolse/rules` — slice 4.2.
 *
 * It used to be defined here, which was fine for as long as only the browser
 * judged a reading. 4.2 sends an email when an analysis is recorded out of
 * range, and that happens in the API — so the definition had to go somewhere
 * both apps can import. A copy in `apps/api` would have been two implementations
 * of one rule, which is the thing that package exists to prevent.
 *
 * This file stays as the re-export so every call site here keeps working, and
 * because `@/lib/water` is the honest place for a web component to look.
 */
export {
  HEALTHY,
  excursions,
  ALERT_WINDOW_HOURS,
  type Excursion,
} from '@poolse/rules';
