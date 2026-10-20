import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import { RegisterRefusedError } from '../classes/attendance.repository.js';
import { asHttp as classGroupRefusal } from '../classes/classes.controller.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import {
  RevertRefusal,
  listActivity,
  revertChange,
  type ActivityEntry,
  type ActivityKind,
  type Resolution,
} from './activity.repository.js';
import { CoreRoute } from '../tenant/modules.js';

/**
 * *Atividade* and *Reverter* — POOLSE-80.
 *
 * Owner and Admin, in the first line of every handler. An instructor's
 * corrections are what this exists to undo, so an instructor is not the one
 * undoing them, and the tab is absent for them (the screen's `canManage`).
 */
@CoreRoute()
@Controller()
export class ActivityController {
  @Get('students/:id/activity')
  async student(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
  ): Promise<Paginated<ActivityEntry>> {
    requireRole('owner', 'admin');
    return this.list('student', id, page);
  }

  @Get('class-groups/:id/activity')
  async classGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
  ): Promise<Paginated<ActivityEntry>> {
    requireRole('owner', 'admin');
    return this.list('class_group', id, page);
  }

  /**
   * Puts back what one entry changed. `resolve` answers a conflict per field —
   * `before` writes the old value anyway, `current` leaves the field as it is.
   */
  @Post('activity/:entryId/revert')
  @HttpCode(200)
  async revert(
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() body: Record<string, unknown> = {},
  ): Promise<{ reverted: true }> {
    requireRole('owner', 'admin');
    const resolve = parseResolve(body['resolve']);

    try {
      await revertChange(currentTenant().organizationId, entryId, resolve);
    } catch (error) {
      if (error instanceof RevertRefusal) {
        if (error.code === 'not_found') throw new NotFoundException('No such change');
        throw new ConflictException({ code: error.code, message: error.code, ...error.detail });
      }
      if (error instanceof RegisterRefusedError) {
        throw new ConflictException({
          code: `register_${error.reason}`,
          message: `attendance.refused.${error.reason}`,
        });
      }
      throw classGroupRefusal(error);
    }
    return { reverted: true };
  }

  private async list(
    kind: ActivityKind,
    id: string,
    page: string | undefined,
  ): Promise<Paginated<ActivityEntry>> {
    const found = await listActivity(currentTenant().organizationId, kind, id, readPageQuery(page));
    if (found === null) throw new NotFoundException('No such record');
    return found;
  }
}

function parseResolve(raw: unknown): Record<string, Resolution> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestException({ message: 'badResolve' });
  }
  const resolve: Record<string, Resolution> = {};
  for (const [field, answer] of Object.entries(raw)) {
    if (answer !== 'before' && answer !== 'current') {
      throw new BadRequestException({ message: 'badResolve', field });
    }
    resolve[field] = answer;
  }
  return resolve;
}
