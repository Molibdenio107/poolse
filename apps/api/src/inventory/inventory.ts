/**
 * What an imported inventory row means, and why it is refused — round 6.
 *
 * The same shape as `students/import.ts`, and deliberately so: preview and
 * commit are one function called twice, because the failure this feature cannot
 * afford is an operator approving a preview and a different set of rows being
 * written. Everything here is pure — no database, no HTTP, no spreadsheet. The
 * web app reads the file and maps the columns; this is handed rows already keyed
 * by Poolse's field names and says what each one resolves to.
 *
 * The one place it diverges from the students importer is what a duplicate
 * means. A second row for a child is a mistake to be told about. A second row
 * for "Pranchas" is almost always a stocktake — the same pile, counted again —
 * so a match is reported as an *update* with the old and new counts side by
 * side, and the operator ticks it. Unticked by default, as on the register:
 * ticking is one click and an unasked-for overwrite is not.
 */

/**
 * The fields a spreadsheet column can be pointed at.
 *
 * Five, and there is not a sixth worth adding. A club's kit list is a name, a
 * number, sometimes a unit, sometimes a note about where it lives — and, for a
 * club with more than one tank, which tanks it serves.
 */
export const INVENTORY_IMPORT_FIELDS = [
  'name',
  'quantity',
  /** Pares, caixas, metros. Left blank on most rows, because the name carries it. */
  'unit',
  'notes',
  /**
   * Which tanks this serves, as the sheet wrote it.
   *
   * Free text matched against the site's own pool names, separated by commas,
   * semicolons or slashes — a club's column reads "Tanque Grande; Aprendizagem",
   * never a list of uuids. A word meaning "all" sets `all_pools`; an empty cell
   * means the item belongs to the building rather than to any tank, which is the
   * commonest answer and so is also the default.
   */
  'pools',
] as const;

export type InventoryImportField = (typeof INVENTORY_IMPORT_FIELDS)[number];

export type RawInventoryRow = Partial<Record<InventoryImportField, string>>;

export type InventoryScope = 'facility' | 'pools' | 'all_pools';

/**
 * What genuinely cannot be written.
 *
 * Short, for the reason the register's list is short: an importer that refuses a
 * row because the sheet is untidy is an importer that fails most real files.
 * Only the name is mandatory in the database, and only a count that is not a
 * count can fail on the way in.
 */
export type InventoryProblemCode = 'nameRequired' | 'tooLong' | 'badQuantity';

/**
 * Worth saying, never worth refusing over.
 *
 * A pool name that matches nothing is the important one. It is nearly always
 * last year's tank, or a typo, and silently narrowing the item's scope would
 * hand somebody an inventory that looks right and covers the wrong water.
 */
export type InventoryWarningCode = 'poolNotFound' | 'noPoolsMatched' | 'quantityMissing';

export interface InventoryProblem {
  field: InventoryImportField;
  code: InventoryProblemCode;
  /** What was in the cell, so the message can quote it back. */
  value?: string;
}

export interface InventoryWarning {
  field: InventoryImportField;
  code: InventoryWarningCode;
  value?: string;
}

/** A field a commit would change on an item the club already has. */
export interface InventoryUpdate {
  field: 'quantity' | 'unit' | 'notes' | 'scope' | 'pools';
  /** What is recorded now, for the screen to show beside the new value. */
  before: string;
  after: string;
}

export interface InventoryDuplicate {
  /** `store` is an item already at this site; `file` is an earlier row of the same sheet. */
  kind: 'store' | 'file';
  itemId?: string;
  name: string;
  /** The earlier row's spreadsheet line, when `kind` is `file`. */
  line?: number;
}

export interface InventoryRow {
  /** 0-based position among the data rows — the client's stable handle. */
  index: number;
  /** The line in the spreadsheet, counting the header as line 1. */
  line: number;
  name: string;
  quantity: number;
  unit: string | null;
  notes: string | null;
  scope: InventoryScope;
  /** Pool ids this row resolved to. Empty unless `scope` is `pools`. */
  poolIds: string[];
  /** Their names, in the order the sheet listed them, for the preview. */
  poolNames: string[];
  problems: InventoryProblem[];
  warnings: InventoryWarning[];
  duplicate: InventoryDuplicate | null;
  updates: InventoryUpdate[];
  /**
   * Whether this row can be written at all. A duplicate is not a problem — it is
   * something to be told before deciding — so it never clears this flag.
   */
  importable: boolean;
}

/** A pool at the target site, as this module needs to see it. */
export interface ImportPool {
  id: string;
  name: string;
}

/** An item already in the store, carrying everything an import could change. */
export interface ExistingItem {
  id: string;
  name: string;
  quantity: number;
  unit: string | null;
  notes: string | null;
  scope: InventoryScope;
  poolIds: string[];
}

