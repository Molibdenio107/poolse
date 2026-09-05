// The `.ts` on the specifier is not a slip: this module is reached by
// `node --test`, whose resolver does not add extensions. `inventory-sheet.ts`
// carries one for the same reason, and `allowImportingTsExtensions` is on so the
// bundler is equally happy.
import { matchFields, type MatchResult, type MatchSpec, type Sheet } from './sheet.ts';
import { POOL_METRICS } from './pool-metrics.ts';

/**
 * The water log's half of `sheet.ts` — round 5, ticket 5.
 *
 * The fourth sibling of the register's field list, and built the same way: it
 * shares the scoring, the abbreviation rule and the shape check via
 * `matchFields`, and shares none of the vocabulary. "Cloro" means nothing in a
 * register and everything here.
 *
 * **No model call, by decision.** The ticket says so and the shape of this file
 * is what keeps that a decision rather than a limitation: the mapping step is a
 * `MatchSpec`, exactly like the other three, so an assisted matcher slots in
 * where `matchWaterColumns` is called rather than being threaded through the
 * wizard. A club's water log is also the one sheet where the heuristic has least
 * to guess at — nine metric names and a date, against a register's forty
 * possible headers.
 *
 * **A row is one analysis, not one reading.** A club writes one line per visit
 * with a column per metric, which is the opposite shape from the database's
 * `pool_analysis` + `pool_analysis_value`. Turning a wide row into several
 * values is the API's job; this file only says which column is which.
 */

/**
 * The fields a column can be pointed at: when the sample was taken, what was in
 * it, and the two that describe the row rather than measure it.
 *
 * The metrics come from `POOL_METRICS` rather than being retyped, so adding one
 * to the enum makes it importable without anybody remembering to come here.
 */
export const WATER_FIELDS = ['takenOn', 'takenTime', 'pool', 'notes', ...POOL_METRICS] as const;

export type WaterField = (typeof WATER_FIELDS)[number];

export type WaterMapping = Record<WaterField, number | null>;

export const EMPTY_WATER_MAPPING: WaterMapping = Object.fromEntries(
  WATER_FIELDS.map((field) => [field, null]),
) as WaterMapping;

/**
 * The header words each field answers to, in pt-PT and en.
 *
 * Accents and case are stripped before matching, so "pH" and "PH" and "ph" are
 * one word and "Temperatura" needs no second spelling.
 *
 * **Order matters where two fields can claim one header.** `combined_chlorine`
 * is listed before `free_chlorine`, which is before the bare `cloro`: a column
 * headed "Cloro combinado" contains the word "cloro", and whichever field
 * claimed that first would take it. `matchFields` scores rather than takes the
 * first, but an exact match on a two-word header has to be able to beat a
 * substring match on a one-word one, and listing the specific before the general
 * is what makes that reliable.
 *
 * **"Total" is deliberately absent from `total_alkalinity`'s list on its own.**
 * A column headed just "Total" in a club's sheet is as likely to be a sum of
 * something else, and a *confident* mapping would write a plausible wrong number
 * into a safety record. It still reaches the field through the shared
 * abbreviation rule — "total" abbreviates "total alkalinity" — which is the
 * right outcome, because that scores into the `unsure` band and `unsure` is the
 * band the mapping step stops and asks about. Proposed, not decided.
 */
