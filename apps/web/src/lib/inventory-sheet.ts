// The `.ts` on the specifier is not a slip: this module is reached by
// `node --test`, whose resolver does not add extensions. `landing.ts` carries
// one for the same reason, and `allowImportingTsExtensions` is on so the
// bundler is equally happy.
import { matchFields, type MatchResult, type MatchSpec, type Sheet } from './sheet.ts';

/**
 * The inventory importer's half of `sheet.ts` — round 6.
 *
 * Pure, and it runs in either half of the app: reading a `.xlsx` needs a library
 * and a Node buffer and lives in `lib/read-sheet.ts`, which is server-only. This
 * is the part with the rules in it, and the part worth testing.
 *
 * It is a sibling of the register's field list rather than an extension of it.
 * The two share the scoring, the abbreviation rule and the shape check —
 * `matchFields` — and share none of the vocabulary, because a column called
 * "Nome" means a child in one file and a pile of pranchas in the other.
 */

/**
 * The fields a column can be pointed at.
 *
 * The API has this list too and it is the authority — it drops keys it does not
 * know. Repeated here rather than shared because the web app and the API share
 * no code package, and the failure mode of the copies drifting is a column that
 * is ignored, not a column written to the wrong place.
 */
export const INVENTORY_FIELDS = ['name', 'quantity', 'unit', 'notes', 'pools'] as const;

export type InventoryField = (typeof INVENTORY_FIELDS)[number];

export type InventoryMapping = Record<InventoryField, number | null>;

export const EMPTY_INVENTORY_MAPPING: InventoryMapping = {
  name: null,
  quantity: null,
  unit: null,
  notes: null,
  pools: null,
};

/**
 * The header words each field answers to, in pt-PT and en.
 *
 * **The plural belongs to the count, the singular to the measure.** "Unidades"
 * over a column of numbers is how a great many club sheets write the quantity;
 * "Unidade" over a column of words is pares, caixas, metros. Splitting them this
 * way rather than by list order is what actually decides it — `matchFields`
 * takes the best-scoring pair, not the first one, so an exact match on the wrong
 * field would win however the list is arranged. Getting this backwards imports a
 * whole store room with every count at zero.
 */
const SYNONYMS: [InventoryField, string[]][] = [
  [
    'quantity',
    [
      'quantidade',
      'qtd',
      'qt',
      'qtde',
      'numero',
      'n',
      'stock',
      'existencias',
      'total',
      'unidades',
      'quantity',
      'qty',
      'count',
      'amount',
      'units',
    ],
  ],
  [
    'pools',
    [
      'piscina',
      'piscinas',
      'tanque',
      'tanques',
      'local',
      'localizacao',
      'onde',
      'pool',
      'pools',
      'location',
      'where',
    ],
  ],
  ['unit', ['unidade', 'medida', 'un', 'unit', 'measure']],
  [
    'notes',
    ['notas', 'observacoes', 'obs', 'descricao', 'estado', 'notes', 'comments', 'remarks', 'description'],
  ],
  [
    'name',
    [
      'material',
      'materiais',
      'equipamento',
      'artigo',
      'item',
      'designacao',
      'nome',
      'descricao do artigo',
      'name',
      'equipment',
      'article',
    ],
  ],
];

/**
 * What each field's values should look like.
 *
 * Only the count, and it earns its place: a club's sheet often has an
 * unreadable heading over the one column of bare numbers, and a column headed
 * "Qtd" full of words is a sheet whose headers have shifted by one — which is
 * worth a question rather than a silent mapping.
 */
const EXPECTED_SHAPE: Partial<Record<InventoryField, (looks: string[]) => boolean>> = {
  quantity: (looks) => looks.some((shape) => /^\d+ digits$/.test(shape)),
};

export const INVENTORY_MATCH: MatchSpec<InventoryField> = {
  empty: EMPTY_INVENTORY_MAPPING,
  synonyms: SYNONYMS,
  expectedShape: EXPECTED_SHAPE,
};

/** Which column is which, with how sure it is about each. */
export function matchInventoryColumns(sheet: Sheet): MatchResult<InventoryField> {
  return matchFields(sheet, INVENTORY_MATCH);
}

/** One row, keyed by field name — exactly what the API's `rows` expects. */
export function applyInventoryMapping(
  row: string[],
  mapping: InventoryMapping,
): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const field of INVENTORY_FIELDS) {
    const at = mapping[field];
    if (at === null) continue;
    const value = (row[at] ?? '').trim();
    if (value !== '') mapped[field] = value;
  }
  return mapped;
}

/**
 * The columns an export writes, in the order a person reads them.
 *
 * One half of a contract with the other: **what the exporter writes, the
 * importer must read back.** The header row of an exported file is
 * `inventory.field.*` from the catalogue — the very labels the mapping step
 * shows — so a club can export, count things in Excel and import the result
 * without touching a single dropdown.
 */
export const INVENTORY_EXPORT_FIELDS: InventoryField[] = [
  'name',
  'quantity',
  'unit',
  'pools',
  'notes',
];

/** Whether enough is mapped to mean anything: a name for the thing. */
export function hasItemName(mapping: InventoryMapping): boolean {
  return mapping.name !== null;
}
