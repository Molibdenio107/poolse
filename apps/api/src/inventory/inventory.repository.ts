import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { searchPredicate } from '../common/search.js';
import {
  windowed,
  TOTAL_COUNT,
  type PageQuery,
  type Paginated,
} from '../common/pagination.js';
import {
  validateInventoryRows,
  type ExistingItem,
  type ImportPool,
  type InventoryImportContext,
  type InventoryRow,
  type InventoryScope,
  type InventorySummary,
  type RawInventoryRow,
} from './inventory.js';

/**
 * The club's kit — round 6.
 *
 * Ordinary tenant-scoped SQL. Nothing here writes `where organization_id`,
 * because RLS supplies it; what the queries *do* write is `facility_id`, which
 * is the boundary this feature actually cares about — two sites in one club do
 * not share a store room.
 */

/** Raised when a name is already taken at the same facility. */
export class DuplicateNameError extends Error {}

function asDuplicate<T>(error: unknown, name: string): T {
  // 23505 is `inventory_item_name_uq`, the partial unique index.
  if (error instanceof Error && (error as { code?: string }).code === '23505') {
    throw new DuplicateNameError(name);
  }
  throw error;
}

export interface InventoryItem {
  id: string;
  facilityId: string;
  name: string;
  quantity: number;
  unit: string | null;
  notes: string | null;
  scope: InventoryScope;
  /** Empty unless `scope` is `pools`. */
  poolIds: string[];
  /** Their names, so a list can be read without a second lookup. */
  poolNames: string[];
}

export interface InventoryItemInput {
  name: string;
  quantity: number;
  unit: string | null;
  notes: string | null;
  scope: InventoryScope;
  /** Ignored unless `scope` is `pools`. */
  poolIds: string[];
}

interface ItemRow {
  total_count: number;
  id: string;
  facility_id: string;
  name: string;
  quantity: number;
  unit: string | null;
  notes: string | null;
  scope: InventoryScope;
  pool_ids: string[] | null;
  pool_names: string[] | null;
}

function toItem(row: ItemRow): InventoryItem {
  return {
    id: row.id,
    facilityId: row.facility_id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    notes: row.notes,
    scope: row.scope,
    poolIds: row.pool_ids ?? [],
    poolNames: row.pool_names ?? [],
  };
}

/**
 * The rows themselves, with the tanks each item serves.
 *
 * One query and a lateral aggregate rather than two round trips and a join in
 * JavaScript: the scope is not decoration on this screen, it is the column
 * somebody scans, so it has to arrive with the row.
 *
 * **The search is over the name and the notes.** A club looking for "prancha"
 * means the item; a club looking for "armário 2" means everything kept there,
 * and the notes field is where that lives. `searchPredicate` rather than `LIKE`,
 * so a term containing `%` is a literal percent sign and not a match on
 * everything — the fix POOLSE-30 already made for the register.
 */
const SELECT_ITEMS = `
  SELECT ${TOTAL_COUNT},
         i.id, i.facility_id, i.name, i.quantity, i.unit, i.notes, i.scope,
         scoped.pool_ids, scoped.pool_names
    FROM inventory_item i
    LEFT JOIN LATERAL (
           SELECT array_agg(p.id ORDER BY lower(strip_accents(p.name))) AS pool_ids,
                  array_agg(p.name ORDER BY lower(strip_accents(p.name))) AS pool_names
             FROM inventory_item_pool link
             JOIN pool p ON p.id = link.pool_id
            WHERE link.item_id = i.id
              AND p.archived_at IS NULL
         ) scoped ON true
   WHERE i.facility_id = $1
     AND i.archived_at IS NULL
     AND ${searchPredicate('i.name || \' \' || coalesce(i.notes, \'\')', '$2')}
   ORDER BY lower(strip_accents(i.name))
`;

/**
 * One page of a site's inventory.
 *
 * Paginated because a store room grows as the club buys things — the rule in
 * CONVENTIONS is about the data, not about the work. The window, the search and
 * the facility scope are all in one statement: filtering after the window is
 * what gives page 2 fewer rows than page 1 and reads as records going missing.
 */
export async function listInventory(
  organizationId: string,
  facilityId: string,
  search: string | null,
  page: PageQuery,
): Promise<Paginated<InventoryItem>> {
  return withOrg(organizationId, async (tx) => {
    const run = (limit: number, offset: number) =>
      tx.query<ItemRow>(`${SELECT_ITEMS} LIMIT $3 OFFSET $4`, [
        facilityId,
        search,
        limit,
        offset,
      ]);

    return windowed(page, run, toItem);
  });
}

/**
 * The same list, for a file.
 *
 * Unwindowed but capped. `listInventory` pages because a screen pages; an export
 * does not, and handing the exporter `?page=3` would produce a file whose
 * contents depend on where somebody happened to be scrolled. The search still
 * travels, because an export under a filtered list must be that list or the
 * button lies about what it did.
 */