const SYNONYMS: [WaterField, string[]][] = [
  [
    'takenOn',
    ['data', 'dia', 'data da analise', 'data de recolha', 'date', 'day', 'sampled', 'taken'],
  ],
  ['takenTime', ['hora', 'horas', 'hora da analise', 'time', 'clock', 'hour']],
  [
    'pool',
    ['tanque', 'tanques', 'piscina', 'piscinas', 'pool', 'tank', 'basin'],
  ],
  [
    'notes',
    ['notas', 'observacoes', 'obs', 'comentarios', 'notes', 'comments', 'remarks', 'observations'],
  ],

  // The specific chlorines before the general one — see the note above.
  [
    'combined_chlorine',
    [
      'cloro combinado',
      'combinado',
      'cloraminas',
      'combined chlorine',
      'combined',
      'chloramines',
    ],
  ],
  [
    'free_chlorine',
    [
      'cloro livre',
      'livre',
      'cloro residual livre',
      'free chlorine',
      'free',
      'residual chlorine',
      // Last, so a sheet with only one chlorine column still places it, and a
      // sheet with two has already given them away above.
      'cloro',
      'chlorine',
    ],
  ],

  ['ph', ['ph', 'p h', 'acidez']],
  ['temperature', ['temperatura', 'temp', 'temperature', 'agua', 'water temperature']],
  [
    'total_alkalinity',
    ['alcalinidade', 'alcalinidade total', 'total alkalinity', 'alkalinity', 'ta'],
  ],
  [
    'calcium_hardness',
    ['dureza', 'dureza calcica', 'calcio', 'calcium hardness', 'hardness', 'calcium', 'ch'],
  ],
  [
    'cyanuric_acid',
    ['acido cianurico', 'cianurico', 'estabilizador', 'cyanuric acid', 'cyanuric', 'stabiliser', 'cya'],
  ],
  ['turbidity', ['turvacao', 'turbidez', 'turbidity', 'clarity']],
  ['salt', ['sal', 'salinidade', 'salt', 'salinity']],
];

/**
 * **No `expectedShape`, and that is a finding rather than an omission.**
 *
 * The obvious rule is "every metric is a number", which would catch a sheet
 * whose headers have shifted by one. It cannot be written correctly today,
 * because `shapeOf` in `sheet.ts` does not see a Portuguese decimal as a number:
 *
 *     "7.4"  -> "2 digits"      (the dot is stripped with the other punctuation)
 *     "7,4"  -> "one word"      (the comma is not, so it is not all digits)
 *     "Bom"  -> "one word"
 *
 * A pH of 7,4 is therefore shaped identically to a note reading "Bom". Adding
 * the check would apply `matchFields`' 45-point contradiction penalty to every
 * metric column in every pt-PT water log — dropping an *exact* header match on
 * "pH" into the band the screen stops and asks about, on the product's own
 * default locale. A rule that fires on the ordinary case is worse than no rule.
 *
 * The fix belongs in `shapeOf`, where it would help all four importers, and it
 * changes matching for the three that already ship — so it is raised as its own
 * change rather than smuggled in here. Until then the header carries the match,
 * which for nine well-known metric names is most of the work anyway.
 */
export const WATER_MATCH: MatchSpec<WaterField> = {
  empty: EMPTY_WATER_MAPPING,
  synonyms: SYNONYMS,
};

/** Which column is which, with how sure it is about each. */
export function matchWaterColumns(sheet: Sheet): MatchResult<WaterField> {
  return matchFields(sheet, WATER_MATCH);
}

/** One row, keyed by field name — exactly what the API's `rows` expects. */
export function applyWaterMapping(row: string[], mapping: WaterMapping): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const field of WATER_FIELDS) {
    const at = mapping[field];
    if (at === null) continue;
    const value = (row[at] ?? '').trim();
    if (value !== '') mapped[field] = value;
  }
  return mapped;
}

/**
 * Whether enough is mapped to mean anything: a date, and at least one reading.
 *
 * Both halves are needed and neither is enough alone. A file with dates and no
 * measurements is a calendar; a file with measurements and no dates cannot be
 * put in order, and a water log that cannot be put in order says nothing about
 * whether the pool was safe on Tuesday.
 */
export function hasReadings(mapping: WaterMapping): boolean {
  return mapping.takenOn !== null && POOL_METRICS.some((metric) => mapping[metric] !== null);
}

/**
 * The columns an export writes, in the order a person reads them.
 *
 * One half of a contract with the other: **what the exporter writes, the
 * importer must read back.** The water log's existing export writes the date,
 * then one column per metric the tank measures, then the notes — so a club can
 * export, correct a figure in Excel and import the result without touching a
 * dropdown.
 */
export const WATER_EXPORT_FIELDS: WaterField[] = ['takenOn', ...POOL_METRICS, 'notes'];
