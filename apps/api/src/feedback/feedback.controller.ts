import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import { CoreRoute } from '../tenant/modules.js';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import {
  archiveFeedback,
  studentFeedback,
  studentIsLive,
  type LessonFeedback,
} from './feedback.repository.js';

/**
 * Lesson feedback, the staff side — POOLSE-116.
 *
 * The family writes through `PUT /app/lessons/:id/feedback` and the register
 * carries a lesson's feedback; this is a student's list and the office's
 * archive. An instructor reads only the lessons they taught
 * (`resolved_instructor_id`), decided in the repository's query; maintenance
 * and families are refused here.
 */
@CoreRoute()
@Controller()
export class FeedbackController {
  @Get('students/:studentId/feedback')
  async forStudent(
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<Paginated<LessonFeedback>> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId, membershipId } = currentTenant();
    if (!(await studentIsLive(organizationId, studentId))) throw new NotFoundException('No such student');
    const instructor = hasRole('owner', 'admin') ? null : membershipId;
    return studentFeedback(organizationId, studentId, instructor, readPageQuery(page, limit));
  }

  /** Owner and admin: abuse, or another child named. Restorable from Arquivados. */
  @Post('feedback/:id/archive')
  async archive(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ archived: true; archiveEntryId: string }> {
    requireRole('owner', 'admin');
    const done = await archiveFeedback(currentTenant().organizationId, id);
    if (done === null) throw new NotFoundException('No such feedback');
    return { archived: true, archiveEntryId: done.archiveEntryId };
  }
}
