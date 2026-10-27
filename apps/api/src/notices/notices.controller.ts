import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { CoreRoute } from '../tenant/modules.js';
import { familyStudents } from '../students/students.repository.js';
import { noticeTarget, NoticeRefusedError, saveNotice } from './notices.repository.js';

/**
 * *Vou / Não vou* — POOLSE-90 slice 2. A guardian, or the student themselves
 * where `family_may_answer()` admits them, tells the club whether a child is
 * coming to one lesson. It never marks the register.
 *
 * Another family's child, or a lesson the child is not in, is the 404 a
 * stranger gets; a child this reader may not answer for is a 403 with its
 * code; a lesson already started, cancelled or with no turma is a 409.
 */
@CoreRoute()
@Controller('sessions')
export class NoticesController {
  @Put(':id/notices/:studentId')
  async answer(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ going: boolean }> {
    requireRole('guardian', 'student');
    const going = body['going'];
    if (typeof going !== 'boolean') {
      throw new BadRequestException({ message: 'going is true or false', fields: { going: 'app.notice.error.going' } });
    }
    const { organizationId, membershipId } = currentTenant();

    const mine = await familyStudents(organizationId, membershipId);
    if (!mine.some((one) => one.id === studentId)) throw new NotFoundException('No such lesson');
    const target = await noticeTarget(organizationId, membershipId, sessionId, studentId);
    if (target === 'notFound') throw new NotFoundException('No such lesson');
    if (target === 'notYours') {
      throw new ForbiddenException({ code: 'notice_guardian_answers', message: 'app.notice.guardianAnswers' });
    }

    try {
      return await saveNotice(organizationId, membershipId, sessionId, studentId, going);
    } catch (error) {
      if (error instanceof NoticeRefusedError) {
        throw new ConflictException({
          code: error.code,
          message: `app.notice.refused.${error.code}`,
          ...(error.value === null ? {} : { reason: error.value }),
        });
      }
      throw error;
    }
  }
}
