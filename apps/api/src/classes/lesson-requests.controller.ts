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
} from '@nestjs/common';
import { CoreRoute } from '../tenant/modules.js';
import { requireMySession } from '../tenant/assignment.js';
import { requireRole } from '../tenant/roles.js';
import { currentTenant } from '../tenant/tenant.context.js';
import {
  markSeen,
  openRequests,
  requestCover,
  withdrawCover,
  type LessonRequest,
} from './lesson-requests.repository.js';

const MAX_NOTE = 500;

/**
 * A teacher asks for a substitute, one lesson at a time — POOLSE-198. Only for
 * their own lesson; the office answers by naming a stand-in.
 */
@CoreRoute()
@Controller('sessions')
export class CoverRequestsController {
  @Post(':id/cover-request')
  async request(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ requested: true }> {
    requireRole('instructor');
    await requireMySession(id);
    const note = typeof body['note'] === 'string' ? body['note'].trim() : '';
    if (note.length > MAX_NOTE) {
      throw new BadRequestException({ fields: { note: 'app.teaching.noteTooLong' } });
    }
    const { organizationId, membershipId } = currentTenant();
    const outcome = await requestCover(organizationId, id, membershipId, note === '' ? null : note);
    if (outcome === 'over') {
      throw new ConflictException({ code: 'lesson_over', message: 'This lesson needs no cover' });
    }
    if (outcome === 'already_open') {
      throw new ConflictException({ code: 'cover_already_requested', message: 'Already requested' });
    }
    return { requested: true };
  }

  @Post(':id/cover-request/withdraw')
  @HttpCode(204)
  async withdraw(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    requireRole('instructor');
    const { organizationId, membershipId } = currentTenant();
    if (!(await withdrawCover(organizationId, id, membershipId))) {
      throw new NotFoundException('No request of yours on this lesson');
    }
  }
}

/** The office's side: what is waiting, and *Visto*. */
@CoreRoute()
@Controller('lesson-requests')
export class LessonRequestsController {
  @Get()
  async open(): Promise<{ requests: LessonRequest[] }> {
    requireRole('owner', 'admin');
    return { requests: await openRequests(currentTenant().organizationId) };
  }

  @Post(':id/seen')
  @HttpCode(204)
  async seen(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    requireRole('owner', 'admin');
    const { organizationId, membershipId } = currentTenant();
    if (!(await markSeen(organizationId, id, membershipId))) throw new NotFoundException('No such request');
  }
}