export async function exportInventory(
  organizationId: string,
  facilityId: string,
  search: string | null,
): Promise<InventoryItem[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<ItemRow>(`${SELECT_ITEMS} LIMIT $3`, [
      facilityId,
      search,
      MAX_EXPORT_ROWS,
    ]);
    return rows.map(toItem);
  });
}

/**
 * The ceiling on one exported file.
 *
 * Generous past any real store room, and present so the endpoint cannot be used
 * to pull an unbounded set in one request. `MAX_INVENTORY_ROWS` on the import is
 * 2 000 for the same reason and the two are deliberately the same order.
 */
const MAX_EXPORT_ROWS = 5_000;

/**
 * The junction rows for one item, rewritten wholesale.
 *
 * Delete-then-insert rather than a diff. The set is at most a handful of pools,
 * it happens inside the same transaction as the item's own update, and a diff
 * would be more code for a case that never gets large — while getting the diff
 * subtly wrong would silently drop a tank from an item's scope.
 *
 * The insert names `facility_id` because both composite keys route through it:
 * that is what makes it impossible to attach a tank at another site.
 */
async function setScopePools(
  tx: Tx,
  organizationId: string,
  facilityId: string,
  itemId: string,
  scope: InventoryScope,
  poolIds: string[],
): Promise<void> {
  await tx.query(`DELETE FROM inventory_item_pool WHERE item_id = $1`, [itemId]);
  if (scope !== 'pools' || poolIds.length === 0) return;

  await tx.query(
    `INSERT INTO inventory_item_pool (organization_id, facility_id, item_id, pool_id)
     SELECT $1, $2, $3, unnest($4::uuid[])
     ON CONFLICT DO NOTHING`,
    [organizationId, facilityId, itemId, poolIds],
  );
}

/**
 * Adds a kind of item to a site's store.
 *
 * Throws `DuplicateNameError` on a second row for the same pile of things, which
 * the unique index decides accent- and case-insensitively rather than this
 * function — "Flutuadores" and "flutuádores" are one pile, and the database is
 * the only place that can say so without a race.
 */
export async function addInventoryItem(
  organizationId: string,
  facilityId: string,
  input: InventoryItemInput,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const facility = await tx.query(
      `SELECT 1 FROM facility WHERE id = $1 AND archived_at IS NULL`,
      [facilityId],
    );
    if (facility.rowCount === 0) return null;

    let id: string;
    try {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO inventory_item
           (organization_id, facility_id, name, quantity, unit, notes, scope)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          organizationId,
          facilityId,
          input.name,
          input.quantity,
          input.unit,
          input.notes,
          input.scope,
        ],
      );
      id = rows[0]!.id;
    } catch (error) {
      return asDuplicate<string>(error, input.name);
    }

    await setScopePools(tx, organizationId, facilityId, id, input.scope, input.poolIds);

    await recordAudit(tx, {
      action: 'inventory.item.added',
      entityType: 'facility',
      entityId: facilityId,
      data: { name: input.name, quantity: input.quantity, scope: input.scope },
    });

    return id;
  });
}

/**
 * Corrects an item, most often its count after a stock check.
 *
 * An ordinary update rather than a movement posted against a running total: a
 * total nobody posts against drifts from the shelf within a month, and then it
 * is wrong with more decimal places than the count was.
 */
export async function updateInventoryItem(
  organizationId: string,
  itemId: string,
  input: InventoryItemInput,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ facility_id: string }>(
      `SELECT facility_id FROM inventory_item WHERE id = $1 AND archived_at IS NULL`,
      [itemId],
    );
    const facilityId = rows[0]?.facility_id;
    if (facilityId === undefined) return false;

    try {
      await tx.query(
        `UPDATE inventory_item
            SET name = $2, quantity = $3, unit = $4, notes = $5, scope = $6
          WHERE id = $1 AND archived_at IS NULL`,
        [itemId, input.name, input.quantity, input.unit, input.notes, input.scope],
      );
    } catch (error) {
      return asDuplicate<boolean>(error, input.name);
    }

    await setScopePools(tx, organizationId, facilityId, itemId, input.scope, input.poolIds);

    await recordAudit(tx, {
      action: 'inventory.item.updated',
      entityType: 'inventory_item',
      entityId: itemId,
      data: { name: input.name, quantity: input.quantity, scope: input.scope },
    });

    return true;
  });
}

