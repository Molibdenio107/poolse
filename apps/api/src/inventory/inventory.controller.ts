import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import { listFacilities, type Facility } from '../facilities/facilities.repository.js';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import { readSearch } from '../common/search.js';
import {
  addInventoryItem,
  archiveInventoryItem,
  DuplicateNameError,
  exportInventory,
  listInventory,
  runInventoryImport,
  updateInventoryItem,
  type InventoryImportResult,
  type InventoryItem,
  type InventoryItemInput,
} from './inventory.repository.js';
import {
  INVENTORY_IMPORT_FIELDS,
  MAX_INVENTORY_ROWS,
  type InventoryImportField,
  type InventoryScope,
  type RawInventoryRow,
} from './inventory.js';

/**
 * The club's kit, at a site — round 6.
 *
 * Its own controller rather than more methods on `FacilitiesController`, and the
 * reason is the move that created it: inventory used to hang off a pool, and it
 * does not any more. An item belongs to a facility and says which tanks it
 * serves, which makes `/inventory?facilityId=` the honest route and
 * `/facilities/pools/:id/materials` a lie about where the data lives.
 *
 * Reads are open to any member — an instructor who wants to know whether there
 * are enough pranchas for a class is asking a reasonable question. Writes are
 * owner and admin, as everywhere else that changes a facility.
 */
@Controller('inventory')
export class InventoryController {
  /**
   * A site's store, and the sites there are to choose between.
   *
   * The facility list travels with the response rather than being fetched
   * separately: the screen cannot render its picker without it, and a second
   * round trip would put a loading state on a `<select>`.
   */
  @Get()
  async list(
    @Query('facilityId') requested?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{
    organizationId: string;
    canManage: boolean;
    facilities: { id: string; name: string; pools: { id: string; name: string }[] }[];
    /** The site actually being shown — the requested one, or the first. */
    facilityId: string | null;
    items: Paginated<InventoryItem>;
  }> {
    const { organizationId } = currentTenant();
    const window = readPageQuery(page, limit);

    const facilityId = await this.resolveFacility(organizationId, requested);
    const facilities: Facility[] = await listFacilities(organizationId);

    return {
      organizationId,
      canManage: hasRole('owner', 'admin'),
      facilities: facilities.map((facility) => ({
        id: facility.id,
        name: facility.name,
        pools: facility.pools.map((pool) => ({ id: pool.id, name: pool.name })),
      })),
      facilityId,
      items:
        facilityId === null
          ? { items: [], total: 0, page: window.page, limit: window.limit }
          : await listInventory(organizationId, facilityId, readSearch(search), window),
    };
  }

  /**
   * The whole filtered list, for a file.
   *
   * A literal segment, declared before `:itemId` could claim it, so
   * `/inventory/export` is this and not an item whose id is the word "export".
   *
   * Separate from `GET /inventory` rather than a `limit=all` on it, because an
   * unbounded window on the list endpoint is the thing somebody uses to pull a
   * tenant's data in one request. This one is capped and carries no page.
   */
  @Get('export')
  async exportAll(
    @Query('facilityId') requested?: string,
    @Query('search') search?: string,
  ): Promise<{ facilityId: string | null; items: InventoryItem[] }> {
    const { organizationId } = currentTenant();

    const facilityId = await this.resolveFacility(organizationId, requested);

    return {
      facilityId,
      items:
        facilityId === null
          ? []
          : await exportInventory(organizationId, facilityId, readSearch(search)),
    };
  }

  /**
   * The site being shown: the requested one, or the first.
   *
   * An unknown id falls back rather than 404-ing. A stale bookmark to a site
   * that has since been archived should show somebody their inventory, not an
   * error page about a facility they no longer have.
   */
  private async resolveFacility(
    organizationId: string,
    requested?: string,
  ): Promise<string | null> {
    const facilities = await listFacilities(organizationId);
    const wanted = (requested ?? '').trim();
    return facilities.find((facility) => facility.id === wanted)?.id ?? facilities[0]?.id ?? null;
  }

  /**
   * Adds a kind of item.
   *
   * The name is free text on purpose: every club calls these things something
   * slightly different, and a fixed vocabulary means the first operator who
   * wants "arcos" cannot record their arcos. The database decides what counts as
   * a duplicate, accent- and case-insensitively, because it is the only place
   * that can decide it without a race.
   */
  @Post()
  async add(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const facilityId = readId(body['facilityId'], 'facilityId');

    let id: string | null;
    try {
      id = await addInventoryItem(organizationId, facilityId, readItem(body));
    } catch (error) {
      throw asHttp(error);
    }

    if (id === null) throw new NotFoundException('No such site');
    return { id };
  }

  /**
   * Preview, then commit — one route with a flag.
   *
   * Declared before `:itemId` would matter, but on a literal segment anyway, so
   * `/inventory/import` can never be read as an item whose id is the word
   * "import".
   */
  @Post('import')
  async import(@Body() body: Record<string, unknown>): Promise<InventoryImportResult> {
    // Adding kit is owner/admin on the form, so it is owner/admin in bulk. An
    // import that took a role the single create refuses would be the permission
    // model, worked around by uploading a file.
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const result = await runInventoryImport(organizationId, {
      facilityId: readId(body['facilityId'], 'facilityId'),
      rows: readRows(body['rows']),
      commit: body['commit'] === true,
      include: readInclude(body['include']),
    });

    if (result === null) throw new NotFoundException('No such site');
    return result;
  }

  /** Corrects an item — in practice, its count after somebody has been counting. */
  @Patch(':itemId')
  async edit(
    @Param('itemId') itemId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    let updated: boolean;
    try {
      updated = await updateInventoryItem(organizationId, itemId, readItem(body));
    } catch (error) {
      throw asHttp(error);
    }

    if (!updated) throw new NotFoundException('No such item');
    return { updated: true };
  }

  @Post(':itemId/archive')
  async remove(@Param('itemId') itemId: string): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await archiveInventoryItem(organizationId, itemId))) {
      throw new NotFoundException('No such item');
    }
    return { archived: true };
  }
}

