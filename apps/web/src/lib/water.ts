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
  NATIONAL_BANDS,
  nationalBands,
  excursions,
  resolveBands,
  ALERT_WINDOW_HOURS,
  POOL_USES,
  ORGANISMS,
  ORGANISM_UNITS,
  type Band,
  type BandMap,
  type BandOverride,
  type Excursion,
  type LabFailure,
  type LabGrade,
  type LabGrading,
  type Organism,
  type PoolUse,
} from '@poolse/rules';

import type { Band } from '@poolse/rules';

/**
 * A band as words — POOLSE-72. "6,5–8", "≤ 1,5", "≥ 24", and for free chlorine
 * both sides of its pH split. Numbers in the reader's locale; the symbols are
 * the same in both languages, so nothing here needs the catalogue.
 */
export function describeBand(band: Band, locale: string): string {
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const range = (from: number | null, to: number | null): string =>
    from !== null && to !== null
      ? `${n.format(from)}–${n.format(to)}`
      : to !== null
        ? `≤ ${n.format(to)}`
        : from !== null
          ? `≥ ${n.format(from)}`
          : '';
  if (band.byPh !== undefined) {
    const { at, atOrBelow, above } = band.byPh;
    return `${range(atOrBelow.from, atOrBelow.to)} (pH ≤ ${n.format(at)}) · ${range(above.from, above.to)} (pH > ${n.format(at)})`;
  }
  return range(band.from, band.to);
}
