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
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import {
  archiveFacility,
  archivePool,
  countPeople,
  createFacility,
  createPool,
  DuplicateNameError,
  findFacility,
  findPool,
  listFacilities,
  updateFacility,
  updatePool,
  type Facility,
  type FacilityDetail,
  type PeopleCounts,
  type PoolDetail,
  type PoolKind,
} from './facilities.repository.js';

interface FacilityDetailResponse extends FacilityDetail {
  organizationId: string;
  canManage: boolean;
  /**
   * Absent for anybody who is not an owner or an admin.
   *
   * Not squeamishness about a headcount — it is that every count links through
   * to a filtered list, and those lists are `/dashboard/people`, which story 8
   * restricted to exactly those two roles. Sending an instructor a row of links
   * that all end in a refusal is worse than not showing the row.
   */
  counts?: PeopleCounts;
}

/**
 * Timezones offered for a facility.
 *
 * Not the full IANA list: a Portuguese pool operator picking from 400 entries is
 * a worse experience than one picking from three, and these three cover the
 * country. `timezone` is a plain text column, so adding one is a one-line change
 * here rather than a migration — which is the right way round, because the
 * database has the whole tz database and only the form is opinionated.
 *
 * This matters more than it looks. Class schedules are stored UTC and displayed
 * in the facility's timezone (CLAUDE.md), so a facility in Ponta Delgada with
 * Europe/Lisbon on it shows every lesson an hour wrong, forever, silently.
 */
const TIMEZONES = ['Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores'];
const POOL_KINDS: PoolKind[] = ['indoor', 'outdoor'];
const MAX_NAME = 120;

interface FacilitiesResponse {
  organizationId: string;
  facilities: Facility[];
  /** So the UI can hide forms the API would refuse. */
  canManage: boolean;
  timezones: string[];
}

/**
 * Slice 1.1 — an operator sets up their site.
 *
 * Reading is open to any member: an instructor needs to know which pool their
 * class is in. Writing is owner and admin, the same line invitations draw, and
 * for the same reason — the people who run the organization decide what it
 * contains.
 */
@Controller('facilities')
export class FacilitiesController {
  @Get()
  async list(): Promise<FacilitiesResponse> {
    const { organizationId } = currentTenant();

    return {
      organizationId,
      facilities: await listFacilities(organizationId),
      canManage: hasRole('owner', 'admin'),
      timezones: TIMEZONES,
    };
  }

  /**
   * Declared before `:facilityId/...` would matter, but on a distinct prefix
   * anyway: `pools/<id>` and `<facilityId>/pools` cannot collide because the
   * literal segment comes first in one and second in the other.
   */
  @Get('pools/:poolId')
  async pool(
    @Param('poolId') poolId: string,
  ): Promise<PoolDetail & { organizationId: string; canManage: boolean }> {
    const { organizationId } = currentTenant();

    const detail = await findPool(organizationId, poolId);
    if (!detail) throw new NotFoundException('No such pool');

    // Carried in the response for the same reason the listings carry it: the
    // client never names its own tenant, it echoes back the one the API resolved.
    return { ...detail, organizationId, canManage: hasRole('owner', 'admin') };
  }

  /**
   * One site: what it is, where it is, its pools, and the size of the operation.
   *
   * Declared after `pools/:poolId` on purpose. Nest matches routes in
   * declaration order, and a `:facilityId` parameter sitting above a literal
   * `pools` segment would swallow `/facilities/pools/<id>` and answer "no such
   * site" for every pool in the product.
   */
  @Get(':facilityId')
  async one(@Param('facilityId') facilityId: string): Promise<FacilityDetailResponse> {
    const { organizationId } = currentTenant();

    const detail = await findFacility(organizationId, facilityId);
    if (!detail) throw new NotFoundException('No such site');

    const privileged = hasRole('owner', 'admin');

    return {
      ...detail,
      organizationId,
      canManage: privileged,
      ...(privileged ? { counts: await countPeople(organizationId) } : {}),
    };
  }

  /**
   * Renames a site, or moves it — backlog round 3, stories 2 and 3.
   *
   * `city`, `countryCode`, `latitude` and `longitude` travel as one unit: the
   * city autocomplete resolves all four at the moment somebody picks from the
   * list, and the database refuses half a coordinate. Sending `city` alone
   * clears the rest, which is the correct reading of "this is somewhere else
   * now".
   */
  @Patch(':facilityId')
  async update(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const input: Parameters<typeof updateFacility>[2] = {};

    if (body['name'] !== undefined) {
      input.name = text(body['name'], 'name', { required: true })!;
    }
    if (body['address'] !== undefined) {
      input.address = text(body['address'], 'address', { max: 500 });
    }

    if (body['city'] !== undefined) {
      const city = text(body['city'], 'city', { max: 120 });
      input.city = city;

      if (city === null) {
        // Clearing the city clears the place. A coordinate with no name on it is
        // a number nobody can check, and the weather panel would still be
        // showing a forecast for a town the operator thought they had removed.
        input.countryCode = null;
        input.latitude = null;
        input.longitude = null;
      } else {
        input.countryCode = countryCode(body['countryCode']);
        input.latitude = coordinate(body['latitude'], 'latitude', 90);
        input.longitude = coordinate(body['longitude'], 'longitude', 180);

        if ((input.latitude === null) !== (input.longitude === null)) {
          throw new BadRequestException('latitude and longitude must be sent together');
        }
      }
    }

    if (!(await updateFacility(organizationId, facilityId, input))) {
      throw new NotFoundException('No such site');
    }
    return { updated: true };
  }

  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const name = text(body['name'], 'name', { required: true });
    const address = text(body['address'], 'address', { max: 500 });
    const timezone = typeof body['timezone'] === 'string' ? body['timezone'] : TIMEZONES[0]!;
    if (!TIMEZONES.includes(timezone)) {
      throw new BadRequestException(`Unsupported timezone: ${timezone}`);
    }