function asHttp(error: unknown): unknown {
  if (error instanceof DuplicateNameError) {
    return new ConflictException('An item with that name is already recorded at this site');
  }
  return error;
}

function readId(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new BadRequestException(`${field} is required`);
  }
  return raw.trim();
}

function text(raw: unknown, field: string, max: number): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new BadRequestException(`${field} must be text`);
  const value = raw.trim();
  if (value === '') return null;
  if (value.length > max) throw new BadRequestException(`${field} is at most ${max} characters`);
  return value;
}

const SCOPES = new Set<string>(['facility', 'pools', 'all_pools']);

/**
 * One item off the wire.
 *
 * `quantity` is validated here rather than left to the CHECK constraint for the
 * usual reason: "violates check constraint inventory_item_quantity_check" is a
 * message for whoever wrote the migration, and −1 in a count field is somebody's
 * typo.
 *
 * The pool list is only read for a `pools` scope. A client that sends both
 * `all_pools` and a list of tanks has contradicted itself, and the scope is the
 * more explicit of the two statements — the database would keep the junction
 * rows and never read them, which is a row nobody can see influencing nothing.
 */
function readItem(body: Record<string, unknown>): InventoryItemInput {
  const name = text(body['name'], 'name', 120);
  if (name === null) throw new BadRequestException('name is required');

  const raw = body['quantity'];
  const quantity = raw === undefined || raw === null ? 0 : Number(raw);
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new BadRequestException('quantity must be a whole number, zero or more');
  }

  const rawScope = body['scope'];
  const scope: InventoryScope =
    typeof rawScope === 'string' && SCOPES.has(rawScope)
      ? (rawScope as InventoryScope)
      : 'facility';

  let poolIds: string[] = [];
  if (scope === 'pools') {
    const sent = body['poolIds'];
    if (!Array.isArray(sent)) throw new BadRequestException('poolIds must be a list');
    poolIds = sent.map((value) => readId(value, 'poolIds'));
    if (poolIds.length === 0) {
      throw new BadRequestException('a pools-scoped item must name at least one pool');
    }
  }

  return {
    name,
    quantity,
    unit: text(body['unit'], 'unit', 40),
    notes: text(body['notes'], 'notes', 500),
    scope,
    poolIds,
  };
}

const FIELDS = new Set<string>(INVENTORY_IMPORT_FIELDS);

/**
 * The rows, believed only as far as their shape.
 *
 * Unknown keys are dropped rather than refused: the client sends what the
 * operator mapped, and a field this API gained yesterday reaching a deployment
 * that has not shipped it should ignore the column, not reject the import.
 */
function readRows(raw: unknown): RawInventoryRow[] {
  if (!Array.isArray(raw)) throw new BadRequestException('rows must be a list');
  if (raw.length === 0) throw new BadRequestException('rows is empty');
  if (raw.length > MAX_INVENTORY_ROWS) {
    throw new BadRequestException(`at most ${MAX_INVENTORY_ROWS} rows in one import`);
  }

  return raw.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new BadRequestException('each row must be an object of field to value');
    }

    const row: RawInventoryRow = {};
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (!FIELDS.has(key)) continue;
      if (value === null || value === undefined) continue;
      row[key as InventoryImportField] = typeof value === 'string' ? value : String(value);
    }
    return row;
  });
}

/** Row indexes, or null when the caller expressed no selection at all. */
function readInclude(raw: unknown): number[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw new BadRequestException('include must be a list of row indexes');

  return raw.map((value) => {
    const index = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= MAX_INVENTORY_ROWS) {
      throw new BadRequestException('include must hold row indexes');
    }
    return index;
  });
}
