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

/**
 * The lifeguard roster — POOLSE-70 slice 2.
 *
 * **Staff read it; owner and admin write it.** Reading is how anybody on the
 * deck knows who is the lifeguard now; deciding it is the office's.
 */

const STAFF: readonly MemberRole[] = ['owner', 'admin', 'instructor', 'maintenance'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

@Controller('facilities/:facilityId/lifeguard-roster')
export class LifeguardRosterController {
  @Get()
  async read(
    @Param('facilityId', new ParseUUIDPipe()) facilityId: string,
    @Query('from') from?: string,
    @Query('days') days?: string,
  ): Promise<Roster & { canManage: boolean }> {
    requireRole(...STAFF);
    if (from === undefined || !DAY.test(from)) throw new BadRequestException('from is YYYY-MM-DD');
    const span = Math.min(Math.max(Number.parseInt(days ?? '7', 10) || 7, 1), 31);
    const roster = await readRoster(currentTenant().organizationId, facilityId, from, span);
    if (roster === null) throw new NotFoundException('No such site');
    return { ...roster, canManage: hasRole('owner', 'admin') };
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

@Controller('lifeguard-duties')
export class LifeguardDutiesController {
  @Post(':id/archive')
  async archive(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ removed: true }> {
    requireRole('owner', 'admin');
    if (!(await removeDuty(currentTenant().organizationId, id))) throw new NotFoundException();
    return { removed: true };
  }
}