/** Archived, never deleted — the club had these once, and that is history. */
export async function archiveInventoryItem(
  organizationId: string,
  itemId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE inventory_item SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL`,
      [itemId],
    );
    if (rowCount === 0) return false;

    await recordAudit(tx, {
      action: 'inventory.item.archived',
      entityType: 'inventory_item',
      entityId: itemId,
    });

    return true;
  });
}

// ---------------------------------------------------------------------------
// The import
// ---------------------------------------------------------------------------
//
// The same arrangement as the register's, for the same reason: one function,
// called with `commit` false and then true, so a preview and the write that
// follows it cannot be produced by two code paths that agree until the evening
// they do not.

export interface InventoryImportRequest {
  facilityId: string;
  rows: RawInventoryRow[];
  commit: boolean;
  /**
   * The row indexes the operator ticked, or null for "everything importable".
   *
   * Only consulted on a commit, and the server still refuses any row with a
   * problem whatever arrives here — a tick on a broken row is a client that is
   * out of date, not permission.
   */
  include: number[] | null;
}

export interface InventoryImportResult {
  rows: InventoryRow[];
  summary: InventorySummary;
  /** Present only on a commit. */
  created?: number;
  updated?: number;
  /** Importable rows the operator did not tick. */
  skipped?: number;
}

/** The tanks at this site, as the matcher needs them. */
async function poolsAt(tx: Tx, facilityId: string): Promise<ImportPool[]> {
  const { rows } = await tx.query<{ id: string; name: string }>(
    `SELECT id, name FROM pool
      WHERE facility_id = $1 AND archived_at IS NULL
      ORDER BY lower(strip_accents(name))`,
    [facilityId],
  );
  return rows;
}

/**
 * Everything already in this store, for duplicate detection.
 *
 * Unpaginated, and comfortably so: the bound is a club's store room, dozens of
 * rows, held for the length of one request.
 */
async function existingItems(tx: Tx, facilityId: string): Promise<ExistingItem[]> {
  const { rows } = await tx.query<{
    id: string;
    name: string;
    quantity: number;
    unit: string | null;
    notes: string | null;
    scope: InventoryScope;
    pool_ids: string[] | null;
  }>(
    `
    SELECT i.id, i.name, i.quantity, i.unit, i.notes, i.scope,
           (SELECT array_agg(link.pool_id)
              FROM inventory_item_pool link
             WHERE link.item_id = i.id) AS pool_ids
      FROM inventory_item i
     WHERE i.facility_id = $1 AND i.archived_at IS NULL
    `,
    [facilityId],
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    notes: row.notes,
    scope: row.scope,
    poolIds: row.pool_ids ?? [],
  }));
}

/**
 * Preview, or write.
 *
 * The whole commit is one transaction. A half-applied stocktake is worse than
 * none: nobody can tell which half landed, and running it again doubles what
 * did.
 */
export async function runInventoryImport(
  organizationId: string,
  request: InventoryImportRequest,
): Promise<InventoryImportResult | null> {
  return withOrg(organizationId, async (tx) => {
    const facility = await tx.query(
      `SELECT 1 FROM facility WHERE id = $1 AND archived_at IS NULL`,
      [request.facilityId],
    );
    if (facility.rowCount === 0) return null;

    const context: InventoryImportContext = {
      pools: await poolsAt(tx, request.facilityId),
      existing: await existingItems(tx, request.facilityId),
    };

    const { rows, summary } = validateInventoryRows(request.rows, context);
    if (!request.commit) return { rows, summary };

    const ticked =
      request.include === null ? null : new Set(request.include);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      if (!row.importable) continue;

      /*
       * The default when the client expressed no selection at all: create what
       * is new, leave what already exists alone. The same rule the preview ticks
       * on screen, so the two agree by construction rather than by memory.
       */
      const wanted =
        ticked === null ? row.duplicate === null : ticked.has(row.index);

      if (!wanted) {
        skipped += 1;
        continue;
      }

      if (row.duplicate?.kind === 'store' && row.duplicate.itemId !== undefined) {
        const itemId = row.duplicate.itemId;

        /*
         * Only what the sheet actually said. `coalesce` on the nullable columns
         * so a file with no notes column does not blank the notes somebody
         * typed — re-importing last year's list has to be harmless, because it
         * is the commonest thing a club will really do with this.
         */
        await tx.query(
          `UPDATE inventory_item
              SET quantity = $2,
                  unit = coalesce($3, unit),
                  notes = coalesce($4, notes),
                  scope = $5
            WHERE id = $1 AND archived_at IS NULL`,
          [itemId, row.quantity, row.unit, row.notes, row.scope],
        );

        await setScopePools(
          tx,
          organizationId,
          request.facilityId,
          itemId,
          row.scope,
          row.poolIds,
        );
        updated += 1;
        continue;
      }

      // A duplicate of an earlier row in the same file is skipped rather than
      // written: the first one already carried this pile of things.
      if (row.duplicate?.kind === 'file') {
        skipped += 1;
        continue;
      }

      const { rows: inserted } = await tx.query<{ id: string }>(
        `INSERT INTO inventory_item
           (organization_id, facility_id, name, quantity, unit, notes, scope)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          organizationId,
          request.facilityId,
          row.name,
          row.quantity,
          row.unit,
          row.notes,
          row.scope,
        ],
      );

      await setScopePools(
        tx,
        organizationId,
        request.facilityId,
        inserted[0]!.id,
        row.scope,
        row.poolIds,
      );
      created += 1;
    }

    await recordAudit(tx, {
      action: 'inventory.imported',
      entityType: 'facility',
      entityId: request.facilityId,
      data: { created, updated, skipped },
    });

    return { rows, summary, created, updated, skipped };
  });
}