export interface InventoryImportContext {
  /** The pools at the facility being imported into. */
  pools: ImportPool[];
  existing: ExistingItem[];
}

/**
 * The largest kit list one import may carry.
 *
 * Far smaller than the register's 10 000, and it does not need to be larger: an
 * inventory is a store room, not a population. Two thousand distinct kinds of
 * item is already an implausible club.
 */
export const MAX_INVENTORY_ROWS = 2_000;

const MAX_NAME = 120;
const MAX_UNIT = 40;
const MAX_NOTES = 500;

/**
 * The same normalisation the database's unique index uses: accents and case
 * removed, punctuation flattened.
 *
 * It has to agree with `lower(strip_accents(name))` or the preview will promise
 * to create a row the commit then rejects as a duplicate — which is exactly the
 * disagreement this whole module is arranged to prevent.
 */
export function normaliseKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Whatever a person wrote for "all of them".
 *
 * Both languages and the abbreviations a hurried operator types. Anything not on
 * this list is treated as a pool name, which is the safe direction to be wrong
 * in: an unmatched name is reported, a wrongly-assumed "all" would not be.
 */
const MEANS_ALL = new Set([
  'todas',
  'todos',
  'todas as piscinas',
  'todos os tanques',
  'todas piscinas',
  'all',
  'all pools',
  'any',
  'geral',
]);

/** A cell as a trimmed string, or null when there was nothing in it. */
function cell(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const value = raw.trim();
  return value === '' ? null : value;
}

/**
 * The count, read the way a spreadsheet actually writes one.
 *
 * "24", "24 un", "1.0" from a cell Excel decided was a float, and " 24 " from a
 * column somebody padded. A blank is zero with a warning rather than a refusal —
 * a kit list with an empty count column is a list of what the club owns, and
 * refusing it would be refusing the file over the least important column in it.
 */
function readQuantity(raw: string | null): { value: number } | { error: 'badQuantity' } {
  if (raw === null) return { value: 0 };

  // A trailing unit is common and harmless: the unit has its own column, and
  // "24 un" in the quantity cell is still twenty-four.
  const digits = raw.replace(',', '.').match(/-?\d+(\.\d+)?/);
  if (digits === null) return { error: 'badQuantity' };

  const value = Number(digits[0]);
  if (!Number.isFinite(value) || value < 0) return { error: 'badQuantity' };

  // 1.0 is one. 1.5 pranchas is not a thing anybody owns, and rounding it
  // silently would be inventing half a float — so the whole part is taken and
  // the operator sees the number that will be written.
  return { value: Math.floor(value) };
}

