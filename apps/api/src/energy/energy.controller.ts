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
import { hasRole, requireCanArchive, requireRole } from '../tenant/roles.js';
import {
  addMeter,
  addReading,
  archiveMeter,
  archiveReading,
  getMeter,
  listMeters,
  listPools,
  listReadings,
  meterTimezone,
  monthlyConsumption,
  updateMeter,
  MeterConflictError,
  ReadingRefusedError,
  type EnergyMeter,
  type EnergyReading,
  type MeterInput,
  type MeterKind,
  type MeterReads,
  type MonthlyConsumption,
  type Option,
} from './energy.repository.js';

/**
 * Energy — slices 5.1 and 5.2.
 *
 * The same three tiers as planned maintenance, for the same reasons. Reading is
 * open to any member. *Typing in a reading is open to every management login*:
 * the person at the meter cupboard with a torch is the maintenance member, and
 * a form they may not submit is a figure on a scrap of paper. Defining the
 * meters — what is metered, what the dial means — is owner and admin, because
 * `reads` is a decision that makes every subsequent figure right or wrong.
 */

const MANAGEMENT = ['owner', 'admin', 'instructor', 'maintenance'] as const;
const CAN_PLAN = ['owner', 'admin'] as const;

const MAX_NAME = 80;
const MAX_UNIT = 12;
const MAX_NOTES = 2000;
const MAX_NOTE = 500;
/** A dial has at most 14 digits before the point in the schema; this is well under. */
const MAX_VALUE = 99_999_999_999;

const KINDS: readonly MeterKind[] = ['pump', 'heating', 'lighting', 'total', 'other'];
const READS: readonly MeterReads[] = ['cumulative_index', 'interval_consumption'];

interface MeterListResponse {
  meters: EnergyMeter[];
  /** The pickers for the form, only for somebody who may fill it in. */
  pools: Option[];
  canPlan: boolean;
  canRecord: boolean;
}

interface MeterResponse {
  meter: EnergyMeter;
  readings: EnergyReading[];
  /** Twelve months ending this one, every month present. */
  monthly: MonthlyConsumption[];
  pools: Option[];
  canPlan: boolean;
  canRecord: boolean;
}

@Controller('energy')
export class EnergyController {
  @Get('facilities/:facilityId/meters')
  async list(@Param('facilityId') facilityId: string): Promise<MeterListResponse> {
    const { organizationId } = currentTenant();
    const canPlan = hasRole(...CAN_PLAN);

    return {
      meters: await listMeters(organizationId, facilityId),
      pools: canPlan ? await listPools(organizationId, facilityId) : [],
      canPlan,
      canRecord: hasRole(...MANAGEMENT),
    };
  }

  @Post('facilities/:facilityId/meters')
  async create(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole(...CAN_PLAN);
    const { organizationId } = currentTenant();

    try {
      return { id: await addMeter(organizationId, readMeter(body, facilityId)) };
    } catch (error) {
      throw asHttp(error);
    }
  }

  @Get('meters/:meterId')
  async one(@Param('meterId') meterId: string): Promise<MeterResponse> {
    const { organizationId } = currentTenant();

    const meter = await getMeter(organizationId, meterId);
    if (meter === null) throw new NotFoundException('No such meter');

    const timezone = (await meterTimezone(organizationId, meterId)) ?? 'Europe/Lisbon';
    const canPlan = hasRole(...CAN_PLAN);

    return {
      meter,
      readings: await listReadings(organizationId, meterId),
      monthly: await monthlyConsumption(organizationId, meterId, timezone),
      pools: canPlan ? await listPools(organizationId, meter.facilityId) : [],
      canPlan,
      // An archived meter takes no more readings: its series ended when it was
      // swapped out or retired, and a figure typed against it would be a figure
      // on the wrong dial.
      canRecord: hasRole(...MANAGEMENT) && !meter.archived,
    };
  }

  @Patch('meters/:meterId')
  async update(
    @Param('meterId') meterId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole(...CAN_PLAN);
    const { organizationId } = currentTenant();

    // `reads` and `replacedMeterId` are not editable — see `updateMeter`.
    const { facilityId: _f, reads: _r, replacedMeterId: _m, ...input } = readMeter(body, '');

    try {
      if (!(await updateMeter(organizationId, meterId, input))) {
        throw new NotFoundException('No such meter');
      }
      return { updated: true };
    } catch (error) {
      throw asHttp(error);
    }
  }

  @Post('meters/:meterId/archive')
  async remove(@Param('meterId') meterId: string): Promise<{ archived: true }> {
    requireCanArchive();
    const { organizationId } = currentTenant();

    if (!(await archiveMeter(organizationId, meterId))) {
      throw new NotFoundException('No such meter');
    }
    return { archived: true };
  }

