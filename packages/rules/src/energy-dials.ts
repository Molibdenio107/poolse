/**
 * A meter's dials — Rui, 12-11-2026.
 *
 * A Portuguese electricity meter on a multi-rate tariff keeps one running
 * index per period; the E-REDES display steps through them by code. Which
 * dials exist follows the tariff option ERSE defines (Diretiva 3/2026):
 * simples (one), bi-horária (vazio, fora de vazio), tri-horária (vazio,
 * cheias, ponta) and tetra-horária (super vazio, vazio normal, cheias, ponta —
 * BTE and MT). A reading holds one value per dial of its meter's set, and its
 * total is their sum.
 *
 * One definition for the API (which refuses a reading missing a dial) and the
 * web (which draws one field per dial). The period *hours* are not here: the
 * meter assigns every kWh to its dial, and ERSE moves the hours in 2027.
 */

export const DIAL_SETS = ['single', 'bi', 'tri', 'tetra'] as const;
export type DialSet = (typeof DIAL_SETS)[number];

export const DIALS = ['super_vazio', 'vazio', 'fora_vazio', 'cheias', 'ponta'] as const;
export type Dial = (typeof DIALS)[number];

/** The dials a reading of each set carries, in the order the form asks them. */
export const DIALS_OF: Record<DialSet, readonly Dial[]> = {
  single: [],
  bi: ['vazio', 'fora_vazio'],
  tri: ['vazio', 'cheias', 'ponta'],
  tetra: ['super_vazio', 'vazio', 'cheias', 'ponta'],
};

/**
 * The code the E-REDES smart-meter display shows beside each dial, so the form
 * can say where to look. Null where the code depends on the meter (a bi-horária
 * meter's "fora de vazio").
 */
export const DIAL_DISPLAY_CODE: Record<Dial, string | null> = {
  vazio: '1.8.1',
  ponta: '1.8.2',
  cheias: '1.8.3',
  super_vazio: '1.8.4',
  fora_vazio: null,
};

export function isDialSet(value: unknown): value is DialSet {
  return typeof value === 'string' && (DIAL_SETS as readonly string[]).includes(value);
}

/**
 * A reading's dials checked against its meter's set: every dial of the set
 * present, none from outside it. The dial named on the first problem, or null.
 */
export function dialProblem(set: DialSet, dials: Partial<Record<Dial, number>>): { dial: Dial; problem: 'missing' | 'foreign' } | null {
  for (const dial of DIALS_OF[set]) {
    if (dials[dial] === undefined) return { dial, problem: 'missing' };
  }
  for (const dial of DIALS) {
    if (dials[dial] !== undefined && !DIALS_OF[set].includes(dial)) return { dial, problem: 'foreign' };
  }
  return null;
}

/** The total a reading's dials make, to three decimals as the column holds them. */
export function dialTotal(dials: Partial<Record<Dial, number>>): number {
  const sum = DIALS.reduce((total, dial) => total + (dials[dial] ?? 0), 0);
  return Math.round(sum * 1000) / 1000;
}

/**
 * The units a meter may count in, by what it measures (Rui, 12-11-2026):
 * electricity in kWh; gas in m³ off its own dial, or kWh when it is typed from
 * the bill; water in m³. The first is the default a new meter takes.
 */
export const UNITS_OF_CARRIER = {
  electricity: ['kWh'],
  gas: ['m³', 'kWh'],
  water: ['m³'],
} as const satisfies Record<'electricity' | 'gas' | 'water', readonly string[]>;

/** A unit as typed, in the spelling Poolse stores: "m3" and "M3" are m³. */
export function normaliseUnit(unit: string): string {
  const compact = unit.trim().replace(/\s+/g, '');
  if (/^m3$/i.test(compact) || compact === 'm³') return 'm³';
  if (/^kwh$/i.test(compact)) return 'kWh';
  return compact;
}

/** Whether a gas meter's readings need a conversion factor to become kWh. */
export function needsGasFactor(carrier: string, unit: string): boolean {
  return carrier === 'gas' && normaliseUnit(unit) === 'm³';
}