/** How the sheet's pool cell splits: commas, semicolons, slashes, pipes, newlines. */
function splitPools(raw: string): string[] {
  return raw
    .split(/[,;/|\n]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

export interface InventorySummary {
  total: number;
  /** Rows that can be written at all. */
  importable: number;
  /** Rows with at least one problem. */
  refused: number;
  /** Importable rows matching something already in the store, or an earlier row. */
  duplicates: number;
  /** Matched rows that would actually change something. */
  toUpdate: number;
  /** Rows that would add a kind of item the club does not yet record. */
  toCreate: number;
  /** Rows carrying at least one warning — imported, but worth a glance. */
  flagged: number;
}

function scopeText(scope: InventoryScope, names: string[]): string {
  if (scope === 'facility') return 'facility';
  if (scope === 'all_pools') return 'all_pools';
  return names.join(', ');
}

function validateRow(
  raw: RawInventoryRow,
  index: number,
  context: InventoryImportContext,
  poolsByKey: Map<string, ImportPool>,
  poolNameById: Map<string, string>,
  existingByKey: Map<string, ExistingItem>,
  seen: Map<string, InventoryRow>,
): InventoryRow {
  const problems: InventoryProblem[] = [];
  const warnings: InventoryWarning[] = [];

  const name = cell(raw.name) ?? '';
  if (name === '') problems.push({ field: 'name', code: 'nameRequired' });
  else if (name.length > MAX_NAME) problems.push({ field: 'name', code: 'tooLong', value: name });

  const rawQuantity = cell(raw.quantity);
  const quantity = readQuantity(rawQuantity);
  if ('error' in quantity) {
    problems.push({ field: 'quantity', code: 'badQuantity', value: rawQuantity ?? '' });
  } else if (rawQuantity === null) {
    // Recorded as zero, and said out loud. "We have a box and it is empty" is a
    // real answer, but so is "the column was blank", and only the operator knows
    // which this file meant.
    warnings.push({ field: 'quantity', code: 'quantityMissing' });
  }

  let unit = cell(raw.unit);
  if (unit !== null && unit.length > MAX_UNIT) {
    problems.push({ field: 'unit', code: 'tooLong', value: unit });
    unit = null;
  }

  let notes = cell(raw.notes);
  if (notes !== null && notes.length > MAX_NOTES) {
    problems.push({ field: 'notes', code: 'tooLong', value: notes });
    notes = null;
  }

  /*
   * The scope, resolved against this site's own tanks.
   *
   * An unmatched name is a warning and not a refusal, but it is never silently
   * dropped: the item lands with the pools that did match, and the ones that did
   * not are named so somebody can fix the sheet or the pool.
   */
  let scope: InventoryScope = 'facility';
  const poolIds: string[] = [];
  const poolNames: string[] = [];

  const rawPools = cell(raw.pools);
  if (rawPools !== null) {
    const parts = splitPools(rawPools);

    if (parts.some((part) => MEANS_ALL.has(normaliseKey(part)))) {
      scope = 'all_pools';
    } else {
      for (const part of parts) {
        const pool = poolsByKey.get(normaliseKey(part));
        if (pool === undefined) {
          warnings.push({ field: 'pools', code: 'poolNotFound', value: part });
          continue;
        }
        if (poolIds.includes(pool.id)) continue;
        poolIds.push(pool.id);
        poolNames.push(pool.name);
      }

      if (poolIds.length > 0) {
        scope = 'pools';
      } else {
        // Every name in the cell missed. The item is still worth having, and it
        // belongs to the building until somebody says otherwise — but the row is
        // flagged, because an item quietly covering nothing is worse than a gap.
        warnings.push({ field: 'pools', code: 'noPoolsMatched', value: rawPools });
      }
    }
  }

  const row: InventoryRow = {
    index,
    // The header is line 1, so the first data row is line 2 — the number the
    // operator sees down the side of their own spreadsheet.
    line: index + 2,
    name,
    quantity: 'error' in quantity ? 0 : quantity.value,
    unit,
    notes,
    scope,
    poolIds,
    poolNames,
    problems,
    warnings,
    duplicate: null,
    updates: [],
    importable: problems.length === 0,
  };

  if (name === '') return row;

  const key = normaliseKey(name);

  // An earlier row of the same file, checked first: a sheet with one tab per
  // tank, pasted together, lists "Pranchas" three times, and the useful thing to
  // say is which line it was already on.
  const earlier = seen.get(key);
  if (earlier !== undefined) {
    row.duplicate = { kind: 'file', name: earlier.name, line: earlier.line };
    return row;
  }
  seen.set(key, row);

  const existing = existingByKey.get(key);
  if (existing === undefined) return row;

  row.duplicate = { kind: 'store', itemId: existing.id, name: existing.name };

  /*
   * What a commit would change, each with the value it replaces.
   *
   * The count is the point of the whole feature — a stocktake sheet exists to
   * correct it — so it is offered even when the file says the same number, in
   * which case there is simply nothing in this list and the row is a no-op the
   * operator can see is a no-op.
   *
   * A blank cell never overwrites something already recorded. Re-importing last
   * year's file with no notes column must not wipe the notes.
   */
  if (existing.quantity !== row.quantity) {
    row.updates.push({
      field: 'quantity',
      before: String(existing.quantity),
      after: String(row.quantity),
    });
  }
  if (unit !== null && unit !== existing.unit) {
    row.updates.push({ field: 'unit', before: existing.unit ?? '', after: unit });
  }
  if (notes !== null && notes !== existing.notes) {
    row.updates.push({ field: 'notes', before: existing.notes ?? '', after: notes });
  }
  if (rawPools !== null) {
    const before = scopeText(
      existing.scope,
      existing.poolIds.map((id) => poolNameById.get(id) ?? ''),
    );
    const after = scopeText(scope, poolNames);
    if (before !== after) row.updates.push({ field: 'scope', before, after });
  }

  return row;
}

export function validateInventoryRows(
  rows: RawInventoryRow[],
  context: InventoryImportContext,
): { rows: InventoryRow[]; summary: InventorySummary } {
  const poolsByKey = new Map(context.pools.map((pool) => [normaliseKey(pool.name), pool]));
  const poolNameById = new Map(context.pools.map((pool) => [pool.id, pool.name]));
  const existingByKey = new Map(
    context.existing.map((item) => [normaliseKey(item.name), item]),
  );

  const seen = new Map<string, InventoryRow>();
  const validated = rows.map((raw, index) =>
    validateRow(raw, index, context, poolsByKey, poolNameById, existingByKey, seen),
  );

  const importable = validated.filter((row) => row.importable);

  return {
    rows: validated,
    summary: {
      total: validated.length,
      importable: importable.length,
      refused: validated.length - importable.length,
      duplicates: importable.filter((row) => row.duplicate !== null).length,
      toUpdate: importable.filter((row) => row.duplicate !== null && row.updates.length > 0).length,
      toCreate: importable.filter((row) => row.duplicate === null).length,
      flagged: importable.filter((row) => row.warnings.length > 0).length,
    },
  };
}