  /**
   * A figure off the dial.
   *
   * `takenAt` is required rather than defaulted to now, unlike a task
   * completion: a meter is read on a date the bill or the logbook names, and
   * the month it lands in is the whole point of the figure.
   */
  @Post('meters/:meterId/readings')
  async record(
    @Param('meterId') meterId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ recorded: true }> {
    requireRole(...MANAGEMENT);
    const { organizationId, membershipId } = currentTenant();

    if (membershipId === null) {
      throw new BadRequestException('Only a member of this organization can record a reading');
    }

    const takenAt = moment(body['takenAt'], 'takenAt');
    if (takenAt === null) {
      throw new BadRequestException({ message: 'When was the meter read?', field: 'takenAt' });
    }

    const value = typeof body['value'] === 'number' ? body['value'] : Number(body['value']);
    if (!Number.isFinite(value) || value < 0 || value > MAX_VALUE) {
      throw new BadRequestException({ message: 'The reading must be a number, zero or more', field: 'value' });
    }

    try {
      await addReading(organizationId, meterId, membershipId, {
        takenAt,
        // Three decimals is what the column holds; more would be silently
        // rounded by Postgres, and a client should hear about it from us.
        value: Math.round(value * 1000) / 1000,
        note: text(body['note'], MAX_NOTE, 'note'),
      });
    } catch (error) {
      throw asHttp(error);
    }
    return { recorded: true };
  }

  /** A reading that never happened. Same audience as recording one. */
  @Post('meters/:meterId/readings/archive')
  async unrecord(
    @Param('meterId') meterId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ archived: true }> {
    requireRole(...MANAGEMENT);
    const { organizationId } = currentTenant();

    const takenAt = moment(body['takenAt'], 'takenAt');
    if (takenAt === null) {
      throw new BadRequestException({ message: 'Which reading?', field: 'takenAt' });
    }

    if (!(await archiveReading(organizationId, meterId, takenAt))) {
      throw new NotFoundException('No such reading');
    }
    return { archived: true };
  }
}

function readMeter(body: Record<string, unknown>, facilityId: string): MeterInput {
  const name = text(body['name'], MAX_NAME, 'name');
  if (name === null) {
    throw new BadRequestException({ message: 'A meter needs a name', field: 'name' });
  }

  const kind = body['kind'];
  if (!KINDS.includes(kind as MeterKind)) {
    throw new BadRequestException({ message: 'What does this meter feed?', field: 'kind' });
  }

  // Absent means a dial, which is what a physical meter is. A club typing its
  // monthly bill in says so explicitly.
  const reads = body['reads'] === undefined ? 'cumulative_index' : body['reads'];
  if (!READS.includes(reads as MeterReads)) {
    throw new BadRequestException({ message: 'Is this a dial or a consumption?', field: 'reads' });
  }

  const rawInitial = body['initialIndex'];
  let initialIndex: number | null = null;
  if (rawInitial !== undefined && rawInitial !== null && rawInitial !== '') {
    initialIndex = typeof rawInitial === 'number' ? rawInitial : Number(rawInitial);
    if (!Number.isFinite(initialIndex) || initialIndex < 0 || initialIndex > MAX_VALUE) {
      throw new BadRequestException({
        message: 'The starting index must be a number, zero or more',
        field: 'initialIndex',
      });
    }
    if (reads !== 'cumulative_index') {
      throw new BadRequestException({
        message: 'Only a dial has a starting index',
        field: 'initialIndex',
      });
    }
  }

  return {
    facilityId,
    poolId: id(body['poolId']),
    name,
    kind: kind as MeterKind,
    unit: text(body['unit'], MAX_UNIT, 'unit') ?? 'kWh',
    reads: reads as MeterReads,
    initialIndex,
    replacedMeterId: id(body['replacedMeterId']),
    notes: text(body['notes'], MAX_NOTES, 'notes'),
  };
}

/** Trimmed, capped, and empty becomes null rather than a blank string. */
function text(value: unknown, max: number, field: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) {
    throw new BadRequestException({ message: `That text is longer than ${max} characters`, field });
  }
  return trimmed;
}

/** An optional reference: a non-empty string, or null. */
function id(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** An instant, as ISO, or null when absent. Rubbish is a 400, not "now". */
function moment(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new BadRequestException({ message: 'That is not a date', field });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException({ message: 'That is not a date', field });
  }
  return parsed.toISOString();
}

/**
 * The database's refusals, with their figures — never re-derived here.
 *
 * `energyIndex` carries the neighbouring reading the trigger compared against,
 * so the screen can say "the reading before this one was 41,235" through
 * `t(key, values)`. Same contract as `poolCapacity`.
 */
function asHttp(error: unknown): unknown {
  if (error instanceof MeterConflictError) {
    if (error.field === 'name') {
      return new ConflictException({
        code: 'meter_name_taken',
        message: 'A meter with that name already exists at this site',
        fields: { name: 'energy.nameTaken' },
      });
    }
    return new BadRequestException({
      message: 'That pool or meter is not at this site',
      field: error.field,
    });
  }
  if (error instanceof ReadingRefusedError) {
    const key =
      error.reason === 'backwards' ? 'energy.readingBackwards'
      : error.reason === 'ahead' ? 'energy.readingAhead'
      : error.reason === 'duplicate' ? 'energy.readingDuplicate'
      : 'energy.meterArchived';
    return new ConflictException({
      code: `reading_${error.reason}`,
      message: `Reading refused: ${error.reason}`,
      fields: { value: key },
      energyIndex: { neighbour: error.neighbour, value: error.value },
    });
  }
  return error;
}
