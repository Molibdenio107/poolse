import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import {
  addSlots,
  archiveSlot,
  DAY_GROUPS,
  listSlots,
  SlotInUseError,
  SlotOverlapError,
  updateSlot,
  type DayGroup,
  type SlotInput,
  type TimeSlot,
} from './slots.repository.js';

/**
 * A facility's schedule grid — POOLSE-44.
 *
 * Its own controller rather than more methods on `FacilitiesController`, which
 * is already long and is about sites, pools, hours and analyses. A slot grid is
 * a fourth thing, and it is about to be read by the schedule screen as often as
 * by the editor.
 *
 * Reads are open to any member: the grid is the timetable's shape, and an
 * instructor looking at the week needs it. Writes are owner/admin, like every
 * other change to a facility.
 */
@Controller('facilities/:facilityId/slots')
export class SlotsController {
  /**
   * The whole grid — all three day groups, one season.
   *
   * One request rather than one per group: the editor shows every group and the
   * schedule needs the weekend block beside the weekday one.
   */
  @Get()
  async list(
    @Param('facilityId') facilityId: string,
    @Query('seasonId') seasonId?: string,
  ): Promise<{
    organizationId: string;
    canManage: boolean;
    seasonId: string | null;
    slots: TimeSlot[];
  }> {
    const { organizationId } = currentTenant();

    const { seasonId: season, slots } = await listSlots(
      organizationId,
      facilityId,
      readOptionalId(seasonId),
    );

    return {
      organizationId,
      canManage: hasRole('owner', 'admin'),
      seasonId: season,
      slots,
    };
  }

  /**
   * Adds one slot, or the forty a generated grid produces.
   *
   * One route for both. "Gerar grelha" is this with a longer list — the
   * arithmetic happens on the client so the operator sees the rows before
   * committing to them, and a separate generate endpoint would be a second way
   * to create a slot.
   */
  @Post()
  async add(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ created: number }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const slots = readSlots(body['slots']);

    let result: { created: number } | null;
    try {
      result = await addSlots(organizationId, facilityId, readOptionalId(body['seasonId']), slots);
    } catch (error) {
      throw asHttp(error);
    }

    if (result === null) throw new NotFoundException('No such site, or no season to plan in');
    return result;
  }

  @Patch(':slotId')
  async edit(
    @Param('slotId') slotId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    let updated: boolean;
    try {
      updated = await updateSlot(organizationId, slotId, readSlot(body));
    } catch (error) {
      throw asHttp(error);
    }

    if (!updated) throw new NotFoundException('No such slot');
    return { updated: true };
  }

  @Delete(':slotId')
  async remove(@Param('slotId') slotId: string): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    let archived: boolean;
    try {
      archived = await archiveSlot(organizationId, slotId);
    } catch (error) {
      throw asHttp(error);
    }

    if (!archived) throw new NotFoundException('No such slot');
    return { archived: true };
  }
}

function asHttp(error: unknown): unknown {
  if (error instanceof SlotOverlapError) {
    return new ConflictException({
      message: 'slotOverlap',
      startTime: error.startTime,
      endTime: error.endTime,
    });
  }

  if (error instanceof SlotInUseError) {
    return new ConflictException({ message: 'slotInUse', bookings: error.bookings });
  }

  return error;
}

function readOptionalId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value === '' ? null : value;
}

const GROUPS = new Set<string>(DAY_GROUPS);

/**
 * `HH:MM` off the wire, and the one value worth refusing by name.
 *
 * **`00:00` as an end time is the trap.** `24:00` means midnight-at-the-end and
 * arithmetics to 1440 in the exclusion constraint; `00:00` means
 * midnight-at-the-start and arithmetics to 0, which makes an empty range that
 * overlaps nothing. The CHECK would refuse it anyway — `end_time > start_time`
 * fails — but as a constraint violation rather than as an instruction, and
 * "write 24:00" is the whole of what the operator needs to hear.
 */
function readTime(raw: unknown, field: string, isEnd: boolean): string {
  if (typeof raw !== 'string') throw new BadRequestException(`${field} is required`);

  const value = raw.trim();
  if (!/^([01]\d|2[0-4]):[0-5]\d$/.test(value)) {
    throw new BadRequestException(`${field} must be a time like 09:30`);
  }
  // 24:xx is only ever 24:00.
  if (value.startsWith('24:') && value !== '24:00') {
    throw new BadRequestException(`${field} must be a time like 09:30`);
  }
  if (isEnd && value === '00:00') {
    throw new BadRequestException('endTime cannot be 00:00 — write 24:00 for the end of the day');
  }
  if (!isEnd && value === '24:00') {
    throw new BadRequestException('startTime cannot be 24:00');
  }

  return value;
}

function readSlot(body: Record<string, unknown>): SlotInput {
  const dayGroup = body['dayGroup'];
  if (typeof dayGroup !== 'string' || !GROUPS.has(dayGroup)) {
    throw new BadRequestException(`dayGroup must be one of ${DAY_GROUPS.join(', ')}`);
  }

  const startTime = readTime(body['startTime'], 'startTime', false);
  const endTime = readTime(body['endTime'], 'endTime', true);

  if (endTime <= startTime) {
    throw new BadRequestException('endTime must be after startTime');
  }

  return { dayGroup: dayGroup as DayGroup, startTime, endTime };
}

/**
 * The most slots one request may carry.
 *
 * A day of 15-minute slots from 06:00 to midnight is 72; three day groups of
 * that is 216. Two hundred is past any real grid and stops the generator being
 * used to insert an unbounded batch.
 */
const MAX_SLOTS = 200;

function readSlots(raw: unknown): SlotInput[] {
  if (!Array.isArray(raw)) throw new BadRequestException('slots must be a list');
  if (raw.length === 0) throw new BadRequestException('slots is empty');
  if (raw.length > MAX_SLOTS) {
    throw new BadRequestException(`at most ${MAX_SLOTS} slots in one request`);
  }

  return raw.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new BadRequestException('each slot must be an object');
    }
    return readSlot(entry as Record<string, unknown>);
  });
}