    try {
      return { id: await createFacility({ organizationId, name: name!, address, timezone }) };
    } catch (error) {
      throw asHttp(error);
    }
  }

  @Post(':facilityId/pools')
  async addPool(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const name = text(body['name'], 'name', { required: true });
    const kind = typeof body['kind'] === 'string' ? body['kind'] : 'indoor';
    if (!POOL_KINDS.includes(kind as PoolKind)) {
      throw new BadRequestException(`Unsupported pool kind: ${kind}`);
    }

    const volumeLitres = positiveInteger(body['volumeLitres'], 'volumeLitres');
    const laneCount = positiveInteger(body['laneCount'], 'laneCount');
    const lengthM = positiveMetres(body['lengthM'], 'lengthM');
    const widthM = positiveMetres(body['widthM'], 'widthM');
    const maxDepthM = positiveMetres(body['maxDepthM'], 'maxDepthM');

    let id: string | null;
    try {
      id = await createPool({
        organizationId,
        facilityId,
        name: name!,
        kind: kind as PoolKind,
        volumeLitres,
        laneCount,
        lengthM,
        widthM,
        maxDepthM,
      });
    } catch (error) {
      throw asHttp(error);
    }

    if (id === null) throw new NotFoundException('No such facility');
    return { id };
  }

  @Patch('pools/:poolId')
  async editPool(
    @Param('poolId') poolId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const kind = typeof body['kind'] === 'string' ? body['kind'] : 'indoor';
    if (!POOL_KINDS.includes(kind as PoolKind)) {
      throw new BadRequestException(`Unsupported pool kind: ${kind}`);
    }

    let updated: boolean;
    try {
      updated = await updatePool(organizationId, poolId, {
        name: text(body['name'], 'name', { required: true })!,
        kind: kind as PoolKind,
        volumeLitres: positiveInteger(body['volumeLitres'], 'volumeLitres'),
        laneCount: positiveInteger(body['laneCount'], 'laneCount'),
        lengthM: positiveMetres(body['lengthM'], 'lengthM'),
        widthM: positiveMetres(body['widthM'], 'widthM'),
        maxDepthM: positiveMetres(body['maxDepthM'], 'maxDepthM'),
      });
    } catch (error) {
      throw asHttp(error);
    }

    if (!updated) throw new NotFoundException('No such pool');
    return { updated: true };
  }

  @Post(':facilityId/archive')
  async archive(@Param('facilityId') facilityId: string): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await archiveFacility(organizationId, facilityId))) {
      throw new NotFoundException('No such facility');
    }
    return { archived: true };
  }

  @Post('pools/:poolId/archive')
  async archivePoolById(@Param('poolId') poolId: string): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await archivePool(organizationId, poolId))) {
      throw new NotFoundException('No such pool');
    }
    return { archived: true };
  }
}

function asHttp(error: unknown): unknown {
  if (error instanceof DuplicateNameError) {
    return new ConflictException(`"${error.message}" already exists here`);
  }
  return error;
}

/** Trimmed, length-checked, and empty-becomes-null so the column stays honest. */
function text(
  value: unknown,
  field: string,
  options: { required?: boolean; max?: number } = {},
): string | null {
  const max = options.max ?? MAX_NAME;
  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (trimmed.length === 0) {
    if (options.required) throw new BadRequestException(`${field} is required`);
    return null;
  }
  if (trimmed.length > max) {
    throw new BadRequestException(`${field} may be at most ${max} characters`);
  }
  return trimmed;
}

/**
 * A measurement in metres, to two decimal places.
 *
 * Whole numbers are wrong here in a way they are not for lane counts: a 12.5 m
 * pool is ordinary, and rounding it looks precise while being false. Two decimal
 * places matches `numeric(5,2)` on the column, so nothing is silently truncated
 * by the database after passing validation here.
 */
function positiveMetres(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;

  const parsed = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new BadRequestException(`${field} must be a positive measurement in metres`);
  }
  if (parsed >= 1000) {
    throw new BadRequestException(`${field} must be less than 1000 metres`);
  }
  return Math.round(parsed * 100) / 100;
}

/**
 * Absent, empty and null all mean "not recorded" — an operator who does not know
 * their pool volume should not be forced to invent one. Anything present has to
 * be a positive whole number, matching the CHECK constraints on the table.
 */
function positiveInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;

  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`${field} must be a positive whole number`);
  }
  return parsed;
}

/** ISO 3166-1 alpha-2, upper-cased here so the CHECK constraint never sees 'pt'. */
function countryCode(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;

  const code = String(value).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new BadRequestException('countryCode must be two letters, ISO 3166-1 alpha-2');
  }
  return code;
}

/**
 * A degree value, rounded to the six decimal places the column stores.
 *
 * Rounded here rather than left to Postgres so the number the API returns is the
 * number it wrote — otherwise a client that saves and re-reads sees its own
 * input change under it, which looks like a bug and is impossible to explain.
 */
function coordinate(value: unknown, field: string, limit: number): number | null {
  if (value === undefined || value === null || value === '') return null;

  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed < -limit || parsed > limit) {
    throw new BadRequestException(`${field} must be between -${limit} and ${limit} degrees`);
  }
  return Math.round(parsed * 1e6) / 1e6;
}
