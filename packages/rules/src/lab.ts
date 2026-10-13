/**
 * Grading a laboratory result — POOLSE-72, NP 4542:2017 §4.4.
 *
 * **Derived, never stored.** The pool's page, the alert and the public page
 * all call `gradeLabResult()` on the stored values, so none of them can tell a
 * different story about the same sample. Pure, like everything in this package.
 *
 * Source record: `docs/research/water-reference-2026-10.md`, §3–§4.
 */
import {
  excursions,
  nationalBands,
  type Excursion,
  type PoolContext,
  type PoolMetric,
} from './water.js';

/**
 * The seven microbiological parameters of NP 4542 Quadro 3 — the same seven in
 * DGS CN 14/DA Tabela 3 and DR 5/97 Anexo II Quadro III. Kept in step with the
 * `lab_parameter` enum by hand.
 */
export const ORGANISMS = [
  'colonies_37c',
  'total_coliforms',
  'e_coli',
  'enterococci',
  'pseudomonas_aeruginosa',
  'staphylococcus_coagulase_positive',
  'staphylococcus_total',
] as const;

export type Organism = (typeof ORGANISMS)[number];

/** Colony counts at 37 °C are per mL; everything else per 100 mL. */
export const ORGANISM_UNITS: Record<Organism, string> = {
  colonies_37c: 'ufc/mL',
  total_coliforms: 'ufc/100 mL',
  e_coli: 'ufc/100 mL',
  enterococci: 'ufc/100 mL',
  pseudomonas_aeruginosa: 'ufc/100 mL',
  staphylococcus_coagulase_positive: 'ufc/100 mL',
  staphylococcus_total: 'ufc/100 mL',
};

/**
 * NP 4542 Quadro 3: VR (recommended) and VL (limit). Null where the quadro
 * gives none. A count **above** a value fails it; 0 means "none allowed".
 */
export const MICROBIOLOGY: Record<Organism, { recommended: number | null; limit: number | null }> = {
  colonies_37c: { recommended: 100, limit: null },
  total_coliforms: { recommended: 0, limit: 10 },
  e_coli: { recommended: null, limit: 0 },
  enterococci: { recommended: null, limit: 0 },
  pseudomonas_aeruginosa: { recommended: null, limit: 0 },
  staphylococcus_coagulase_positive: { recommended: null, limit: 0 },
  staphylococcus_total: { recommended: 20, limit: null },
};

/** Quadro 2 — disinfection. A failure here is *não conforme*. */
const QUADRO_2: readonly PoolMetric[] = ['ph', 'free_chlorine', 'combined_chlorine', 'cyanuric_acid'];
/**
 * Quadro 1 — the quality criteria Poolse holds. A failure is *conforme
 * condicionada*. The rest of Quadro 1 (conductivity, chlorides, oxidability,
 * TOC, nitrates) is measured against the supply water, which Poolse does not
 * store, so it is not judged and the grade says what it covered.
 */
const QUADRO_1: readonly PoolMetric[] = ['turbidity', 'total_alkalinity'];

export type LabGrade = 'conforme' | 'conforme_condicionada' | 'nao_conforme';

export interface LabFailure {
  parameter: Organism | PoolMetric;
  value: number;
  unit: string;
  /** The value crossed — always a number, so the sentence needs no null check. */
  limit: number;
  /** `limit` (VL), `recommended` (VR) or `criterion` (Quadro 1). */
  kind: 'limit' | 'recommended' | 'criterion';
  direction: 'low' | 'high';
  /** For free chlorine: the pH it was judged at, or null when none was measured. */
  ph?: number | null;
}

export interface LabGrading {
  /** Null when nothing the lab reported is gradeable — never a silent "conforme". */
  grade: LabGrade | null;
  failures: LabFailure[];
  /** Whether any of the seven organisms was reported. */
  microbiologyReported: boolean;
  /** Organisms the lab did not report: not judged, and said so. */
  organismsMissing: Organism[];
  /** The gradeable chemistry that was reported. */
  chemistryCovered: PoolMetric[];
}

export interface LabValues {
  organisms: Partial<Record<Organism, number>>;
  chemistry: { metric: PoolMetric; value: number; unit: string }[];
}

/**
 * NP 4542 §4.4, over the parameters the lab reported:
 *
 * - **não conforme** — a Quadro 3 limit (VL) or a Quadro 2 limit fails;
 * - **conforme condicionada** — every limit holds, but a Quadro 3 recommended
 *   value (VR) or a Quadro 1 criterion fails;
 * - **conforme** — everything reported passes.
 *
 * **Judged against the national reference for the tank, never a club's own
 * bands.** A club may relax its operational pH band; that does not make a
 * sample conforme under NP 4542, and the grade is the standard's answer.
 *
 * A parameter the lab did not report is not judged — "not covered" is never
 * "conforme". A report with chemistry and no microbiology is graded on the
 * chemistry and `microbiologyReported` says so.
 */
export function gradeLabResult(values: LabValues, pool: PoolContext): LabGrading {
  const failures: LabFailure[] = [];

  for (const organism of ORGANISMS) {
    const value = values.organisms[organism];
    if (value === undefined) continue;
    const { recommended, limit } = MICROBIOLOGY[organism];
    const unit = ORGANISM_UNITS[organism];
    if (limit !== null && value > limit) {
      failures.push({ parameter: organism, value, unit, limit, kind: 'limit', direction: 'high' });
    } else if (recommended !== null && value > recommended) {
      failures.push({
        parameter: organism, value, unit, limit: recommended, kind: 'recommended', direction: 'high',
      });
    }
  }

  const graded = values.chemistry.filter(
    (reading) => QUADRO_2.includes(reading.metric) || QUADRO_1.includes(reading.metric),
  );
  // The same `excursions()` every reading is judged by — so free chlorine is
  // judged by the pH in this same report, exactly as on the pool's page.
  for (const excursion of excursions(values.chemistry, nationalBands(pool))) {
    if (!graded.some((reading) => reading.metric === excursion.metric)) continue;
    failures.push(fromExcursion(excursion));
  }

  const organismsReported = ORGANISMS.filter((organism) => values.organisms[organism] !== undefined);
  const chemistryCovered = graded.map((reading) => reading.metric);

  let grade: LabGrade | null = null;
  if (organismsReported.length > 0 || chemistryCovered.length > 0) {
    grade = failures.some((failure) => failure.kind === 'limit')
      ? 'nao_conforme'
      : failures.length > 0
        ? 'conforme_condicionada'
        : 'conforme';
  }

  return {
    grade,
    failures,
    microbiologyReported: organismsReported.length > 0,
    organismsMissing: ORGANISMS.filter((organism) => values.organisms[organism] === undefined),
    chemistryCovered,
  };
}

function fromExcursion(excursion: Excursion): LabFailure {
  return {
    parameter: excursion.metric,
    value: excursion.value,
    unit: excursion.unit,
    limit: excursion.limit,
    kind: QUADRO_2.includes(excursion.metric) ? 'limit' : 'criterion',
    direction: excursion.direction,
    ...(excursion.ph !== undefined ? { ph: excursion.ph } : {}),
  };
}
