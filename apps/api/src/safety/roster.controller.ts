import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole, type MemberRole } from '../tenant/roles.js';
import {
  addDuty,
  onDuty,
  readRoster,
  removeDuty,
  DoubleDutyError,
  NotStaffError,
  PoolOffSiteError,
  type Roster,
} from './roster.repository.js';
import {
  addPeriod,
  endPeriod,
  listPeriods,
  EndInPastError,
  type LifeguardPeriod,
} from './periods.repository.js';
import { PoolseModule } from '../tenant/modules.js';

/**
 * The lifeguard roster — POOLSE-70 slice 2.
 *
 * **Staff read it; owner and admin write it.** Reading is how anybody on the
 * deck knows who is the lifeguard now; deciding it is the office's.
 */

const STAFF: readonly MemberRole[] = ['owner', 'admin', 'instructor', 'maintenance'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

@PoolseModule('incidents')
@Controller('facilities/:facilityId/lifeguard-roster')
export class LifeguardRosterController {
  @Get()
  async read(
    @Param('facilityId', new ParseUUIDPipe()) facilityId: string,
    @Query('from') from?: string,
    @Query('days') days?: string,
  ): Promise<Roster & { periods: LifeguardPeriod[]; canManage: boolean }> {
    requireRole(...STAFF);
    if (from === undefined || !DAY.test(from)) throw new BadRequestException('from is YYYY-MM-DD');
    const span = Math.min(Math.max(Number.parseInt(days ?? '7', 10) || 7, 1), 31);
    const { organizationId } = currentTenant();
    const roster = await readRoster(organizationId, facilityId, from, span);
    if (roster === null) throw new NotFoundException('No such site');
    return {
      ...roster,
      periods: await listPeriods(organizationId, facilityId, from),
      canManage: hasRole('owner', 'admin'),
    };
  }

  /**
   * A vigilance period — who, which tanks, which dates and weekdays, and either
   * the site's opening hours or one typed window. Writes the days at once and
   * answers how many, and how many were already held by that person.
   */
  @Post('periods')
  async addPeriod(
    @Param('facilityId', new ParseUUIDPipe()) facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string; written: number; clashes: number }> {
    requireRole('owner', 'admin');
    const read = (key: string): string =>
      typeof body[key] === 'string' ? (body[key] as string).trim() : '';
    const poolIds = Array.isArray(body['poolIds'])
      ? (body['poolIds'] as unknown[]).filter((id): id is string => typeof id === 'string' && UUID.test(id))
      : [];
    const weekdays = Array.isArray(body['weekdays'])
      ? [...new Set((body['weekdays'] as unknown[]).map(Number))].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
      : [];
    const opening = body['hours'] !== 'fixed';
    const input = {
      membershipId: read('membershipId'),
      poolIds,
      startsOn: read('startsOn'),
      endsOn: read('endsOn'),
      weekdays,
      from: opening ? null : read('from'),
      to: opening ? null : read('to'),
    };

    const fields: Record<string, string> = {};
    if (!UUID.test(input.membershipId)) fields['membershipId'] = 'roster.error.personRequired';
    if (poolIds.length === 0) fields['poolIds'] = 'roster.error.poolsRequired';
    if (weekdays.length === 0) fields['weekdays'] = 'roster.error.weekdaysRequired';
    if (!DAY.test(input.startsOn)) fields['startsOn'] = 'roster.error.dayRequired';
    if (!DAY.test(input.endsOn)) fields['endsOn'] = 'roster.error.dayRequired';
    else if (DAY.test(input.startsOn) && input.endsOn < input.startsOn) fields['endsOn'] = 'roster.error.endBeforeStart';
    else if (DAY.test(input.startsOn) && daysBetween(input.startsOn, input.endsOn) > 400) {
      fields['endsOn'] = 'roster.error.periodTooLong';
    }
    if (!opening) {
      if (!TIME.test(input.from ?? '')) fields['from'] = 'roster.error.timeRequired';
      if (!TIME.test(input.to ?? '') || input.to === input.from) fields['to'] = 'roster.error.timeRequired';
    }
    if (Object.keys(fields).length > 0) {
      throw new BadRequestException({ message: 'Invalid period', fields });
    }

    try {
      const made = await addPeriod(currentTenant().organizationId, facilityId, input);
      if (made === null) throw new NotFoundException('No such site');
      return made;
    } catch (error) {
      if (error instanceof PoolOffSiteError) {
        throw new BadRequestException({ message: 'No such tank here', fields: { poolIds: 'roster.error.poolsRequired' } });
      }
      if (error instanceof NotStaffError) {
        throw new BadRequestException({
          message: 'Only a staff member can be rostered',
          fields: { membershipId: 'roster.error.notStaff' },
        });
      }
      throw error;
    }
  }

  /** Who was on duty on a tank at a moment — the incident form's pre-fill. */
  @Get('on-duty')
  async onDuty(
    @Query('poolId', new ParseUUIDPipe()) poolId: string,
    @Query('at') at?: string,
  ): Promise<{ onDuty: { membershipId: string; name: string | null; licensed: boolean }[] }> {
    requireRole(...STAFF);
    if (at === undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) {
      throw new BadRequestException('at is YYYY-MM-DDTHH:mm');
    }
    return { onDuty: await onDuty(currentTenant().organizationId, poolId, at) };
  }

  @Post()
  async add(
    @Param('facilityId', new ParseUUIDPipe()) facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const read = (key: string): string =>
      typeof body[key] === 'string' ? (body[key] as string).trim() : '';
    const input = {
      poolId: read('poolId'),
      membershipId: read('membershipId'),
      day: read('day'),
      from: read('from'),
      to: read('to'),
    };
    const fields: Record<string, string> = {};
    if (input.poolId === '') fields['poolId'] = 'roster.error.poolRequired';
    if (input.membershipId === '') fields['membershipId'] = 'roster.error.personRequired';
    if (!DAY.test(input.day)) fields['day'] = 'roster.error.dayRequired';
    if (!TIME.test(input.from)) fields['from'] = 'roster.error.timeRequired';
    if (!TIME.test(input.to) || input.to === input.from) fields['to'] = 'roster.error.timeRequired';
    if (Object.keys(fields).length > 0) {
      throw new BadRequestException({ message: 'Invalid duty', fields });
    }

    try {
      const id = await addDuty(currentTenant().organizationId, facilityId, input);
      if (id === null) throw new NotFoundException();
      return { id };
    } catch (error) {
      if (error instanceof PoolOffSiteError) {
        throw new BadRequestException({ message: 'No such tank here', fields: { poolId: 'roster.error.poolRequired' } });
      }
      if (error instanceof NotStaffError) {
        throw new BadRequestException({
          message: 'Only a staff member can be rostered',
          fields: { membershipId: 'roster.error.notStaff' },
        });
      }
      if (error instanceof DoubleDutyError) {
        throw new ConflictException({
          code: 'lifeguard_double',
          message: 'That person is already on this tank then',
        });
      }
      throw error;
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

@PoolseModule('incidents')
@Controller('lifeguard-periods')
export class LifeguardPeriodsController {
  /** Ends a period from a day on — today or later; the days before stay as they are. */
  @Post(':id/end')
  async end(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ removed: number }> {
    requireRole('owner', 'admin');
    const from = typeof body['from'] === 'string' ? body['from'].trim() : '';
    if (!DAY.test(from)) {
      throw new BadRequestException({ message: 'from is YYYY-MM-DD', fields: { from: 'roster.error.dayRequired' } });
    }
    try {
      const ended = await endPeriod(currentTenant().organizationId, id, from);
      if (ended === null) throw new NotFoundException();
      return ended;
    } catch (error) {
      if (error instanceof EndInPastError) {
        throw new BadRequestException({
          code: 'period_end_in_past',
          message: 'A period ends today or later',
          fields: { from: 'roster.error.endInPast' },
        });
      }
      throw error;
    }
  }
}

@PoolseModule('incidents')
@Controller('lifeguard-duties')
export class LifeguardDutiesController {
  @Post(':id/archive')
  async archive(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ removed: true }> {
    requireRole('owner', 'admin');
    if (!(await removeDuty(currentTenant().organizationId, id))) throw new NotFoundException();
    return { removed: true };
  }
}
